// CPU particles on WebGPU — port of webgl2/particlesGL.ts. WebGPU has no point sprites, so each
// particle is an instanced quad (6 vertices from vertex_index) sized like the GL point:
// clamp(size_m * zoom, 1, maxPx) buffer pixels in the G-buffer, max(1, size_m * occScale) texels in
// the occluder. `pc` reproduces gl_PointCoord * 2 - 1 (its y points up the screen in the GL passes).
// Translucency is screen-door dithering, as in GL.

import { shaderModule, validated, type GpuContext } from '../device';
import { BU, DynBuffer, SS, Ubo } from '../targets';
import { CAMERA_WGSL, DITHER_WGSL, GBUF_WGSL, MATH_WGSL } from '../wgsl/common';
import { PARTICLE_FLOATS } from '../../pack';
import { OCC_BLEND } from './stacks';

// particle uniforms: 0 occRect (x, y rel origin, w, h) · 4 (maxPx, occScale = texels/m, occRes, -)
const WGSL = /* wgsl */ `
${CAMERA_WGSL}
${MATH_WGSL}
${DITHER_WGSL}
${GBUF_WGSL}
struct Part { occRect: vec4f, p: vec4f };
@group(0) @binding(1) var<uniform> PU: Part;
struct PIn {
  @location(0) pos: vec4f,   // x, y (rel), z, size (m)
  @location(1) col: vec4f,   // rgb, alpha
  @location(2) mat: vec4f,   // material, emissive, up-ness, occluder smoke
};
struct POut {
  @builtin(position) pos: vec4f,
  @location(0) col: vec4f,
  @location(1) @interpolate(flat) mat: vec4f,
  @location(2) z: f32,
  @location(3) pc: vec2f,
};
fn corner(vi: u32) -> vec2f {
  var c = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  return c[vi];
}
@vertex fn vsPart(@builtin(vertex_index) vi: u32, p: PIn) -> POut {
  let c = corner(vi);   // c.y runs down the buffer
  var clip = worldToClip(p.pos.xyz);
  let px = clamp(p.pos.w * F.cam.z, 1.0, PU.p.x);
  clip.x += c.x * px / F.buf.x;
  clip.y -= c.y * px / F.buf.y;
  var o: POut;
  o.pos = clip; o.col = p.col; o.mat = p.mat; o.z = p.pos.z; o.pc = vec2f(c.x, -c.y);
  return o;
}
@vertex fn vsPartOcc(@builtin(vertex_index) vi: u32, p: PIn) -> POut {
  let c = corner(vi);
  let uv = (p.pos.xy - PU.occRect.xy) / PU.occRect.zw;
  let size = max(1.0, p.pos.w * PU.p.y);
  let res = 1.0 / PU.p.z;   // 1 / occluder resolution
  var o: POut;
  o.pos = vec4f(uv.x * 2.0 - 1.0 + c.x * size * res, 1.0 - uv.y * 2.0 - c.y * size * res, 0.0, 1.0);
  o.col = p.col; o.mat = p.mat; o.z = p.pos.z; o.pc = vec2f(c.x, -c.y);
  return o;
}

@fragment fn fsPart(i: POut) -> GOut {
  if (dot(i.pc, i.pc) > 1.15) { discard; }
  if (i.col.a < ditherHere(i.pos.xy)) { discard; }
  let nxy = i.pc * 0.55 * (1.0 - i.mat.z);
  var o: GOut;
  o.albedo = vec4f(i.col.rgb, i.mat.x / 255.0);
  o.normal = vec4f(nxy, i.z, i.mat.y);
  return o;
}
@fragment fn fsPartOcc(i: POut) -> @location(0) vec4f {
  let r = dot(i.pc, i.pc);
  if (r > 1.0) { discard; }
  return vec4f(-50.0, 0.0, 0.0, i.mat.w * i.col.a * (1.0 - r));
}
`;

const INSTANCE_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: PARTICLE_FLOATS * 4, stepMode: 'instance',
  attributes: [0, 1, 2].map((i) => ({ shaderLocation: i, offset: i * 16, format: 'float32x4' as const })),
};

export class ParticlePassGPU {
  pGbuf!: GPURenderPipeline; pOcc!: GPURenderPipeline;
  private ubo: Ubo;
  private layout!: GPUBindGroupLayout;
  private bg: GPUBindGroup | null = null;
  private frame: GPUBuffer | null = null;
  private inst: DynBuffer;
  count = 0;

  private constructor(private g: GpuContext) {
    this.ubo = new Ubo(g.device, 8, 'particles');
    this.inst = new DynBuffer(g.device, BU.VERTEX, 'particle instances');
  }

  static async create(g: GpuContext): Promise<ParticlePassGPU> {
    const p = new ParticlePassGPU(g);
    const module = await shaderModule(g, 'particles', WGSL);
    const d = g.device, VF = SS.VERTEX | SS.FRAGMENT;
    await validated(g, 'particle pipelines', () => {
      p.layout = d.createBindGroupLayout({
        label: 'particles',
        entries: [
          { binding: 0, visibility: VF, buffer: { type: 'uniform' } },
          { binding: 1, visibility: VF, buffer: { type: 'uniform' } },
        ],
      });
      const layout = d.createPipelineLayout({ label: 'particles', bindGroupLayouts: [p.layout] });
      p.pGbuf = d.createRenderPipeline({
        label: 'particles.gbuf', layout,
        vertex: { module, entryPoint: 'vsPart', buffers: [INSTANCE_LAYOUT] },
        fragment: { module, entryPoint: 'fsPart', targets: [{ format: 'rgba8unorm' }, { format: 'rgba16float' }] },
        primitive: { topology: 'triangle-list' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
      });
      p.pOcc = d.createRenderPipeline({
        label: 'particles.occ', layout,
        vertex: { module, entryPoint: 'vsPartOcc', buffers: [INSTANCE_LAYOUT] },
        fragment: { module, entryPoint: 'fsPartOcc', targets: [{ format: 'rgba16float', blend: OCC_BLEND }] },
        primitive: { topology: 'triangle-list' },
      });
    });
    return p;
  }

  setFrame(frame: GPUBuffer) {
    if (this.bg && this.frame === frame) return;
    this.frame = frame;
    this.bg = this.g.device.createBindGroup({
      label: 'particles', layout: this.layout,
      entries: [{ binding: 0, resource: { buffer: frame } }, { binding: 1, resource: { buffer: this.ubo.buffer } }],
    });
  }

  write(occRel: [number, number, number, number], occRes: number, maxPx: number, data: Float32Array<ArrayBuffer>, count: number) {
    const f = this.ubo.f;
    f.set(occRel, 0);
    f[4] = maxPx; f[5] = occRes / occRel[2]; f[6] = occRes; f[7] = 0;
    this.ubo.write();
    this.inst.write(data, count * PARTICLE_FLOATS);
    this.count = count;
  }

  encode(pass: GPURenderPassEncoder, which: 'gbuf' | 'occ') {
    if (!this.count || !this.bg || !this.inst.buffer) return;
    pass.setPipeline(which === 'gbuf' ? this.pGbuf : this.pOcc);
    pass.setBindGroup(0, this.bg);
    pass.setVertexBuffer(0, this.inst.buffer);
    pass.draw(6, this.count);
  }

  dispose() { this.ubo.destroy(); this.inst.destroy(); }
}
