// Frame orchestration:
//   water sims -> occluder heightmap -> underwater objects -> G-buffer (sea, ships, particles)
//   -> deferred lighting with occluder shadows -> bloom + grade -> integer-scaled present.

import { drawFullscreen, FULLSCREEN_VS, Program, Target, type GL, type GLCaps } from './gl';
import type { Camera } from './camera';
import type { Screen } from './screen';
import { WaterPass } from './passes/waterPass';
import { LightingPass } from './passes/lightingPass';
import { PostPass } from './passes/postPass';
import { LightList } from './lights';
import { SpriteStackRenderer } from './spriteStack';
import { Particles } from './particles';
import { Ocean, MAX_WAVES } from '../water/ocean';
import { WaveSim } from '../water/waveSim';
import { FluidSim } from '../water/fluidSim';
import type { HullInput, SplatInput } from '../water/simInputs';
import type { Environment } from '../game/environment';
import type { Theater } from '../game/theaters';
import { dev } from '../core/devSettings';
import { hex01 } from '../core/math';
import { SliceAtlas } from '../art/voxel';
import { CAMERA_GLSL } from './shaders/common';

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

export interface FrameInputs {
  camera: Camera;
  ocean: Ocean;
  env: Environment;
  theater: Theater;
  hulls: HullInput[];
  splats: SplatInput[];
  simDt: number;
  time: number;
  flash: number;
  flashCol: [number, number, number];
  bio: number;
  ice: number;
}

export class Renderer {
  gbuf: Target; under: Target; occ: Target; lit: Target;
  water: WaterPass; lighting: LightingPass; post: PostPass;
  lights: LightList;
  stacks: SpriteStackRenderer;
  particles: Particles;
  wave: WaveSim;
  fluid: FluidSim;
  atlas: SliceAtlas;
  private debugProg: Program;
  private waveA = new Float32Array(MAX_WAVES * 4);
  private waveB = new Float32Array(MAX_WAVES * 4);
  private rings = new Float32Array(32);
  private ringCount = 0;
  origin = { x: 0, y: 0 };
  occRect = { x: 0, y: 0, s: 1 };
  stats = { stackInstances: 0, particles: 0, lights: 0, gpuMs: 0 };
  simsOk: boolean;

  constructor(readonly gl: GL, readonly caps: GLCaps, readonly screen: Screen) {
    this.simsOk = caps.floatRT;
    this.gbuf = new Target(gl, ['rgba8', 'rgba16f'], { depth: true });
    this.under = new Target(gl, ['rgba8', 'rgba16f'], { depth: true });
    this.occ = new Target(gl, ['rgba16f'], { filter: gl.LINEAR });
    this.lit = new Target(gl, ['rgba16f'], { filter: gl.LINEAR });
    this.water = new WaterPass(gl);
    this.lighting = new LightingPass(gl);
    this.post = new PostPass(gl);
    this.lights = new LightList(gl);
    this.atlas = new SliceAtlas(2048);
    this.stacks = new SpriteStackRenderer(gl, this.atlas);
    this.particles = new Particles(gl);
    this.wave = new WaveSim(gl, parseInt(dev.str('water.simRes')), dev.num('water.simCell'));
    this.fluid = new FluidSim(gl);
    this.applySimSizes();
    this.debugProg = new Program(gl, 'debug', FULLSCREEN_VS, DEBUG_FS);
    for (const k of ['water.simRes', 'water.simCell', 'water.fluidRes']) dev.on(k, () => this.applySimSizes());
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
      .f1('uRippleScale', dev.num('water.rippleScale'));
  }

  frame(f: FrameInputs) {
    const gl = this.gl, cam = f.camera, sc = this.screen;
    cam.setViewport(sc.W, sc.H);
    cam.snap();
    const O = this.origin;
    O.x = cam.ix / cam.zoom; O.y = cam.iy / (cam.zoom * cam.cosT);
    const bw = cam.bw, bh = cam.bh;
    this.gbuf.resize(bw, bh); this.under.resize(bw, bh); this.lit.resize(bw, bh); this.post.resize(bw, bh);
    const occRes = parseInt(dev.str('light.shadowRes')) || 1024;
    this.occ.resize(occRes, occRes);
    this.stacks.uploadAtlas();

    // ---- ocean uniforms (origin folded into wave phases on the CPU, in double precision)
    this.waveCount = f.ocean.pack(O.x, O.y, this.waveA, this.waveB);
    this.ringCount = f.ocean.packRings(O.x, O.y, this.rings);

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
        this.wave.rasterForces(f.hulls, f.splats, 1 / f.simDt);
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
    const view = cam.viewRect(0);
    const span = Math.max(view.x1 - view.x0, view.y1 - view.y0) + 360;
    const texel = span / occRes;
    const ocx = Math.floor(((view.x0 + view.x1) / 2 - span / 2) / texel) * texel;
    const ocy = Math.floor(((view.y0 + view.y1) / 2 - span / 2) / texel) * texel;
    this.occRect = { x: ocx, y: ocy, s: span };
    const occRel: [number, number, number, number] = [ocx - O.x, ocy - O.y, span, span];
    this.occ.bind();
    gl.clearColor(-50, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendEquationSeparate(gl.MAX, gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE);
    const nInst = this.stacks.build(O.x, O.y);
    this.stats.stackInstances = nInst;
    const ps = this.stacks.pOcc.use();
    ps.i1('uOccluder', 1).f4('uOccRect', ...occRel).tex('uAtlas', 0, this.stacks.atlasTex);
    this.setCam(ps, cam);
    this.stacks.draw();
    const nPart = this.particles.upload(O.x, O.y, f.time);
    this.stats.particles = nPart;
    const po = this.particles.progOcc.use();
    this.setCam(po, cam);
    po.i1('uOccluder', 1).f4('uOccRect', ...occRel).f1('uOccScale', occRes / span).f1('uMaxPx', 64);
    this.particles.draw();
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
    const T = f.theater;
    const pw = this.water.prog.use();
    this.setCam(pw, cam); this.setOcean(pw); this.setSim(pw, 0);
    const ramp = new Float32Array(24);
    T.ramp.forEach((h, i) => ramp.set(hex01(h), i * 3));
    pw.v3a('uRamp', ramp);
    const fc = hex01(T.foam), fs = hex01(T.foamShade), mc = hex01(T.murk);
    pw.f3('uFoamCol', fc[0], fc[1], fc[2]).f3('uFoamShade', fs[0], fs[1], fs[2]).f3('uMurk', mc[0], mc[1], mc[2]);
    pw.f1('uClarity', T.clarity * dev.num('water.clarity')).f1('uHs', Math.max(0.3, f.ocean.hs + f.ocean.params.swellHeight * 0.5))
      .f1('uContrast', dev.num('water.contrast')).f1('uDetail', dev.num('water.detail')).f1('uCrestFoam', dev.num('water.crestFoam'))
      .f1('uTime', f.time).f2('uWind', f.ocean.params.seaState > 0 ? Math.cos(f.ocean.params.windDir) * f.ocean.windSpeed : 0, Math.sin(f.ocean.params.windDir) * f.ocean.windSpeed)
      .i1('uParallax', dev.bool('water.parallax') ? 1 : 0)
      .tex('uDye', 1, this.fluid.dyeTex).f1('uSimCell', this.wave.win.cell)
      .tex('uUnder', 2, this.under.tex[0]).tex('uUnderD', 3, this.under.tex[1])
      .f1('uBio', f.bio).f1('uIce', f.ice);
    if (!(this.simsOk && dev.bool('water.fluid'))) pw.tex('uDye', 1, null);
    this.water.draw(gl);
    gl.depthFunc(gl.LESS);
    const pg = this.stacks.pGbuf.use();
    pg.i1('uOccluder', 0).tex('uAtlas', 0, this.stacks.atlasTex).tex('uNormAtlas', 1, this.stacks.normTex);
    this.setCam(pg, cam); this.setOcean(pg); this.setSim(pg, 2);
    pg.f3('uFoamCol', fc[0], fc[1], fc[2]).i1('uWaterline', dev.bool('water.waterline') ? 1 : 0).f1('uTime', f.time);
    this.stacks.draw();
    const pp = this.particles.prog.use();
    this.setCam(pp, cam);
    pp.i1('uOccluder', 0).f1('uMaxPx', 24);
    this.particles.draw();
    gl.disable(gl.DEPTH_TEST);

    // ---- lighting
    const env = f.env;
    const reach = dev.num('light.reach');
    this.lights.upload(O.x, O.y, cam.viewRect(40), dev.num('light.maxLights'), reach);
    this.stats.lights = this.lights.count;
    this.lit.bind();
    const pl = this.lighting.prog.use();
    this.setCam(pl, cam);
    pl.tex('uAlbedo', 0, this.gbuf.tex[0]).tex('uNormal', 1, this.gbuf.tex[1]).tex('uOcc', 2, this.occ.t).tex('uLights', 3, this.lights.tex)
      .i1('uLightCount', this.lights.count).f4('uOccRect', ...occRel)
      .f3('uAmbient', ...env.ambient).f3('uSky', ...env.sky).f3('uFogCol', ...env.fogColor)
      .f3('uSunDir', env.sunDir.x, env.sunDir.y, env.sunDir.z)
      .f3('uSunCol', env.sunColor[0] * env.sunIntensity, env.sunColor[1] * env.sunIntensity, env.sunColor[2] * env.sunIntensity)
      .f3('uMoonDir', env.moonDir.x, env.moonDir.y, env.moonDir.z)
      .f3('uMoonCol', env.moonColor[0] * env.moonIntensity, env.moonColor[1] * env.moonIntensity, env.moonColor[2] * env.moonIntensity)
      .f1('uReach', reach).f1('uStrength', dev.num('light.strength')).f1('uAmbientFill', dev.num('light.ambient'))
      .f1('uSoft', dev.num('light.softness')).f1('uBands', dev.num('light.bands')).f1('uDitherAmt', dev.num('light.dither'))
      .f1('uBeams', dev.num('light.beams')).f1('uSpec', dev.num('light.specular')).f1('uReflect', dev.num('water.reflection'))
      .f1('uFog', Math.min(0.85, env.fogDensity * dev.num('light.fog') * 0.55)).f1('uLightning', env.lightning * 0.35)
      .f1('uHaze', 0.35 + env.fogDensity * 2.2)
      .i1('uSteps', dev.num('light.shadowSteps')).i1('uShadows', dev.bool('light.shadows') ? 1 : 0)
      .i1('uCelShadows', dev.bool('light.celestialShadows') ? 1 : 0).i1('uLightsOn', dev.bool('light.enabled') ? 1 : 0)
      .i1('uView', ({ albedo: 1, normal: 2, height: 3, light: 4 } as Record<string, number>)[dev.str('debug.view')] ?? 0);
    this.lighting.draw(gl);

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
    const bloom = dev.num('light.bloom');
    this.post.bloom(this.lit.t, bloom);
    const grade = ({ theater: 0, neutral: 1, newsreel: 2, technicolor: 3, uboat: 4, mono: 5 } as Record<string, number>)[dev.str('display.grade')] ?? 0;
    this.post.present({
      lit: this.lit.t, pw: sc.pw, ph: sc.ph, S: sc.S, shiftX: Math.round(cam.fx * sc.S), shiftY: Math.round(cam.fy * sc.S), bw, bh,
      bloom, vignette: dev.num('display.vignette'), grain: dev.num('display.grain'), scan: dev.num('display.scanlines'),
      time: f.time, grade, flash: f.flash, flashCol: f.flashCol,
    });
  }
}
