// M2 placeholder scene: a world-anchored 10 m checkerboard with a 100 m grid and HDR markers at the
// grid crossings (so bloom shows). It goes through the same camera math as the ocean, so it must
// scroll exactly with the world. Replaced by the real G-buffer + lighting in M3.

import { shaderModule, validated, type GpuContext } from '../device';
import { Ubo } from '../targets';
import { CAMERA_WGSL, DITHER_WGSL, FULLSCREEN_WGSL, MATH_WGSL } from '../wgsl/common';

// pattern uniforms: 0 origin (x, y) absolute world meters · 2 time
const WGSL = /* wgsl */ `
${FULLSCREEN_WGSL}
${CAMERA_WGSL}
${MATH_WGSL}
${DITHER_WGSL}
struct Pat { origin: vec2f, time: f32, pad: f32 };
@group(0) @binding(1) var<uniform> P: Pat;
@fragment fn fsPattern(i: VsOut) -> @location(0) vec4f {
  let w = pixToWorld(i.pos.xy, 0.0) + P.origin;
  let cell = fmod(floor(w.x / 10.0) + floor(w.y / 10.0), 2.0);
  var c = select(vec3f(0.05, 0.09, 0.14), vec3f(0.09, 0.15, 0.22), cell > 0.5);
  if (ditherHere(i.pos.xy) < 0.12) { c *= 0.85; }
  let g = vec2f(fmod(w.x, 100.0), fmod(w.y, 100.0));
  let px = 1.0 / F.cam.z;
  let gd = min(min(g.x, 100.0 - g.x), min(g.y, 100.0 - g.y));
  if (gd < px) { c = vec3f(0.32, 0.46, 0.55); }
  let cd = max(min(g.x, 100.0 - g.x), min(g.y, 100.0 - g.y));
  if (cd < 2.0 * px) { c = vec3f(3.0, 2.3, 1.1) * (0.8 + 0.2 * sin(P.time * 3.0)); }
  return vec4f(c, 1.0);
}
`;

export class TestPatternPass {
  private pipeline!: GPURenderPipeline;
  private ubo: Ubo;
  private bg: GPUBindGroup | null = null;
  private constructor(private g: GpuContext, private frame: GPUBuffer) { this.ubo = new Ubo(g.device, 4, 'pattern'); }

  static async create(g: GpuContext, frame: GPUBuffer, format: GPUTextureFormat): Promise<TestPatternPass> {
    const p = new TestPatternPass(g, frame);
    const module = await shaderModule(g, 'pattern', WGSL);
    await validated(g, 'pattern pipeline', () => {
      p.pipeline = g.device.createRenderPipeline({
        label: 'pattern', layout: 'auto',
        vertex: { module, entryPoint: 'vsFull' },
        fragment: { module, entryPoint: 'fsPattern', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      });
      p.bg = g.device.createBindGroup({
        layout: p.pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: p.frame } }, { binding: 1, resource: { buffer: p.ubo.buffer } }],
      });
    });
    return p;
  }

  encode(enc: GPUCommandEncoder, target: GPUTextureView, ox: number, oy: number, time: number) {
    this.ubo.f[0] = ox; this.ubo.f[1] = oy; this.ubo.f[2] = time;
    this.ubo.write();
    const rp = enc.beginRenderPass({ label: 'pattern', colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
    rp.setPipeline(this.pipeline);
    rp.setBindGroup(0, this.bg!);
    rp.draw(3);
    rp.end();
  }

  dispose() { this.ubo.destroy(); }
}
