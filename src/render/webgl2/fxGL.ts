// GPU effect particles on WebGL2 (M18, render/fx.ts): the WebGPU compute pass done with transform
// feedback. Two ping-pong vertex buffers hold the ring slots; new particles are written into the current
// one, an update program (rasterizer off) integrates every slot into the other, and the result is drawn
// as instanced quads into the lit buffer, depth-tested against the G-buffer, plus smoke into the occluder
// map. The maths mirrors webgpu/passes/fx.ts line for line (WebGL2 is best effort: same look, fewer slots).

import { CAMERA_GLSL, NOISE_GLSL } from './glsl/common';
import { Program, type GL } from './gl';
import { FX_FLOATS, FX_KINDS, FX_MOTION, type FxSystem } from '../fx';

const motion = () => `const vec4 MOTION[${FX_KINDS * 2}] = vec4[${FX_KINDS * 2}](${FX_MOTION.map((m) =>
  `vec4(${m.buoy.toFixed(3)}, ${m.drag.toFixed(3)}, ${m.grav.toFixed(3)}, ${m.curl.toFixed(3)}), vec4(${m.wind.toFixed(3)}, ${m.water.toFixed(1)}, 0.0, 0.0)`).join(', ')});`;

const VN = /* glsl */ `
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}`;

const SIM_VS = /* glsl */ `#version 300 es
precision highp float;
${NOISE_GLSL}
${VN}
${motion()}
layout(location = 0) in vec4 aA;   // pos, age
layout(location = 1) in vec4 aB;   // vel, life
layout(location = 2) in vec4 aC;   // size0, size1, seed, kind
layout(location = 3) in vec4 aD;   // tint, heat
uniform vec4 uP;     // dt, time
uniform vec2 uWind;
out vec4 vA; out vec4 vB; out vec4 vC; out vec4 vD;
vec2 curl2(vec2 p) {
  float e = 0.35;
  return vec2(vn(p + vec2(0.0, e)) - vn(p - vec2(0.0, e)), -(vn(p + vec2(e, 0.0)) - vn(p - vec2(e, 0.0)))) / (2.0 * e);
}
void main() {
  vA = aA; vB = aB; vC = aC; vD = aD;
  if (aA.w >= aB.w) return;
  float dt = uP.x;
  int kind = int(aC.w + 0.5);
  vec4 m0 = MOTION[kind * 2], m1 = MOTION[kind * 2 + 1];
  float t = aA.w / max(aB.w, 1e-3);
  vec3 acc = vec3(0.0, 0.0, -m0.z + m0.x * (1.0 - t) * (1.0 - t));
  if (m0.w > 0.0) {
    vec2 q = aA.xy * 0.05 + vec2(aC.z * 37.0, uP.y * 0.11 + aC.z * 11.0);
    acc += vec3(curl2(q) * m0.w, (vn(q * 1.7 + 5.3) - 0.5) * m0.w * 0.6);
  }
  acc += vec3((uWind - aB.xy) * m1.x * 0.6, 0.0);
  vec3 v = (aB.xyz + acc * dt) * exp(-m0.y * dt);
  vec3 pos = aA.xyz + v * dt;
  float age = min(aA.w + dt, aB.w);
  if (pos.z < 0.0 && v.z < 0.0) {
    if (m1.y > 1.5) { pos.z = 0.0; v = vec3(v.xy * 0.2, 0.0); }
    else if (m1.y > 0.5) { age = aB.w; }
  }
  vA = vec4(pos, age); vB = vec4(v, aB.w);
}`;
const SIM_FS = /* glsl */ `#version 300 es
precision mediump float;
out vec4 o;
void main() { o = vec4(0.0); }`;

const LOOK = /* glsl */ `
uniform vec4 uO;      // origin x, y, maxPx, time
uniform vec4 uLight;  // smoke light rgb
uniform vec4 uOccRect;
uniform vec4 uQ;      // occScale, occRes, intensity
uniform vec4 uGi;     // GI emission: giScale texels/m, giRes, gain, min size m
vec3 fireRamp(float k) {
  vec3 a = vec3(3.4, 2.4, 1.1), b = vec3(2.2, 0.85, 0.18), c = vec3(0.7, 0.14, 0.03);
  return k < 0.5 ? mix(c, b, k * 2.0) : mix(b, a, (k - 0.5) * 2.0);
}
// colour+alpha, additive share and size (m) by kind and age (see webgpu/passes/fx.ts)
void look(vec4 A, vec4 C, vec4 D, float t, out vec4 col, out float add, out float size) {
  int kind = int(C.w + 0.5);
  float heat = D.w;
  float flick = hash12(vec2(C.z * 91.7, floor(uO.w * 24.0)));
  vec3 c = vec3(1.0); float a = 1.0; add = 1.0; size = mix(C.x, C.y, sqrt(t));
  float fadeOut = 1.0 - smoothstep(0.6, 1.0, t);
  if (kind == 0) {
    float burn = heat * (1.0 - smoothstep(0.04, 0.38, t));
    c = mix(D.rgb * 0.2 * uLight.rgb, fireRamp(burn), smoothstep(0.05, 0.4, burn));
    add = 0.75 * smoothstep(0.15, 0.55, burn);
    a = smoothstep(0.0, 0.04, t) * (1.0 - t * t * t) * mix(0.8, 1.0, add);
  } else if (kind == 1) {
    c = mix(vec3(5.0, 2.2, 0.5), vec3(1.4, 0.22, 0.04), t) * (0.55 + 0.7 * flick);
    a = smoothstep(0.0, 0.08, t) * fadeOut; size = C.x;
  } else if (kind == 2) {
    c = fireRamp(1.0 - t * 1.1) * 1.3; a = 1.0 - t * t; size = C.x;
  } else if (kind == 3) {
    c = D.rgb * 0.22 * uLight.rgb + vec3(2.6, 0.9, 0.2) * heat * pow(max(1.0 - A.w * 1.4, 0.0), 3.0);
    add = 0.0; a = 0.82 * smoothstep(0.0, 0.12, t) * fadeOut;
  } else if (kind == 4) {
    c = vec3(9.0, 7.5, 5.0) * heat; a = (1.0 - t) * (1.0 - t); size = mix(C.x, C.y, min(1.0, t * 3.0));
  } else if (kind == 5) {
    c = D.rgb * uLight.rgb * 0.8; add = 0.0; a = 0.9 * fadeOut;
  } else if (kind == 6) {
    float glow = heat * max(1.0 - t * 3.0, 0.0);
    c = mix(D.rgb * uLight.rgb * 0.5, fireRamp(0.6) * 0.8, glow); add = glow; a = 1.0; size = C.x;
  } else if (kind == 7) {
    c = D.rgb * uLight.rgb * 0.75; add = 0.0; a = 0.5 * smoothstep(0.0, 0.1, t) * fadeOut;
  } else if (kind == 8) {
    float core = 1.0 - smoothstep(0.0, 0.15, A.w);
    c = mix(vec3(0.035, 0.032, 0.03) * uLight.rgb, vec3(6.0, 3.2, 1.0), core); add = core;
    a = 0.92 * (1.0 - smoothstep(0.55, 1.0, t)); size = mix(C.x, C.y, min(1.0, t * 5.0));
  } else if (kind == 9) {
    c = vec3(0.9, 0.95, 1.0) * heat * (1.0 - t) * (1.0 - t) * 0.6; a = 1.0; size = C.y * (1.0 - pow(1.0 - t, 2.5));
  } else {
    c = D.rgb * uLight.rgb * 0.6; add = 0.0; a = 0.7 * smoothstep(0.0, 0.1, t) * fadeOut;
  }
  col = vec4(c, a);
}`;

const DRAW_VS = /* glsl */ `#version 300 es
precision highp float;
${CAMERA_GLSL}
${NOISE_GLSL}
${LOOK}
layout(location = 0) in vec4 aA;
layout(location = 1) in vec4 aB;
layout(location = 2) in vec4 aC;
layout(location = 3) in vec4 aD;
uniform highp int uOcc;
out vec2 vUv; flat out vec4 vCol; flat out vec4 vInfo;
const vec2 CORNERS[6] = vec2[6](vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0), vec2(-1.0, 1.0), vec2(1.0, -1.0), vec2(1.0, 1.0));
void main() {
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  if (aA.w >= aB.w) return;
  float t = clamp(aA.w / max(aB.w, 1e-3), 0.0, 1.0);
  vec4 col; float add, size;
  look(aA, aC, aD, t, col, add, size);
  int kind = int(aC.w + 0.5);
  vec2 c = CORNERS[gl_VertexID % 6];
  vUv = c; vCol = col; vInfo = vec4(add, float(kind), aC.z, t);
  vec2 rel = aA.xy - uO.xy;
  if (uOcc == 1) {
    if (!(kind == 0 || kind == 3 || kind == 7 || kind == 8 || kind == 10) || add > 0.5) return;
    vec2 uv = (rel - uOccRect.xy) / uOccRect.zw;
    float s = max(1.0, size * uQ.x) / uQ.y;
    gl_Position = vec4(uv * 2.0 - 1.0 + c * s, 0.0, 1.0);
    return;
  }
  if (uOcc == 2) {
    // hot particles splat their light into the GI grid (see webgpu/passes/fx.ts vsFxEmit)
    if (kind == 1 || kind == 2 || kind == 3 || kind == 5 || kind == 7 || kind == 9 || kind == 10) return;
    vec3 hot = col.rgb * col.a * add;
    if (max(hot.r, max(hot.g, hot.b)) < 0.01) return;
    vec2 uv = (rel - uOccRect.xy) / uOccRect.zw;
    float sz = max(size, uGi.w);
    gl_Position = vec4(uv * 2.0 - 1.0 + c * (sz * uGi.x / uGi.y), 0.0, 1.0);
    vCol = vec4(hot * (size * size) / (sz * sz) * uGi.z, 1.0);
    return;
  }
  if (kind == 9) {
    gl_Position = worldToClip(vec3(rel + c * max(size, 0.5), aA.z));
    return;
  }
  vec4 clip = worldToClip(vec3(rel, aA.z));
  float px = clamp(size * uCam.z, 1.0, uO.z);
  vec2 ax = vec2(1.0, 0.0), half_ = vec2(px * 0.5 + 0.5);
  if (kind == 2) {
    vec2 sv = vec2(aB.x, aB.y * uTilt.x - aB.z * uTilt.y) * uCam.z;
    float sp = length(sv);
    if (sp > 0.5) { ax = sv / sp; half_.x += min(sp * 0.035, 10.0); }
  }
  vec2 ay = vec2(-ax.y, ax.x);
  vec2 off = ax * c.x * half_.x + ay * c.y * half_.y;
  // internal passes are y-down in buffer pixels: clip y grows with buffer y
  clip.xy += off * 2.0 / uBuf;
  gl_Position = clip;
}`;

const DRAW_FS = /* glsl */ `#version 300 es
precision highp float;
${NOISE_GLSL}
${VN}
uniform vec4 uQ;
uniform highp int uOcc;
in vec2 vUv; flat in vec4 vCol; flat in vec4 vInfo;
out vec4 o;
float bayer4(vec2 p) {
  ivec2 q = ivec2(mod(p, 4.0));
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[q.y * 4 + q.x]) + 0.5) / 16.0;
}
void main() {
  if (uOcc == 1) {
    float r = dot(vUv, vUv);
    if (r > 1.0) discard;
    o = vec4(-50.0, 0.0, 0.0, vCol.a * (1.0 - r) * 0.9);
    return;
  }
  if (uOcc == 2) {
    float r = dot(vUv, vUv);
    if (r > 1.0) discard;
    o = vec4(vCol.rgb * (1.0 - r) * 2.0, 0.0);
    return;
  }
  int kind = int(vInfo.y + 0.5);
  float r = length(vUv), shape;
  vec3 rgb = vCol.rgb;
  if (kind == 9) { float x = (r - 0.93) / 0.035; shape = exp(-x * x) * 0.3; }
  else {
    float n = vn(vUv * 2.3 + vec2(vInfo.z * 47.0, vInfo.w * 2.0)) * 0.6 + vn(vUv * 5.1 + vInfo.z * 13.0) * 0.4;
    shape = smoothstep(0.15, 0.6, (1.0 - smoothstep(0.35, 1.0, r)) * (0.35 + 0.9 * n));
    if (kind == 2 || kind == 1) shape = 1.0 - smoothstep(0.3, 1.0, r);
    rgb *= mix((0.8 - 0.3 * vUv.y) * (0.8 + 0.4 * n), 1.0, vInfo.x);
  }
  float a = clamp(vCol.a * shape, 0.0, 1.0);
  a = floor(a * 4.0 + bayer4(gl_FragCoord.xy)) * 0.25;
  if (a <= 0.0) discard;
  o = vec4(rgb * a * uQ.z, a * (1.0 - vInfo.x));
}`;

export class FxGL {
  static readonly CAP = 16384;
  private bufs: WebGLBuffer[] = [];
  private vaos: WebGLVertexArrayObject[] = [];
  private tf: WebGLTransformFeedback;
  private cur = 0;
  private count = 0;
  readonly sim: Program;
  readonly draw: Program;
  private fb: WebGLFramebuffer | null = null;
  private fbKey = '';

  constructor(private gl: GL) {
    this.sim = new Program(gl, 'fx.sim', SIM_VS, SIM_FS, ['vA', 'vB', 'vC', 'vD']);
    this.draw = new Program(gl, 'fx.draw', DRAW_VS, DRAW_FS);
    const bytes = FxGL.CAP * FX_FLOATS * 4;
    for (let k = 0; k < 2; k++) {
      const b = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.DYNAMIC_COPY);
      this.bufs.push(b);
      // one VAO per buffer: per-vertex for the update, per-instance for the draw
      for (const div of [0, 1]) {
        const vao = gl.createVertexArray()!;
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        for (let i = 0; i < 4; i++) {
          gl.enableVertexAttribArray(i);
          gl.vertexAttribPointer(i, 4, gl.FLOAT, false, FX_FLOATS * 4, i * 16);
          gl.vertexAttribDivisor(i, div);
        }
        this.vaos[k * 2 + div] = vao;
      }
    }
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.tf = gl.createTransformFeedback()!;
  }

  /** upload this frame's new particles, then integrate every slot into the other buffer */
  simulate(fx: FxSystem, dt: number, time: number, wind: { x: number; y: number }) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufs[this.cur]);
    for (const r of fx.runs) gl.bufferSubData(gl.ARRAY_BUFFER, r.slot * FX_FLOATS * 4, fx.staged, r.src * FX_FLOATS, r.n * FX_FLOATS);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    fx.consumed();
    this.count = fx.used;
    if (!this.count || dt <= 0) return;
    // long frames run in substeps of at most 1/10 s
    const n = Math.ceil(dt / 0.1);
    this.sim.use().f4('uP', dt / n, time, 0, 0).f2('uWind', wind.x, wind.y);
    for (let i = 0; i < n; i++) this.step();
  }

  private step() {
    const gl = this.gl;
    const next = 1 - this.cur;
    gl.bindVertexArray(this.vaos[this.cur * 2]);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.tf);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.bufs[next]);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, this.count);
    gl.endTransformFeedback();
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindVertexArray(null);
    this.cur = next;
  }

  /** set the draw uniforms (camera uniforms are set by the caller) */
  uniforms(ox: number, oy: number, time: number, maxPx: number, light: [number, number, number], occRel: [number, number, number, number], occRes: number, intensity: number) {
    this.draw.use().f4('uO', ox, oy, maxPx, time).f4('uLight', light[0], light[1], light[2], 0)
      .f4('uOccRect', ...occRel).f4('uQ', occRes / occRel[2], occRes, intensity, 0);
  }

  /** GI emission parameters (texels per metre and size of the GI grid, light gain, minimum splat size m) */
  setGi(giScale: number, giRes: number, gain: number, minSize: number) {
    this.draw.use().f4('uGi', giScale, giRes, gain, minSize);
  }

  /** splat hot particles' light into the GI emission grid (caller binds it, with additive blending) */
  drawEmit() {
    if (!this.count) return;
    const gl = this.gl;
    this.draw.use().i1('uOcc', 2);
    gl.bindVertexArray(this.vaos[this.cur * 2 + 1]);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count);
    gl.bindVertexArray(null);
  }

  /** draw into the occluder map (caller binds it and its MAX/ADD blending) */
  drawOcc() {
    if (!this.count) return;
    const gl = this.gl;
    this.draw.use().i1('uOcc', 1);
    gl.bindVertexArray(this.vaos[this.cur * 2 + 1]);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count);
    gl.bindVertexArray(null);
  }

  /** draw into the lit buffer, depth-tested against the G-buffer's depth */
  drawLit(litTex: WebGLTexture, depth: WebGLRenderbuffer | null, w: number, h: number) {
    if (!this.count || !depth) return;
    const gl = this.gl;
    const key = `${w}x${h}`;
    if (!this.fb || this.fbKey !== key || this.fbTex !== litTex || this.fbDepth !== depth) {
      if (this.fb) gl.deleteFramebuffer(this.fb);
      this.fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, litTex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      this.fbKey = key; this.fbTex = litTex; this.fbDepth = depth;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.viewport(0, 0, w, h);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.depthFunc(gl.LESS);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    this.draw.use().i1('uOcc', 0);
    gl.bindVertexArray(this.vaos[this.cur * 2 + 1]);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.disable(gl.DEPTH_TEST);
  }
  private fbTex: WebGLTexture | null = null;
  private fbDepth: WebGLRenderbuffer | null = null;

  dispose() {
    const gl = this.gl;
    for (const b of this.bufs) gl.deleteBuffer(b);
    for (const v of this.vaos) gl.deleteVertexArray(v);
    gl.deleteTransformFeedback(this.tf);
    if (this.fb) gl.deleteFramebuffer(this.fb);
  }
}
