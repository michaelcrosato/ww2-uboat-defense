// Deferred lighting with occluder-based soft shadows — WGSL port of webgl2/passes/lightingPass.ts
// (keep the math 1:1). Sun, moon, ambient and up to MAX_LIGHTS point/spot lights from a storage
// buffer (rows packed by render/lights.ts `packLights`), heightmap-marched shadows, beam haze,
// light-band quantization, water glints and sky reflection, fog, debug views.

import { shaderModule, validated, type GpuContext } from '../device';
import { BU, Ubo, type Samplers } from '../targets';
import { CAMERA_WGSL, DITHER_WGSL, FULLSCREEN_WGSL, MAT_WGSL, MATH_WGSL } from '../wgsl/common';
import { LIGHT_FLOATS, MAX_LIGHTS } from '../../lights';
import type { LightParams } from '../../common/frameUniforms';

/**
 * Lighting uniforms (float offsets): 0 ambient · 4 sky · 8 fogCol · 12 sunDir · 16 sunCol · 20 moonDir
 * 24 moonCol (all rgb/xyz, -) · 28 occRect (x, y rel origin, w, h) · 32 (reach, strength, ambientFill, soft)
 * 36 (bands, ditherAmt, beams, spec) · 40 (reflect, fog, lightning, haze)
 * 44 (steps, shadows, celShadows, lightsOn) · 48 (view, lightCount, occTop, -)
 */
export const LIGHTING_FLOATS = 52;

const WGSL = /* wgsl */ `
${FULLSCREEN_WGSL}
${CAMERA_WGSL}
${MATH_WGSL}
${DITHER_WGSL}
${MAT_WGSL}
struct Lighting {
  ambient: vec4f, sky: vec4f, fogCol: vec4f,
  sunDir: vec4f, sunCol: vec4f, moonDir: vec4f, moonCol: vec4f,
  occRect: vec4f,
  p0: vec4f,   // reach, strength, ambientFill, soft
  p1: vec4f,   // bands, ditherAmt, beams, spec
  p2: vec4f,   // reflect, fog, lightning, haze
  p3: vec4f,   // steps, shadows, celShadows, lightsOn
  p4: vec4f,   // view, lightCount, occTop (highest occluder or smoke, m)
};
@group(0) @binding(1) var<uniform> U: Lighting;
@group(0) @binding(2) var albedoTex: texture_2d<f32>;
@group(0) @binding(3) var normalTex: texture_2d<f32>;
@group(0) @binding(4) var occTex: texture_2d<f32>;
// 4 vec4 per light: pos (rel) + reach · color + intensity · dir + cos outer (-2 omni) · shadow, beam, cos inner, size
@group(0) @binding(5) var<storage, read> lights: array<vec4f>;
@group(0) @binding(6) var lin: sampler;

fn occAt(p: vec2f) -> vec2f {
  let uv = (p - U.occRect.xy) / U.occRect.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { return vec2f(-50.0, 0.0); }
  return textureSampleLevel(occTex, lin, uv, 0.0).ra;   // r = max occluder height, a = smoke density
}

fn shadowTo(p: vec3f, lp: vec3f, jitter: f32, steps: i32) -> f32 {
  let d = lp - p;
  let D = length(d.xy);
  if (D < 0.4) { return 1.0; }
  var s = 1.0;
  var trans = 1.0;
  let seg = D / f32(steps);
  for (var k = 0; k < 64; k++) {
    if (k >= steps) { break; }
    var t = (f32(k) + jitter) / f32(steps);
    t = 0.015 + t * t * 0.97;
    let q = p + d * t;
    let o = occAt(q.xy);
    let pen = (o.x - q.z) / (0.18 + U.p0.w * t * D * 0.14);
    s = min(s, 1.0 - clamp(pen, 0.0, 1.0));
    trans *= exp(-o.y * seg * 0.06);
    if (s <= 0.001) { break; }
  }
  return s * trans;
}

// the ray climbs L.z / hz per metre: past the tallest occluder (or smoke) nothing can block it, so
// the march ends there and its step count shrinks with it
fn shadowDir(p: vec3f, L: vec3f, maxD: f32, jitter: f32, steps: i32) -> f32 {
  let hz = length(L.xy);
  if (hz < 1e-3) { return 1.0; }
  var D = maxD;
  if (L.z > 1e-3) { D = min(D, (U.p4.z - p.z) * hz / L.z); }
  if (D <= 0.4) { return 1.0; }
  return shadowTo(p, p + L * (D / hz), jitter, max(4, i32(f32(steps) * D / maxD + 0.5)));
}

fn blinn(n: vec3f, L: vec3f, V: vec3f, k: f32) -> f32 {
  let H = normalize(L + V);
  return pow(max(dot(n, H), 0.0), k);
}

@fragment fn fsLighting(i: VsOut) -> @location(0) vec4f {
  let ip = vec2<i32>(i.pos.xy);
  let A = textureLoad(albedoTex, ip, 0);
  let N = textureLoad(normalTex, ip, 0);
  let reach = U.p0.x; let strength = U.p0.y; let ambientFill = U.p0.z;
  let bands = U.p1.x; let ditherAmt = U.p1.y; let beams = U.p1.z; let specAmt = U.p1.w;
  let reflectAmt = U.p2.x; let fog = U.p2.y; let lightning = U.p2.z; let hazeAmt = U.p2.w;
  let steps = i32(U.p3.x + 0.5); let shadows = U.p3.y > 0.5; let celShadows = U.p3.z > 0.5; let lightsOn = U.p3.w > 0.5;
  let view = i32(U.p4.x + 0.5); let lightCount = i32(U.p4.y + 0.5);
  let mat = floor(A.a * 255.0 + 0.5);
  let n = vec3f(N.xy, sqrt(max(0.0, 1.0 - dot(N.xy, N.xy))));
  let z = N.z; let emis = N.w;
  let P = vec3f(pixToWorld(i.pos.xy, z), z);
  let V = normalize(vec3f(0.0, F.tilt.y, F.tilt.x));
  let dth = ditherHere(i.pos.xy);
  let jitter = fract(dth * 7.31 + 0.13);
  let water = mat == MAT_WATER;
  let glossy = water || mat == MAT_METAL || mat == MAT_ICE;
  // zoomed in, water glints narrow their lobe so they don't swell into blobs (the lobe is fixed in world
  // space and the screen magnifies it); sun/light glints only linearly, or they thin out to nothing
  let zk = max(1.0, F.cam.z / 1.2);
  let shininess = select(select(18.0, 40.0, mat == MAT_ICE), 90.0 * zk, water);
  let specK = select(select(select(0.0, 0.4, mat == MAT_ICE), 0.25, mat == MAT_METAL), 1.0, water);

  var light = U.ambient.rgb * ambientFill * (0.62 + 0.38 * n.z);
  light += vec3f(0.75, 0.8, 1.0) * lightning;
  let base = light;
  var spec = vec3f(0.0);
  var haze = vec3f(0.0);
  let csteps = max(4, steps / 2);
  // ---- sun and moon
  let sunCol = U.sunCol.rgb; let sunDir = U.sunDir.xyz;
  if (sunCol.r + sunCol.g + sunCol.b > 0.003) {
    let ndl = clamp((dot(n, sunDir) + 0.15) / 1.15, 0.0, 1.0);
    var sh = 1.0;
    if (celShadows && shadows) { sh = shadowDir(P + n * 0.2, sunDir, 70.0, jitter, csteps); }
    light += sunCol * ndl * sh;
    if (glossy) { spec += sunCol * blinn(n, sunDir, V, shininess) * specK * sh * 2.5; }
  }
  let moonCol = U.moonCol.rgb; let moonDir = U.moonDir.xyz;
  if (moonCol.r + moonCol.g + moonCol.b > 0.002) {
    let ndl = clamp((dot(n, moonDir) + 0.15) / 1.15, 0.0, 1.0);
    var sh = 1.0;
    if (celShadows && shadows) { sh = shadowDir(P + n * 0.2, moonDir, 70.0, jitter, csteps); }
    light += moonCol * ndl * sh;
    // an orthographic view has one view vector, so a reflection could never form a glitter path:
    // moon glints use a virtual observer mirrored from the moon, which lays a patch of glitter around
    // the view centre stretched toward the moon (low moons give long paths)
    if (water) { spec += moonCol * blinn(n, moonDir, normalize(vec3f(-moonDir.xy, moonDir.z) * 420.0 - P), 900.0 * zk * zk) * sh * 3.0; }
    else if (glossy) { spec += moonCol * blinn(n, moonDir, V, shininess * 1.3) * specK * sh * 6.0; }
  }
  // ---- dynamic lights
  if (lightsOn) {
    for (var li = 0; li < ${MAX_LIGHTS}; li++) {
      if (li >= lightCount) { break; }
      let l0 = lights[li * 4];       // pos (rel), reach
      let l1 = lights[li * 4 + 1];   // color, intensity
      let l2 = lights[li * 4 + 2];   // dir, cos outer (-2 = omni)
      let l3 = lights[li * 4 + 3];   // shadow, beam, cos inner, size
      let R = l0.w * reach;
      let Lc = l1.rgb * l1.w * strength;
      let spot = l2.w > -1.5;
      // in-scattered haze (beams and halos), visible even where the light does not land
      if (l3.y > 0.0 && beams > 0.0) {
        if (spot) {
          let D = l2.xyz;
          let w0 = P - l0.xyz;
          let b = dot(V, D); let d = dot(V, w0); let e = dot(D, w0);
          let den = max(1.0 - b * b, 1e-4);
          let t = clamp((e - b * d) / den, 0.0, R);
          let s = max(0.0, t * b - d);
          let bpnt = l0.xyz + D * t;
          let r = length(P + V * s - bpnt);
          let tanA = sqrt(max(1.0 - l2.w * l2.w, 0.0)) / max(l2.w, 0.05);
          let rb = t * tanA + l3.w;
          let k = 1.0 - smoothstep(0.0, rb, r);
          if (k > 0.0) {
            var fall = (1.0 - t / R); fall *= fall;
            var shs = 1.0;
            if (shadows && l3.x > 0.0) { shs = shadowTo(bpnt, l0.xyz, jitter, max(4, i32(f32(steps) * l3.x / 3.0 + 0.5))); }
            haze += Lc * k * k * fall * l3.y * beams * hazeAmt * 0.55 * shs;
          }
        } else {
          let w0 = l0.xyz - P;
          let s = max(dot(w0, V), 0.0);
          let r = length(P + V * s - l0.xyz);
          let rad = R * 0.22;
          haze += Lc * exp(-r * r / (rad * rad)) * l3.y * beams * hazeAmt * 0.35;
        }
      }
      let d = l0.xyz - P;
      let dist = length(d);
      if (dist >= R) { continue; }
      var att = 1.0 - (dist * dist) / (R * R);
      att *= att;
      let Ld = d / max(dist, 1e-3);
      var cone = 1.0;
      if (spot) { cone = smoothstep(l2.w, l3.z, dot(-Ld, l2.xyz)); }
      if (cone * att <= 0.001) { continue; }
      var c = Lc * att * cone;
      // contributions too faint to show skip the shadow march entirely
      if (max(c.r, max(c.g, c.b)) < 0.004) { continue; }
      let ndl = clamp((dot(n, Ld) + 0.35) / 1.35, 0.0, 1.0);
      // shadow steps by the light's importance (l3.x, ranked on the CPU) and how much of it lands here
      if (shadows && l3.x > 0.0) { c *= shadowTo(P + n * 0.15, l0.xyz, jitter, max(4, i32(f32(steps) * l3.x * (0.4 + 0.6 * sqrt(att)) + 0.5))); }
      light += c * ndl;
      if (glossy) { spec += c * blinn(n, Ld, V, shininess) * specK * 3.0; }
    }
  }
  // ---- pixel-art quantization of the direct light; the flat ambient base stays smooth so dark
  // scenes don't break up into dither speckle where everything sits below the first band
  var lq = light;
  if (bands > 0.5) {
    let dl = light - base;
    let lum = max(dl.r, max(dl.g, dl.b));
    let q = floor(lum * bands + mix(0.5, dth, ditherAmt)) / bands;
    lq = base + dl * (q / max(lum, 1e-4));
  }
  var col = A.rgb * lq;
  // water: glints as hard sparkles + sky reflection
  if (glossy) {
    let sl = max(spec.r, max(spec.g, spec.b)) * specAmt;
    if (water) {
      let sp = select(spec * specAmt * 0.15, spec * specAmt * 1.4, sl > 0.35 + 0.5 * dth);
      col += sp;
      let Fr = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
      col += U.sky.rgb * Fr * reflectAmt * 0.9;
    } else { col += spec * specAmt; }
  }
  col += A.rgb * emis;
  if (mat == MAT_FIRE || mat == MAT_LAMP) { col += A.rgb * 0.4; }
  col += haze;
  col = mix(col, U.fogCol.rgb, clamp(fog, 0.0, 0.95));
  if (view == 1) { col = A.rgb; }
  else if (view == 2) { col = n * 0.5 + 0.5; }
  else if (view == 3) { col = vec3f(clamp(z * 0.08 + 0.5, 0.0, 1.0), clamp(-z * 0.08 + 0.5, 0.0, 1.0), 0.5); }
  else if (view == 4) { col = lq * 0.6 + haze; }
  return vec4f(col, 1.0);
}
`;

export interface LightingInputs { frame: GPUBuffer; albedo: GPUTextureView; normal: GPUTextureView; occ: GPUTextureView }

export class LightingPassGPU {
  pipeline!: GPURenderPipeline;
  private ubo: Ubo;
  readonly lightBuf: GPUBuffer;
  private bg: GPUBindGroup | null = null;
  private inputs: LightingInputs | null = null;

  private constructor(private g: GpuContext, private s: Samplers) {
    this.ubo = new Ubo(g.device, LIGHTING_FLOATS, 'lighting');
    this.lightBuf = g.device.createBuffer({ label: 'lights', size: MAX_LIGHTS * LIGHT_FLOATS * 4, usage: BU.STORAGE | BU.COPY_DST });
  }

  static async create(g: GpuContext, s: Samplers, format: GPUTextureFormat): Promise<LightingPassGPU> {
    const p = new LightingPassGPU(g, s);
    const module = await shaderModule(g, 'lighting', WGSL);
    await validated(g, 'lighting pipeline', () => {
      p.pipeline = g.device.createRenderPipeline({
        label: 'lighting', layout: 'auto',
        vertex: { module, entryPoint: 'vsFull' },
        fragment: { module, entryPoint: 'fsLighting', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      });
    });
    return p;
  }

  setInputs(t: LightingInputs) {
    const a = this.inputs;
    if (a && a.frame === t.frame && a.albedo === t.albedo && a.normal === t.normal && a.occ === t.occ) return;
    this.inputs = t;
    this.bg = this.g.device.createBindGroup({
      label: 'lighting', layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: t.frame } }, { binding: 1, resource: { buffer: this.ubo.buffer } },
        { binding: 2, resource: t.albedo }, { binding: 3, resource: t.normal }, { binding: 4, resource: t.occ },
        { binding: 5, resource: { buffer: this.lightBuf } }, { binding: 6, resource: this.s.linear },
      ],
    });
  }

  /** occRel: occluder window relative to the render origin; lights: packLights output; occTop: shadow ray ceiling (m) */
  write(L: LightParams, occRel: [number, number, number, number], lights: Float32Array<ArrayBuffer>, lightCount: number, occTop: number) {
    const f = this.ubo.f;
    const v3 = (o: number, c: [number, number, number]) => { f[o] = c[0]; f[o + 1] = c[1]; f[o + 2] = c[2]; f[o + 3] = 0; };
    v3(0, L.ambient); v3(4, L.sky); v3(8, L.fogCol); v3(12, L.sunDir); v3(16, L.sunCol); v3(20, L.moonDir); v3(24, L.moonCol);
    f.set(occRel, 28);
    f[32] = L.reach; f[33] = L.strength; f[34] = L.ambientFill; f[35] = L.soft;
    f[36] = L.bands; f[37] = L.ditherAmt; f[38] = L.beams; f[39] = L.spec;
    f[40] = L.reflect; f[41] = L.fog; f[42] = L.lightning; f[43] = L.haze;
    f[44] = L.steps; f[45] = L.shadows ? 1 : 0; f[46] = L.celShadows ? 1 : 0; f[47] = L.lightsOn ? 1 : 0;
    f[48] = L.view; f[49] = lightCount; f[50] = occTop;
    this.ubo.write();
    this.g.device.queue.writeBuffer(this.lightBuf, 0, lights, 0, MAX_LIGHTS * LIGHT_FLOATS);
  }

  encode(pass: GPURenderPassEncoder) {
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bg!);
    pass.draw(3);
  }

  dispose() { this.ubo.destroy(); this.lightBuf.destroy(); }
}
