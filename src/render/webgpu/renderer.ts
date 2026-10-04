// WebGPU backend. M2: device, canvas, frame pacing and the WGSL post chain around a world-anchored
// test pattern; the real scene passes (water, stacks, particles, lighting, sims) arrive in M3–M5
// and are recorded into one command encoder in the same order as webgl2/renderer.ts.

import type { Screen } from '../screen';
import type { RenderScene } from '../scene';
import type { BackendInfo, BackendStats, FrameParams, RenderBackend } from '../types';
import { postParams } from '../common/post';
import { initGpu, type GpuContext, type GpuInitOpts } from './device';
import { BU, createSamplers, resizeTarget, TU, Ubo, type GpuTarget } from './targets';
import { FRAME_FLOATS, writeFrame } from './wgsl/common';
import { PostPassGPU } from './passes/post';
import { TestPatternPass } from './passes/testPattern';

const LIT: GPUTextureFormat = 'rgba16float';
const MAX_IN_FLIGHT = 2;

export class WebGPUBackend implements RenderBackend {
  readonly info: BackendInfo;
  stats: BackendStats = { stackInstances: 0, particles: 0, lights: 0 };
  origin = { x: 0, y: 0 };
  private lit: GpuTarget | null = null;
  private inFlight = 0;
  // readback present (test hook): offscreen frame → mapped buffer → 2D canvas
  private outTex: GpuTarget | null = null;
  private readBuf: GPUBuffer | null = null;
  private reading = false;
  private img: ImageData | null = null;

  private constructor(readonly screen: Screen, readonly g: GpuContext, private frameUbo: Ubo, private post: PostPassGPU, private pattern: TestPatternPass) {
    this.info = { kind: 'webgpu', adapter: g.adapterName, computeSims: false, features: g.features };
  }

  /** throws on any init failure (no adapter, compile/validation error) so the caller can fall back */
  static async create(screen: Screen, opts: GpuInitOpts = {}): Promise<WebGPUBackend> {
    const g = await initGpu(screen.canvas, opts);
    try {
      const samplers = createSamplers(g.device);
      const frameUbo = new Ubo(g.device, FRAME_FLOATS, 'frame');
      const post = await PostPassGPU.create(g, samplers);
      const pattern = await TestPatternPass.create(g, frameUbo.buffer, LIT);
      if (g.lost) throw new Error(g.lost);
      return new WebGPUBackend(screen, g, frameUbo, post, pattern);
    } catch (e) {
      g.device.destroy();
      throw e;
    }
  }

  /** non-null once the device is lost or errored: the App swaps to WebGL2 */
  get lost() { return this.g.lost; }

  resize() { /* the canvas drawing buffer follows Screen; targets follow the camera buffer lazily */ }
  resetSims() { /* no sims yet (M5) */ }

  render(_scene: RenderScene, f: FrameParams) {
    if (this.g.lost || this.inFlight >= MAX_IN_FLIGHT || this.reading) return;
    const cam = f.camera, sc = this.screen, d = this.g.device;
    cam.setViewport(sc.W, sc.H);
    cam.snap();
    const O = this.origin;
    O.x = cam.ix / cam.zoom; O.y = cam.iy / (cam.zoom * cam.cosT);
    let changed: boolean;
    [this.lit, changed] = resizeTarget(d, this.lit, LIT, cam.bw, cam.bh, 0, 'lit');
    if (changed) this.post.setInputs(this.lit.view, cam.bw, cam.bh);

    writeFrame(this.frameUbo.f, cam);
    this.frameUbo.write();
    const enc = d.createCommandEncoder({ label: 'frame' });
    this.pattern.encode(enc, this.lit.view, O.x, O.y, f.time);
    const pp = postParams(sc, cam, f);
    this.post.bloom(enc, pp.bloom);
    if (this.g.present === 'canvas') {
      this.post.present(enc, this.g.context!.getCurrentTexture().createView(), pp);
      d.queue.submit([enc.finish()]);
    } else this.presentReadback(enc, pp);
    this.inFlight++;
    d.queue.onSubmittedWorkDone().then(() => { this.inFlight--; }, () => { this.inFlight--; });
  }

  private presentReadback(enc: GPUCommandEncoder, pp: ReturnType<typeof postParams>) {
    const d = this.g.device, w = pp.pw, h = pp.ph;
    [this.outTex] = resizeTarget(d, this.outTex, this.g.format, w, h, TU.COPY_SRC, 'readback');
    this.post.present(enc, this.outTex.view, pp);
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
    this.post.dispose();
    this.pattern.dispose();
    this.frameUbo.destroy();
    this.lit?.texture.destroy();
    this.outTex?.texture.destroy();
    this.readBuf?.destroy();
    this.g.context?.unconfigure();
    this.g.device.destroy();
  }
}
