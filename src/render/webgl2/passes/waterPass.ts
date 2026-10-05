// G-buffer pass for the sea surface. One fullscreen triangle: every pixel finds its point on the
// displaced ocean surface, builds the normal from swell + ripple sim + capillary detail, picks a
// palette tone with world-anchored dithering, lays foam / bioluminescence / oil / burning oil on
// top, and composites submerged objects (U-boats, torpedoes, depth charges, hulls below the
// waterline) faded by depth and theater clarity.

import { drawFullscreen, FULLSCREEN_VS, Program, type GL } from '../gl';
import { CAMERA_GLSL, DITHER_GLSL, GBUF_OUT_GLSL, MAT_GLSL, NOISE_GLSL } from '../glsl/common';
import { OCEAN_GLSL } from '../glsl/ocean';

const FS = /* glsl */ `#version 300 es
precision highp float;
${CAMERA_GLSL}
${DITHER_GLSL}
${NOISE_GLSL}
${OCEAN_GLSL}
${MAT_GLSL}
${GBUF_OUT_GLSL}
uniform vec3 uRamp[8];
uniform vec3 uFoamCol, uFoamShade, uMurk;
uniform float uClarity, uHs, uContrast, uDetail, uCrestFoam, uTime, uRippleScale;
uniform vec2 uWind;            // m/s, direction of travel
uniform int uParallax;
uniform sampler2D uWave;       // ripple heightfield (m)
uniform sampler2D uDye;        // foam, bio, oil, fire
uniform vec4 uSimRect;         // sim window origin (rel), size
uniform float uSimCell;
uniform int uSimOn;
uniform sampler2D uUnder;      // submerged objects: rgb albedo, a coverage
uniform sampler2D uUnderD;     // r = depth below surface (m)
uniform float uBio;            // night * theater bioluminescence
uniform float uIce;            // arctic pack ice amount

float simUV(vec2 p, out vec2 uv) {
  uv = (p - uSimRect.xy) / uSimRect.zw;
  vec2 e = min(uv, 1.0 - uv);
  return uSimOn == 1 ? smoothstep(0.0, 0.06, min(e.x, e.y)) : 0.0;
}
float simH(vec2 p) {
  vec2 uv; float w = simUV(p, uv);
  return w > 0.0 ? texture(uWave, uv).r * w * uRippleScale : 0.0;
}
float surfaceH(vec2 p) { return oceanHeight(p) + simH(p); }

void main() {
  vec2 bp = gl_FragCoord.xy;
  // solve for the surface point seen through this pixel (vertical displacement in tilted views): a
  // cheap step on the undisplaced swell, then an exact one (the fixed point gains ~5x per step)
  vec2 p = pixToWorld(bp, 0.0);
  if (uParallax == 1 && uTilt.y > 0.01) {
    p = pixToWorld(bp, oceanHeightFast(p));
    p = pixToWorld(bp, surfaceH(p));
  }
  vec3 n; float jac;
  float hs = oceanSample(p, n, jac);
  // ripple sim: height and slope
  vec2 suv; float sw = simUV(p, suv);
  float rh = 0.0;
  if (sw > 0.0) {
    float t = 1.0 / (uSimRect.z / uSimCell);
    float c = texture(uWave, suv).r;
    float l = texture(uWave, suv - vec2(t, 0.0)).r, r = texture(uWave, suv + vec2(t, 0.0)).r;
    float d = texture(uWave, suv - vec2(0.0, t)).r, u = texture(uWave, suv + vec2(0.0, t)).r;
    rh = c * sw * uRippleScale;
    vec2 g = vec2(r - l, u - d) / (2.0 * uSimCell) * sw * uRippleScale;
    n = normalize(n + vec3(-g * 1.6, 0.0));
  }
  // cat's paws: large drifting patches where gusts roughen the surface; light airs leave the rest glassy
  float ws = length(uWind);
  float paws = smoothstep(0.35, 0.75, fbm(p * 0.006 + uWind * uTime * 0.0035 + vec2(11.0, 3.0)));
  float rough = mix(0.2, 1.0, smoothstep(1.0, 7.0, ws)) * mix(0.55, 1.45, paws);
  // capillary detail: wind-driven value noise slopes
  if (uDetail > 0.0) {
    vec2 q = p * 0.31 + uWind * uTime * 0.045;
    float e = 0.6;
    float a = fbm(q), bx = fbm(q + vec2(e, 0.0)), by = fbm(q + vec2(0.0, e));
    n = normalize(n + vec3(-(bx - a), -(by - a), 0.0) * uDetail * 0.9 * rough);
  }
  float h = hs + rh;
  vec4 dye = vec4(0.0);
  if (sw > 0.0) dye = texture(uDye, suv) * sw;
  float oil = clamp(dye.b, 0.0, 1.0);
  n = normalize(mix(n, vec3(0.0, 0.0, 1.0), oil * 0.75));

  // ---- palette tone
  float dth = ditherHere();
  float tone = 0.5;
  // height only as a soft, compressed undulation: raw swell height made broad light/dark bands
  float hn = hs / max(uHs * 0.8, 0.3);
  tone += hn / (1.0 + abs(hn)) * 0.09 * uContrast;
  tone += (paws - 0.5) * 0.06 * uContrast;
  tone += rh * 0.45 * uContrast;
  tone += (n.y * 0.65 + n.x * 0.2) * uContrast;
  tone += (1.0 - clamp(jac, 0.0, 1.0)) * 0.35 * uContrast;
  tone = clamp(tone, 0.0, 0.999);
  float ci = tone * 7.0;
  int i0 = int(floor(ci));
  if (fract(ci) > dth) i0 = min(i0 + 1, 7);
  vec3 alb = uRamp[i0];
  float mat = MAT_WATER;
  float emis = 0.0;

  // ---- submerged objects show through the water
  ivec2 ip = ivec2(bp);
  vec4 under = texelFetch(uUnder, ip, 0);
  if (under.a > 0.5) {
    float dep = max(texelFetch(uUnderD, ip, 0).r, 0.0);
    float vis = exp(-dep / max(uClarity, 0.1));
    vec3 seen = mix(uMurk, under.rgb, exp(-dep / max(uClarity * 0.45, 0.1)));
    if (vis * 0.92 > dth) alb = mix(alb, seen, 0.85);
  }

  // ---- oil slick: dark, glossy, faint iridescence
  if (oil > 0.02) {
    float irid = fbm(p * 0.08 + uTime * 0.01);
    vec3 oc = mix(vec3(0.04, 0.045, 0.05), vec3(0.16, 0.1, 0.2), irid * 0.6);
    if (oil * 1.25 > dth) alb = mix(alb, oc, 0.8);
  }

  // ---- foam: whitecaps from breaking crests + advected wake foam
  float lace = cellular(p * 0.42 + vec2(uTime * 0.03, 0.0));
  float lace2 = cellular(p * 0.95 - vec2(0.0, uTime * 0.05));
  float crest = smoothstep(0.62, 0.18, jac) * uCrestFoam;
  float wake = clamp(dye.r, 0.0, 2.0);
  float fv = max(crest * (0.35 + 0.9 * smoothstep(0.55, 0.15, lace)), wake * (0.45 + 0.75 * smoothstep(0.7, 0.2, lace2)));
  if (fv > dth) {
    alb = fv > dth + 0.3 ? uFoamCol : uFoamShade;
    mat = MAT_FOAM;
  }

  // ---- bioluminescence in churned water (emissive)
  float bio = dye.g * uBio;
  if (bio > 0.03) {
    float sparkle = 0.6 + 0.4 * hash12(floor(p * 1.5) + floor(uTime * 6.0));
    float b = bio * sparkle;
    if (b > dth * 0.8) { alb = mix(vec3(0.25, 1.0, 0.85), vec3(0.6, 1.0, 1.0), sparkle - 0.6); emis = max(emis, 0.9 * b + 0.3); mat = MAT_FOAM; }
  }

  // ---- burning oil
  float fire = dye.a;
  if (fire > 0.02) {
    float fl = fbm(p * 0.35 + vec2(0.0, -uTime * 1.7)) * 1.3;
    float fi = fire * fl;
    if (fi > dth * 0.7) {
      alb = fi > 0.9 ? vec3(1.0, 0.92, 0.55) : fi > 0.5 ? vec3(1.0, 0.55, 0.12) : vec3(0.75, 0.2, 0.05);
      emis = 2.2 * clamp(fi, 0.2, 1.2);
      mat = MAT_FIRE;
    }
  }

  // ---- pack ice (Arctic)
  if (uIce > 0.0) {
    // domain-warped cells with roughened rims: angular, irregular floes separated by dark leads
    vec2 q = p * 0.018 + 3.1 + (vec2(fbm(p * 0.031), fbm(p * 0.031 + 5.2)) - 0.5) * 0.9;
    float floe = cellular(q) + (fbm(p * 0.21) - 0.5) * 0.12;
    float edge = 0.22 + uIce * 0.16;
    float ice = step(floe, edge) * smoothstep(0.2, 0.6, fbm(p * 0.004 + 7.0) + uIce * 0.3);
    if (ice > 0.5) {
      float sh = fbm(p * 0.2);
      alb = mix(vec3(0.72, 0.8, 0.86), vec3(0.93, 0.96, 0.98), step(dth, sh));
      alb = mix(alb, vec3(0.55, 0.64, 0.7), smoothstep(edge - 0.035, edge, floe) * 0.8);
      n = normalize(vec3(0.0, 0.0, 1.0) + vec3(sh - 0.5, 0.0, 0.0) * 0.3);
      mat = MAT_ICE;
      h += 0.5;
    }
  }

  oAlbedo = vec4(alb, mat / 255.0);
  oNormal = vec4(n.xy, h, emis);
  vec4 clip = worldToClip(vec3(p, h));
  gl_FragDepth = clip.z * 0.5 + 0.5;
}`;

export class WaterPass {
  prog: Program;
  constructor(gl: GL) {
    this.prog = new Program(gl, 'water', FULLSCREEN_VS, FS);
  }
  draw(gl: GL) { drawFullscreen(gl); }
}
