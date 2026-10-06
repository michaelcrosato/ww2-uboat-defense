// Bloom, light shafts, grading and the final integer-scaled present — WGSL port of
// webgl2/passes/postPass.ts. The lit image is (W+2) x (H+2) internal pixels; present maps each device
// pixel to a buffer pixel with the camera's sub-pixel remainder applied as a whole-device-pixel shift, so
// the world scrolls smoothly while every game pixel stays a crisp S x S block. Screen-space effects (M18)
// bend the lookup: shockwave rings push pixels outward in a thin band, heat haze shimmers above fires and
// a radial colour split follows big blasts.

import { shaderModule, validated, type GpuContext } from '../device';
import { resizeTarget, Ubo, type GpuTarget, type Samplers } from '../targets';
import { FULLSCREEN_WGSL, MATH_WGSL, NOISE_WGSL } from '../wgsl/common';
import { POST_HEAT, POST_RINGS, POST_SHAFTS, type PostParams } from '../../common/post';

// bright / blur uniforms: 0 texel (x, y) · 2 dir (x, y)
const BLOOM_WGSL = /* wgsl */ `
${FULLSCREEN_WGSL}
struct B { texel: vec2f, dir: vec2f };
@group(0) @binding(0) var<uniform> U: B;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var lin: sampler;
@fragment fn fsBright(i: VsOut) -> @location(0) vec4f {
  let uv = i.pos.xy * U.texel;
  let c = textureSampleLevel(src, lin, uv, 0.0).rgb;
  let l = max(c.r, max(c.g, c.b));
  return vec4f(c * smoothstep(0.85, 1.6, l), 1.0);
}
@fragment fn fsBlur(i: VsOut) -> @location(0) vec4f {
  let uv = i.pos.xy * U.texel;
  var w = array<f32, 5>(0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  var c = textureSampleLevel(src, lin, uv, 0.0).rgb * w[0];
  for (var k = 1; k < 5; k++) {
    c += textureSampleLevel(src, lin, uv + U.dir * U.texel * f32(k) * 1.5, 0.0).rgb * w[k];
    c += textureSampleLevel(src, lin, uv - U.dir * U.texel * f32(k) * 1.5, 0.0).rgb * w[k];
  }
  return vec4f(c, 1.0);
}
`;

// light shafts (volumetric light scattering as a post-process): from each pixel march toward a bright
// source through the bright buffer, adding what it passes with a decay, so a flash throws rays through
// smoke and rigging. Uniforms: 0 texel (x, y), count, - · 4.. sources (uv x, y, intensity, -)
const SHAFT_FLOATS = 4 + POST_SHAFTS * 4;
const SHAFTS_WGSL = /* wgsl */ `
${FULLSCREEN_WGSL}
struct Sh { texel: vec2f, count: f32, pad: f32, src: array<vec4f, ${POST_SHAFTS}> };
@group(0) @binding(0) var<uniform> U: Sh;
@group(0) @binding(1) var bright: texture_2d<f32>;
@group(0) @binding(2) var lin: sampler;
@fragment fn fsShafts(i: VsOut) -> @location(0) vec4f {
  let uv = i.pos.xy * U.texel;
  var acc = vec3f(0.0);
  for (var s = 0; s < ${POST_SHAFTS}; s++) {
    if (f32(s) >= U.count) { break; }
    let L = U.src[s];
    let step = (L.xy - uv) / 28.0;
    var p = uv; var w = 1.0;
    var sum = vec3f(0.0);
    for (var k = 0; k < 28; k++) {
      p += step;
      sum += textureSampleLevel(bright, lin, p, 0.0).rgb * w;
      w *= 0.94;
    }
    acc += sum * L.z / 28.0;
  }
  return vec4f(acc, 1.0);
}
`;

/**
 * Present uniforms (float offsets): 0 device (w, h) · 2 shift (x, y) · 4 buf (w, h) · 6 S · 7 bloom
 * 8 vignette · 9 grain · 10 scan · 11 time · 12 flash · 13 grade · 14 pad · 16 flashCol (rgb, -)
 * 20 fx (chroma, ringCount, heatCount, shaftAmt) · 24 rings (x, y, radius, strength in buffer px)
 * 24 + 4·POST_RINGS heat (x, y, radius, strength)
 */
const PRESENT_FLOATS = 24 + POST_RINGS * 4 + POST_HEAT * 4;
const PRESENT_WGSL = /* wgsl */ `
${FULLSCREEN_WGSL}
${MATH_WGSL}
${NOISE_WGSL}
struct P {
  device: vec2f, shift: vec2f, buf: vec2f, S: f32, bloomAmt: f32,
  vignette: f32, grain: f32, scan: f32, time: f32, flash: f32, grade: f32, pad: vec2f,
  flashCol: vec4f,
  fx: vec4f,
  rings: array<vec4f, ${POST_RINGS}>,
  heat: array<vec4f, ${POST_HEAT}>,
};
@group(0) @binding(0) var<uniform> U: P;
@group(0) @binding(1) var lit: texture_2d<f32>;
@group(0) @binding(2) var bloomTex: texture_2d<f32>;
@group(0) @binding(3) var lin: sampler;
@group(0) @binding(4) var shaftTex: texture_2d<f32>;
fn fetch(b: vec2f) -> vec3f { return textureLoad(lit, vec2<i32>(clamp(floor(b), vec2f(0.0), U.buf - 1.0)), 0).rgb; }
@fragment fn fsPresent(i: VsOut) -> @location(0) vec4f {
  let d = i.pos.xy;   // device pixel, y down
  let bp = (d + U.shift) / U.S + 1.0;   // continuous buffer position
  // ---- screen-space distortion: shockwave bands and heat shimmer move the lookup, never the picture
  var off = vec2f(0.0);
  for (var k = 0; k < ${POST_RINGS}; k++) {
    if (f32(k) >= U.fx.y) { break; }
    let r = U.rings[k];
    let dv = bp - r.xy;
    let dist = max(length(dv), 1e-3);
    let th = 2.5 + r.z * 0.1;
    let x = (dist - r.z) / th;
    off += (dv / dist) * r.w * x * exp(-x * x);
  }
  for (var k = 0; k < ${POST_HEAT}; k++) {
    if (f32(k) >= U.fx.z) { break; }
    let h = U.heat[k];
    // a plume of hot air rising up the screen from the fire
    let q = (bp - h.xy) / vec2f(h.z, h.z * 2.2);
    let fall = exp(-dot(q + vec2f(0.0, 0.55), q + vec2f(0.0, 0.55)) * 1.6);
    if (fall > 0.01) {
      let n = vec2f(vnoise(bp * 0.31 + vec2f(0.0, U.time * 4.0)), vnoise(bp * 0.29 + vec2f(17.0, U.time * 3.3))) - 0.5;
      off += n * fall * h.w * 3.0;
    }
  }
  let b = bp + off;
  var c: vec3f;
  if (U.fx.x > 0.05) {
    let dir = normalize(b - U.buf * 0.5 + vec2f(1e-3)) * U.fx.x;
    c = vec3f(fetch(b + dir).r, fetch(b).g, fetch(b - dir).b);
  } else { c = fetch(b); }
  let uvb = (floor(clamp(b, vec2f(0.0), U.buf - 1.0)) + 0.5) / U.buf;
  c += textureSampleLevel(bloomTex, lin, uvb, 0.0).rgb * U.bloomAmt;
  c += textureSampleLevel(shaftTex, lin, uvb, 0.0).rgb * U.fx.w;
  let l = dot(c, vec3f(0.3, 0.55, 0.15));
  let grade = i32(U.grade + 0.5);
  if (grade == 2) { c = mix(vec3f(0.16, 0.1, 0.06), vec3f(1.0, 0.9, 0.72), clamp(l * 1.05, 0.0, 1.2)); }
  else if (grade == 3) { c = mix(vec3f(l), c, 1.4); c = (c - 0.5) * 1.12 + 0.5 + vec3f(0.02, 0.0, -0.02); }
  else if (grade == 4) { c = mix(c, vec3f(l * 1.3, l * 0.16, l * 0.1), 0.78); }
  else if (grade == 5) { let m = (l - 0.5) * 1.15 + 0.5; c = vec3f(m); }
  else if (grade == 1) { c = mix(vec3f(l), c, 0.92); }
  c += U.flashCol.rgb * U.flash;
  let q = d / U.device - 0.5;
  c *= 1.0 - U.vignette * smoothstep(0.25, 0.75, length(q * vec2f(1.0, U.device.y / U.device.x) * 1.15));
  if (U.grain > 0.0) { c += (hash12(floor(b) + floor(U.time * 24.0) * 13.7) - 0.5) * 0.06 * U.grain; }
  if (U.scan > 0.0 && U.S >= 2.0 && fmod(d.y + U.shift.y, U.S) >= U.S - 1.0) { c *= 1.0 - U.scan * 0.5; }
  return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), 1.0);
}
`;

const HDR: GPUTextureFormat = 'rgba16float';

export class PostPassGPU {
  bright: GpuTarget | null = null; blurA: GpuTarget | null = null; blurB: GpuTarget | null = null; shafts: GpuTarget | null = null;
  private pBright!: GPURenderPipeline; private pBlur!: GPURenderPipeline; private pPresent!: GPURenderPipeline; private pShafts!: GPURenderPipeline;
  private uBright: Ubo; private uBlurH: Ubo; private uBlurV: Ubo; private uPresent: Ubo; private uShafts: Ubo;
  private bgBright: GPUBindGroup | null = null; private bgBlurH: GPUBindGroup | null = null;
  private bgBlurV: GPUBindGroup | null = null; private bgPresent: GPUBindGroup | null = null; private bgShafts: GPUBindGroup | null = null;
  private litView: GPUTextureView | null = null;
  private shaftsOn = false;

  private constructor(private g: GpuContext, private s: Samplers) {
    const d = g.device;
    this.uBright = new Ubo(d, 4, 'post.bright'); this.uBlurH = new Ubo(d, 4, 'post.blurH');
    this.uBlurV = new Ubo(d, 4, 'post.blurV'); this.uPresent = new Ubo(d, PRESENT_FLOATS, 'post.present');
    this.uShafts = new Ubo(d, SHAFT_FLOATS, 'post.shafts');
  }

  static async create(g: GpuContext, s: Samplers): Promise<PostPassGPU> {
    const p = new PostPassGPU(g, s);
    const bloom = await shaderModule(g, 'post.bloom', BLOOM_WGSL);
    const shafts = await shaderModule(g, 'post.shafts', SHAFTS_WGSL);
    const present = await shaderModule(g, 'post.present', PRESENT_WGSL);
    await validated(g, 'post pipelines', () => {
      const mk = (label: string, module: GPUShaderModule, entry: string, format: GPUTextureFormat) => g.device.createRenderPipeline({
        label, layout: 'auto',
        vertex: { module, entryPoint: 'vsFull' },
        fragment: { module, entryPoint: entry, targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      });
      p.pBright = mk('post.bright', bloom, 'fsBright', HDR);
      p.pBlur = mk('post.blur', bloom, 'fsBlur', HDR);
      p.pShafts = mk('post.shafts', shafts, 'fsShafts', HDR);
      p.pPresent = mk('post.present', present, 'fsPresent', g.format);
    });
    return p;
  }

  /** half-res bloom targets for a bw x bh lit buffer; the lit view feeds bright + present */
  setInputs(lit: GPUTextureView, bw: number, bh: number) {
    const d = this.g.device;
    const w = Math.max(1, Math.ceil(bw / 2)), h = Math.max(1, Math.ceil(bh / 2));
    let ch = false, c: boolean;
    [this.bright, c] = resizeTarget(d, this.bright, HDR, w, h, 0, 'bloom.bright'); ch ||= c;
    [this.blurA, c] = resizeTarget(d, this.blurA, HDR, w, h, 0, 'bloom.a'); ch ||= c;
    [this.blurB, c] = resizeTarget(d, this.blurB, HDR, w, h, 0, 'bloom.b'); ch ||= c;
    [this.shafts, c] = resizeTarget(d, this.shafts, HDR, w, h, 0, 'shafts'); ch ||= c;
    if (!ch && lit === this.litView) return;
    this.litView = lit;
    const lin = this.s.linear;
    const bg = (pl: GPURenderPipeline, ubo: Ubo, src: GPUTextureView) => d.createBindGroup({
      layout: pl.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: ubo.buffer } }, { binding: 1, resource: src }, { binding: 2, resource: lin }],
    });
    this.bgBright = bg(this.pBright, this.uBright, lit);
    this.bgBlurH = bg(this.pBlur, this.uBlurH, this.bright!.view);
    this.bgBlurV = bg(this.pBlur, this.uBlurV, this.blurA!.view);
    this.bgShafts = bg(this.pShafts, this.uShafts, this.bright!.view);
    this.bgPresent = d.createBindGroup({
      layout: this.pPresent.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uPresent.buffer } }, { binding: 1, resource: lit },
        { binding: 2, resource: this.blurB!.view }, { binding: 3, resource: lin }, { binding: 4, resource: this.shafts!.view }],
    });
  }

  private pass(enc: GPUCommandEncoder, view: GPUTextureView, pl: GPURenderPipeline | null, bg: GPUBindGroup | null, label: string, timestampWrites?: GPURenderPassTimestampWrites) {
    const rp = enc.beginRenderPass({ label, timestampWrites, colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
    if (pl && bg) { rp.setPipeline(pl); rp.setBindGroup(0, bg); rp.draw(3); }
    rp.end();
  }

  /** bloom chain, plus the light shafts when a bright source is on screen */
  bloom(enc: GPUCommandEncoder, amount: number, o?: PostParams) {
    const shafts = !!o && o.shaftCount > 0 && o.shaftAmt > 0;
    if (amount <= 0 && !shafts) {
      this.pass(enc, this.blurB!.view, null, null, 'bloom.off');
      if (this.shaftsOn) { this.pass(enc, this.shafts!.view, null, null, 'shafts.off'); this.shaftsOn = false; }
      return;
    }
    const tw = 1 / this.bright!.w, th = 1 / this.bright!.h;
    const set = (u: Ubo, dx: number, dy: number) => { u.f[0] = tw; u.f[1] = th; u.f[2] = dx; u.f[3] = dy; u.write(); };
    set(this.uBright, 0, 0); set(this.uBlurH, 1, 0); set(this.uBlurV, 0, 1);
    this.pass(enc, this.bright!.view, this.pBright, this.bgBright, 'bloom.bright');
    if (amount > 0) {
      this.pass(enc, this.blurA!.view, this.pBlur, this.bgBlurH, 'bloom.blurH');
      this.pass(enc, this.blurB!.view, this.pBlur, this.bgBlurV, 'bloom.blurV');
    } else this.pass(enc, this.blurB!.view, null, null, 'bloom.off');
    if (shafts) {
      const f = this.uShafts.f;
      f[0] = tw; f[1] = th; f[2] = o.shaftCount;
      f.set(o.shafts, 4);
      this.uShafts.write();
      this.pass(enc, this.shafts!.view, this.pShafts, this.bgShafts, 'shafts');
      this.shaftsOn = true;
    } else if (this.shaftsOn) { this.pass(enc, this.shafts!.view, null, null, 'shafts.off'); this.shaftsOn = false; }
  }

  present(enc: GPUCommandEncoder, out: GPUTextureView, o: PostParams, timestampWrites?: GPURenderPassTimestampWrites) {
    const f = this.uPresent.f;
    f[0] = o.pw; f[1] = o.ph; f[2] = o.shiftX; f[3] = o.shiftY; f[4] = o.bw; f[5] = o.bh; f[6] = o.S; f[7] = o.bloom;
    f[8] = o.vignette; f[9] = o.grain; f[10] = o.scan; f[11] = o.time; f[12] = o.flash; f[13] = o.grade;
    f[16] = o.flashCol[0]; f[17] = o.flashCol[1]; f[18] = o.flashCol[2];
    f[20] = o.chroma; f[21] = o.ringCount; f[22] = o.heatCount; f[23] = this.shaftsOn ? o.shaftAmt : 0;
    f.set(o.rings, 24);
    f.set(o.heat, 24 + POST_RINGS * 4);
    this.uPresent.write();
    this.pass(enc, out, this.pPresent, this.bgPresent, 'present', timestampWrites);
  }

  dispose() {
    for (const t of [this.bright, this.blurA, this.blurB, this.shafts]) t?.texture.destroy();
    for (const u of [this.uBright, this.uBlurH, this.uBlurV, this.uPresent, this.uShafts]) u.destroy();
  }
}
