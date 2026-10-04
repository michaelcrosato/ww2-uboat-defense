// Deferred lighting with occluder-based soft shadows.
// Occluders are rasterized top-down into a world-aligned heightmap (R = max height of hulls,
// superstructure, islands; G = smoke density). For each lit pixel and light, a ray is marched in
// world space from the pixel toward the light; wherever the heightmap rises above the ray the light
// is blocked, with a penumbra that widens with distance (shadow softness). Smoke attenuates light.
// Searchlights add in-scattered haze along their beam (with shadow shafts); flares get halos.
// Irradiance is quantized into bands with world-anchored dithering for a pixel-art look.

import { drawFullscreen, FULLSCREEN_VS, Program, type GL } from '../gl';
import { CAMERA_GLSL, DITHER_GLSL, MAT_GLSL } from '../glsl/common';
import { MAX_LIGHTS } from '../../lights';

const FS = /* glsl */ `#version 300 es
precision highp float;
${CAMERA_GLSL}
${DITHER_GLSL}
${MAT_GLSL}
uniform sampler2D uAlbedo, uNormal, uOcc, uLights;
uniform int uLightCount;
uniform vec4 uOccRect;
uniform vec3 uAmbient, uSky, uFogCol;
uniform vec3 uSunDir, uSunCol, uMoonDir, uMoonCol;
uniform float uReach, uStrength, uAmbientFill, uSoft, uBands, uDitherAmt, uBeams, uSpec, uReflect, uFog, uLightning, uHaze;
uniform int uSteps, uShadows, uCelShadows, uLightsOn;
uniform int uView;   // 0 final, 1 albedo, 2 normal, 3 height, 4 light only
out vec4 oColor;

vec2 occAt(vec2 p) {
  vec2 uv = (p - uOccRect.xy) / uOccRect.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec2(-50.0, 0.0);
  return texture(uOcc, uv).ra;   // r = max occluder height, a = accumulated smoke density
}

float shadowTo(vec3 p, vec3 lp, float jitter, int steps) {
  vec3 d = lp - p;
  float D = length(d.xy);
  if (D < 0.4) return 1.0;
  float s = 1.0, trans = 1.0;
  float seg = D / float(steps);
  for (int k = 0; k < 64; k++) {
    if (k >= steps) break;
    float t = (float(k) + jitter) / float(steps);
    t = 0.015 + t * t * 0.97;
    vec3 q = p + d * t;
    vec2 o = occAt(q.xy);
    float pen = (o.x - q.z) / (0.18 + uSoft * t * D * 0.14);
    s = min(s, 1.0 - clamp(pen, 0.0, 1.0));
    trans *= exp(-o.y * seg * 0.06);
    if (s <= 0.001) break;
  }
  return s * trans;
}

float shadowDir(vec3 p, vec3 L, float maxD, float jitter, int steps) {
  float hz = length(L.xy);
  if (hz < 1e-3) return 1.0;
  return shadowTo(p, p + L * (maxD / hz), jitter, steps);
}

float blinn(vec3 n, vec3 L, vec3 V, float k) {
  vec3 H = normalize(L + V);
  return pow(max(dot(n, H), 0.0), k);
}

void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec4 A = texelFetch(uAlbedo, ip, 0);
  vec4 N = texelFetch(uNormal, ip, 0);
  float mat = floor(A.a * 255.0 + 0.5);
  vec3 n = vec3(N.xy, sqrt(max(0.0, 1.0 - dot(N.xy, N.xy))));
  float z = N.z, emis = N.w;
  vec3 P = vec3(pixToWorld(gl_FragCoord.xy, z), z);
  vec3 V = normalize(vec3(0.0, uTilt.y, uTilt.x));
  float dth = ditherHere();
  float jitter = fract(dth * 7.31 + 0.13);
  bool water = mat == MAT_WATER;
  bool glossy = water || mat == MAT_METAL || mat == MAT_ICE;
  float shininess = water ? 90.0 : (mat == MAT_ICE ? 40.0 : 18.0);
  float specK = water ? 1.0 : (mat == MAT_METAL ? 0.25 : (mat == MAT_ICE ? 0.4 : 0.0));

  vec3 light = uAmbient * uAmbientFill * (0.62 + 0.38 * n.z);
  light += vec3(0.75, 0.8, 1.0) * uLightning;
  vec3 base = light;
  vec3 spec = vec3(0.0);
  vec3 haze = vec3(0.0);
  int csteps = max(4, uSteps / 2);
  // ---- sun and moon
  if (uSunCol.r + uSunCol.g + uSunCol.b > 0.003) {
    float ndl = clamp((dot(n, uSunDir) + 0.15) / 1.15, 0.0, 1.0);
    float sh = uCelShadows == 1 && uShadows == 1 ? shadowDir(P + n * 0.2, uSunDir, 70.0, jitter, csteps) : 1.0;
    light += uSunCol * ndl * sh;
    if (glossy) spec += uSunCol * blinn(n, uSunDir, V, shininess) * specK * sh * 2.5;
  }
  if (uMoonCol.r + uMoonCol.g + uMoonCol.b > 0.002) {
    float ndl = clamp((dot(n, uMoonDir) + 0.15) / 1.15, 0.0, 1.0);
    float sh = uCelShadows == 1 && uShadows == 1 ? shadowDir(P + n * 0.2, uMoonDir, 70.0, jitter, csteps) : 1.0;
    light += uMoonCol * ndl * sh;
    // an orthographic view has one view vector, so a reflection could never form a glitter path:
    // moon glints use a virtual observer mirrored from the moon, which lays a patch of glitter around
    // the view centre stretched toward the moon (low moons give long paths)
    if (water) spec += uMoonCol * blinn(n, uMoonDir, normalize(vec3(-uMoonDir.xy, uMoonDir.z) * 420.0 - P), 900.0) * sh * 3.0;
    else if (glossy) spec += uMoonCol * blinn(n, uMoonDir, V, shininess * 1.3) * specK * sh * 6.0;
  }
  // ---- dynamic lights
  if (uLightsOn == 1) {
    for (int i = 0; i < ${MAX_LIGHTS}; i++) {
      if (i >= uLightCount) break;
      vec4 l0 = texelFetch(uLights, ivec2(0, i), 0);  // pos (rel), reach
      vec4 l1 = texelFetch(uLights, ivec2(1, i), 0);  // color, intensity
      vec4 l2 = texelFetch(uLights, ivec2(2, i), 0);  // dir, cos outer (-2 = omni)
      vec4 l3 = texelFetch(uLights, ivec2(3, i), 0);  // shadow, beam, cos inner, size
      float R = l0.w * uReach;
      vec3 Lc = l1.rgb * l1.w * uStrength;
      bool spot = l2.w > -1.5;
      // in-scattered haze (beams and halos), visible even where the light does not land
      if (l3.y > 0.0 && uBeams > 0.0) {
        if (spot) {
          vec3 D = l2.xyz;
          vec3 w0 = P - l0.xyz;
          float b = dot(V, D), d = dot(V, w0), e = dot(D, w0);
          float den = max(1.0 - b * b, 1e-4);
          float t = clamp((e - b * d) / den, 0.0, R);
          float s = max(0.0, t * b - d);
          vec3 bpnt = l0.xyz + D * t;
          float r = length(P + V * s - bpnt);
          float tanA = sqrt(max(1.0 - l2.w * l2.w, 0.0)) / max(l2.w, 0.05);
          float rb = t * tanA + l3.w;
          float k = 1.0 - smoothstep(0.0, rb, r);
          if (k > 0.0) {
            float fall = (1.0 - t / R); fall *= fall;
            float shs = uShadows == 1 && l3.x > 0.5 ? shadowTo(bpnt, l0.xyz, jitter, max(4, uSteps / 3)) : 1.0;
            haze += Lc * k * k * fall * l3.y * uBeams * uHaze * 0.55 * shs;
          }
        } else {
          vec3 w0 = l0.xyz - P;
          float s = max(dot(w0, V), 0.0);
          float r = length(P + V * s - l0.xyz);
          float rad = R * 0.22;
          haze += Lc * exp(-r * r / (rad * rad)) * l3.y * uBeams * uHaze * 0.35;
        }
      }
      vec3 d = l0.xyz - P;
      float dist = length(d);
      if (dist >= R) continue;
      float att = 1.0 - (dist * dist) / (R * R);
      att *= att;
      vec3 Ld = d / max(dist, 1e-3);
      float cone = 1.0;
      if (spot) cone = smoothstep(l2.w, l3.z, dot(-Ld, l2.xyz));
      if (cone * att <= 0.001) continue;
      float ndl = clamp((dot(n, Ld) + 0.35) / 1.35, 0.0, 1.0);
      float sh = uShadows == 1 && l3.x > 0.5 ? shadowTo(P + n * 0.15, l0.xyz, jitter, uSteps) : 1.0;
      vec3 c = Lc * att * cone * sh;
      light += c * ndl;
      if (glossy) spec += c * blinn(n, Ld, V, shininess) * specK * 3.0;
    }
  }
  // ---- pixel-art quantization of the direct light; the flat ambient base stays smooth so dark
  // scenes don't break up into dither speckle where everything sits below the first band
  vec3 lq = light;
  if (uBands > 0.5) {
    vec3 dl = light - base;
    float lum = max(dl.r, max(dl.g, dl.b));
    float q = floor(lum * uBands + mix(0.5, dth, uDitherAmt)) / uBands;
    lq = base + dl * (q / max(lum, 1e-4));
  }
  vec3 col = A.rgb * lq;
  // water: glints as hard sparkles + sky reflection
  if (glossy) {
    float sl = max(spec.r, max(spec.g, spec.b)) * uSpec;
    if (water) {
      vec3 sp = sl > 0.35 + 0.5 * dth ? spec * uSpec * 1.4 : spec * uSpec * 0.15;
      col += sp;
      float F = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
      col += uSky * F * uReflect * 0.9;
    } else col += spec * uSpec;
  }
  col += A.rgb * emis;
  if (mat == MAT_FIRE || mat == MAT_LAMP) col += A.rgb * 0.4;
  col += haze;
  col = mix(col, uFogCol, clamp(uFog, 0.0, 0.95));
  if (uView == 1) col = A.rgb;
  else if (uView == 2) col = n * 0.5 + 0.5;
  else if (uView == 3) col = vec3(clamp(z * 0.08 + 0.5, 0.0, 1.0), clamp(-z * 0.08 + 0.5, 0.0, 1.0), 0.5);
  else if (uView == 4) col = lq * 0.6 + haze;
  oColor = vec4(col, 1.0);
}`;

export class LightingPass {
  prog: Program;
  constructor(gl: GL) {
    this.prog = new Program(gl, 'lighting', FULLSCREEN_VS, FS);
  }
  draw(gl: GL) { drawFullscreen(gl); }
}
