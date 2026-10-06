// Ground decals on WebGPU (M19): bomb craters, scorch, burnt-out wrecks and strafing pocks drawn into the
// G-buffer's albedo after the sprite stacks, as flat quads on the ground. They blend over the albedo
// (material id and normals stay), and the depth test keeps them off hulls, buildings and anything else
// standing above the ground at that pixel. Pixel art: the look is stepped and dithered.

import { shaderModule, validated, type GpuContext } from '../device';
import { BU, DynBuffer, SS } from '../targets';
import { CAMERA_WGSL, DITHER_WGSL, MATH_WGSL, NOISE_WGSL } from '../wgsl/common';
import { DECAL_FLOATS } from '../../pack';

const WGSL = /* wgsl */ `
${CAMERA_WGSL}
${MATH_WGSL}
${NOISE_WGSL}
${DITHER_WGSL}
struct DIn {
  @location(0) pos: vec4f,   // x, y (rel origin), z, radius
  @location(1) p: vec4f,     // kind, seed, strength, -
};
struct DOut {
  @builtin(position) pos: vec4f,
  @location(0) q: vec2f,
  @location(1) @interpolate(flat) p: vec4f,
};
@vertex fn vsDecal(@builtin(vertex_index) vi: u32, d: DIn) -> DOut {
  var cs = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let c = cs[vi];
  // a little proud of the ground so it wins the depth test there, and turned by its seed
  let a = d.p.y * 6.2831853;
  let r = vec2f(cos(a) * c.x - sin(a) * c.y, sin(a) * c.x + cos(a) * c.y) * d.pos.w;
  var o: DOut;
  o.pos = worldToClip(vec3f(d.pos.xy + r, d.pos.z + 0.35));
  o.q = c; o.p = d.p;
  return o;
}
@fragment fn fsDecal(i: DOut) -> @location(0) vec4f {
  let kind = i32(i.p.x + 0.5);
  let r = length(i.q);
  if (r > 1.0) { discard; }
  let seed = i.p.y * 97.0;
  let ang = atan2(i.q.y, i.q.x);
  // ragged outline: the radius wobbles with angle
  let edge = 0.78 + 0.22 * vnoise(vec2f(ang * 2.2 + seed, seed * 0.37));
  var col = vec3f(0.0); var a = 0.0;
  if (kind == 0) {
    // crater: a dark pit, a lip of thrown-up earth, scorch fading outward with radial streaks
    let pit = 1.0 - smoothstep(0.32 * edge, 0.42 * edge, r);
    let lip = smoothstep(0.36 * edge, 0.46 * edge, r) * (1.0 - smoothstep(0.5 * edge, 0.64 * edge, r));
    let streak = vnoise(vec2f(ang * 7.0 + seed, r * 3.0));
    let burn = (1.0 - smoothstep(0.4, 1.0 * edge, r)) * (0.55 + 0.45 * streak);
    col = mix(vec3f(0.07, 0.06, 0.05), vec3f(0.36, 0.28, 0.2), lip);
    a = max(max(pit * 0.95, lip * 0.8), burn * 0.75);
    if (pit > 0.5) { col = vec3f(0.05, 0.045, 0.04) + vec3f(0.03) * vnoise(i.q * 9.0 + seed); }
    else if (lip < 0.3) { col = vec3f(0.08, 0.07, 0.06); }
  } else if (kind == 1) {
    // scorch: a blackened splash, patchy
    let n = vnoise(i.q * 3.5 + seed) * 0.6 + vnoise(i.q * 8.0 + seed * 1.7) * 0.4;
    a = (1.0 - smoothstep(0.45 * edge, edge, r)) * (0.45 + 0.55 * n);
    col = vec3f(0.06, 0.055, 0.05);
  } else if (kind == 2) {
    // a burnt-out patch under a wreck: black char with a ring of ash
    let n = vnoise(i.q * 5.0 + seed);
    let ash = smoothstep(0.55 * edge, 0.8 * edge, r) * (1.0 - smoothstep(0.85 * edge, edge, r));
    a = max((1.0 - smoothstep(0.5 * edge, 0.75 * edge, r)) * (0.6 + 0.4 * n), ash * 0.5);
    col = mix(vec3f(0.05, 0.045, 0.04), vec3f(0.38, 0.36, 0.33), ash);
  } else {
    // strafing: a line of small pocks along the quad's long axis
    let cell = floor((i.q.x + 1.0) * 6.0);
    let cx = (cell + 0.5) / 6.0 * 2.0 - 1.0 + (hash12(vec2f(cell, seed)) - 0.5) * 0.12;
    let d = length(vec2f((i.q.x - cx) * 6.0, i.q.y * 3.0 - (hash12(vec2f(seed, cell)) - 0.5)));
    a = (1.0 - smoothstep(0.25, 0.5, d)) * 0.8;
    col = vec3f(0.12, 0.1, 0.08);
  }
  a *= i.p.z;
  // pixel art: four dithered steps of coverage
  a = floor(a * 4.0 + ditherHere(i.pos.xy)) * 0.25;
  if (a <= 0.0) { discard; }
  return vec4f(col, a);
}
`;

const LAYOUT: GPUVertexBufferLayout = {
  arrayStride: DECAL_FLOATS * 4, stepMode: 'instance',
  attributes: [0, 1].map((i) => ({ shaderLocation: i, offset: i * 16, format: 'float32x4' as const })),
};

export class DecalPassGPU {
  private pipeline!: GPURenderPipeline;
  private layout!: GPUBindGroupLayout;
  private bg: GPUBindGroup | null = null;
  private frame: GPUBuffer | null = null;
  private inst: DynBuffer;
  count = 0;

  private constructor(private g: GpuContext) {
    this.inst = new DynBuffer(g.device, BU.VERTEX, 'decal instances');
  }

  static async create(g: GpuContext): Promise<DecalPassGPU> {
    const p = new DecalPassGPU(g);
    const d = g.device;
    const module = await shaderModule(g, 'decals', WGSL);
    await validated(g, 'decal pipeline', () => {
      p.layout = d.createBindGroupLayout({ label: 'decals', entries: [{ binding: 0, visibility: SS.VERTEX | SS.FRAGMENT, buffer: { type: 'uniform' } }] });
      p.pipeline = d.createRenderPipeline({
        label: 'decals', layout: d.createPipelineLayout({ label: 'decals', bindGroupLayouts: [p.layout] }),
        vertex: { module, entryPoint: 'vsDecal', buffers: [LAYOUT] },
        fragment: {
          module, entryPoint: 'fsDecal',
          targets: [
            // albedo blends toward the decal colour; the material id in alpha is kept
            { format: 'rgba8unorm', blend: { color: { operation: 'add', srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { operation: 'add', srcFactor: 'zero', dstFactor: 'one' } } },
            { format: 'rgba16float', writeMask: 0 },
          ],
        },
        primitive: { topology: 'triangle-list' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
      });
    });
    return p;
  }

  setFrame(frame: GPUBuffer) {
    if (this.bg && this.frame === frame) return;
    this.frame = frame;
    this.bg = this.g.device.createBindGroup({ label: 'decals', layout: this.layout, entries: [{ binding: 0, resource: { buffer: frame } }] });
  }

  write(data: Float32Array<ArrayBuffer>, count: number) {
    this.inst.write(data, count * DECAL_FLOATS);
    this.count = count;
  }

  encode(pass: GPURenderPassEncoder) {
    if (!this.count || !this.bg || !this.inst.buffer) return;
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bg);
    pass.setVertexBuffer(0, this.inst.buffer);
    pass.draw(6, this.count);
  }

  dispose() { this.inst.destroy(); }
}
