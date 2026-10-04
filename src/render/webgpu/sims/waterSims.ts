// WebGPU interactive water — mirrors render/webgl2/water/{waveSim,fluidSim}.ts step for step:
//  1. force raster (render pass, additive) of hull footprints + splats into three rgba16float targets
//  2. wave-equation heightfield (compute, CFL substeps, impulses only on the first substep)
//  3. stable fluids at the coarser fluid resolution (advect + obstacles, vorticity confinement,
//     divergence, Jacobi pressure, gradient subtract) and dye advection at the wave resolution
// The window follows the camera in whole cells (shared SimWindow logic); textures shift with a
// copy-with-offset kernel. Dev settings are read by the backend and passed in each frame.

import { shaderModule, validated, type GpuContext } from '../device';
import { BU, DynBuffer, SS, TU, Ubo, type Samplers } from '../targets';
import { SimWindow } from '../../../water/simWindow';
import { FORCE_FLOATS } from '../../pack';
import {
  ADVECT_VEL_WGSL, CURL_WGSL, DIV_WGSL, DYE_WGSL, FORCE_WGSL, GRAD_WGSL, JACOBI_WGSL, SHIFT_R32_WGSL,
  SHIFT_RGBA_WGSL, VORT_WGSL, WAVE_WGSL,
} from './kernels';

type Bind = 'ubo' | 'tex' | 'utex' | 'sampler' | 'rgba' | 'r32';
const HDR: GPUTextureFormat = 'rgba16float';
const WG = 8;

interface Kernel { pipeline: GPUComputePipeline; layout: GPUBindGroupLayout }

async function kernel(g: GpuContext, label: string, code: string, binds: Bind[]): Promise<Kernel> {
  const module = await shaderModule(g, label, code);
  return validated(g, label, () => {
    const layout = g.device.createBindGroupLayout({
      label,
      entries: binds.map((b, i): GPUBindGroupLayoutEntry => {
        const e = { binding: i, visibility: SS.COMPUTE };
        switch (b) {
          case 'ubo': return { ...e, buffer: { type: 'uniform' } };
          case 'tex': return { ...e, texture: { sampleType: 'float' } };
          case 'utex': return { ...e, texture: { sampleType: 'unfilterable-float' } };
          case 'sampler': return { ...e, sampler: { type: 'filtering' } };
          case 'rgba': return { ...e, storageTexture: { access: 'write-only', format: HDR } };
          case 'r32': return { ...e, storageTexture: { access: 'write-only', format: 'r32float' } };
        }
      }),
    });
    const pipeline = g.device.createComputePipeline({ label, layout: g.device.createPipelineLayout({ bindGroupLayouts: [layout] }), compute: { module, entryPoint: 'main' } });
    return { pipeline, layout };
  });
}

class Tex {
  readonly texture: GPUTexture;
  readonly view: GPUTextureView;
  constructor(d: GPUDevice, readonly format: GPUTextureFormat, readonly n: number, label: string) {
    this.texture = d.createTexture({ label, format, size: { width: n, height: n }, usage: TU.TEXTURE_BINDING | TU.STORAGE_BINDING | TU.RENDER_ATTACHMENT | TU.COPY_SRC });
    this.view = this.texture.createView();
  }
  destroy() { this.texture.destroy(); }
}

/** two textures + read index; `read`/`write` swap after every pass that writes */
class PP {
  a: Tex; b: Tex; private i = 0;
  constructor(d: GPUDevice, fmt: GPUTextureFormat, n: number, label: string) { this.a = new Tex(d, fmt, n, label + '.a'); this.b = new Tex(d, fmt, n, label + '.b'); }
  get read() { return this.i ? this.b : this.a; }
  get write() { return this.i ? this.a : this.b; }
  swap() { this.i ^= 1; }
  destroy() { this.a.destroy(); this.b.destroy(); }
}

export interface SimParams {
  sim: boolean; fluid: boolean;
  waveSpeed: number; damping: number; hullPush: number; foamAmount: number;
  vorticity: number; iterations: number; foamDecay: number;
}

export class WaterSimsGPU {
  win: SimWindow;
  nf = 256;
  private state!: PP; private force!: Tex[];
  private vel!: PP; private pressure!: PP; private div!: Tex; private curl!: Tex; private dye!: PP;
  private K!: Record<'wave' | 'shift' | 'shiftR' | 'adv' | 'curl' | 'vort' | 'div' | 'jac' | 'grad' | 'dye', Kernel>;
  private forcePipeline!: GPURenderPipeline;
  private forceBg!: GPUBindGroup;
  private forceInst: DynBuffer;
  private forceCount = 0;
  private uForce: Ubo; private uWave1: Ubo; private uWaveN: Ubo; private uFluid: Ubo; private uDye: Ubo;
  private shiftUbos: Ubo[] = [];
  private zero: GPUTexture;
  drift = { x: 0, y: 0 };

  private constructor(private g: GpuContext, private s: Samplers, n: number, cell: number) {
    const d = g.device;
    this.win = new SimWindow(n, cell);
    this.forceInst = new DynBuffer(d, BU.VERTEX, 'force instances');
    this.uForce = new Ubo(d, 4, 'sim.force'); this.uWave1 = new Ubo(d, 8, 'sim.wave1'); this.uWaveN = new Ubo(d, 8, 'sim.waveN');
    this.uFluid = new Ubo(d, 8, 'sim.fluid'); this.uDye = new Ubo(d, 12, 'sim.dye');
    this.zero = d.createTexture({ label: 'sim.zero', format: HDR, size: { width: 1, height: 1 }, usage: TU.TEXTURE_BINDING });
  }

  static async create(g: GpuContext, s: Samplers, n: number, cell: number, nf: number): Promise<WaterSimsGPU> {
    const w = new WaterSimsGPU(g, s, n, cell);
    w.K = {
      wave: await kernel(g, 'sim.wave', WAVE_WGSL, ['ubo', 'tex', 'tex', 'tex', 'rgba']),
      shift: await kernel(g, 'sim.shift', SHIFT_RGBA_WGSL, ['ubo', 'tex', 'rgba']),
      shiftR: await kernel(g, 'sim.shiftR', SHIFT_R32_WGSL, ['ubo', 'utex', 'r32']),
      adv: await kernel(g, 'sim.advect', ADVECT_VEL_WGSL, ['ubo', 'tex', 'tex', 'tex', 'sampler', 'rgba']),
      curl: await kernel(g, 'sim.curl', CURL_WGSL, ['ubo', 'tex', 'r32']),
      vort: await kernel(g, 'sim.vort', VORT_WGSL, ['ubo', 'tex', 'utex', 'rgba']),
      div: await kernel(g, 'sim.div', DIV_WGSL, ['ubo', 'tex', 'r32']),
      jac: await kernel(g, 'sim.jacobi', JACOBI_WGSL, ['ubo', 'utex', 'utex', 'r32']),
      grad: await kernel(g, 'sim.grad', GRAD_WGSL, ['ubo', 'utex', 'tex', 'rgba']),
      dye: await kernel(g, 'sim.dye', DYE_WGSL, ['ubo', 'tex', 'tex', 'tex', 'sampler', 'rgba']),
    };
    const module = await shaderModule(g, 'sim.force', FORCE_WGSL);
    await validated(g, 'force pipeline', () => {
      const add: GPUBlendState = { color: { operation: 'add', srcFactor: 'one', dstFactor: 'one' }, alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one' } };
      w.forcePipeline = g.device.createRenderPipeline({
        label: 'sim.force', layout: 'auto',
        vertex: {
          module, entryPoint: 'vsForce',
          buffers: [{ arrayStride: FORCE_FLOATS * 4, stepMode: 'instance', attributes: [0, 1, 2, 3, 4].map((i) => ({ shaderLocation: i, offset: i * 16, format: 'float32x4' as const })) }],
        },
        fragment: { module, entryPoint: 'fsForce', targets: [{ format: HDR, blend: add }, { format: HDR, blend: add }, { format: HDR, blend: add }] },
        primitive: { topology: 'triangle-strip' },
      });
      w.forceBg = g.device.createBindGroup({ layout: w.forcePipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: w.uForce.buffer } }] });
    });
    w.resize(n, cell, nf);
    return w;
  }

  /** wave resolution n (cells), cell size (m), fluid resolution request; mirrors WebGL2 applySimSizes */
  resize(n: number, cell: number, nfReq: number) {
    const d = this.g.device;
    this.destroyTextures();
    this.win.n = n; this.win.cell = cell;
    // keep window shifts aligned with whole fluid cells
    this.win.quant = Math.max(1, Math.round(n / nfReq));
    this.nf = Math.round(n / this.win.quant);
    this.state = new PP(d, HDR, n, 'wave.state');
    this.force = [0, 1, 2].map((i) => new Tex(d, HDR, n, 'force' + i));
    this.vel = new PP(d, HDR, this.nf, 'fluid.vel');
    this.pressure = new PP(d, 'r32float', this.nf, 'fluid.p');
    this.div = new Tex(d, 'r32float', this.nf, 'fluid.div');
    this.curl = new Tex(d, 'r32float', this.nf, 'fluid.curl');
    this.dye = new PP(d, HDR, n, 'fluid.dye');
    this.cleared = false;
  }
  private cleared = false;

  get heightView() { return this.state.read.view; }
  get velView() { return this.vel.read.view; }
  get dyeView() { return this.dye.read.view; }

  private clearTex(enc: GPUCommandEncoder, ts: Tex[]) {
    for (const t of ts) enc.beginRenderPass({ colorAttachments: [{ view: t.view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] }).end();
  }
  /** wave state + forces (WaveSim.clear) */
  clearWave(enc: GPUCommandEncoder) { this.clearTex(enc, [this.state.a, this.state.b, ...this.force]); }
  /** velocity, pressure, dye (FluidSim.clear) */
  clearFluid(enc: GPUCommandEncoder) { this.clearTex(enc, [this.vel.a, this.vel.b, this.pressure.a, this.pressure.b, this.dye.a, this.dye.b]); }

  private bg(k: Kernel, res: (GPUBuffer | GPUTextureView | GPUSampler)[]) {
    return this.g.device.createBindGroup({
      layout: k.layout,
      entries: res.map((r, i) => ({ binding: i, resource: r instanceof GPUBuffer ? { buffer: r } : r })),
    });
  }
  private dispatch(cp: GPUComputePassEncoder, k: Kernel, bg: GPUBindGroup, n: number) {
    cp.setPipeline(k.pipeline); cp.setBindGroup(0, bg);
    const w = Math.ceil(n / WG);
    cp.dispatchWorkgroups(w, w);
  }

  private shiftUbo(i: number, dx: number, dy: number, n: number): Ubo {
    while (this.shiftUbos.length <= i) this.shiftUbos.push(new Ubo(this.g.device, 4, 'sim.shift'));
    const u = this.shiftUbos[i];
    u.f[0] = dx; u.f[1] = dy; u.f[2] = n; u.f[3] = n; u.write();
    return u;
  }
  private shiftPP(cp: GPUComputePassEncoder, pp: PP, dx: number, dy: number, slot: number) {
    const r32 = pp.read.format === 'r32float';
    const k = r32 ? this.K.shiftR : this.K.shift;
    const u = this.shiftUbo(slot, dx, dy, pp.read.n);
    this.dispatch(cp, k, this.bg(k, [u.buffer, pp.read.view, pp.write.view]), pp.read.n);
    pp.swap();
  }

  /** (reset) and keep the window centred on the camera, shifting textures by whole cells */
  follow(enc: GPUCommandEncoder, cx: number, cy: number, reset: boolean) {
    if (reset || !this.cleared) { this.win.reset(cx, cy); this.clearWave(enc); this.clearFluid(enc); this.cleared = true; }
    const [dx, dy] = this.win.recenter(cx, cy);
    if (!dx && !dy) return;
    const n = this.win.n;
    const cp = enc.beginComputePass({ label: 'sim.shift' });
    let slot = 0;
    const big = Math.abs(dx) >= n || Math.abs(dy) >= n;
    // wave state (WaveSim.follow)
    if (!big) this.shiftPP(cp, this.state, dx, dy, slot++);
    // fluid (FluidSim.shift): dye by whole wave cells, velocity/pressure by the matching fluid cells
    if (!big) {
      this.shiftPP(cp, this.dye, dx, dy, slot++);
      const r = this.nf / n;
      const fx = Math.round(dx * r), fy = Math.round(dy * r);
      if (fx || fy) { this.shiftPP(cp, this.vel, fx, fy, slot++); this.shiftPP(cp, this.pressure, fx, fy, slot++); }
    }
    cp.end();
    if (big) { this.clearWave(enc); this.clearFluid(enc); }
  }

  /**
   * Raster forces → wave substeps → fluid + dye, in the WebGL2 order. `forces` is packForces output
   * relative to the CURRENT window, so the caller packs after `follow()`.
   */
  step(enc: GPUCommandEncoder, simDt: number, p: SimParams, forces: Float32Array<ArrayBuffer>, count: number, timestampWrites?: GPUComputePassTimestampWrites) {
    const n = this.win.n, size = this.win.size, cell = this.win.cell;
    // ---- 1. force raster
    this.forceInst.write(forces, count * FORCE_FLOATS);
    this.forceCount = count;
    this.uForce.f[0] = size; this.uForce.f[1] = p.hullPush; this.uForce.f[2] = p.foamAmount; this.uForce.write();
    const rp = enc.beginRenderPass({
      label: 'sim.force',
      colorAttachments: this.force.map((t) => ({ view: t.view, loadOp: 'clear' as const, storeOp: 'store' as const, clearValue: { r: 0, g: 0, b: 0, a: 0 } })),
    });
    if (this.forceCount && this.forceInst.buffer) {
      rp.setPipeline(this.forcePipeline); rp.setBindGroup(0, this.forceBg);
      rp.setVertexBuffer(0, this.forceInst.buffer); rp.draw(4, this.forceCount);
    }
    rp.end();
    const zero = this.zero.createView();
    const cp = enc.beginComputePass({ label: 'sims', timestampWrites });
    // ---- 2. wave equation, CFL: c*dt/dx < 0.5 for the 9-point stencil
    if (p.sim) {
      const maxDt = (0.45 * cell) / Math.max(p.waveSpeed, 0.1);
      const steps = Math.max(1, Math.ceil(simDt / maxDt));
      const sdt = simDt / steps;
      const setW = (u: Ubo, imp: number) => { const f = u.f; f[0] = n; f[1] = sdt; f[2] = (p.waveSpeed * p.waveSpeed) / (cell * cell); f[3] = p.damping; f[4] = imp; u.write(); };
      setW(this.uWave1, 1); setW(this.uWaveN, 0);
      for (let i = 0; i < steps; i++) {
        // impulses only on the first substep
        const u = i === 0 ? this.uWave1 : this.uWaveN;
        this.dispatch(cp, this.K.wave, this.bg(this.K.wave, [u.buffer, this.state.read.view, this.force[0].view, i === 0 ? this.force[2].view : zero, this.state.write.view]), n);
        this.state.swap();
      }
    }
    // ---- 3. stable fluids + dye
    if (p.fluid) {
      const dt = Math.min(simDt, 1 / 20), nf = this.nf;
      const f = this.uFluid.f;
      f[0] = dt; f[1] = size; f[2] = 0.08; f[3] = nf; f[4] = p.vorticity; f[5] = size / nf;
      this.uFluid.write();
      const U = this.uFluid.buffer, lin = this.s.linear;
      this.dispatch(cp, this.K.adv, this.bg(this.K.adv, [U, this.vel.read.view, this.force[0].view, this.force[2].view, lin, this.vel.write.view]), nf);
      this.vel.swap();
      if (p.vorticity > 0) {
        this.dispatch(cp, this.K.curl, this.bg(this.K.curl, [U, this.vel.read.view, this.curl.view]), nf);
        this.dispatch(cp, this.K.vort, this.bg(this.K.vort, [U, this.vel.read.view, this.curl.view, this.vel.write.view]), nf);
        this.vel.swap();
      }
      this.dispatch(cp, this.K.div, this.bg(this.K.div, [U, this.vel.read.view, this.div.view]), nf);
      for (let i = 0; i < p.iterations; i++) {
        this.dispatch(cp, this.K.jac, this.bg(this.K.jac, [U, this.pressure.read.view, this.div.view, this.pressure.write.view]), nf);
        this.pressure.swap();
      }
      this.dispatch(cp, this.K.grad, this.bg(this.K.grad, [U, this.pressure.read.view, this.vel.read.view, this.vel.write.view]), nf);
      this.vel.swap();
      const k = 1 / Math.max(0.05, p.foamDecay);
      const df = this.uDye.f;
      df[0] = dt; df[1] = size; df[2] = 0; df[3] = n;
      df[4] = this.drift.x; df[5] = this.drift.y;
      df[8] = 0.028 * k; df[9] = 0.16 * k; df[10] = 0.0015; df[11] = 0.02;
      this.uDye.write();
      this.dispatch(cp, this.K.dye, this.bg(this.K.dye, [this.uDye.buffer, this.dye.read.view, this.vel.read.view, this.force[1].view, lin, this.dye.write.view]), n);
      this.dye.swap();
    }
    cp.end();
  }

  private destroyTextures() {
    if (!this.state) return;
    for (const t of [this.state, this.vel, this.pressure, this.dye]) t.destroy();
    for (const t of [...this.force, this.div, this.curl]) t.destroy();
  }

  dispose() {
    this.destroyTextures();
    this.forceInst.destroy();
    for (const u of [this.uForce, this.uWave1, this.uWaveN, this.uFluid, this.uDye, ...this.shiftUbos]) u.destroy();
    this.zero.destroy();
  }
}
