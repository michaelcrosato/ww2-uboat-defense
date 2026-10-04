// WGSL twin of the CPU Gerstner ocean (src/water/ocean.ts) and of webgl2/glsl/ocean.ts — keep the
// math identical. Waves come in one uniform struct; positions are relative to the render origin.

import { MAX_WAVES } from '../../../water/ocean';

/**
 * Ocean uniforms (float offsets): 0 a[16] (dir.xy, k, A) · 64 b[16] (phase, Q, omega, -)
 * 128 rings[8] (x, y, age, amp) · 160 count (waves, rings, swellScale, -)
 */
export const OCEAN_FLOATS = MAX_WAVES * 8 + 32 + 4;

export const OCEAN_WGSL = /* wgsl */ `
struct Ocean { a: array<vec4f, ${MAX_WAVES}>, b: array<vec4f, ${MAX_WAVES}>, rings: array<vec4f, 8>, count: vec4f };
@group(0) @binding(1) var<uniform> OC: Ocean;
struct OceanOut { h: f32, n: vec3f, jac: f32 };

fn ringHeight(p: vec2f) -> f32 {
  var h = 0.0;
  let rc = i32(OC.count.y + 0.5);
  for (var i = 0; i < 8; i++) {
    if (i >= rc) { break; }
    let r = OC.rings[i];
    let d = length(p - r.xy);
    let u = (d - r.z * 9.0) / 6.0;
    if (u < -6.0 || u > 2.0) { continue; }
    let decay = r.w / (1.0 + r.z * 0.6) / sqrt(1.0 + d * 0.05);
    h += decay * cos(u * 2.2) * exp(-u * u * 0.15);
  }
  return h;
}

fn gerstnerQ(p: vec2f, wc: i32) -> vec2f {
  var q = p;
  for (var it = 0; it < 2; it++) {
    var d = vec2f(0.0);
    for (var i = 0; i < ${MAX_WAVES}; i++) {
      if (i >= wc) { break; }
      let a = OC.a[i];
      let b = OC.b[i];
      d += a.xy * (sin(a.z * dot(a.xy, q) + b.x) * b.y * a.w);
    }
    q = p + d;
  }
  return q;
}

// height, normal and jacobian
fn oceanSample(p: vec2f) -> OceanOut {
  let wc = i32(OC.count.x + 0.5);
  let q = gerstnerQ(p, wc);
  var h = 0.0; var jxx = 1.0; var jyy = 1.0; var jxy = 0.0; var hx = 0.0; var hy = 0.0;
  for (var i = 0; i < ${MAX_WAVES}; i++) {
    if (i >= wc) { break; }
    let a = OC.a[i];
    let b = OC.b[i];
    let th = a.z * dot(a.xy, q) + b.x;
    let cs = cos(th);
    let sn = sin(th);
    let kA = a.z * a.w;
    h += a.w * cs;
    hx -= a.x * kA * sn; hy -= a.y * kA * sn;
    let qka = b.y * kA * cs;
    jxx -= qka * a.x * a.x; jyy -= qka * a.y * a.y; jxy -= qka * a.x * a.y;
  }
  var o: OceanOut;
  o.n = normalize(vec3f(jxy * hy - hx * jyy, hx * jxy - jxx * hy, jxx * jyy - jxy * jxy));
  o.jac = jxx * jyy - jxy * jxy;
  o.h = h + ringHeight(p);
  return o;
}

fn oceanHeight(p: vec2f) -> f32 {
  let wc = i32(OC.count.x + 0.5);
  let q = gerstnerQ(p, wc);
  var h = 0.0;
  for (var i = 0; i < ${MAX_WAVES}; i++) {
    if (i >= wc) { break; }
    let a = OC.a[i];
    h += a.w * cos(a.z * dot(a.xy, q) + OC.b[i].x);
  }
  return h + ringHeight(p);
}
`;

/** fill the ocean UBO floats (offsets above) from packed wave arrays */
export function writeOcean(f: Float32Array, waveA: Float32Array, waveB: Float32Array, waveCount: number, rings: Float32Array, ringCount: number) {
  f.set(waveA, 0);
  f.set(waveB, MAX_WAVES * 4);
  f.set(rings, MAX_WAVES * 8);
  const c = MAX_WAVES * 8 + 32;
  f[c] = waveCount; f[c + 1] = ringCount; f[c + 2] = 1; f[c + 3] = 0;
}
