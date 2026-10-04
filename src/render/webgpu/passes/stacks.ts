// Sprite stacks on WebGPU — WGSL port of webgl2/spriteStack.ts (keep the math 1:1). Each voxel slice
// is an instanced quad (render/pack.ts `packStacks`, 20 floats) transformed by the body's rigid
// transform and projected by the oblique camera. Three pipelines share one explicit layout:
//  * gbuf     : parts above the local water surface → G-buffer (waterline foam, damage, lamps, decals)
//  * under    : parts below the surface → submerged color + depth below surface
//  * occluder : top-down world-aligned ortho → heightmap (MAX blend) for the shadow pass

import { shaderModule, validated, type GpuContext } from '../device';
import { BU, DynBuffer, SS, Ubo, type Samplers } from '../targets';
import { CAMERA_WGSL, DITHER_WGSL, GBUF_WGSL, MAT_WGSL, MATH_WGSL, NOISE_WGSL } from '../wgsl/common';
import { OCEAN_WGSL } from '../wgsl/ocean';
import { STACK_FLOATS } from '../../pack';
import type { SliceAtlas } from '../../../art/voxel';

export const QROT_WGSL = /* wgsl */ `
fn qrot(q: vec4f, v: vec3f) -> vec3f { let t = 2.0 * cross(q.xyz, v); return v + q.w * t + cross(q.xyz, t); }
`;

/**
 * Shared by stacks and the water lookup: 0 occRect (x, y rel origin, w, h) · 4 simRect
 * 8 foamCol (rgb, -) · 12 (waterline, time, simOn, rippleScale)
 */
export const STACK_UBO_FLOATS = 16;

const WGSL = /* wgsl */ `
${CAMERA_WGSL}
${MATH_WGSL}
${DITHER_WGSL}
${NOISE_WGSL}
${OCEAN_WGSL}
${MAT_WGSL}
${GBUF_WGSL}
${QROT_WGSL}
struct Stack { occRect: vec4f, simRect: vec4f, foamCol: vec4f, p: vec4f };
@group(0) @binding(2) var<uniform> SU: Stack;
@group(0) @binding(3) var atlasTex: texture_2d<f32>;
@group(0) @binding(4) var normTex: texture_2d<f32>;
@group(0) @binding(5) var waveTex: texture_2d<f32>;
@group(0) @binding(6) var near: sampler;
@group(0) @binding(7) var lin: sampler;

fn waterAt(p: vec2f) -> f32 {
  var h = oceanHeight(p);
  if (SU.p.z > 0.5) {
    let uv = (p - SU.simRect.xy) / SU.simRect.zw;
    let e = min(uv, 1.0 - uv);
    let w = smoothstep(0.0, 0.06, min(e.x, e.y));
    if (w > 0.0) { h += textureSampleLevel(waveTex, lin, uv, 0.0).r * w * SU.p.w; }
  }
  return h;
}

struct SIn {
  @location(0) pos: vec4f,    // body position (rel origin), slice local z
  @location(1) rot: vec4f,    // quaternion
  @location(2) rect: vec4f,   // slice x0, y0, w, h (model meters)
  @location(3) uv: vec4f,     // atlas rect
  @location(4) misc: vec4f,   // damage, flags, clip x0, clip x1
  @location(5) hits: vec4f,   // damage centres: local x, radius, local x, radius
};
struct SOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) world: vec3f,
  @location(2) local: vec3f,
  @location(3) @interpolate(flat) rot: vec4f,
  @location(4) @interpolate(flat) misc: vec4f,
  @location(5) @interpolate(flat) hits: vec4f,
};

fn stackVert(vi: u32, s: SIn) -> SOut {
  let q = vec2f(f32(vi & 1u), f32(vi >> 1u));
  var local = vec3f(s.rect.x + q.x * s.rect.z, s.rect.y + q.y * s.rect.w, s.pos.w);
  if ((u32(s.misc.y + 0.5) & 8u) != 0u) { local.z = 0.0; }   // flatten (ground shadows)
  let w = s.pos.xyz + qrot(s.rot, local);
  var o: SOut;
  o.world = w; o.local = local; o.rot = s.rot; o.misc = s.misc; o.hits = s.hits;
  o.uv = mix(s.uv.xy, s.uv.zw, q);
  o.pos = worldToClip(w);
  return o;
}
@vertex fn vsStack(@builtin(vertex_index) vi: u32, s: SIn) -> SOut { return stackVert(vi, s); }
@vertex fn vsStackOcc(@builtin(vertex_index) vi: u32, s: SIn) -> SOut {
  var o = stackVert(vi, s);
  let c = (o.world.xy - SU.occRect.xy) / SU.occRect.zw;
  o.pos = vec4f(c.x * 2.0 - 1.0, 1.0 - c.y * 2.0, 0.0, 1.0);
  return o;
}

@fragment fn fsStackGbuf(i: SOut) -> GOut {
  if (i.local.x < i.misc.z || i.local.x > i.misc.w) { discard; }
  let c = textureSampleLevel(atlasTex, near, i.uv, 0.0);
  if (c.a < 0.5) { discard; }
  let nm = textureSampleLevel(normTex, near, i.uv, 0.0);
  let flags = u32(i.misc.y + 0.5);
  var o: GOut;
  if ((flags & 4u) != 0u) {
    // ground shadow decal: dithered darkening of the sea
    if (ditherHere(i.pos.xy) < 0.45) { discard; }
    o.albedo = vec4f(0.015, 0.02, 0.03, MAT_WATER / 255.0);
    o.normal = vec4f(0.0, 0.0, i.world.z, 0.0);
    return o;
  }
  let wh = waterAt(i.world.xy);
  if (i.world.z < wh - 0.05) { discard; }
  var n = normalize(qrot(i.rot, nm.rgb * 2.0 - 1.0));
  if (n.z < 0.0) { n = normalize(vec3f(n.xy, 0.05)); }
  var mat = floor(nm.a * 255.0 + 0.5);
  var alb = c.rgb;
  var emis = 0.0;
  // battle damage: scorched, blackened plating clustered around the hits (light grime elsewhere),
  // shell holes at the centres, charred broken edges where a hull split in two
  let dmg = i.misc.x;
  var nearHit = 0.0;
  if (i.hits.y > 0.0) { nearHit = max(nearHit, 1.0 - smoothstep(i.hits.y * 0.3, i.hits.y, abs(i.local.x - i.hits.x))); }
  if (i.hits.w > 0.0) { nearHit = max(nearHit, 1.0 - smoothstep(i.hits.w * 0.3, i.hits.w, abs(i.local.x - i.hits.z))); }
  let dk = max(dmg * 0.35, nearHit * clamp(0.35 + dmg, 0.0, 1.0));
  if (dk > 0.0) {
    let hsh = hash12(floor(i.local.xy) + floor(i.local.z) * 7.3);
    if (nearHit > 0.7 && hsh < 0.18 * dk) { alb = vec3f(0.02); }
    else if (hsh < dk * 0.6) { alb *= 0.32 + 0.3 * hsh; }
    else if (hsh < dk * 0.8) { alb = mix(alb, vec3f(0.32, 0.17, 0.09), 0.6); }
  }
  let cut = min(abs(i.local.x - i.misc.z), abs(i.local.x - i.misc.w));
  if (cut < 1.5) { alb *= 0.12 + 0.4 * (cut / 1.5) * hash12(floor(i.local.yz * 2.0)); }
  if (mat == MAT_LAMP) { emis = select(0.0, 2.2, (flags & 1u) == 1u); if (emis == 0.0) { alb *= 0.5; } }
  // waterline: churned white water where the hull meets the sea
  // (only on the hull sides: a low deck lapped by the sea, like a U-boat casing, just looks wet)
  if (SU.p.x > 0.5 && i.world.z < wh + 0.32) {
    let d = ditherHere(i.pos.xy);
    let fz = hash12(floor(i.world.xy * 1.5) + floor(SU.p.y * 8.0));
    if (n.z < 0.6 && fz > 0.35 + d * 0.3) { alb = SU.foamCol.rgb; mat = MAT_FOAM; n = vec3f(0.0, 0.0, 1.0); }
    else { alb *= 0.75; }
  }
  o.albedo = vec4f(alb, mat / 255.0);
  o.normal = vec4f(n.xy, i.world.z, emis);
  return o;
}

struct UOut { @location(0) col: vec4f, @location(1) depth: vec4f, @builtin(frag_depth) z: f32 };
@fragment fn fsStackUnder(i: SOut) -> UOut {
  if (i.local.x < i.misc.z || i.local.x > i.misc.w) { discard; }
  let c = textureSampleLevel(atlasTex, near, i.uv, 0.0);
  if (c.a < 0.5) { discard; }
  let flags = u32(i.misc.y + 0.5);
  if ((flags & 4u) != 0u) { discard; }
  let wh = waterAt(i.world.xy);
  var dep = wh - i.world.z;
  if (dep < 0.0) { discard; }
  var col = c.rgb;
  // x-ray: own submerged boat stays readable as a tinted silhouette
  if ((flags & 2u) == 2u) { col = mix(col, vec3f(0.75, 0.95, 0.85), 0.35); dep = min(dep, 4.0); }
  var o: UOut;
  o.col = vec4f(col, 1.0);
  o.depth = vec4f(dep, i.world.z, 0.0, 1.0);
  o.z = clamp(dep / 400.0, 0.0, 1.0);
  return o;
}

@fragment fn fsStackOcc(i: SOut) -> @location(0) vec4f {
  if (i.local.x < i.misc.z || i.local.x > i.misc.w) { discard; }
  let c = textureSampleLevel(atlasTex, near, i.uv, 0.0);
  // shadow decals and things in flight (the heightmap would turn them into towers) cast no occluder
  if (c.a < 0.5 || (u32(i.misc.y + 0.5) & 20u) != 0u) { discard; }
  return vec4f(i.world.z, 0.0, 0.0, 0.0);
}
`;

const INSTANCE_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: STACK_FLOATS * 4, stepMode: 'instance',
  attributes: [0, 1, 2, 3, 4, 5].map((i) => ({ shaderLocation: i, offset: i * 16, format: 'float32x4' as const })),
};

/** MAX on height (r), ADD on smoke density (a) — `max` requires factors 'one' */
export const OCC_BLEND: GPUBlendState = {
  color: { operation: 'max', srcFactor: 'one', dstFactor: 'one' },
  alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one' },
};

export interface StackInputs { frame: GPUBuffer; ocean: GPUBuffer; wave: GPUTextureView }

export class StackPassGPU {
  pGbuf!: GPURenderPipeline; pUnder!: GPURenderPipeline; pOcc!: GPURenderPipeline;
  readonly ubo: Ubo;
  private layout!: GPUBindGroupLayout;
  private bg: GPUBindGroup | null = null;
  private inputs: StackInputs | null = null;
  private atlasTex: GPUTexture | null = null;
  private normTex: GPUTexture | null = null;
  private uploaded: { atlas: SliceAtlas | null; version: number } = { atlas: null, version: 0 };
  private inst: DynBuffer;
  count = 0;

  private constructor(private g: GpuContext, private s: Samplers) {
    this.ubo = new Ubo(g.device, STACK_UBO_FLOATS, 'stacks');
    this.inst = new DynBuffer(g.device, BU.VERTEX, 'stack instances');
  }

  static async create(g: GpuContext, s: Samplers): Promise<StackPassGPU> {
    const p = new StackPassGPU(g, s);
    const module = await shaderModule(g, 'stacks', WGSL);
    const d = g.device, VF = SS.VERTEX | SS.FRAGMENT;
    await validated(g, 'stack pipelines', () => {
      p.layout = d.createBindGroupLayout({
        label: 'stacks',
        entries: [
          { binding: 0, visibility: VF, buffer: { type: 'uniform' } },
          { binding: 1, visibility: VF, buffer: { type: 'uniform' } },
          { binding: 2, visibility: VF, buffer: { type: 'uniform' } },
          { binding: 3, visibility: SS.FRAGMENT, texture: { sampleType: 'float' } },
          { binding: 4, visibility: SS.FRAGMENT, texture: { sampleType: 'float' } },
          { binding: 5, visibility: SS.FRAGMENT, texture: { sampleType: 'float' } },
          { binding: 6, visibility: SS.FRAGMENT, sampler: { type: 'filtering' } },
          { binding: 7, visibility: SS.FRAGMENT, sampler: { type: 'filtering' } },
        ],
      });
      const layout = d.createPipelineLayout({ label: 'stacks', bindGroupLayouts: [p.layout] });
      const prim: GPUPrimitiveState = { topology: 'triangle-strip', cullMode: 'none' };
      p.pGbuf = d.createRenderPipeline({
        label: 'stack.gbuf', layout,
        vertex: { module, entryPoint: 'vsStack', buffers: [INSTANCE_LAYOUT] },
        fragment: { module, entryPoint: 'fsStackGbuf', targets: [{ format: 'rgba8unorm' }, { format: 'rgba16float' }] },
        primitive: prim, depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
      });
      p.pUnder = d.createRenderPipeline({
        label: 'stack.under', layout,
        vertex: { module, entryPoint: 'vsStack', buffers: [INSTANCE_LAYOUT] },
        fragment: { module, entryPoint: 'fsStackUnder', targets: [{ format: 'rgba8unorm' }, { format: 'rgba16float' }] },
        primitive: prim, depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
      });
      p.pOcc = d.createRenderPipeline({
        label: 'stack.occ', layout,
        vertex: { module, entryPoint: 'vsStackOcc', buffers: [INSTANCE_LAYOUT] },
        fragment: { module, entryPoint: 'fsStackOcc', targets: [{ format: 'rgba16float', blend: OCC_BLEND }] },
        primitive: prim,
      });
    });
    return p;
  }

  /** upload the slice atlas when it changed since this backend last sent it */
  uploadAtlas(atlas: SliceAtlas) {
    if (this.uploaded.atlas === atlas && this.uploaded.version === atlas.version) return;
    const d = this.g.device, S = atlas.size;
    if (!this.atlasTex || this.atlasTex.width !== S) {
      this.atlasTex?.destroy(); this.normTex?.destroy();
      const mk = (label: string) => d.createTexture({ label, format: 'rgba8unorm', size: { width: S, height: S }, usage: 0x04 | 0x02 /* TEXTURE_BINDING | COPY_DST */ });
      this.atlasTex = mk('atlas.albedo'); this.normTex = mk('atlas.normal');
      this.bg = null;
    }
    d.queue.writeTexture({ texture: this.atlasTex }, atlas.albedo as Uint8Array<ArrayBuffer>, { bytesPerRow: S * 4 }, { width: S, height: S });
    d.queue.writeTexture({ texture: this.normTex! }, atlas.normal as Uint8Array<ArrayBuffer>, { bytesPerRow: S * 4 }, { width: S, height: S });
    this.uploaded = { atlas, version: atlas.version };
  }

  setInputs(t: StackInputs) {
    const a = this.inputs;
    if (this.bg && a && a.frame === t.frame && a.ocean === t.ocean && a.wave === t.wave) return;
    this.inputs = t;
    if (!this.atlasTex) return;
    this.bg = this.g.device.createBindGroup({
      label: 'stacks', layout: this.layout,
      entries: [
        { binding: 0, resource: { buffer: t.frame } }, { binding: 1, resource: { buffer: t.ocean } },
        { binding: 2, resource: { buffer: this.ubo.buffer } },
        { binding: 3, resource: this.atlasTex.createView() }, { binding: 4, resource: this.normTex!.createView() },
        { binding: 5, resource: t.wave },
        { binding: 6, resource: this.s.nearest }, { binding: 7, resource: this.s.linear },
      ],
    });
  }

  /** per-frame uniforms + instance data */
  write(occRel: [number, number, number, number], sim: { x: number; y: number; size: number; on: boolean; rippleScale: number },
    foamCol: [number, number, number], waterline: boolean, time: number, data: Float32Array<ArrayBuffer>, count: number) {
    const f = this.ubo.f;
    f.set(occRel, 0);
    f[4] = sim.x; f[5] = sim.y; f[6] = sim.size; f[7] = sim.size;
    f[8] = foamCol[0]; f[9] = foamCol[1]; f[10] = foamCol[2]; f[11] = 0;
    f[12] = waterline ? 1 : 0; f[13] = time; f[14] = sim.on ? 1 : 0; f[15] = sim.rippleScale;
    this.ubo.write();
    this.inst.write(data, count * STACK_FLOATS);
    this.count = count;
  }

  /** which: the pipeline for the current render pass */
  encode(pass: GPURenderPassEncoder, which: 'gbuf' | 'under' | 'occ') {
    if (!this.count || !this.bg || !this.inst.buffer) return;
    pass.setPipeline(which === 'gbuf' ? this.pGbuf : which === 'under' ? this.pUnder : this.pOcc);
    pass.setBindGroup(0, this.bg);
    pass.setVertexBuffer(0, this.inst.buffer);
    pass.draw(4, this.count);
  }

  dispose() { this.ubo.destroy(); this.inst.destroy(); this.atlasTex?.destroy(); this.normTex?.destroy(); }
}
