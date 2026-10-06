// Debug texture views drawn straight over the lit buffer (`debug.view` = wave | fluid | foam |
// occluder) — port of the DEBUG_FS in webgl2/renderer.ts.

import { shaderModule, validated, type GpuContext } from '../device';
import { Ubo, type Samplers } from '../targets';
import { CAMERA_WGSL, FULLSCREEN_WGSL } from '../wgsl/common';

// uniforms: 0 rect (x, y rel origin, w, h) · 4 (mode, -, -, -)
const WGSL = /* wgsl */ `
${FULLSCREEN_WGSL}
${CAMERA_WGSL}
struct Dbg { rect: vec4f, p: vec4f };
@group(0) @binding(1) var<uniform> DU: Dbg;
@group(0) @binding(2) var tex: texture_2d<f32>;
@group(0) @binding(3) var lin: sampler;
@fragment fn fsDebug(i: VsOut) -> @location(0) vec4f {
  let p = pixToWorld(i.pos.xy, 0.0);
  let uv = (p - DU.rect.xy) / DU.rect.zw;
  let t = textureSampleLevel(tex, lin, uv, 0.0);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { return vec4f(0.05, 0.0, 0.08, 1.0); }
  let mode = i32(DU.p.x + 0.5);
  if (mode == 0) { return vec4f(0.5 + t.r * 0.5, 0.5 - t.r * 0.5, 0.5 + t.g * 0.1, 1.0); }
  if (mode == 1) { return vec4f(0.5 + t.xy * 0.08, 0.5, 1.0); }
  if (mode == 2) { return vec4f(t.r, t.g + t.a * 0.5, t.b + t.a, 1.0); }
  if (mode == 5) {
    let N = DU.p.y;
    if (t.z < 0.5) { return vec4f(0.3, 0.0, 0.0, 1.0); }
    let d = length(t.xy + 0.5 - uv * N);
    return vec4f(fract(d / 8.0), clamp(d / 64.0, 0.0, 1.0), select(0.0, 1.0, d < 1.0), 1.0);
  }
  if (mode == 4) { return vec4f(t.rgb / (vec3f(1.0) + t.rgb) * 1.6 + vec3f(0.0, 0.0, (1.0 - t.a) * 0.12), 1.0); }
  return vec4f(clamp(t.r * 0.05 + 0.2, 0.0, 1.0), t.a * 0.3, clamp(t.r * 0.02, 0.0, 1.0), 1.0);
}
`;

export const DEBUG_TEX_MODES: Record<string, number> = { wave: 0, fluid: 1, foam: 2, occluder: 3, gi: 4, giSeeds: 5 };

export class DebugPassGPU {
  private pipeline!: GPURenderPipeline;
  private ubo: Ubo;
  private bg: GPUBindGroup | null = null;
  private key: [GPUBuffer, GPUTextureView] | null = null;
  private constructor(private g: GpuContext, private s: Samplers) { this.ubo = new Ubo(g.device, 8, 'debug'); }

  static async create(g: GpuContext, s: Samplers, format: GPUTextureFormat): Promise<DebugPassGPU> {
    const p = new DebugPassGPU(g, s);
    const module = await shaderModule(g, 'debug', WGSL);
    await validated(g, 'debug pipeline', () => {
      p.pipeline = g.device.createRenderPipeline({
        label: 'debug', layout: 'auto',
        vertex: { module, entryPoint: 'vsFull' },
        fragment: { module, entryPoint: 'fsDebug', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      });
    });
    return p;
  }

  /** draw `tex` (covering `rect`, relative to the render origin) over `target` */
  encode(enc: GPUCommandEncoder, target: GPUTextureView, frame: GPUBuffer, tex: GPUTextureView, rect: [number, number, number, number], mode: number, extra = 0) {
    if (!this.key || this.key[0] !== frame || this.key[1] !== tex) {
      this.key = [frame, tex];
      this.bg = this.g.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: frame } }, { binding: 1, resource: { buffer: this.ubo.buffer } },
          { binding: 2, resource: tex }, { binding: 3, resource: this.s.linear }],
      });
    }
    this.ubo.f.set(rect, 0); this.ubo.f[4] = mode; this.ubo.f[5] = extra; this.ubo.write();
    const rp = enc.beginRenderPass({ label: 'debug', colorAttachments: [{ view: target, loadOp: 'load', storeOp: 'store' }] });
    rp.setPipeline(this.pipeline); rp.setBindGroup(0, this.bg!); rp.draw(3); rp.end();
  }

  dispose() { this.ubo.destroy(); }
}
