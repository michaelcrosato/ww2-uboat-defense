// Shared WGSL chunks, 1:1 ports of render/webgl2/glsl/common.ts (same function names and math).
// Conventions (docs/WEBGPU_PORTING.md §1):
//  * @builtin(position).xy is the buffer pixel, y DOWN (top-left origin) — no flip needed inside passes.
//  * clip y from a y-down buffer pixel is 1 - by/bh*2 (flipped vs GL); NDC depth is 0..1.
//  * world positions are relative to the render origin (snapped camera center).

import type { Camera } from '../../camera';
import { MAT } from '../../materials';

/** fullscreen triangle; `uv` is 0..1 with v down (matches buffer rows) */
export const FULLSCREEN_WGSL = /* wgsl */ `
struct VsOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vsFull(@builtin(vertex_index) i: u32) -> VsOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VsOut;
  o.pos = vec4f(p[i], 0.0, 1.0);
  o.uv = vec2f(p[i].x * 0.5 + 0.5, 0.5 - p[i].y * 0.5);
  return o;
}
`;

/**
 * Frame uniforms (group 0, binding 0 in every world-space pass). Float offsets:
 *   0 cam (rel x, rel y, zoom, -) · 4 tilt (cos, sin) · 6 buf (w, h) · 8 pixOff (x, y) · 10 pad
 */
export const FRAME_FLOATS = 12;
export function writeFrame(f: Float32Array, cam: Camera) {
  f[0] = 0; f[1] = 0; f[2] = cam.zoom; f[3] = 0;
  f[4] = cam.cosT; f[5] = cam.sinT; f[6] = cam.bw; f[7] = cam.bh;
  f[8] = cam.ix; f[9] = cam.iy; f[10] = 0; f[11] = 0;
}

export const CAMERA_WGSL = /* wgsl */ `
struct Frame { cam: vec4f, tilt: vec2f, buf: vec2f, pixOff: vec2f, pad: vec2f };
@group(0) @binding(0) var<uniform> F: Frame;

fn pixToWorld(bp: vec2f, z: f32) -> vec2f {
  let x = (bp.x - F.buf.x * 0.5) / F.cam.z + F.cam.x;
  let y = ((bp.y - F.buf.y * 0.5) / F.cam.z + z * F.tilt.y) / F.tilt.x + F.cam.y;
  return vec2f(x, y);
}
// world (relative) -> clip position with depth along the view direction (y flipped, depth 0..1)
fn worldToClip(p: vec3f) -> vec4f {
  let bx = (p.x - F.cam.x) * F.cam.z + F.buf.x * 0.5;
  let by = ((p.y - F.cam.y) * F.tilt.x - p.z * F.tilt.y) * F.cam.z + F.buf.y * 0.5;
  let d = -((p.y - F.cam.y) * F.tilt.y + p.z * F.tilt.x);
  return vec4f(bx / F.buf.x * 2.0 - 1.0, 1.0 - by / F.buf.y * 2.0, clamp(d / 3000.0, -1.0, 1.0) * 0.5 + 0.5, 1.0);
}
`;

export const MATH_WGSL = /* wgsl */ `
// GLSL mod (floored); WGSL % truncates toward zero
fn fmod(x: f32, y: f32) -> f32 { return x - y * floor(x / y); }
fn fmod2(x: vec2f, y: f32) -> vec2f { return x - y * floor(x / y); }
`;

export const NOISE_WGSL = /* wgsl */ `
fn hash12(p: vec2f) -> f32 {
  var p3 = fract(p.xyx * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
fn hash22(p: vec2f) -> vec2f {
  var p3 = fract(p.xyx * vec3f(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash12(i);
  let b = hash12(i + vec2f(1.0, 0.0));
  let c = hash12(i + vec2f(0.0, 1.0));
  let d = hash12(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
fn fbm(p0: vec2f) -> f32 {
  var p = p0;
  var s = 0.0;
  var a = 0.5;
  for (var i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2f(17.1, 9.7); a *= 0.5; }
  return s;
}
// distance to nearest cell point (cellular / worley), for foam lace
fn cellular(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  var d = 8.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let g = vec2f(f32(x), f32(y));
      let o = hash22(i + g);
      let r = g + o - f;
      d = min(d, dot(r, r));
    }
  }
  return sqrt(d);
}
`;

/** G-buffer outputs: RT0 rgb albedo + material/255, RT1 normal.xy, world height z, emissive */
export const GBUF_WGSL = /* wgsl */ `
struct GOut { @location(0) albedo: vec4f, @location(1) normal: vec4f };
`;

/** MAT_* constants generated from render/materials.ts (the GLSL #defines must match) */
export const MAT_WGSL = Object.entries(MAT).filter(([k]) => k !== 'NONE').map(([k, v]) => `const MAT_${k} = ${v}.0;`).join('\n') + '\n';

/** needs CAMERA_WGSL (F.pixOff) and MATH_WGSL */
export const DITHER_WGSL = /* wgsl */ `
fn bayer8(p: vec2f) -> f32 {
  let q = vec2<i32>(fmod2(p, 8.0));
  var m = array<f32, 64>(
     0.0, 32.0,  8.0, 40.0,  2.0, 34.0, 10.0, 42.0,
    48.0, 16.0, 56.0, 24.0, 50.0, 18.0, 58.0, 26.0,
    12.0, 44.0,  4.0, 36.0, 14.0, 46.0,  6.0, 38.0,
    60.0, 28.0, 52.0, 20.0, 62.0, 30.0, 54.0, 22.0,
     3.0, 35.0, 11.0, 43.0,  1.0, 33.0,  9.0, 41.0,
    51.0, 19.0, 59.0, 27.0, 49.0, 17.0, 57.0, 25.0,
    15.0, 47.0,  7.0, 39.0, 13.0, 45.0,  5.0, 37.0,
    63.0, 31.0, 55.0, 23.0, 61.0, 29.0, 53.0, 21.0);
  return (m[q.y * 8 + q.x] + 0.5) / 64.0;
}
fn bayer4(p: vec2f) -> f32 {
  let q = vec2<i32>(fmod2(p, 4.0));
  var m = array<f32, 16>(0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (m[q.y * 4 + q.x] + 0.5) / 16.0;
}
// world-anchored threshold for this fragment (pos = @builtin(position).xy)
fn ditherHere(pos: vec2f) -> f32 { return bayer8(floor(pos) + F.pixOff); }
`;
