// WebGPU backend. Records one command encoder per frame in the same pass order as
// webgl2/renderer.ts: occluder heightmap (stacks + smoke) → underwater (submerged stacks) →
// G-buffer (water, stacks, particles) → deferred lighting (+ debug views) → bloom + present. Water sims arrive as compute shaders in M5; until then the
// ripple and dye inputs are 1×1 zero textures.

import type { Screen } from '../screen';
import type { RenderScene } from '../scene';
import type { BackendInfo, BackendStats, FrameParams, RenderBackend } from '../types';
import { postParams } from '../common/post';
import { lightParams, occluderRect, occluderRes, waterParams } from '../common/frameUniforms';
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
import { packParticles, packStacks, type F32 } from '../pack';

const HDR: GPUTextureFormat = 'rgba16float';
const MAX_IN_FLIGHT = 2;

export interface WebGPUOpts {
  /** debug (`?testpattern=1`): draw the M2 world-anchored test pattern instead of the scene */
  testPattern?: boolean;
}

interface Passes {
  post: PostPassGPU; water: WaterPassGPU; lighting: LightingPassGPU; stacks: StackPassGPU; particles: ParticlePassGPU;
  debug: DebugPassGPU; pattern: TestPatternPass | null;
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
  private partData: F32 = new Float32Array(4096 * 12);
  // readback present (test hook): offscreen frame → mapped buffer → 2D canvas
  private outTex: GpuTarget | null = null;
  private readBuf: GPUBuffer | null = null;
  private reading = false;
  private img: ImageData | null = null;

  private constructor(readonly screen: Screen, readonly g: GpuContext, private p: Passes, frameUbo: Ubo, oceanUbo: Ubo) {
    this.info = { kind: 'webgpu', adapter: g.adapterName, computeSims: false, features: g.features };
    this.frameUbo = frameUbo; this.oceanUbo = oceanUbo;
    this.zeroTex = g.device.createTexture({ label: 'zero', format: HDR, size: { width: 1, height: 1 }, usage: TU.TEXTURE_BINDING });
    this.zeroView = this.zeroTex.createView();
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
  resetSims() { /* no sims yet (M5) */ }

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
    if (this.g.lost || this.inFlight >= MAX_IN_FLIGHT || this.reading) return;
    const cam = f.camera, sc = this.screen, d = this.g.device, P = this.p;
    cam.setViewport(sc.W, sc.H);
    cam.snap();
    const O = this.origin;
    O.x = cam.ix / cam.zoom; O.y = cam.iy / (cam.zoom * cam.cosT);
    const bw = cam.bw, bh = cam.bh;
    const occRes = occluderRes();
    if (this.ensureTargets(bw, bh, occRes)) {
      P.post.setInputs(this.lit!.view, bw, bh);
      const zero = this.zeroView;
      P.water.setInputs({ frame: this.frameUbo.buffer, ocean: this.oceanUbo.buffer, wave: zero, dye: zero, under: this.uC!.view, underD: this.uD!.view });
      P.lighting.setInputs({ frame: this.frameUbo.buffer, albedo: this.gA!.view, normal: this.gN!.view, occ: this.occ!.view });
    }
    P.stacks.uploadAtlas(scene.atlas);
    P.stacks.setInputs({ frame: this.frameUbo.buffer, ocean: this.oceanUbo.buffer, wave: this.zeroView });
    P.particles.setFrame(this.frameUbo.buffer);

    // ---- per-frame uniforms (origin folded into wave phases on the CPU, in double precision)
    writeFrame(this.frameUbo.f, cam);
    this.frameUbo.write();
    const W = waterParams(f);
    const waveCount = f.ocean.pack(O.x, O.y, this.waveA, this.waveB);
    const ringCount = f.ocean.packRings(O.x, O.y, this.rings);
    writeOcean(this.oceanUbo.f, this.waveA, this.waveB, W.swell ? waveCount : 0, this.rings, ringCount);
    this.oceanUbo.write();
    P.water.write(W, { x: 0, y: 0, size: 1, cell: 1, on: false });
    this.occRect = occluderRect(cam, occRes);
    const occRel: [number, number, number, number] = [this.occRect.x - O.x, this.occRect.y - O.y, this.occRect.s, this.occRect.s];
    const L = lightParams(f);
    const lp = packLights(scene.lights, O.x, O.y, cam.viewRect(40), dev.num('light.maxLights'), L.reach, this.lightData);
    this.lightData = lp.data;
    P.lighting.write(L, occRel, lp.data, lp.count);
    this.stats.lights = lp.count;
    const st = packStacks(scene.stacks, O.x, O.y, this.stackData);
    this.stackData = st.data;
    P.stacks.write(occRel, { x: 0, y: 0, size: 1, on: false, rippleScale: W.rippleScale }, W.foamCol, dev.bool('water.waterline'), f.time, st.data, st.count);
    this.stats.stackInstances = st.count;
    const pk = packParticles(scene.particles, O.x, O.y, f.time, this.partData);
    this.partData = pk.data;
    P.particles.write(occRel, occRes, 24, pk.data, pk.count);
    this.stats.particles = pk.count;

    const enc = d.createCommandEncoder({ label: 'frame' });
    if (P.pattern) {
      P.pattern.encode(enc, this.lit!.view, O.x, O.y, f.time);
    } else {
      // ---- occluder heightmap: max height of stacks (r) + smoke density (a), world aligned
      const op = enc.beginRenderPass({ label: 'occluder', colorAttachments: [{ view: this.occ!.view, loadOp: 'clear', storeOp: 'store', clearValue: { r: -50, g: 0, b: 0, a: 0 } }] });
      P.stacks.encode(op, 'occ');
      P.particles.encode(op, 'occ');
      op.end();
      // ---- underwater: submerged parts of everything (depth = distance below surface)
      const up = enc.beginRenderPass({
        label: 'underwater',
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
        label: 'gbuffer',
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
      const lpass = enc.beginRenderPass({ label: 'lighting', colorAttachments: [{ view: this.lit!.view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
      P.lighting.encode(lpass);
      lpass.end();
      // debug texture views drawn straight into the lit buffer
      const dv = dev.str('debug.view');
      if (dv in DEBUG_TEX_MODES) {
        const occ = dv === 'occluder';
        P.debug.encode(enc, this.lit!.view, this.frameUbo.buffer, occ ? this.occ!.view : this.zeroView, occ ? occRel : [0, 0, 1, 1], DEBUG_TEX_MODES[dv]);
      }
    }

    // ---- post
    const pp = postParams(sc, cam, f);
    P.post.bloom(enc, pp.bloom);
    if (this.g.present === 'canvas') {
      P.post.present(enc, this.g.context!.getCurrentTexture().createView(), pp);
      d.queue.submit([enc.finish()]);
    } else this.presentReadback(enc, pp);
    this.inFlight++;
    d.queue.onSubmittedWorkDone().then(() => { this.inFlight--; }, () => { this.inFlight--; });
  }

  private presentReadback(enc: GPUCommandEncoder, pp: ReturnType<typeof postParams>) {
    const d = this.g.device, w = pp.pw, h = pp.ph;
    [this.outTex] = resizeTarget(d, this.outTex, this.g.format, w, h, TU.COPY_SRC, 'readback');
    this.p.post.present(enc, this.outTex.view, pp);
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
    P.post.dispose(); P.water.dispose(); P.lighting.dispose(); P.stacks.dispose(); P.particles.dispose(); P.debug.dispose(); P.pattern?.dispose();
    this.frameUbo.destroy(); this.oceanUbo.destroy();
    for (const t of [this.gA, this.gN, this.gDepth, this.uC, this.uD, this.uDepth, this.occ, this.lit, this.outTex]) t?.texture.destroy();
    this.zeroTex.destroy();
    this.readBuf?.destroy();
    this.g.context?.unconfigure();
    this.g.device.destroy();
  }
}
