// G-buffer pass for the sea surface — WGSL port of webgl2/passes/waterPass.ts (keep the math 1:1).
// One fullscreen triangle: every pixel finds its point on the displaced ocean surface, builds the
// normal from swell + ripple sim + capillary detail, picks a palette tone with world-anchored
// dithering, lays foam / bioluminescence / oil / burning oil on top, and composites submerged
// objects faded by depth and theater clarity.

import { shaderModule, validated, type GpuContext } from '../device';
import { Ubo, type Samplers } from '../targets';
import { CAMERA_WGSL, DITHER_WGSL, FULLSCREEN_WGSL, GBUF_WGSL, MAT_WGSL, MATH_WGSL, NOISE_WGSL } from '../wgsl/common';
import { OCEAN_WGSL } from '../wgsl/ocean';
import type { WaterParams } from '../../common/frameUniforms';

/**
 * Water uniforms (float offsets): 0 ramp[8] (rgb, -) · 32 foamCol · 36 foamShade · 40 murk
 * 44 simRect (x, y rel origin, w, h) · 48 (clarity, hs, contrast, detail)
 * 52 (crestFoam, time, rippleScale, simCell) · 56 wind.xy, parallax, simOn · 60 bio, ice, -, -
 */
export const WATER_FLOATS = 64;

const WGSL = /* wgsl */ `
${FULLSCREEN_WGSL}
${CAMERA_WGSL}
${MATH_WGSL}
${DITHER_WGSL}
${NOISE_WGSL}
${OCEAN_WGSL}
${MAT_WGSL}
${GBUF_WGSL}
struct Water {
  ramp: array<vec4f, 8>,
  foamCol: vec4f, foamShade: vec4f, murk: vec4f,
  simRect: vec4f,
  p0: vec4f,   // clarity, hs, contrast, detail
  p1: vec4f,   // crestFoam, time, rippleScale, simCell
  wind: vec2f, parallax: f32, simOn: f32,
  bio: f32, ice: f32, pad: vec2f,
};
@group(0) @binding(2) var<uniform> W: Water;
@group(0) @binding(3) var waveTex: texture_2d<f32>;    // ripple heightfield (m)
@group(0) @binding(4) var dyeTex: texture_2d<f32>;     // foam, bio, oil, fire
@group(0) @binding(5) var underTex: texture_2d<f32>;   // submerged objects: rgb albedo, a coverage
@group(0) @binding(6) var underDTex: texture_2d<f32>;  // r = depth below surface (m)
@group(0) @binding(7) var lin: sampler;

// uv in xy, edge-faded weight in z
fn simUV(p: vec2f) -> vec3f {
  let uv = (p - W.simRect.xy) / W.simRect.zw;
  let e = min(uv, 1.0 - uv);
  return vec3f(uv, select(0.0, smoothstep(0.0, 0.06, min(e.x, e.y)), W.simOn > 0.5));
}
fn simH(p: vec2f) -> f32 {
  let s = simUV(p);
  if (s.z > 0.0) { return textureSampleLevel(waveTex, lin, s.xy, 0.0).r * s.z * W.p1.z; }
  return 0.0;
}
fn surfaceH(p: vec2f) -> f32 { return oceanHeight(p) + simH(p); }

struct WOut { @location(0) albedo: vec4f, @location(1) normal: vec4f, @builtin(frag_depth) depth: f32 };

@fragment fn fsWater(i: VsOut) -> WOut {
  let bp = i.pos.xy;
  let clarity = W.p0.x; let uHs = W.p0.y; let contrast = W.p0.z; let detail = W.p0.w;
  let crestFoam = W.p1.x; let time = W.p1.y; let rippleScale = W.p1.z; let simCell = W.p1.w;
  // solve for the surface point seen through this pixel (vertical displacement in tilted views)
  var p = pixToWorld(bp, 0.0);
  if (W.parallax > 0.5 && F.tilt.y > 0.01) {
    for (var k = 0; k < 3; k++) {
      let h = surfaceH(p);
      p = pixToWorld(bp, h);
    }
  }
  let os = oceanSample(p);
  var n = os.n;
  let jac = os.jac;
  let hs = os.h;
  // ripple sim: height and slope
  let s = simUV(p);
  let suv = s.xy; let sw = s.z;
  var rh = 0.0;
  if (sw > 0.0) {
    let t = 1.0 / (W.simRect.z / simCell);
    let c = textureSampleLevel(waveTex, lin, suv, 0.0).r;
    let l = textureSampleLevel(waveTex, lin, suv - vec2f(t, 0.0), 0.0).r;
    let r = textureSampleLevel(waveTex, lin, suv + vec2f(t, 0.0), 0.0).r;
    let d = textureSampleLevel(waveTex, lin, suv - vec2f(0.0, t), 0.0).r;
    let u = textureSampleLevel(waveTex, lin, suv + vec2f(0.0, t), 0.0).r;
    rh = c * sw * rippleScale;
    let g = vec2f(r - l, u - d) / (2.0 * simCell) * sw * rippleScale;
    n = normalize(n + vec3f(-g * 1.6, 0.0));
  }
  // cat's paws: large drifting patches where gusts roughen the surface; light airs leave the rest glassy
  let ws = length(W.wind);
  let paws = smoothstep(0.35, 0.75, fbm(p * 0.006 + W.wind * time * 0.0035 + vec2f(11.0, 3.0)));
  let rough = mix(0.2, 1.0, smoothstep(1.0, 7.0, ws)) * mix(0.55, 1.45, paws);
  // capillary detail: wind-driven value noise slopes
  if (detail > 0.0) {
    let q = p * 0.31 + W.wind * time * 0.045;
    let e = 0.6;
    let a = fbm(q);
    let bx = fbm(q + vec2f(e, 0.0));
    let by = fbm(q + vec2f(0.0, e));
    n = normalize(n + vec3f(-(bx - a), -(by - a), 0.0) * detail * 0.9 * rough);
  }
  var h = hs + rh;
  var dye = vec4f(0.0);
  if (sw > 0.0) { dye = textureSampleLevel(dyeTex, lin, suv, 0.0) * sw; }
  let oil = clamp(dye.b, 0.0, 1.0);
  n = normalize(mix(n, vec3f(0.0, 0.0, 1.0), oil * 0.75));

  // ---- palette tone
  let dth = ditherHere(bp);
  var tone = 0.5;
  // height only as a soft, compressed undulation: raw swell height made broad light/dark bands
  let hn = hs / max(uHs * 0.8, 0.3);
  tone += hn / (1.0 + abs(hn)) * 0.09 * contrast;
  tone += (paws - 0.5) * 0.06 * contrast;
  tone += rh * 0.45 * contrast;
  tone += (n.y * 0.65 + n.x * 0.2) * contrast;
  tone += (1.0 - clamp(jac, 0.0, 1.0)) * 0.35 * contrast;
  tone = clamp(tone, 0.0, 0.999);
  let ci = tone * 7.0;
  var i0 = i32(floor(ci));
  if (fract(ci) > dth) { i0 = min(i0 + 1, 7); }
  var alb = W.ramp[i0].rgb;
  var mat = MAT_WATER;
  var emis = 0.0;

  // ---- submerged objects show through the water
  let ip = vec2<i32>(bp);
  let under = textureLoad(underTex, ip, 0);
  if (under.a > 0.5) {
    let dep = max(textureLoad(underDTex, ip, 0).r, 0.0);
    let vis = exp(-dep / max(clarity, 0.1));
    let seen = mix(W.murk.rgb, under.rgb, exp(-dep / max(clarity * 0.45, 0.1)));
    if (vis * 0.92 > dth) { alb = mix(alb, seen, 0.85); }
  }

  // ---- oil slick: dark, glossy, faint iridescence
  if (oil > 0.02) {
    let irid = fbm(p * 0.08 + time * 0.01);
    let oc = mix(vec3f(0.04, 0.045, 0.05), vec3f(0.16, 0.1, 0.2), irid * 0.6);
    if (oil * 1.25 > dth) { alb = mix(alb, oc, 0.8); }
  }

  // ---- foam: whitecaps from breaking crests + advected wake foam
  let lace = cellular(p * 0.42 + vec2f(time * 0.03, 0.0));
  let lace2 = cellular(p * 0.95 - vec2f(0.0, time * 0.05));
  let crest = smoothstep(0.62, 0.18, jac) * crestFoam;
  let wake = clamp(dye.r, 0.0, 2.0);
  let fv = max(crest * (0.35 + 0.9 * smoothstep(0.55, 0.15, lace)), wake * (0.45 + 0.75 * smoothstep(0.7, 0.2, lace2)));
  if (fv > dth) {
    alb = select(W.foamShade.rgb, W.foamCol.rgb, fv > dth + 0.3);
    mat = MAT_FOAM;
  }

  // ---- bioluminescence in churned water (emissive)
  let bio = dye.g * W.bio;
  if (bio > 0.03) {
    let sparkle = 0.6 + 0.4 * hash12(floor(p * 1.5) + floor(time * 6.0));
    let b = bio * sparkle;
    if (b > dth * 0.8) { alb = mix(vec3f(0.25, 1.0, 0.85), vec3f(0.6, 1.0, 1.0), sparkle - 0.6); emis = max(emis, 0.9 * b + 0.3); mat = MAT_FOAM; }
  }

  // ---- burning oil
  let fire = dye.a;
  if (fire > 0.02) {
    let fl = fbm(p * 0.35 + vec2f(0.0, -time * 1.7)) * 1.3;
    let fi = fire * fl;
    if (fi > dth * 0.7) {
      alb = select(select(vec3f(0.75, 0.2, 0.05), vec3f(1.0, 0.55, 0.12), fi > 0.5), vec3f(1.0, 0.92, 0.55), fi > 0.9);
      emis = 2.2 * clamp(fi, 0.2, 1.2);
      mat = MAT_FIRE;
    }
  }

  // ---- pack ice (Arctic)
  if (W.ice > 0.0) {
    // domain-warped cells with roughened rims: angular, irregular floes separated by dark leads
    let q = p * 0.018 + 3.1 + (vec2f(fbm(p * 0.031), fbm(p * 0.031 + 5.2)) - 0.5) * 0.9;
    let floe = cellular(q) + (fbm(p * 0.21) - 0.5) * 0.12;
    let edge = 0.22 + W.ice * 0.16;
    let ice = step(floe, edge) * smoothstep(0.2, 0.6, fbm(p * 0.004 + 7.0) + W.ice * 0.3);
    if (ice > 0.5) {
      let sh = fbm(p * 0.2);
      alb = mix(vec3f(0.72, 0.8, 0.86), vec3f(0.93, 0.96, 0.98), step(dth, sh));
      alb = mix(alb, vec3f(0.55, 0.64, 0.7), smoothstep(edge - 0.035, edge, floe) * 0.8);
      n = normalize(vec3f(0.0, 0.0, 1.0) + vec3f(sh - 0.5, 0.0, 0.0) * 0.3);
      mat = MAT_ICE;
      h += 0.5;
    }
  }

  var o: WOut;
  o.albedo = vec4f(alb, mat / 255.0);
  o.normal = vec4f(n.xy, h, emis);
  o.depth = worldToClip(vec3f(p, h)).z;
  return o;
}
`;

export interface WaterInputs {
  frame: GPUBuffer; ocean: GPUBuffer;
  wave: GPUTextureView; dye: GPUTextureView; under: GPUTextureView; underD: GPUTextureView;
}

export class WaterPassGPU {
  pipeline!: GPURenderPipeline;
  private ubo: Ubo;
  private bg: GPUBindGroup | null = null;
  private inputs: WaterInputs | null = null;

  private constructor(private g: GpuContext, private s: Samplers) { this.ubo = new Ubo(g.device, WATER_FLOATS, 'water'); }

  static async create(g: GpuContext, s: Samplers): Promise<WaterPassGPU> {
    const p = new WaterPassGPU(g, s);
    const module = await shaderModule(g, 'water', WGSL);
    await validated(g, 'water pipeline', () => {
      p.pipeline = g.device.createRenderPipeline({
        label: 'water', layout: 'auto',
        vertex: { module, entryPoint: 'vsFull' },
        fragment: { module, entryPoint: 'fsWater', targets: [{ format: 'rgba8unorm' }, { format: 'rgba16float' }] },
        primitive: { topology: 'triangle-list' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'always' },
      });
    });
    return p;
  }

  /** rebind when any input view changes (resize, sim size change) */
  setInputs(t: WaterInputs) {
    const a = this.inputs;
    if (a && a.frame === t.frame && a.ocean === t.ocean && a.wave === t.wave && a.dye === t.dye && a.under === t.under && a.underD === t.underD) return;
    this.inputs = t;
    this.bg = this.g.device.createBindGroup({
      label: 'water', layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: t.frame } }, { binding: 1, resource: { buffer: t.ocean } },
        { binding: 2, resource: { buffer: this.ubo.buffer } },
        { binding: 3, resource: t.wave }, { binding: 4, resource: t.dye },
        { binding: 5, resource: t.under }, { binding: 6, resource: t.underD },
        { binding: 7, resource: this.s.linear },
      ],
    });
  }

  /** sim: window rect relative to the render origin + cell size; on = ripple/dye textures valid */
  write(w: WaterParams, sim: { x: number; y: number; size: number; cell: number; on: boolean }) {
    const f = this.ubo.f;
    for (let i = 0; i < 8; i++) { const c = w.ramp[i] ?? w.ramp[w.ramp.length - 1]; f[i * 4] = c[0]; f[i * 4 + 1] = c[1]; f[i * 4 + 2] = c[2]; f[i * 4 + 3] = 0; }
    f.set(w.foamCol, 32); f.set(w.foamShade, 36); f.set(w.murk, 40);
    f[44] = sim.x; f[45] = sim.y; f[46] = sim.size; f[47] = sim.size;
    f[48] = w.clarity; f[49] = w.hs; f[50] = w.contrast; f[51] = w.detail;
    f[52] = w.crestFoam; f[53] = w.time; f[54] = w.rippleScale; f[55] = sim.cell;
    f[56] = w.wind[0]; f[57] = w.wind[1]; f[58] = w.parallax ? 1 : 0; f[59] = sim.on ? 1 : 0;
    f[60] = w.bio; f[61] = w.ice;
    this.ubo.write();
  }

  encode(pass: GPURenderPassEncoder) {
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bg!);
    pass.draw(3);
  }

  dispose() { this.ubo.destroy(); }
}
