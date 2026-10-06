// GPU effect particles on WebGPU (M18, render/fx.ts): a storage buffer of ring slots, a compute pass that
// integrates them (buoyancy, drag, gravity, curl-noise turbulence, wind, the water plane), one draw into
// the HDR lit buffer with premultiplied blending (fire and sparks write alpha 0 and add light; smoke and
// spray write alpha and cover what is behind; a fireball puff slides from one to the other as it ages),
// depth-tested against the G-buffer so hulls in front hide it, and a draw into the occluder map so smoke
// columns cast shadows. Pixel art: sizes snap to buffer pixels, translucency is ordered dithering.

import { shaderModule, validated, type GpuContext } from '../device';
import { BU, SS, Ubo } from '../targets';
import { CAMERA_WGSL, MATH_WGSL, NOISE_WGSL } from '../wgsl/common';
import { FX_FLOATS, FX_KINDS, FX_MOTION, type FxSystem } from '../../fx';
import { OCC_BLEND } from './stacks';

const motionTable = () => `const MOTION = array<vec4f, ${FX_KINDS * 2}>(${FX_MOTION.map((m) =>
  `vec4f(${m.buoy.toFixed(3)}, ${m.drag.toFixed(3)}, ${m.grav.toFixed(3)}, ${m.curl.toFixed(3)}), vec4f(${m.wind.toFixed(3)}, ${m.water.toFixed(1)}, 0.0, 0.0)`).join(', ')});`;

/** shared struct + noise; the particle is 4 vec4: pos+age · vel+life · size0, size1, seed, kind · tint+heat */
const COMMON = /* wgsl */ `
struct Pt { a: vec4f, b: vec4f, c: vec4f, d: vec4f };
fn vn(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let h = vec4f(hash12(i), hash12(i + vec2f(1.0, 0.0)), hash12(i + vec2f(0.0, 1.0)), hash12(i + vec2f(1.0, 1.0)));
  return mix(mix(h.x, h.y, u.x), mix(h.z, h.w, u.x), u.y);
}
`;

// compute uniforms: 0 (dt, time, count, -) · 4 wind (x, y, -, -)
const SIM_WGSL = /* wgsl */ `
${MATH_WGSL}
${NOISE_WGSL}
${COMMON}
${motionTable()}
struct Sim { p: vec4f, wind: vec4f };
@group(0) @binding(0) var<storage, read_write> ps: array<Pt>;
@group(0) @binding(1) var<uniform> S: Sim;
// curl of a scalar noise field: a swirling flow without sources or sinks (smoke never clumps)
fn curl2(p: vec2f) -> vec2f {
  let e = 0.35;
  let a = vn(p + vec2f(0.0, e)); let b = vn(p - vec2f(0.0, e));
  let c = vn(p + vec2f(e, 0.0)); let d = vn(p - vec2f(e, 0.0));
  return vec2f(a - b, -(c - d)) / (2.0 * e);
}
@compute @workgroup_size(64) fn update(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= u32(S.p.z)) { return; }
  var p = ps[i];
  if (p.a.w >= p.b.w) { return; }
  let dt = S.p.x;
  let kind = i32(p.c.w + 0.5);
  let m0 = MOTION[kind * 2]; let m1 = MOTION[kind * 2 + 1];
  let t = p.a.w / max(p.b.w, 1e-3);
  var acc = vec3f(0.0, 0.0, -m0.z + m0.x * (1.0 - t) * (1.0 - t));
  if (m0.w > 0.0) {
    let q = p.a.xy * 0.05 + vec2f(p.c.z * 37.0, S.p.y * 0.11 + p.c.z * 11.0);
    acc += vec3f(curl2(q) * m0.w, (vn(q * 1.7 + 5.3) - 0.5) * m0.w * 0.6);
  }
  acc += vec3f((S.wind.xy - p.b.xy) * m1.x * 0.6, 0.0);
  var v = (p.b.xyz + acc * dt) * exp(-m0.y * dt);
  var pos = p.a.xyz + v * dt;
  if (pos.z < 0.0 && v.z < 0.0) {
    if (m1.y > 1.5) { pos.z = 0.0; v = vec3f(v.xy * 0.2, 0.0); }
    else if (m1.y > 0.5) { p.a.w = p.b.w; }
  }
  p.a = vec4f(pos, min(p.a.w + dt, p.b.w)); p.b = vec4f(v, p.b.w);
  ps[i] = p;
}
`;

/**
 * draw uniforms (float offsets): 0 origin (x, y), maxPx, time · 4 smokeLight (rgb, -) · 8 occRect (x, y rel,
 * w, h) · 12 (occScale texels/m, occRes, intensity, -) · 16 GI emission (giScale texels/m, giRes, gain, min size m)
 */
const DRAW_WGSL = /* wgsl */ `
${CAMERA_WGSL}
${MATH_WGSL}
${NOISE_WGSL}
${COMMON}
struct Draw { o: vec4f, light: vec4f, occRect: vec4f, q: vec4f, gi: vec4f };
@group(0) @binding(1) var<uniform> D: Draw;
@group(0) @binding(2) var<storage, read> ps: array<Pt>;
struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) col: vec4f,   // rgb (premultiplied later), alpha
  @location(2) @interpolate(flat) info: vec4f,  // additive, kind, seed, t
};
fn corner(vi: u32) -> vec2f {
  var c = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  return c[vi];
}
// fire colour by temperature: white-yellow core, orange, deep red
fn fireRamp(k: f32) -> vec3f {
  let a = vec3f(3.4, 2.4, 1.1); let b = vec3f(2.2, 0.85, 0.18); let c = vec3f(0.7, 0.14, 0.03);
  return select(mix(b, a, (k - 0.5) * 2.0), mix(c, b, k * 2.0), k < 0.5);
}
// appearance by kind and age: colour, alpha, additive share, size (m)
fn look(p: Pt, t: f32) -> array<vec4f, 2> {
  let kind = i32(p.c.w + 0.5);
  let heat = p.d.w;
  let flick = hash12(vec2f(p.c.z * 91.7, floor(D.o.w * 24.0)));
  let s01 = sqrt(t);
  var col = vec3f(1.0); var a = 1.0; var add = 1.0; var size = mix(p.c.x, p.c.y, s01);
  let fadeOut = 1.0 - smoothstep(0.6, 1.0, t);
  if (kind == 0) {
    // fireball puff: burns, then cools into dark smoke lit by the scene
    let burn = heat * (1.0 - smoothstep(0.04, 0.38, t));
    let smoke = p.d.rgb * 0.2 * D.light.rgb;
    col = mix(smoke, fireRamp(burn), smoothstep(0.05, 0.4, burn));
    // never fully additive: a fireball covers what is behind it, so stacked puffs cannot burn white
    add = 0.75 * smoothstep(0.15, 0.55, burn);
    a = smoothstep(0.0, 0.04, t) * (1.0 - t * t * t) * mix(0.8, 1.0, add);
  } else if (kind == 1) {
    col = mix(vec3f(5.0, 2.2, 0.5), vec3f(1.4, 0.22, 0.04), t) * (0.55 + 0.7 * flick);
    a = smoothstep(0.0, 0.08, t) * fadeOut; size = p.c.x;
  } else if (kind == 2) {
    col = fireRamp(1.0 - t * 1.1) * 1.3; a = 1.0 - t * t; size = p.c.x;
  } else if (kind == 3) {
    // a hot glow at the root for the first second, whatever the puff's life
    col = p.d.rgb * 0.22 * D.light.rgb + vec3f(2.6, 0.9, 0.2) * heat * pow(max(1.0 - p.a.w * 1.4, 0.0), 3.0);
    add = 0.0; a = 0.82 * smoothstep(0.0, 0.12, t) * fadeOut;
  } else if (kind == 4) {
    col = vec3f(9.0, 7.5, 5.0) * heat; a = (1.0 - t) * (1.0 - t); size = mix(p.c.x, p.c.y, min(1.0, t * 3.0));
  } else if (kind == 5) {
    col = p.d.rgb * D.light.rgb * 0.8; add = 0.0; a = 0.9 * fadeOut;
  } else if (kind == 6) {
    let glow = heat * max(1.0 - t * 3.0, 0.0);
    col = mix(p.d.rgb * D.light.rgb * 0.5, fireRamp(0.6) * 0.8, glow); add = glow; a = 1.0; size = p.c.x;
  } else if (kind == 7) {
    col = p.d.rgb * D.light.rgb * 0.75; add = 0.0; a = 0.5 * smoothstep(0.0, 0.1, t) * fadeOut;
  } else if (kind == 8) {
    let core = 1.0 - smoothstep(0.0, 0.15, p.a.w);
    col = mix(vec3f(0.035, 0.032, 0.03) * D.light.rgb, vec3f(6.0, 3.2, 1.0), core); add = core;
    a = 0.92 * (1.0 - smoothstep(0.55, 1.0, t)); size = mix(p.c.x, p.c.y, min(1.0, t * 5.0));
  } else if (kind == 9) {
    col = vec3f(0.9, 0.95, 1.0) * heat * (1.0 - t) * (1.0 - t) * 0.6; a = 1.0; size = p.c.y * (1.0 - pow(1.0 - t, 2.5));
  } else if (kind == 11) {
    // flame tongue: colour comes from the fragment's noise fire; here only the fade in and out
    col = vec3f(heat); a = smoothstep(0.0, 0.15, t) * (1.0 - smoothstep(0.7, 1.0, t)); add = 0.7; size = p.c.x;
  } else {
    col = p.d.rgb * D.light.rgb * 0.6; add = 0.0; a = 0.7 * smoothstep(0.0, 0.1, t) * fadeOut;
  }
  return array<vec4f, 2>(vec4f(col, a), vec4f(add, size, 0.0, 0.0));
}
@vertex fn vsFx(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var o: VOut;
  let p = ps[ii];
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  if (p.a.w >= p.b.w) { return o; }
  let t = clamp(p.a.w / max(p.b.w, 1e-3), 0.0, 1.0);
  let L = look(p, t);
  let kind = i32(p.c.w + 0.5);
  let c = corner(vi);
  let rel = vec3f(p.a.xy - D.o.xy, p.a.z);
  if (kind == 9) {
    // shock ring: a flat annulus on the surface (the oblique view squashes it like the sea)
    let R = max(L[1].y, 0.5);
    o.pos = worldToClip(rel + vec3f(c * R, 0.0));
  } else if (kind == 11) {
    // flame tongue: an upright quad standing on its base (size0 = width, size1 = height, m); drawn a
    // little taller than the oblique view would show it, so a blaze reads at game zoom
    // depth climbs with it as if it stood upright, so the tongue licks up in front of the hull behind it
    var clip = worldToClip(rel);
    let top = worldToClip(rel + vec3f(0.0, 0.0, p.c.y));
    let w = max(2.0, p.c.x * F.cam.z);
    let h = max(3.0, p.c.y * F.cam.z * 0.95);
    let k = c.y * 0.5 + 0.5;
    clip.x += c.x * w * 0.5 * 2.0 / F.buf.x;
    clip.y += k * h * 2.0 / F.buf.y;
    clip.z = mix(clip.z, top.z, k);
    o.pos = clip;
  } else {
    var clip = worldToClip(rel);
    let px = clamp(L[1].y * F.cam.z, 1.0, D.o.z);
    var ax = vec2f(1.0, 0.0); var half = vec2f(px * 0.5 + 0.5);
    if (kind == 2) {
      // sparks stretch along their screen-space velocity
      let sv = vec2f(p.b.x, p.b.y * F.tilt.x - p.b.z * F.tilt.y) * F.cam.z;
      let sp = length(sv);
      if (sp > 0.5) { ax = sv / sp; half.x += min(sp * 0.035, 10.0); }
    }
    let ay = vec2f(-ax.y, ax.x);
    let off = ax * c.x * half.x + ay * c.y * half.y;
    clip.x += off.x * 2.0 / F.buf.x;
    clip.y -= off.y * 2.0 / F.buf.y;
    o.pos = clip;
  }
  o.uv = c;
  o.col = L[0];
  o.info = vec4f(L[1].x, f32(kind), p.c.z, t);
  return o;
}
fn bayer4(p: vec2f) -> f32 {
  let x = u32(p.x) & 3u; let y = u32(p.y) & 3u;
  var m = array<f32, 16>(0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (m[y * 4u + x] + 0.5) / 16.0;
}
@fragment fn fsFx(i: VOut) -> @location(0) vec4f {
  let kind = i32(i.info.y + 0.5);
  let r = length(i.uv);
  var shape: f32;
  var rgb = i.col.rgb;
  if (kind == 9) {
    // annulus band, thinning as it grows
    let x = (r - 0.93) / 0.035;
    shape = exp(-x * x) * 0.3;
  } else if (kind == 11) {
    // noise fire: fBm scrolling up, bent by a second noise, shaped hot at the base and the middle, the
    // heat stepped through the fire ramp (pixel-art palette bands)
    let y = i.uv.y * 0.5 + 0.5;
    let tt = D.o.w * 2.2 + i.info.z * 31.0;
    var q = vec2f(i.uv.x * 1.9 + i.info.z * 7.0, y * 2.4 - tt);
    q += (vec2f(vn(q * 1.3 + vec2f(0.0, -tt * 0.4)), vn(q * 1.3 + vec2f(5.2, 1.3 - tt * 0.4))) - 0.5) * 1.1;
    let n = vn(q) * 0.55 + vn(q * 2.1 + 3.1) * 0.3 + vn(q * 4.4 + 7.7) * 0.15;
    let grad = clamp(1.0 - y, 0.0, 1.0) * (1.0 - i.uv.x * i.uv.x);
    let heat = clamp(n * grad * 1.9 - 0.36 + 0.35 * grad * grad, 0.0, 1.0) * i.col.a;
    if (heat < 0.05) { discard; }
    let hq = floor(heat * 6.0 + bayer4(i.pos.xy) * 0.6) / 6.0;
    rgb = fireRamp(hq) * 1.15 * i.col.r;
    shape = smoothstep(0.05, 0.3, heat) / max(i.col.a, 1e-3);
  } else {
    // clumpy soft blob: a disc eroded by noise, hot cores for fire
    let n = vn(i.uv * 2.3 + vec2f(i.info.z * 47.0, i.info.w * 2.0)) * 0.6 + vn(i.uv * 5.1 + i.info.z * 13.0) * 0.4;
    shape = smoothstep(0.15, 0.6, (1.0 - smoothstep(0.35, 1.0, r)) * (0.35 + 0.9 * n));
    if (kind == 2 || kind == 1) { shape = 1.0 - smoothstep(0.3, 1.0, r); }
    // puffs of smoke and spray are lit from above and lumpy inside
    rgb *= mix((0.8 - 0.3 * i.uv.y) * (0.8 + 0.4 * n), 1.0, i.info.x);
  }
  var a = clamp(i.col.a * shape, 0.0, 1.0);
  let add = i.info.x;
  // pixel art: alpha in four dithered steps, so smoke and fire break up into game pixels
  a = floor(a * 4.0 + bayer4(i.pos.xy)) * 0.25;
  if (a <= 0.0) { discard; }
  return vec4f(rgb * a * D.q.z, a * (1.0 - add));
}

// smoke shades the occluder map (alpha = density, added up) so columns cast shadows
@vertex fn vsFxOcc(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var o: VOut;
  let p = ps[ii];
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  let kind = i32(p.c.w + 0.5);
  if (p.a.w >= p.b.w || !(kind == 0 || kind == 3 || kind == 7 || kind == 8 || kind == 10)) { return o; }
  let t = clamp(p.a.w / max(p.b.w, 1e-3), 0.0, 1.0);
  let L = look(p, t);
  if (L[1].x > 0.5) { return o; }
  let c = corner(vi);
  let rel = p.a.xy - D.o.xy;
  let uv = (rel - D.occRect.xy) / D.occRect.zw;
  let size = max(1.0, L[1].y * D.q.x) / D.q.y;
  o.pos = vec4f(uv.x * 2.0 - 1.0 + c.x * size, 1.0 - uv.y * 2.0 - c.y * size, 0.0, 1.0);
  o.uv = c; o.col = L[0]; o.info = vec4f(L[1].x, f32(kind), p.c.z, t);
  return o;
}
// hot particles splat their light into the GI emission grid (same window as the occluder map, coarser):
// fire while it burns, flashes, glowing debris, a flak burst's core. A particle smaller than
// a GI texel is drawn at the minimum size with its light thinned to match, so the total stays the same
@vertex fn vsFxEmit(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var o: VOut;
  let p = ps[ii];
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  let kind = i32(p.c.w + 0.5);
  // embers and sparks are too small and too many: as GI emitters they only add speckle
  if (p.a.w >= p.b.w || kind == 1 || kind == 2 || kind == 3 || kind == 5 || kind == 7 || kind == 9 || kind == 10 || kind == 11) { return o; }
  let t = clamp(p.a.w / max(p.b.w, 1e-3), 0.0, 1.0);
  let L = look(p, t);
  let hot = L[0].rgb * L[0].a * L[1].x;
  if (max(hot.r, max(hot.g, hot.b)) < 0.01) { return o; }
  let c = corner(vi);
  let rel = p.a.xy - D.o.xy;
  let uv = (rel - D.occRect.xy) / D.occRect.zw;
  let sz = max(L[1].y, D.gi.w);
  let half = sz * 0.5 * D.gi.x / D.gi.y * 2.0;
  o.pos = vec4f(uv.x * 2.0 - 1.0 + c.x * half, 1.0 - uv.y * 2.0 - c.y * half, 0.0, 1.0);
  let thin = (L[1].y * L[1].y) / (sz * sz);
  o.uv = c; o.col = vec4f(hot * thin * D.gi.z, 1.0); o.info = vec4f(L[1].x, f32(kind), p.c.z, t);
  return o;
}
@fragment fn fsFxEmit(i: VOut) -> @location(0) vec4f {
  let r = dot(i.uv, i.uv);
  if (r > 1.0) { discard; }
  return vec4f(i.col.rgb * (1.0 - r) * 2.0, 0.0);
}

@fragment fn fsFxOcc(i: VOut) -> @location(0) vec4f {
  let r = dot(i.uv, i.uv);
  if (r > 1.0) { discard; }
  return vec4f(-50.0, 0.0, 0.0, i.col.a * (1.0 - r) * 0.9);
}
`;

const ADD: GPUBlendState = { color: { operation: 'add', srcFactor: 'one', dstFactor: 'one' }, alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one' } };

const PREMULT: GPUBlendState = {
  color: { operation: 'add', srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
  alpha: { operation: 'add', srcFactor: 'zero', dstFactor: 'one' },
};

export class FxPassGPU {
  private pSim!: GPUComputePipeline;
  private pDraw!: GPURenderPipeline;
  private pOcc!: GPURenderPipeline;
  private pEmit!: GPURenderPipeline;
  private simUbo: Ubo; private drawUbo: Ubo;
  readonly buf: GPUBuffer;
  private bgSim!: GPUBindGroup;
  private bgDraw: GPUBindGroup | null = null;
  private frame: GPUBuffer | null = null;
  private count = 0;
  static readonly CAP = 65536;

  private constructor(private g: GpuContext) {
    const d = g.device;
    this.simUbo = new Ubo(d, 8, 'fx.sim');
    this.drawUbo = new Ubo(d, 20, 'fx.draw');
    this.buf = d.createBuffer({ label: 'fx particles', size: FxPassGPU.CAP * FX_FLOATS * 4, usage: BU.STORAGE | BU.COPY_DST });
  }

  static async create(g: GpuContext): Promise<FxPassGPU> {
    const p = new FxPassGPU(g);
    const d = g.device;
    const sim = await shaderModule(g, 'fx.sim', SIM_WGSL);
    const draw = await shaderModule(g, 'fx.draw', DRAW_WGSL);
    await validated(g, 'fx pipelines', () => {
      p.pSim = d.createComputePipeline({ label: 'fx.sim', layout: 'auto', compute: { module: sim, entryPoint: 'update' } });
      p.bgSim = d.createBindGroup({
        label: 'fx.sim', layout: p.pSim.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: p.buf } }, { binding: 1, resource: { buffer: p.simUbo.buffer } }],
      });
      const layout = d.createBindGroupLayout({
        label: 'fx.draw',
        entries: [
          { binding: 0, visibility: SS.VERTEX | SS.FRAGMENT, buffer: { type: 'uniform' } },
          { binding: 1, visibility: SS.VERTEX | SS.FRAGMENT, buffer: { type: 'uniform' } },
          { binding: 2, visibility: SS.VERTEX, buffer: { type: 'read-only-storage' } },
        ],
      });
      const pl = d.createPipelineLayout({ label: 'fx.draw', bindGroupLayouts: [layout] });
      p.pDraw = d.createRenderPipeline({
        label: 'fx.draw', layout: pl,
        vertex: { module: draw, entryPoint: 'vsFx' },
        fragment: { module: draw, entryPoint: 'fsFx', targets: [{ format: 'rgba16float', blend: PREMULT }] },
        primitive: { topology: 'triangle-list' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
      });
      p.pOcc = d.createRenderPipeline({
        label: 'fx.occ', layout: pl,
        vertex: { module: draw, entryPoint: 'vsFxOcc' },
        fragment: { module: draw, entryPoint: 'fsFxOcc', targets: [{ format: 'rgba16float', blend: OCC_BLEND }] },
        primitive: { topology: 'triangle-list' },
      });
      p.pEmit = d.createRenderPipeline({
        label: 'fx.emit', layout: pl,
        vertex: { module: draw, entryPoint: 'vsFxEmit' },
        fragment: { module: draw, entryPoint: 'fsFxEmit', targets: [{ format: 'rgba16float', blend: ADD }] },
        primitive: { topology: 'triangle-list' },
      });
    });
    return p;
  }

  setFrame(frame: GPUBuffer) {
    if (this.bgDraw && this.frame === frame) return;
    this.frame = frame;
    this.bgDraw = this.g.device.createBindGroup({
      label: 'fx.draw', layout: this.pDraw.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: frame } }, { binding: 1, resource: { buffer: this.drawUbo.buffer } }, { binding: 2, resource: { buffer: this.buf } }],
    });
  }

  /** upload this frame's new particles and integrate every live slot by dt */
  simulate(enc: GPUCommandEncoder, fx: FxSystem, dt: number, time: number, wind: [number, number]) {
    const q = this.g.device.queue;
    for (const r of fx.runs) q.writeBuffer(this.buf, r.slot * FX_FLOATS * 4, fx.staged, r.src * FX_FLOATS, r.n * FX_FLOATS);
    fx.consumed();
    this.count = fx.used;
    if (!this.count || dt <= 0) return;
    // long frames run in substeps of at most 1/10 s (dispatches in one pass see each other's writes)
    const n = Math.ceil(dt / 0.1);
    const f = this.simUbo.f;
    f[0] = dt / n; f[1] = time; f[2] = this.count; f[4] = wind[0]; f[5] = wind[1];
    this.simUbo.write();
    const cp = enc.beginComputePass({ label: 'fx.sim' });
    cp.setPipeline(this.pSim);
    cp.setBindGroup(0, this.bgSim);
    for (let i = 0; i < n; i++) cp.dispatchWorkgroups(Math.ceil(this.count / 64));
    cp.end();
  }

  write(ox: number, oy: number, time: number, maxPx: number, smokeLight: [number, number, number], occRel: [number, number, number, number], occRes: number, intensity: number) {
    const f = this.drawUbo.f;
    f[0] = ox; f[1] = oy; f[2] = maxPx; f[3] = time;
    f[4] = smokeLight[0]; f[5] = smokeLight[1]; f[6] = smokeLight[2];
    f.set(occRel, 8);
    f[12] = occRes / occRel[2]; f[13] = occRes; f[14] = intensity;
    this.drawUbo.write();
  }

  /** GI emission parameters (texels per metre and size of the GI grid, light gain, minimum splat size m) */
  setGi(giScale: number, giRes: number, gain: number, minSize: number) {
    const f = this.drawUbo.f;
    f[16] = giScale; f[17] = giRes; f[18] = gain; f[19] = minSize;
  }

  encode(pass: GPURenderPassEncoder, which: 'draw' | 'occ' | 'emit') {
    if (!this.count || !this.bgDraw) return;
    pass.setPipeline(which === 'draw' ? this.pDraw : which === 'occ' ? this.pOcc : this.pEmit);
    pass.setBindGroup(0, this.bgDraw);
    pass.draw(6, this.count);
  }

  dispose() { this.simUbo.destroy(); this.drawUbo.destroy(); this.buf.destroy(); }
}
