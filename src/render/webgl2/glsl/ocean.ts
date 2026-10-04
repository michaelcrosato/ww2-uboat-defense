// GLSL twin of the CPU Gerstner ocean in src/water/ocean.ts (keep the math identical).

import { MAX_WAVES } from '../../../water/ocean';

/** GLSL twin of Ocean.sample. Positions are relative to the render origin (uOrigin). */
export const OCEAN_GLSL = /* glsl */ `
#define MAX_WAVES ${MAX_WAVES}
uniform vec4 uWaveA[MAX_WAVES];  // dir.xy, k, A
uniform vec4 uWaveB[MAX_WAVES];  // phase (origin+time folded), Q, omega, -
uniform int uWaveCount;
uniform vec4 uRings[8];          // x, y (rel), age, amp
uniform int uRingCount;
uniform float uSwellScale;       // global visual scale (1)

float ringHeight(vec2 p) {
  float h = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= uRingCount) break;
    vec4 r = uRings[i];
    float d = length(p - r.xy);
    float u = (d - r.z * 9.0) / 6.0;
    if (u < -6.0 || u > 2.0) continue;
    float decay = r.w / (1.0 + r.z * 0.6) / sqrt(1.0 + d * 0.05);
    h += decay * cos(u * 2.2) * exp(-u * u * 0.15);
  }
  return h;
}

// returns height and fills normal + jacobian
float oceanSample(vec2 p, out vec3 n, out float jac) {
  vec2 q = p;
  for (int it = 0; it < 2; it++) {
    vec2 d = vec2(0.0);
    for (int i = 0; i < MAX_WAVES; i++) {
      if (i >= uWaveCount) break;
      vec4 a = uWaveA[i]; vec4 b = uWaveB[i];
      d += a.xy * (sin(a.z * dot(a.xy, q) + b.x) * b.y * a.w);
    }
    q = p + d;
  }
  float h = 0.0, jxx = 1.0, jyy = 1.0, jxy = 0.0, hx = 0.0, hy = 0.0;
  for (int i = 0; i < MAX_WAVES; i++) {
    if (i >= uWaveCount) break;
    vec4 a = uWaveA[i]; vec4 b = uWaveB[i];
    float th = a.z * dot(a.xy, q) + b.x;
    float cs = cos(th), sn = sin(th);
    float kA = a.z * a.w;
    h += a.w * cs;
    hx -= a.x * kA * sn; hy -= a.y * kA * sn;
    float qka = b.y * kA * cs;
    jxx -= qka * a.x * a.x; jyy -= qka * a.y * a.y; jxy -= qka * a.x * a.y;
  }
  n = normalize(vec3(jxy * hy - hx * jyy, hx * jxy - jxx * hy, jxx * jyy - jxy * jxy));
  jac = jxx * jyy - jxy * jxy;
  return h + ringHeight(p);
}

float oceanHeight(vec2 p) {
  vec2 q = p;
  for (int it = 0; it < 2; it++) {
    vec2 d = vec2(0.0);
    for (int i = 0; i < MAX_WAVES; i++) {
      if (i >= uWaveCount) break;
      vec4 a = uWaveA[i]; vec4 b = uWaveB[i];
      d += a.xy * (sin(a.z * dot(a.xy, q) + b.x) * b.y * a.w);
    }
    q = p + d;
  }
  float h = 0.0;
  for (int i = 0; i < MAX_WAVES; i++) {
    if (i >= uWaveCount) break;
    vec4 a = uWaveA[i]; vec4 b = uWaveB[i];
    h += a.w * cos(a.z * dot(a.xy, q) + b.x);
  }
  return h + ringHeight(p);
}
`;
