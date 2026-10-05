// WebGPU backend. Records one command encoder per frame in the same pass order as
// webgl2/renderer.ts: occluder heightmap (stacks + smoke) → underwater (submerged stacks) →
// G-buffer (water, stacks, particles) → deferred lighting (+ debug views) → bloom + present, after
// the water sims (force raster + compute kernels, sims/waterSims.ts).

import type { Screen } from '../screen';
import type { RenderScene } from '../scene';
import type { BackendInfo, BackendStats, FrameParams, RenderBackend } from '../types';
import { postParams } from '../common/post';
import { lightParams, occluderRect, occluderRes, seaTop, waterParams } from '../common/frameUniforms';
import { LIGHT_FLOATS, MAX_LIGHTS, packLights } from '../lights';
import { MAX_WAVES } from '../../water/ocean';
import { dev } from '../../core/devSettings';
import { initGpu, type GpuContext, type GpuInitOpts } from './device';
import { BU, createSamplers, resizeTarget, TU, Ubo, type GpuTarget } from './targets';
import { FRAME_FLOATS, writeFrame } from './wgsl/common';
import { OCEAN_FLOATS, writeOcean } from './wgsl/ocean';
import { PostPassGPU } from './passes/post';
import { TestPatternPass } from './passes/testPattern';
import { WaterPassGPU } from './passes/water';
import { LightingPassGPU } from './passes/lighting';
import { StackPassGPU } from './passes/stacks';
import { ParticlePassGPU } from './passes/particles';
import { DebugPassGPU, DEBUG_TEX_MODES } from './passes/debug';
import { packForces, packParticles, packStacks, type F32 } from '../pack';
import { WaterSimsGPU, type SimParams } from './sims/waterSims';
import { GpuTimer } from './timing';
import type { SplatInput } from '../../water/simInputs';

const HDR: GPUTextureFormat = 'rgba16float';
const MAX_IN_FLIGHT = 2;

export interface WebGPUOpts {
  /** debug (`?testpattern=1`): draw the M2 world-anchored test pattern instead of the scene */
  testPattern?: boolean;
}

interface Passes {
  post: PostPassGPU; water: WaterPassGPU; lighting: LightingPassGPU; stacks: StackPassGPU; particles: ParticlePassGPU;
  debug: DebugPassGPU; pattern: TestPatternPass | null; sims: WaterSimsGPU;
}

function simSizes() {
  return { n: parseInt(dev.str('water.simRes')) || 768, cell: dev.num('water.simCell'), nf: parseInt(dev.str('water.fluidRes')) || 256 };
}
function simParams(): SimParams {
  return {
    sim: dev.bool('water.sim'), fluid: dev.bool('water.fluid'),
    waveSpeed: dev.num('water.waveSpeed'), damping: dev.num('water.simDamping'), hullPush: dev.num('water.hullPush'),
    foamAmount: dev.num('water.foamAmount'), vorticity: dev.num('water.vorticity'), iterations: dev.num('water.pressureIters'),
    foamDecay: dev.num('water.foamDecay'),
  };
}

export class WebGPUBackend implements RenderBackend {
  readonly info: BackendInfo;
  stats: BackendStats = { stackInstances: 0, particles: 0, lights: 0 };
  origin = { x: 0, y: 0 };
  occRect = { x: 0, y: 0, s: 1 };
  private inFlight = 0;
  // targets (recreated lazily on size change)
  private gA: GpuTarget | null = null;      // albedo + material
  private gN: GpuTarget | null = null;      // normal.xy, height, emissive
  private gDepth: GpuTarget | null = null;
  private uC: GpuTarget | null = null;      // underwater color
  private uD: GpuTarget | null = null;      // underwater depth below surface, z
  private uDepth: GpuTarget | null = null;
  private occ: GpuTarget | null = null;     // occluder heightmap (r) + smoke (a)
  private lit: GpuTarget | null = null;
  /** 1×1 zero textures standing in for the ripple / dye sims until M5 */
  private zeroTex: GPUTexture;
  private zeroView: GPUTextureView;
  private frameUbo: Ubo;
  private oceanUbo: Ubo;
  private waveA = new Float32Array(MAX_WAVES * 4);
  private waveB = new Float32Array(MAX_WAVES * 4);
  private rings = new Float32Array(32);
  private lightData = new Float32Array(MAX_LIGHTS * LIGHT_FLOATS);
  private stackData: F32 = new Float32Array(2048 * 20);
  private forceData: F32 = new Float32Array(64 * 20);
  private simReset = true;
  /** sim time + one-shot splats from frames skipped for pacing (the App clears scene.splats) */
  private pendingDt = 0;
  private pendingSplats: SplatInput[] = [];
  private unsub: (() => void)[] = [];
  /** per-pass GPU ms via timestamp queries (null without the feature) */
  private timer: GpuTimer | null;
  private partData: F32 = new Float32Array(4096 * 12);
  // readback present (test hook): offscreen frame → mapped buffer → 2D canvas
  private outTex: GpuTarget | null = null;
  private readBuf: GPUBuffer | null = null;
  private reading = false;
  private img: ImageData | null = null;

  private constructor(readonly screen: Screen, readonly g: GpuContext, private p: Passes, frameUbo: Ubo, oceanUbo: Ubo) {
    this.info = { kind: 'webgpu', adapter: g.adapterName, computeSims: true, features: g.features };
    for (const k of ['water.simRes', 'water.simCell', 'water.fluidRes']) this.unsub.push(dev.on(k, () => {
      const z = simSizes();
      this.p.sims.resize(z.n, z.cell, z.nf);
      this.simReset = true;
    }));
    this.frameUbo = frameUbo; this.oceanUbo = oceanUbo;
    this.zeroTex = g.device.createTexture({ label: 'zero', format: HDR, size: { width: 1, height: 1 }, usage: TU.TEXTURE_BINDING });
    this.zeroView = this.zeroTex.createView();
    this.timer = g.hasTimestamps ? new GpuTimer(g.device, ['sims', 'occluder', 'under', 'gbuffer', 'lighting', 'present']) : null;
    this.stats.passMs = this.timer?.ms;
  }

  /** throws on any init failure (no adapter, compile/validation error) so the caller can fall back */
  static async create(screen: Screen, opts: GpuInitOpts = {}, wopts: WebGPUOpts = {}): Promise<WebGPUBackend> {
    const g = await initGpu(screen.canvas, opts);
    try {
      const samplers = createSamplers(g.device);
      const frameUbo = new Ubo(g.device, FRAME_FLOATS, 'frame');
      const oceanUbo = new Ubo(g.device, OCEAN_FLOATS, 'ocean');
      const passes: Passes = {
        post: await PostPassGPU.create(g, samplers),
        water: await WaterPassGPU.create(g, samplers),
        lighting: await LightingPassGPU.create(g, samplers, HDR),
        stacks: await StackPassGPU.create(g, samplers),
        particles: await ParticlePassGPU.create(g),
        debug: await DebugPassGPU.create(g, samplers, HDR),
        pattern: wopts.testPattern ? await TestPatternPass.create(g, frameUbo.buffer, HDR) : null,
        sims: await (() => { const z = simSizes(); return WaterSimsGPU.create(g, samplers, z.n, z.cell, z.nf); })(),
      };
      if (g.lost) throw new Error(g.lost);
      return new WebGPUBackend(screen, g, passes, frameUbo, oceanUbo);
    } catch (e) {
      g.device.destroy();
      throw e;
    }
  }

  /** non-null once the device is lost or errored: the App swaps to WebGL2 */
  get lost() { return this.g.lost; }

  resize() { /* the canvas drawing buffer follows Screen; targets follow the camera buffer lazily */ }
  resetSims() { this.simReset = true; }
  strictFrames = false;
  async whenIdle() { await this.g.device.queue.onSubmittedWorkDone(); }

  /** (re)create size-dependent targets; returns true when any view changed */
  private ensureTargets(bw: number, bh: number, occRes: number): boolean {
    const d = this.g.device;
    let ch = false, c: boolean;
    [this.gA, c] = resizeTarget(d, this.gA, 'rgba8unorm', bw, bh, 0, 'gbuf.albedo'); ch ||= c;
    [this.gN, c] = resizeTarget(d, this.gN, HDR, bw, bh, 0, 'gbuf.normal'); ch ||= c;
    [this.gDepth, c] = resizeTarget(d, this.gDepth, 'depth24plus', bw, bh, 0, 'gbuf.depth'); ch ||= c;
    [this.uC, c] = resizeTarget(d, this.uC, 'rgba8unorm', bw, bh, 0, 'under.color'); ch ||= c;
    [this.uD, c] = resizeTarget(d, this.uD, HDR, bw, bh, 0, 'under.depth'); ch ||= c;
    [this.uDepth, c] = resizeTarget(d, this.uDepth, 'depth24plus', bw, bh, 0, 'under.z'); ch ||= c;
    [this.occ, c] = resizeTarget(d, this.occ, HDR, occRes, occRes, 0, 'occluder'); ch ||= c;
    [this.lit, c] = resizeTarget(d, this.lit, HDR, bw, bh, 0, 'lit'); ch ||= c;
    return ch;
  }

  render(scene: RenderScene, f: FrameParams) {
    if (this.g.lost) return;
    if (this.inFlight >= MAX_IN_FLIGHT && !this.strictFrames) {
      // skip this frame but keep what the sims would have consumed
      this.pendingDt += f.simDt;
      if (f.simDt > 0) this.pendingSplats.push(...scene.splats);
      return;
    }
    const simDt = Math.min(0.1, f.simDt + this.pendingDt);
    const splats = this.pendingSplats.length ? [...this.pendingSplats, ...scene.splats] : scene.splats;
    this.pendingDt = 0;
    this.pendingSplats = [];
    const cam = f.camera, sc = this.screen, d = this.g.device, P = this.p;
    cam.setViewport(sc.W, sc.H);
    cam.snap();
    const O = this.origin;
    O.x = cam.ix / cam.zoom; O.y = cam.iy / (cam.zoom * cam.cosT);
    const bw = cam.bw, bh = cam.bh;
    const occRes = occluderRes();
    if (this.ensureTargets(bw, bh, occRes)) {
      P.post.setInputs(this.lit!.view, bw, bh);
      P.lighting.setInputs({ frame: this.frameUbo.buffer, albedo: this.gA!.view, normal: this.gN!.view, occ: this.occ!.view });
    }
    const enc = d.createCommandEncoder({ label: 'frame' });
    const T = this.timer;
    T?.begin();
    const tw = (name: string) => T?.writes(name);

    // ---- water sims (window follows the camera in whole cells)
    const sp = simParams(), S = P.sims, win = S.win;
    if (sp.sim || sp.fluid) {
      S.follow(enc, cam.x, cam.y, this.simReset);
      this.simReset = false;
      if (simDt > 0) {
        const forces = packForces(scene.hulls, splats, win.ox, win.oy, 1 / simDt, this.forceData);
        this.forceData = forces.data;
        S.step(enc, simDt, sp, forces.data, forces.count, tw('sims'));
      }
    }
    const simRel = { x: win.ox - O.x, y: win.oy - O.y, size: win.size, cell: win.cell, on: sp.sim };
    P.water.setInputs({ frame: this.frameUbo.buffer, ocean: this.oceanUbo.buffer, wave: S.heightView, dye: sp.fluid ? S.dyeView : this.zeroView, under: this.uC!.view, underD: this.uD!.view });
    P.stacks.uploadAtlas(scene.atlas);
    P.stacks.setInputs({ frame: this.frameUbo.buffer, ocean: this.oceanUbo.buffer, wave: S.heightView });
    P.particles.setFrame(this.frameUbo.buffer);

    // ---- per-frame uniforms (origin folded into wave phases on the CPU, in double precision)
    writeFrame(this.frameUbo.f, cam);
    this.frameUbo.write();
    const W = waterParams(f);
    const waveCount = f.ocean.pack(O.x, O.y, this.waveA, this.waveB);
    const ringCount = f.ocean.packRings(O.x, O.y, this.rings);
    writeOcean(this.oceanUbo.f, this.waveA, this.waveB, W.swell ? waveCount : 0, this.rings, ringCount);
    this.oceanUbo.write();
    P.water.write(W, simRel);
    this.occRect = occluderRect(cam, occRes);
    const occRel: [number, number, number, number] = [this.occRect.x - O.x, this.occRect.y - O.y, this.occRect.s, this.occRect.s];
    const L = lightParams(f);
    const lp = packLights(scene.lights, O.x, O.y, cam.viewRect(40), dev.num('light.maxLights'), L.reach, this.lightData);
    this.lightData = lp.data;
    this.stats.lights = lp.count;
    // only what can be seen or shade the view: the occluder window is the view plus a shadow margin
    const R = this.occRect, cull = { x0: R.x, y0: R.y, x1: R.x + R.s, y1: R.y + R.s };
    const st = packStacks(scene.stacks, O.x, O.y, this.stackData, cull);
    this.stackData = st.data;
    const top = seaTop(this.waveA, W.swell ? waveCount : 0, this.rings, ringCount, W.rippleScale);
    P.stacks.write(occRel, { ...simRel, rippleScale: W.rippleScale }, W.foamCol, dev.bool('water.waterline'), f.time, st.data, st.count, top);
    this.stats.stackInstances = st.count;
    const pk = packParticles(scene.particles, O.x, O.y, f.time, this.partData, cull);
    this.partData = pk.data;
    P.lighting.write(L, occRel, lp.data, lp.count, Math.max(st.top, pk.top) + 1);
    P.particles.write(occRel, occRes, 24, pk.data, pk.count);
    this.stats.particles = pk.count;

    if (P.pattern) {
      P.pattern.encode(enc, this.lit!.view, O.x, O.y, f.time);
    } else {
      // ---- occluder heightmap: max height of stacks (r) + smoke density (a), world aligned
      const op = enc.beginRenderPass({ label: 'occluder', timestampWrites: tw('occluder'), colorAttachments: [{ view: this.occ!.view, loadOp: 'clear', storeOp: 'store', clearValue: { r: -50, g: 0, b: 0, a: 0 } }] });
      P.stacks.encode(op, 'occ');
      P.particles.encode(op, 'occ');
      op.end();
      // ---- underwater: submerged parts of everything (depth = distance below surface)
      const up = enc.beginRenderPass({
        label: 'underwater', timestampWrites: tw('under'),
        colorAttachments: [
          { view: this.uC!.view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } },
          { view: this.uD!.view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } },
        ],
        depthStencilAttachment: { view: this.uDepth!.view, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      P.stacks.encode(up, 'under');
      up.end();
      // ---- G-buffer: sea surface (writes depth), then stacks and particles (depth less)
      const gp = enc.beginRenderPass({
        label: 'gbuffer', timestampWrites: tw('gbuffer'),
        colorAttachments: [
          { view: this.gA!.view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } },
          { view: this.gN!.view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } },
        ],
        depthStencilAttachment: { view: this.gDepth!.view, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      P.water.encode(gp);
      P.stacks.encode(gp, 'gbuf');
      P.particles.encode(gp, 'gbuf');
      gp.end();
      // ---- lighting
      const lpass = enc.beginRenderPass({ label: 'lighting', timestampWrites: tw('lighting'), colorAttachments: [{ view: this.lit!.view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
      P.lighting.encode(lpass);
      lpass.end();
      // debug texture views drawn straight into the lit buffer
      const dv = dev.str('debug.view');
      if (dv in DEBUG_TEX_MODES) {
        const occ = dv === 'occluder';
        const tex = occ ? this.occ!.view : dv === 'wave' ? S.heightView : dv === 'fluid' ? S.velView : S.dyeView;
        P.debug.encode(enc, this.lit!.view, this.frameUbo.buffer, tex, occ ? occRel : [simRel.x, simRel.y, simRel.size, simRel.size], DEBUG_TEX_MODES[dv]);
      }
    }

    // ---- post
    const pp = postParams(sc, cam, f);
    P.post.bloom(enc, pp.bloom);
    if (this.g.present === 'canvas') {
      P.post.present(enc, this.g.context!.getCurrentTexture().createView(), pp, tw('present'));
      T?.resolve(enc);
      d.queue.submit([enc.finish()]);
    } else this.presentReadback(enc, pp, tw('present'));
    T?.read();
    if (T) this.stats.gpuMs = T.total;
    this.inFlight++;
    const t0 = performance.now();
    d.queue.onSubmittedWorkDone().then(() => {
      this.inFlight--;
      // without timestamp queries: submit → done latency (an upper bound on GPU frame time)
      if (!this.timer) {
        const ms = performance.now() - t0;
        this.stats.gpuMs = this.stats.gpuMs ? this.stats.gpuMs * 0.9 + ms * 0.1 : ms;
      }
    }, () => { this.inFlight--; });
  }

  private presentReadback(enc: GPUCommandEncoder, pp: ReturnType<typeof postParams>, timestampWrites?: GPURenderPassTimestampWrites) {
    const d = this.g.device, w = pp.pw, h = pp.ph;
    [this.outTex] = resizeTarget(d, this.outTex, this.g.format, w, h, TU.COPY_SRC, 'readback');
    this.p.post.present(enc, this.outTex.view, pp, timestampWrites);
    this.timer?.resolve(enc);
    // a previous frame is still being read back: present nothing new this frame (the sims still ran)
    if (this.reading) { d.queue.submit([enc.finish()]); return; }
    const bpr = Math.ceil((w * 4) / 256) * 256;
    if (!this.readBuf || this.readBuf.size !== bpr * h) {
      this.readBuf?.destroy();
      this.readBuf = d.createBuffer({ label: 'readback', size: bpr * h, usage: BU.MAP_READ | BU.COPY_DST });
    }
    const buf = this.readBuf;
    enc.copyTextureToBuffer({ texture: this.outTex.texture }, { buffer: buf, bytesPerRow: bpr }, { width: w, height: h });
    d.queue.submit([enc.finish()]);
    this.reading = true;
    buf.mapAsync(1 /* GPUMapMode.READ */).then(() => {
      const src = new Uint8Array(buf.getMappedRange());
      const g2 = this.g.ctx2d!, cv = g2.canvas;
      if (cv.width === w && cv.height === h) {
        if (!this.img || this.img.width !== w || this.img.height !== h) this.img = new ImageData(w, h);
        const dst = this.img.data;
        for (let y = 0; y < h; y++) dst.set(src.subarray(y * bpr, y * bpr + w * 4), y * w * 4);
        g2.putImageData(this.img, 0, 0);
      }
      buf.unmap();
    }).catch(() => undefined).finally(() => { this.reading = false; });
  }

  dispose() {
    const P = this.p;
    for (const u of this.unsub) u();
    P.sims.dispose();
    P.post.dispose(); P.water.dispose(); P.lighting.dispose(); P.stacks.dispose(); P.particles.dispose(); P.debug.dispose(); P.pattern?.dispose();
    this.frameUbo.destroy(); this.oceanUbo.destroy();
    for (const t of [this.gA, this.gN, this.gDepth, this.uC, this.uD, this.uDepth, this.occ, this.lit, this.outTex]) t?.texture.destroy();
    this.zeroTex.destroy();
    this.timer?.destroy();
    this.readBuf?.destroy();
    this.g.context?.unconfigure();
    this.g.device.destroy();
  }
}
