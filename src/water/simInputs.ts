// Per-frame inputs shared by the GPU water sims: moving hulls (ships, subs, torpedo trails) and
// one-shot splats (explosions, shell splashes, spray impacts). Packed into small float textures
// so shaders can loop over them without exhausting uniform space.

import type { GL } from '../gfx/gl';

export const MAX_HULLS = 64;
export const MAX_SPLATS = 96;

export interface HullInput {
  x: number; y: number;          // world center
  fx: number; fy: number;        // forward unit vector
  halfLen: number; halfBeam: number;
  vx: number; vy: number;        // velocity (m/s)
  angVel: number;                // yaw rate (rad/s)
  thrust: number;                // -1..1 propeller effort
  draft: number;                 // m (0 for wake-only sources)
  depth: number;                 // 0 surface; >0 = submerged depth of top (m)
  foam: number;                  // foam multiplier
  oil: number;                   // oil leak (0..1)
  fire: number;                  // burning (0..1)
  kind: number;                  // 0 ship, 1 torpedo bubble trail, 2 periscope feather, 3 sub (submerged)
}

export interface SplatInput {
  x: number; y: number; radius: number;
  wave: number;     // vertical velocity impulse (m/s) into the ripple sim (negative = crater)
  foam: number; bio: number; oil: number; fire: number;
  push: number;     // radial surface current (m/s)
}

export class SimInputs {
  hulls: HullInput[] = [];
  splats: SplatInput[] = [];
  hullTex: WebGLTexture;
  splatTex: WebGLTexture;
  private hullData = new Float32Array(MAX_HULLS * 4 * 4);
  private splatData = new Float32Array(MAX_SPLATS * 2 * 4);
  hullCount = 0; splatCount = 0;

  constructor(private gl: GL) {
    this.hullTex = this.mk(4, MAX_HULLS);
    this.splatTex = this.mk(2, MAX_SPLATS);
  }
  private mk(w: number, h: number) {
    const gl = this.gl, t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
    return t;
  }
  clear() { this.hulls.length = 0; this.splats.length = 0; }
  addSplat(s: SplatInput) { if (this.splats.length < MAX_SPLATS) this.splats.push(s); }

  /** upload with positions relative to (ox, oy) — the sim window origin */
  upload(ox: number, oy: number) {
    const gl = this.gl;
    const H = this.hullData; H.fill(0);
    let n = 0;
    for (const h of this.hulls) {
      if (n >= MAX_HULLS) break;
      const b = n * 16;
      H[b] = h.x - ox; H[b + 1] = h.y - oy; H[b + 2] = h.fx; H[b + 3] = h.fy;
      H[b + 4] = h.halfLen; H[b + 5] = h.halfBeam; H[b + 6] = h.vx; H[b + 7] = h.vy;
      H[b + 8] = h.angVel; H[b + 9] = h.thrust; H[b + 10] = h.draft; H[b + 11] = h.depth;
      H[b + 12] = h.foam; H[b + 13] = h.oil; H[b + 14] = h.fire; H[b + 15] = h.kind;
      n++;
    }
    this.hullCount = n;
    gl.bindTexture(gl.TEXTURE_2D, this.hullTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 4, MAX_HULLS, gl.RGBA, gl.FLOAT, H);
    const S = this.splatData; S.fill(0);
    let m = 0;
    for (const s of this.splats) {
      if (m >= MAX_SPLATS) break;
      const b = m * 8;
      S[b] = s.x - ox; S[b + 1] = s.y - oy; S[b + 2] = s.radius; S[b + 3] = s.wave;
      // oil and fire share a slot: positive = oil, negative = burning oil
      S[b + 4] = s.foam; S[b + 5] = s.bio; S[b + 6] = s.fire > 0 ? -s.fire : s.oil; S[b + 7] = s.push;
      m++;
    }
    this.splatCount = m;
    gl.bindTexture(gl.TEXTURE_2D, this.splatTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 2, MAX_SPLATS, gl.RGBA, gl.FLOAT, S);
  }
}

/** GLSL accessors for the packed hull / splat textures (positions relative to sim origin, meters) */
export const SIM_INPUTS_GLSL = /* glsl */ `
uniform sampler2D uHulls;
uniform int uHullCount;
uniform sampler2D uSplats;
uniform int uSplatCount;
struct Hull { vec2 c; vec2 f; float hl; float hb; vec2 v; float w; float thrust; float draft; float depth; float foam; float oil; float fire; float kind; };
Hull getHull(int i) {
  vec4 a = texelFetch(uHulls, ivec2(0, i), 0);
  vec4 b = texelFetch(uHulls, ivec2(1, i), 0);
  vec4 c = texelFetch(uHulls, ivec2(2, i), 0);
  vec4 d = texelFetch(uHulls, ivec2(3, i), 0);
  Hull h;
  h.c = a.xy; h.f = a.zw; h.hl = b.x; h.hb = b.y; h.v = b.zw;
  h.w = c.x; h.thrust = c.y; h.draft = c.z; h.depth = c.w;
  h.foam = d.x; h.oil = d.y; h.fire = d.z; h.kind = d.w;
  return h;
}
// local hull coords: x along forward (-1 stern .. 1 bow), y across (-1..1)
vec2 hullLocal(Hull h, vec2 p) {
  vec2 d = p - h.c;
  return vec2(dot(d, h.f) / max(h.hl, 0.01), dot(d, vec2(-h.f.y, h.f.x)) / max(h.hb, 0.01));
}
// smooth ship planform: pointed bow, rounded stern. returns 0 outside, ~1 deep inside
float hullShape(vec2 l) {
  float taper = l.x > 0.25 ? mix(1.0, 0.08, (l.x - 0.25) / 0.75) : (l.x < -0.8 ? mix(1.0, 0.55, (-l.x - 0.8) / 0.2) : 1.0);
  float wy = abs(l.y) / max(taper, 0.05);
  if (abs(l.x) > 1.0 || wy > 1.0) return 0.0;
  return (1.0 - wy * wy) * (1.0 - l.x * l.x * l.x * l.x);
}
struct Splat { vec2 p; float r; float wave; float foam; float bio; float oil; float fire; float push; };
Splat getSplat(int i) {
  vec4 a = texelFetch(uSplats, ivec2(0, i), 0);
  vec4 b = texelFetch(uSplats, ivec2(1, i), 0);
  Splat s;
  s.p = a.xy; s.r = a.z; s.wave = a.w; s.foam = b.x; s.bio = b.y;
  s.oil = max(b.z, 0.0); s.fire = max(-b.z, 0.0); s.push = b.w;
  return s;
}
`;
