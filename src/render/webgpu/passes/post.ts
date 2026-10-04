// Bloom, grading and the final integer-scaled present — WGSL port of webgl2/passes/postPass.ts.
// The lit image is (W+2) x (H+2) internal pixels; present maps each device pixel to a buffer pixel
// with the camera's sub-pixel remainder applied as a whole-device-pixel shift, so the world scrolls
// smoothly while every game pixel stays a crisp S x S block.

import { shaderModule, validated, type GpuContext } from '../device';
import { resizeTarget, Ubo, type GpuTarget, type Samplers } from '../targets';
import { FULLSCREEN_WGSL, MATH_WGSL } from '../wgsl/common';
import type { PostParams } from '../../common/post';

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

/**
 * Present uniforms (float offsets): 0 device (w, h) · 2 shift (x, y) · 4 buf (w, h) · 6 S · 7 bloom
 * 8 vignette · 9 grain · 10 scan · 11 time · 12 flash · 13 grade · 14 pad · 16 flashCol (rgb, -)
 */
const PRESENT_FLOATS = 20;
const PRESENT_WGSL = /* wgsl */ `
${FULLSCREEN_WGSL}
${MATH_WGSL}
struct P {
  device: vec2f, shift: vec2f, buf: vec2f, S: f32, bloomAmt: f32,
  vignette: f32, grain: f32, scan: f32, time: f32, flash: f32, grade: f32, pad: vec2f,
  flashCol: vec4f,
};
@group(0) @binding(0) var<uniform> U: P;
@group(0) @binding(1) var lit: texture_2d<f32>;
@group(0) @binding(2) var bloomTex: texture_2d<f32>;
@group(0) @binding(3) var lin: sampler;
@fragment fn fsPresent(i: VsOut) -> @location(0) vec4f {
  let d = i.pos.xy;   // device pixel, y down
  let b = clamp(floor((d + U.shift) / U.S) + 1.0, vec2f(0.0), U.buf - 1.0);
  var c = textureLoad(lit, vec2<i32>(b), 0).rgb;
  c += textureSampleLevel(bloomTex, lin, (b + 0.5) / U.buf, 0.0).rgb * U.bloomAmt;
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
  if (U.grain > 0.0) { c += (hash12(b + floor(U.time * 24.0) * 13.7) - 0.5) * 0.06 * U.grain; }
  if (U.scan > 0.0 && U.S >= 2.0 && fmod(d.y + U.shift.y, U.S) >= U.S - 1.0) { c *= 1.0 - U.scan * 0.5; }
  return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), 1.0);
}
`;


const HDR: GPUTextureFormat = 'rgba16float';

export class PostPassGPU {
  bright: GpuTarget | null = null; blurA: GpuTarget | null = null; blurB: GpuTarget | null = null;
  private pBright!: GPURenderPipeline; private pBlur!: GPURenderPipeline; private pPresent!: GPURenderPipeline;
  private uBright: Ubo; private uBlurH: Ubo; private uBlurV: Ubo; private uPresent: Ubo;
  private bgBright: GPUBindGroup | null = null; private bgBlurH: GPUBindGroup | null = null;
  private bgBlurV: GPUBindGroup | null = null; private bgPresent: GPUBindGroup | null = null;
  private litView: GPUTextureView | null = null;

  private constructor(private g: GpuContext, private s: Samplers) {
    const d = g.device;
    this.uBright = new Ubo(d, 4, 'post.bright'); this.uBlurH = new Ubo(d, 4, 'post.blurH');
    this.uBlurV = new Ubo(d, 4, 'post.blurV'); this.uPresent = new Ubo(d, PRESENT_FLOATS, 'post.present');
  }

  static async create(g: GpuContext, s: Samplers): Promise<PostPassGPU> {
    const p = new PostPassGPU(g, s);
    const bloom = await shaderModule(g, 'post.bloom', BLOOM_WGSL);
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
    this.bgPresent = d.createBindGroup({
      layout: this.pPresent.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uPresent.buffer } }, { binding: 1, resource: lit },
        { binding: 2, resource: this.blurB!.view }, { binding: 3, resource: lin }],
    });
  }

  private pass(enc: GPUCommandEncoder, view: GPUTextureView, pl: GPURenderPipeline | null, bg: GPUBindGroup | null, label: string) {
    const rp = enc.beginRenderPass({ label, colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
    if (pl && bg) { rp.setPipeline(pl); rp.setBindGroup(0, bg); rp.draw(3); }
    rp.end();
  }

  bloom(enc: GPUCommandEncoder, amount: number) {
    if (amount <= 0) { this.pass(enc, this.blurB!.view, null, null, 'bloom.off'); return; }
    const tw = 1 / this.bright!.w, th = 1 / this.bright!.h;
    const set = (u: Ubo, dx: number, dy: number) => { u.f[0] = tw; u.f[1] = th; u.f[2] = dx; u.f[3] = dy; u.write(); };
    set(this.uBright, 0, 0); set(this.uBlurH, 1, 0); set(this.uBlurV, 0, 1);
    this.pass(enc, this.bright!.view, this.pBright, this.bgBright, 'bloom.bright');
    this.pass(enc, this.blurA!.view, this.pBlur, this.bgBlurH, 'bloom.blurH');
    this.pass(enc, this.blurB!.view, this.pBlur, this.bgBlurV, 'bloom.blurV');
  }

  present(enc: GPUCommandEncoder, out: GPUTextureView, o: PostParams) {
    const f = this.uPresent.f;
    f[0] = o.pw; f[1] = o.ph; f[2] = o.shiftX; f[3] = o.shiftY; f[4] = o.bw; f[5] = o.bh; f[6] = o.S; f[7] = o.bloom;
    f[8] = o.vignette; f[9] = o.grain; f[10] = o.scan; f[11] = o.time; f[12] = o.flash; f[13] = o.grade;
    f[16] = o.flashCol[0]; f[17] = o.flashCol[1]; f[18] = o.flashCol[2];
    this.uPresent.write();
    this.pass(enc, out, this.pPresent, this.bgPresent, 'present');
  }

  dispose() {
    for (const t of [this.bright, this.blurA, this.blurB]) t?.texture.destroy();
    for (const u of [this.uBright, this.uBlurH, this.uBlurV, this.uPresent]) u.destroy();
  }
}
