// Shared GLSL chunks. Conventions for every internal pass:
//  * gl_FragCoord.xy is the render-buffer pixel with y DOWN (passes write clip y = by/bh*2-1).
//  * world positions in shaders are relative to the render origin (the snapped camera center),
//    so numbers stay small and precise. CPU code folds the origin into uniforms.
//  * G-buffer: RT0 = albedo.rgb + material/255, RT1 = normal.xy, world height z, emissive.

export const CAMERA_GLSL = /* glsl */ `
uniform vec4 uCam;    // camera rel offset x, y (usually 0), zoom (px/m), unused
uniform vec2 uTilt;   // cos(tilt), sin(tilt)
uniform vec2 uBuf;    // render buffer size in pixels
uniform vec2 uPixOff; // integer camera pixel offset (world-anchored dithering)

vec2 pixToWorld(vec2 bp, float z) {
  float x = (bp.x - uBuf.x * 0.5) / uCam.z + uCam.x;
  float y = ((bp.y - uBuf.y * 0.5) / uCam.z + z * uTilt.y) / uTilt.x + uCam.y;
  return vec2(x, y);
}
// world (relative) -> clip position with depth along the view direction
vec4 worldToClip(vec3 p) {
  float bx = (p.x - uCam.x) * uCam.z + uBuf.x * 0.5;
  float by = ((p.y - uCam.y) * uTilt.x - p.z * uTilt.y) * uCam.z + uBuf.y * 0.5;
  float d = -((p.y - uCam.y) * uTilt.y + p.z * uTilt.x);
  return vec4(bx / uBuf.x * 2.0 - 1.0, by / uBuf.y * 2.0 - 1.0, clamp(d / 3000.0, -1.0, 1.0), 1.0);
}
`;

export const DITHER_GLSL = /* glsl */ `
float bayer8(vec2 p) {
  ivec2 q = ivec2(mod(p, 8.0));
  int m[64] = int[64](
     0, 32,  8, 40,  2, 34, 10, 42,
    48, 16, 56, 24, 50, 18, 58, 26,
    12, 44,  4, 36, 14, 46,  6, 38,
    60, 28, 52, 20, 62, 30, 54, 22,
     3, 35, 11, 43,  1, 33,  9, 41,
    51, 19, 59, 27, 49, 17, 57, 25,
    15, 47,  7, 39, 13, 45,  5, 37,
    63, 31, 55, 23, 61, 29, 53, 21);
  return (float(m[q.y * 8 + q.x]) + 0.5) / 64.0;
}
float bayer4(vec2 p) {
  ivec2 q = ivec2(mod(p, 4.0));
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[q.y * 4 + q.x]) + 0.5) / 16.0;
}
// world-anchored threshold for this fragment
float ditherHere() { return bayer8(floor(gl_FragCoord.xy) + uPixOff); }
`;

export const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1, 0)), c = hash12(i + vec2(0, 1)), d = hash12(i + vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.7); a *= 0.5; }
  return s;
}
// distance to nearest cell point (cellular / worley), for foam lace
float cellular(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = hash22(i + g);
    vec2 r = g + o - f;
    d = min(d, dot(r, r));
  }
  return sqrt(d);
}
`;

export const GBUF_OUT_GLSL = /* glsl */ `
layout(location = 0) out vec4 oAlbedo;   // rgb albedo, a = material id / 255
layout(location = 1) out vec4 oNormal;   // xy normal, z = world height, w = emissive
`;

export const MAT = {
  NONE: 0,
  WATER: 1,
  METAL: 2,
  WOOD: 3,
  FOAM: 4,
  FIRE: 5,
  SMOKE: 6,
  LAMP: 7,
  UNDERWATER: 8,
  SPRAY: 9,
  ICE: 10,
  LAND: 11,
} as const;

export const MAT_GLSL = /* glsl */ `
#define MAT_WATER 1.0
#define MAT_METAL 2.0
#define MAT_WOOD 3.0
#define MAT_FOAM 4.0
#define MAT_FIRE 5.0
#define MAT_SMOKE 6.0
#define MAT_LAMP 7.0
#define MAT_UNDERWATER 8.0
#define MAT_SPRAY 9.0
#define MAT_ICE 10.0
#define MAT_LAND 11.0
`;
