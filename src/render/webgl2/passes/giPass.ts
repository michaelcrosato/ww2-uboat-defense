// 2D global illumination on WebGL2 (M19): the fragment-pass twin of webgpu/passes/gi.ts (keep the maths
// 1:1). Emitters (effect particles, omni lights, the game's steady fire emitters) are splatted into an
// emission grid over the occluder window; a compose pass writes the material grid and the jump-flood
// seeds (two render targets); log2(N) jump-flood passes ping-pong the seeds into a distance field; a trace
// pass marches a few noise-rotated rays per texel and blends the result with last frame's (reprojected).

import { drawFullscreen, FULLSCREEN_VS, Program, Target, makeTex, type GL } from '../gl';
import { NOISE_GLSL } from '../glsl/common';
import { MAX_GI_EMITTERS } from '../../fx';
import { MAX_LIGHTS } from '../../lights';

const COMPOSE_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uOcc, uEmit, uDye;
uniform vec4 uOccRect;   // GI window rel origin (x, y, w, h)
uniform vec4 uSim;       // sim window rel origin (x, y, size), oil gain
uniform vec2 uP;         // N, wall height
layout(location = 0) out vec4 oScene;
layout(location = 1) out vec4 oSeed;
void main() {
  float N = uP.x;
  vec2 id = floor(gl_FragCoord.xy);
  vec2 on = vec2(textureSize(uOcc, 0));
  float h = -50.0;
  for (int k = 0; k < 4; k++) {
    vec2 d = vec2(float(k & 1), float(k >> 1)) * 0.5 + 0.25;
    h = max(h, texelFetch(uOcc, ivec2((id + d) / N * on), 0).r);
  }
  vec3 e = texelFetch(uEmit, ivec2(id), 0).rgb;
  vec2 uv = (id + 0.5) / N;
  vec2 suv = (uOccRect.xy + uv * uOccRect.zw - uSim.xy) / uSim.z;
  if (all(greaterThan(suv, vec2(0.0))) && all(lessThan(suv, vec2(1.0)))) {
    e += vec3(2.4, 1.0, 0.28) * clamp(texture(uDye, suv).a, 0.0, 2.0) * uSim.w;
  }
  vec4 m = vec4(0.0);
  if (max(e.r, max(e.g, e.b)) > 0.015) m = vec4(e, 1.0);
  else if (h > uP.y) m = vec4(0.5, 0.48, 0.45, 2.0);
  oScene = m;
  oSeed = m.a > 0.5 ? vec4(id, 1.0, 0.0) : vec4(-1.0, -1.0, 0.0, 0.0);
}`;

const JFA_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform float uJump;
out vec4 o;
void main() {
  ivec2 size = textureSize(uSrc, 0);
  ivec2 p = ivec2(gl_FragCoord.xy);
  int k = int(uJump);
  vec4 best = vec4(-1.0, -1.0, 0.0, 0.0);
  float bestD = 1e9;
  for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
    ivec2 q = p + ivec2(dx, dy) * k;
    if (q.x < 0 || q.y < 0 || q.x >= size.x || q.y >= size.y) continue;
    vec4 s = texelFetch(uSrc, q, 0);
    if (s.z < 0.5) continue;
    float d = distance(s.xy, vec2(p));
    if (d < bestD) { bestD = d; best = s; }
  }
  o = best;
}`;

const TRACE_FS = /* glsl */ `#version 300 es
precision highp float;
${NOISE_GLSL}
uniform sampler2D uScene, uJfa, uPrev;
uniform vec4 uP0;    // N, reach (m, light halves), frame, rays
uniform vec4 uP1;    // steps, bounce, blend, ray clamp
uniform vec4 uCur;   // window abs (x, y, span)
uniform vec4 uPrevW; // previous window abs (x, y, span, valid)
out vec4 o;
const float TAU = 6.2831853;
vec4 prevAt(vec2 q) {
  if (uPrevW.w < 0.5) return vec4(0.0);
  vec2 w = uCur.xy + q / uP0.x * uCur.z;
  vec2 uv = (w - uPrevW.xy) / uPrevW.z;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec4(0.0);
  return texture(uPrev, uv);
}
vec3 traceRay(vec2 p, vec2 dir, float N) {
  float t = 0.75;
  int steps = int(uP1.x);
  for (int i = 0; i < 64; i++) {
    if (i >= steps) break;
    vec2 q = p + dir * t;
    if (q.x < 0.0 || q.y < 0.0 || q.x >= N || q.y >= N) return vec3(0.0);
    vec4 s = texelFetch(uJfa, ivec2(q), 0);
    if (s.z < 0.5) return vec3(0.0);
    float d = length(s.xy + 0.5 - q);
    if (d < 1.0) {
      // falls off as over a ground plane, not as in flatland (see the WGSL twin)
      float tm = t * uCur.z / N / uP0.y, fall = 1.0 / (1.0 + tm * tm);
      vec4 m = texelFetch(uScene, ivec2(s.xy), 0);
      if (m.a < 1.5) return min(m.rgb, vec3(uP1.w)) * fall;
      return m.rgb * prevAt(q - dir * 1.5).rgb * uP1.y * fall;
    }
    t += max(d - 0.75, 0.75);
  }
  return vec3(0.0);
}
void main() {
  float N = uP0.x;
  vec2 p = floor(gl_FragCoord.xy) + 0.5;
  vec4 here = texelFetch(uScene, ivec2(p), 0);
  vec4 raw = vec4(0.0);
  if (here.a < 0.5) {
    int n = int(uP0.w);
    float jitter = fract(hash12(p * 0.73 + vec2(17.0, 3.0)) + uP0.z * 0.61803398875);
    vec3 sum = vec3(0.0);
    for (int r = 0; r < 32; r++) {
      if (r >= n) break;
      float a = (float(r) + jitter) / float(n) * TAU;
      sum += traceRay(p, vec2(cos(a), sin(a)), N);
    }
    raw = vec4(sum / float(n), 1.0);
  } else if (here.a < 1.5) {
    raw = vec4(here.rgb * 0.5, 1.0);
  }
  vec4 old = prevAt(p);
  o = uPrevW.w > 0.5 ? mix(old, raw, uP1.z) : raw;
}`;

/** omni lights (lights texture, 4 texels per light) and steady emitters (same layout) as soft discs */
const LIGHT_VS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uLights;
uniform vec4 uOccRect;
uniform float uGain;
out vec2 vC; flat out vec3 vCol;
const vec2 CS[6] = vec2[6](vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0), vec2(-1.0, 1.0), vec2(1.0, -1.0), vec2(1.0, 1.0));
void main() {
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  int i = gl_InstanceID;
  vec4 l0 = texelFetch(uLights, ivec2(0, i), 0), l1 = texelFetch(uLights, ivec2(1, i), 0);
  vec4 l2 = texelFetch(uLights, ivec2(2, i), 0), l3 = texelFetch(uLights, ivec2(3, i), 0);
  if (l2.w > -1.5) return;
  vec2 c = CS[gl_VertexID % 6];
  float r = clamp(l3.w * 2.0 + l0.w * 0.06, 3.0, 18.0);
  vec2 uv = (l0.xy - uOccRect.xy) / uOccRect.zw;
  gl_Position = vec4(uv * 2.0 - 1.0 + c * (r / uOccRect.z * 2.0), 0.0, 1.0);
  vC = c;
  vCol = l1.rgb * l1.w * uGain / (1.0 + r * 0.15);
}`;
const LIGHT_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vC; flat in vec3 vCol;
out vec4 o;
void main() {
  float d = dot(vC, vC);
  if (d > 1.0) discard;
  o = vec4(vCol * (1.0 - d * d), 0.0);
}`;

export interface GiFrameGL {
  N: number; wallH: number; frame: number; rays: number; steps: number; bounce: number; blend: number; lightGain: number; clamp: number; reach: number;
  occRel: [number, number, number, number]; cur: [number, number, number]; prev: [number, number, number] | null;
  sim: [number, number, number]; oilGain: number;
  lightTex: WebGLTexture; lightCount: number;
  emitters: Float32Array<ArrayBuffer>; emitterCount: number;
}

export class GiPassGL {
  private compose: Program; private jfa: Program; private trace: Program; private lights: Program;
  private emit: Target; private scene: Target;
  private seed: Target[]; private rad: Target[];
  private emitterTex: WebGLTexture;
  private N = 0;
  /** which accumulation target holds this frame's light */
  cur = 0;

  constructor(private gl: GL) {
    this.compose = new Program(gl, 'gi.compose', FULLSCREEN_VS, COMPOSE_FS);
    this.jfa = new Program(gl, 'gi.jfa', FULLSCREEN_VS, JFA_FS);
    this.trace = new Program(gl, 'gi.trace', FULLSCREEN_VS, TRACE_FS);
    this.lights = new Program(gl, 'gi.lights', LIGHT_VS, LIGHT_FS);
    this.emit = new Target(gl, ['rgba16f']);
    this.scene = new Target(gl, ['rgba16f', 'rgba16f']);
    this.seed = [new Target(gl, ['rgba16f']), new Target(gl, ['rgba16f'])];
    this.rad = [new Target(gl, ['rgba16f'], { filter: gl.LINEAR }), new Target(gl, ['rgba16f'], { filter: gl.LINEAR })];
    this.emitterTex = makeTex(gl, 4, MAX_GI_EMITTERS, { internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT });
  }

  /** this frame's accumulated light (the lighting pass samples it) */
  get tex(): WebGLTexture | null { return this.N ? this.rad[this.cur].t : null; }

  private resize(N: number) {
    if (N === this.N) return;
    this.N = N;
    this.emit.resize(N, N); this.scene.resize(N, N);
    for (const t of [...this.seed, ...this.rad]) t.resize(N, N);
    // fresh accumulation targets start dark
    const gl = this.gl;
    for (const t of this.rad) { t.bind(); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
  }

  /** the whole GI frame; the caller then samples `tex`. drawFx splats the effect particles (FxGL.drawEmit) */
  render(f: GiFrameGL, occTex: WebGLTexture, dyeTex: WebGLTexture | null, drawFx: () => void) {
    const gl = this.gl;
    this.resize(f.N);
    this.cur = 1 - this.cur;
    // ---- emitters, added up
    this.emit.bind();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    drawFx();
    const lp = this.lights.use().f4('uOccRect', ...f.occRel).f1('uGain', f.lightGain);
    if (f.lightCount > 0) { lp.tex('uLights', 0, f.lightTex); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, Math.min(f.lightCount, MAX_LIGHTS)); }
    if (f.emitterCount > 0) {
      gl.bindTexture(gl.TEXTURE_2D, this.emitterTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 4, f.emitterCount, gl.RGBA, gl.FLOAT, f.emitters);
      lp.tex('uLights', 0, this.emitterTex);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, f.emitterCount);
    }
    gl.disable(gl.BLEND);
    // ---- material grid + seeds
    this.scene.bind();
    this.compose.use().tex('uOcc', 0, occTex).tex('uEmit', 1, this.emit.t).tex('uDye', 2, dyeTex)
      .f4('uOccRect', ...f.occRel).f4('uSim', f.sim[0], f.sim[1], f.sim[2], f.oilGain).f2('uP', f.N, f.wallH);
    drawFullscreen(gl);
    // ---- jump flood: the seeds start in the compose target's second attachment
    let src: WebGLTexture = this.scene.tex[1], k = 0;
    for (let j = f.N >> 1; j >= 1; j >>= 1, k++) {
      const dst = this.seed[k & 1];
      dst.bind();
      this.jfa.use().tex('uSrc', 0, src).f1('uJump', j);
      drawFullscreen(gl);
      src = dst.t;
    }
    // ---- trace + history
    this.rad[this.cur].bind();
    this.trace.use().tex('uScene', 0, this.scene.tex[0]).tex('uJfa', 1, src).tex('uPrev', 2, this.rad[1 - this.cur].t)
      .f4('uP0', f.N, f.reach, f.frame, f.rays).f4('uP1', f.steps, f.bounce, f.blend, f.clamp)
      .f4('uCur', f.cur[0], f.cur[1], f.cur[2], 0)
      .f4('uPrevW', f.prev ? f.prev[0] : 0, f.prev ? f.prev[1] : 0, f.prev ? f.prev[2] : 1, f.prev ? 1 : 0);
    drawFullscreen(gl);
  }

  dispose() {
    const gl = this.gl;
    this.emit.dispose(); this.scene.dispose();
    for (const t of [...this.seed, ...this.rad]) t.dispose();
    gl.deleteTexture(this.emitterTex);
    for (const p of [this.compose, this.jfa, this.trace, this.lights]) gl.deleteProgram(p.prog);
  }
}
