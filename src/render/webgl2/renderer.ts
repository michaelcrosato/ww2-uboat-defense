// Frame orchestration:
//   water sims -> occluder heightmap -> underwater objects -> G-buffer (sea, ships, particles)
//   -> deferred lighting with occluder shadows -> bloom + grade -> integer-scaled present.

import { createGL, drawFullscreen, FULLSCREEN_VS, Program, Target, type GL, type GLCaps } from './gl';
import type { Camera } from '../camera';
import type { Screen } from '../screen';
import type { RenderScene } from '../scene';
import type { BackendInfo, BackendStats, FrameParams, RenderBackend } from '../types';
import { WaterPass } from './passes/waterPass';
import { LightingPass } from './passes/lightingPass';
import { PostPass } from './passes/postPass';
import { LIGHT_FLOATS, MAX_LIGHTS, packLights } from '../lights';
import { packDecals, packEmitters, packForces, packParticles, packStacks } from '../pack';
import { MAX_GI_EMITTERS } from '../fx';
import { SpriteStackRenderer } from './spriteStack';
import { ParticlesGL } from './particlesGL';
import { FxGL } from './fxGL';
import { GiPassGL } from './passes/giPass';
import { DecalsGL } from './decalsGL';
import { MAX_WAVES } from '../../water/ocean';
import { WaveSim } from './water/waveSim';
import { FluidSim } from './water/fluidSim';
import { dev } from '../../core/devSettings';
import { CAMERA_GLSL } from './glsl/common';
import { postParams } from '../common/post';
import { giRes, lightParams, occluderRect, occluderRes, seaTop, smokeLight, waterParams } from '../common/frameUniforms';

const DEBUG_FS = /* glsl */ `#version 300 es
precision highp float;
${CAMERA_GLSL}
uniform sampler2D uTex;
uniform vec4 uRect;
uniform int uMode;
out vec4 o;
void main() {
  vec2 p = pixToWorld(gl_FragCoord.xy, 0.0);
  vec2 uv = (p - uRect.xy) / uRect.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { o = vec4(0.05, 0.0, 0.08, 1.0); return; }
  vec4 t = texture(uTex, uv);
  if (uMode == 0) o = vec4(0.5 + t.r * 0.5, 0.5 - t.r * 0.5, 0.5 + t.g * 0.1, 1.0);
  else if (uMode == 1) o = vec4(0.5 + t.xy * 0.08, 0.5, 1.0);
  else if (uMode == 2) o = vec4(t.r, t.g + t.a * 0.5, t.b + t.a, 1.0);
  else o = vec4(clamp(t.r * 0.05 + 0.2, 0.0, 1.0), t.a * 0.3, clamp(t.r * 0.02, 0.0, 1.0), 1.0);
}`;

export class WebGL2Backend implements RenderBackend {
  readonly gl: GL;
  readonly caps: GLCaps;
  readonly info: BackendInfo;
  gbuf: Target; under: Target; occ: Target; lit: Target;
  water: WaterPass; lighting: LightingPass; post: PostPass;
  lightTex: WebGLTexture;
  lightCount = 0;
  stacks: SpriteStackRenderer;
  particles: ParticlesGL;
  fx: FxGL;
  gi: GiPassGL;
  decals: DecalsGL;
  private decalData: Float32Array<ArrayBuffer> = new Float32Array(512);
  private giPrev: { x: number; y: number; s: number; n: number } | null = null;
  private giFrame = 0;
  private emitData: Float32Array<ArrayBuffer> = new Float32Array(MAX_GI_EMITTERS * 16);
  wave: WaveSim;
  fluid: FluidSim;
  private debugProg: Program;
  // CPU staging for packed scene data (grown on demand by the packers)
  private stackData = new Float32Array(2048 * 20);
  private partData = new Float32Array(4096 * 12);
  private forceData = new Float32Array(64 * 20);
  private lightData = new Float32Array(MAX_LIGHTS * LIGHT_FLOATS);
  private waveA = new Float32Array(MAX_WAVES * 4);
  private waveB = new Float32Array(MAX_WAVES * 4);
  private rings = new Float32Array(32);
  private ringCount = 0;
  origin = { x: 0, y: 0 };
  occRect = { x: 0, y: 0, s: 1 };
  /** highest occluder or smoke top this frame (m): shadow rays stop climbing past it */
  private occTop = 0;
  stats: BackendStats = { stackInstances: 0, particles: 0, lights: 0, gpuMs: 0 };
  simsOk: boolean;
  private zeroTex: WebGLTexture;
  private unsub: (() => void)[] = [];

  constructor(readonly screen: Screen) {
    const { gl, caps } = createGL(screen.canvas);
    this.gl = gl; this.caps = caps;
    this.info = { kind: 'webgl2', adapter: caps.renderer, computeSims: false, features: [caps.floatRT ? 'float-rt' : 'no-float-rt', ...(caps.floatLinear ? ['float-linear'] : [])] };
    this.simsOk = caps.floatRT;
    // bound in place of the dye when the fluid sim is off (an unbound sampler reads (0,0,0,1) = burning oil)
    this.zeroTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.zeroTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);   // no mips: must not be mip-filtered
    this.gbuf = new Target(gl, ['rgba8', 'rgba16f'], { depth: true });
    this.under = new Target(gl, ['rgba8', 'rgba16f'], { depth: true });
    this.occ = new Target(gl, ['rgba16f'], { filter: gl.LINEAR });
    this.lit = new Target(gl, ['rgba16f'], { filter: gl.LINEAR });
    this.water = new WaterPass(gl);
    this.lighting = new LightingPass(gl);
    this.post = new PostPass(gl);
    this.lightTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.lightTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 4, MAX_LIGHTS, 0, gl.RGBA, gl.FLOAT, null);
    this.stacks = new SpriteStackRenderer(gl);
    this.particles = new ParticlesGL(gl);
    this.fx = new FxGL(gl);
    this.gi = new GiPassGL(gl);
    this.decals = new DecalsGL(gl);
    this.wave = new WaveSim(gl, parseInt(dev.str('water.simRes')), dev.num('water.simCell'));
    this.fluid = new FluidSim(gl);
    this.applySimSizes();
    this.debugProg = new Program(gl, 'debug', FULLSCREEN_VS, DEBUG_FS);
    for (const k of ['water.simRes', 'water.simCell', 'water.fluidRes']) this.unsub.push(dev.on(k, () => this.applySimSizes()));
  }

  resize() { /* targets follow the camera buffer size every frame */ }
  resetSims() { this.simNeedsReset = true; }
  whenIdle() { this.gl.finish(); return Promise.resolve(); }
  dispose() {
    for (const u of this.unsub) u();
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  applySimSizes() {
    const n = parseInt(dev.str('water.simRes')) || 768;
    const nf = parseInt(dev.str('water.fluidRes')) || 256;
    this.wave.resize(n, dev.num('water.simCell'));
    // keep window shifts aligned with whole fluid cells
    this.wave.win.quant = Math.max(1, Math.round(n / nf));
    this.fluid.resize(Math.round(n / this.wave.win.quant), n);
    this.simNeedsReset = true;
  }
  simNeedsReset = true;

  private setCam(p: Program, cam: Camera) {
    p.f4('uCam', 0, 0, cam.zoom, 0).f2('uTilt', cam.cosT, cam.sinT).f2('uBuf', cam.bw, cam.bh).f2('uPixOff', cam.ix, cam.iy);
  }
  private setOcean(p: Program) {
    p.v4a('uWaveA', this.waveA).v4a('uWaveB', this.waveB).i1('uWaveCount', dev.bool('water.swell') ? this.waveCount : 0)
      .v4a('uRings', this.rings).i1('uRingCount', this.ringCount).f1('uSwellScale', 1);
  }
  private waveCount = 0;
  private setSim(p: Program, unit: number) {
    const w = this.wave.win;
    p.tex('uWave', unit, this.wave.heightTex)
      .f4('uSimRect', w.ox - this.origin.x, w.oy - this.origin.y, w.size, w.size)
      .i1('uSimOn', this.simsOk && dev.bool('water.sim') ? 1 : 0)
      .f1('uRippleScale', dev.num('water.rippleScale')).f1('uSeaTop', this.seaTop);
  }
  private seaTop = 0;

  render(scene: RenderScene, f: FrameParams) {
    const gl = this.gl, cam = f.camera, sc = this.screen;
    cam.setViewport(sc.W, sc.H);
    cam.snap();
    const O = this.origin;
    O.x = cam.ix / cam.zoom; O.y = cam.iy / (cam.zoom * cam.cosT);
    const bw = cam.bw, bh = cam.bh;
    this.gbuf.resize(bw, bh); this.under.resize(bw, bh); this.lit.resize(bw, bh); this.post.resize(bw, bh);
    const occRes = occluderRes();
    this.occ.resize(occRes, occRes);
    this.stacks.uploadAtlas(scene.atlas);
    // ---- GPU effect particles: new ones uploaded, every slot integrated by transform feedback
    const fx = scene.fx;
    if (fx.cap !== FxGL.CAP) { fx.cap = FxGL.CAP; fx.clear(); }
    this.fx.simulate(fx, f.fxDt, f.time, scene.particles.wind);

    // ---- ocean uniforms (origin folded into wave phases on the CPU, in double precision)
    this.waveCount = f.ocean.pack(O.x, O.y, this.waveA, this.waveB);
    this.ringCount = f.ocean.packRings(O.x, O.y, this.rings);
    this.seaTop = seaTop(this.waveA, dev.bool('water.swell') ? this.waveCount : 0, this.rings, this.ringCount, dev.num('water.rippleScale'));

    // ---- water sims
    const simOn = this.simsOk && dev.bool('water.sim');
    const fluidOn = this.simsOk && dev.bool('water.fluid');
    if (simOn || fluidOn) {
      if (this.simNeedsReset) { this.wave.win.reset(cam.x, cam.y); this.wave.clear(); this.fluid.clear(); this.simNeedsReset = false; }
      const [dx, dy] = this.wave.follow(cam.x, cam.y);
      if (dx || dy) this.fluid.shift(dx, dy);
      this.wave.c = dev.num('water.waveSpeed');
      this.wave.damping = dev.num('water.simDamping');
      this.wave.hullPush = dev.num('water.hullPush');
      this.wave.foamAmount = dev.num('water.foamAmount');
      if (f.simDt > 0) {
        const forces = packForces(scene.hulls, scene.splats, this.wave.win.ox, this.wave.win.oy, 1 / f.simDt, this.forceData);
        this.forceData = forces.data;
        this.wave.rasterForces(forces.data, forces.count);
        if (simOn) this.wave.step(f.simDt);
        if (fluidOn) {
          this.fluid.vorticity = dev.num('water.vorticity');
          this.fluid.iterations = dev.num('water.pressureIters');
          this.fluid.foamDecay = dev.num('water.foamDecay');
          this.fluid.step(f.simDt, this.wave.win.size, this.wave.force);
        }
      }
    }

    // ---- occluder heightmap (world aligned, snapped to texels so shadows do not shimmer)
    this.occRect = occluderRect(cam, occRes);
    const { x: ocx, y: ocy, s: span } = this.occRect;
    const occRel: [number, number, number, number] = [ocx - O.x, ocy - O.y, span, span];
    this.occ.bind();
    gl.clearColor(-50, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendEquationSeparate(gl.MAX, gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE);
    // only what can be seen or shade the view: the occluder window is the view plus a shadow margin
    const cull = { x0: ocx, y0: ocy, x1: ocx + span, y1: ocy + span };
    const st = packStacks(scene.stacks, O.x, O.y, this.stackData, cull);
    this.stackData = st.data;
    this.stacks.set(st.data, st.count);
    this.stats.stackInstances = st.count;
    const ps = this.stacks.pOcc.use();
    ps.i1('uOccluder', 1).f4('uOccRect', ...occRel).tex('uAtlas', 0, this.stacks.atlasTex);
    this.setCam(ps, cam);
    this.stacks.draw();
    const pk = packParticles(scene.particles, O.x, O.y, f.time, this.partData, cull);
    this.partData = pk.data;
    this.occTop = Math.max(st.top, pk.top) + 1;
    this.particles.upload(pk.data, pk.count);
    this.stats.particles = pk.count;
    const po = this.particles.progOcc.use();
    this.setCam(po, cam);
    po.i1('uOccluder', 1).f4('uOccRect', ...occRel).f1('uOccScale', occRes / span).f1('uMaxPx', 64);
    this.particles.draw();
    this.fx.uniforms(O.x, O.y, f.time, 160, [1, 1, 1], occRel, occRes, 1);
    this.setCam(this.fx.draw, cam);
    this.fx.drawOcc();
    gl.blendEquation(gl.FUNC_ADD);
    gl.disable(gl.BLEND);

    // ---- underwater: submerged parts of everything (depth = distance below surface)
    this.under.bind();
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    const pu = this.stacks.pUnder.use();
    pu.i1('uOccluder', 0).tex('uAtlas', 0, this.stacks.atlasTex);
    this.setCam(pu, cam); this.setOcean(pu); this.setSim(pu, 1);
    this.stacks.draw();

    // ---- G-buffer
    this.gbuf.bind();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.ALWAYS);
    const W = waterParams(f);
    const pw = this.water.prog.use();
    this.setCam(pw, cam); this.setOcean(pw); this.setSim(pw, 0);
    const ramp = new Float32Array(24);
    W.ramp.forEach((c, i) => ramp.set(c, i * 3));
    pw.v3a('uRamp', ramp);
    const fc = W.foamCol;
    pw.f3('uFoamCol', ...W.foamCol).f3('uFoamShade', ...W.foamShade).f3('uMurk', ...W.murk);
    pw.f1('uClarity', W.clarity).f1('uHs', W.hs)
      .f1('uContrast', W.contrast).f1('uDetail', W.detail).f1('uCrestFoam', W.crestFoam)
      .f1('uTime', W.time).f2('uWind', W.wind[0], W.wind[1])
      .i1('uParallax', W.parallax ? 1 : 0)
      .tex('uDye', 1, this.fluid.dyeTex).f1('uSimCell', this.wave.win.cell)
      .tex('uUnder', 2, this.under.tex[0]).tex('uUnderD', 3, this.under.tex[1])
      .f1('uBio', W.bio).f1('uIce', W.ice);
    if (!(this.simsOk && dev.bool('water.fluid'))) pw.tex('uDye', 1, this.zeroTex);
    this.water.draw(gl);
    gl.depthFunc(gl.LESS);
    const pg = this.stacks.pGbuf.use();
    pg.i1('uOccluder', 0).tex('uAtlas', 0, this.stacks.atlasTex).tex('uNormAtlas', 1, this.stacks.normTex);
    this.setCam(pg, cam); this.setOcean(pg); this.setSim(pg, 2);
    pg.f3('uFoamCol', fc[0], fc[1], fc[2]).i1('uWaterline', dev.bool('water.waterline') ? 1 : 0).f1('uTime', f.time);
    this.stacks.draw();
    // ground decals (craters, scorch) over the land's albedo
    const dk = packDecals(scene.decals, O.x, O.y, this.decalData, { x0: ocx, y0: ocy, x1: ocx + span, y1: ocy + span });
    this.decalData = dk.data;
    this.decals.set(dk.data, dk.count);
    this.setCam(this.decals.prog.use(), cam);
    this.decals.draw();
    const pp = this.particles.prog.use();
    this.setCam(pp, cam);
    pp.i1('uOccluder', 0).f1('uMaxPx', 24);
    this.particles.draw();
    gl.disable(gl.DEPTH_TEST);

    // ---- lighting
    const L = lightParams(f);
    const lp = packLights(scene.lights, O.x, O.y, cam.viewRect(40), dev.num('light.maxLights'), L.reach, this.lightData);
    this.lightCount = lp.count;
    gl.bindTexture(gl.TEXTURE_2D, this.lightTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 4, MAX_LIGHTS, gl.RGBA, gl.FLOAT, lp.data);
    this.stats.lights = lp.count;
    // ---- global illumination over the occluder window (see passes/giPass.ts)
    const giN = giRes(), giOn = L.gi > 0;
    if (giOn) {
      const R = this.occRect, pv = this.giPrev && this.giPrev.n === giN ? this.giPrev : null;
      const em = packEmitters(scene.fx.emitters, O.x, O.y, 45 * dev.num('light.giFire'), this.emitData);
      const w = this.wave.win;
      this.gi.render({
        N: giN, wallH: dev.num('light.giWall'), frame: this.giFrame++, rays: dev.num('light.giRays'), steps: 32,
        bounce: dev.num('light.giBounce'), blend: 1 - dev.num('light.giHistory'), lightGain: 0.35, clamp: 12, reach: dev.num('light.giReach'),
        occRel, cur: [R.x, R.y, R.s], prev: pv ? [pv.x, pv.y, pv.s] : null,
        sim: [w.ox - O.x, w.oy - O.y, w.size], oilGain: fluidOn ? 1 : 0,
        lightTex: this.lightTex, lightCount: lp.count, emitters: em.data, emitterCount: em.count,
      }, this.occ.t, fluidOn ? this.fluid.dyeTex : this.zeroTex, () => {
        this.fx.uniforms(O.x, O.y, f.time, 160, [1, 1, 1], occRel, occRes, 1);
        this.fx.setGi(giN / span, giN, dev.num('light.giEmit'), span / giN);
        this.setCam(this.fx.draw, cam);
        this.fx.drawEmit();
      });
      this.giPrev = { x: R.x, y: R.y, s: R.s, n: giN };
    } else this.giPrev = null;
    this.lit.bind();
    const pl = this.lighting.prog.use();
    this.setCam(pl, cam);
    pl.tex('uAlbedo', 0, this.gbuf.tex[0]).tex('uNormal', 1, this.gbuf.tex[1]).tex('uOcc', 2, this.occ.t).tex('uLights', 3, this.lightTex)
      .i1('uLightCount', this.lightCount).f4('uOccRect', ...occRel).f1('uOccTop', this.occTop)
      .f3('uAmbient', ...L.ambient).f3('uSky', ...L.sky).f3('uFogCol', ...L.fogCol)
      .f3('uSunDir', ...L.sunDir).f3('uSunCol', ...L.sunCol).f3('uMoonDir', ...L.moonDir).f3('uMoonCol', ...L.moonCol)
      .f1('uAo', L.ao).f1('uReach', L.reach).f1('uStrength', L.strength).f1('uAmbientFill', L.ambientFill)
      .f1('uSoft', L.soft).f1('uBands', L.bands).f1('uDitherAmt', L.ditherAmt)
      .f1('uBeams', L.beams).f1('uSpec', L.spec).f1('uReflect', L.reflect)
      .f1('uFog', L.fog).f1('uLightning', L.lightning).f1('uHaze', L.haze)
      .i1('uSteps', L.steps).i1('uShadows', L.shadows ? 1 : 0)
      .i1('uCelShadows', L.celShadows ? 1 : 0).i1('uLightsOn', L.lightsOn ? 1 : 0).i1('uView', L.view)
      .tex('uGI', 4, giOn ? this.gi.tex : this.zeroTex).f2('uGIp', giOn && this.gi.tex ? L.gi : 0, giN);
    this.lighting.draw(gl);
    // effect particles over the lit image, depth-tested against the G-buffer
    this.fx.uniforms(O.x, O.y, f.time, 160, smokeLight(L), occRel, occRes, dev.num('fx.intensity'));
    this.setCam(this.fx.draw, cam);
    this.fx.drawLit(this.lit.t, this.gbuf.depth, bw, bh);

    // debug texture views drawn straight into the lit buffer
    const dv = dev.str('debug.view');
    if (dv === 'wave' || dv === 'fluid' || dv === 'foam' || dv === 'occluder') {
      const pd = this.debugProg.use();
      this.setCam(pd, cam);
      const w = this.wave.win;
      if (dv === 'occluder') pd.tex('uTex', 0, this.occ.t).f4('uRect', ...occRel).i1('uMode', 3);
      else pd.tex('uTex', 0, dv === 'wave' ? this.wave.heightTex : dv === 'fluid' ? this.fluid.velTex : this.fluid.dyeTex)
        .f4('uRect', w.ox - O.x, w.oy - O.y, w.size, w.size).i1('uMode', dv === 'wave' ? 0 : dv === 'fluid' ? 1 : 2);
      drawFullscreen(gl);
    }

    // ---- post
    const post = postParams(sc, cam, f, scene.fx);
    this.post.bloom(this.lit.t, post.bloom, post);
    this.post.present({ lit: this.lit.t, ...post });
  }
}
