// Bloom, grading and the final integer-scaled present.
// The lit image is (W+2) x (H+2) internal pixels; present maps each device pixel to a buffer
// pixel with the camera's sub-pixel remainder applied as a whole-device-pixel shift, so the world
// scrolls smoothly while every game pixel stays a crisp S x S block.

import { drawFullscreen, FULLSCREEN_VS, Program, Target, type GL } from '../gl';
import { NOISE_GLSL } from '../glsl/common';
import { POST_HEAT, POST_RINGS, POST_SHAFTS, type PostParams } from '../../common/post';

// light shafts: march from each pixel toward a bright source through the bright buffer (see webgpu/passes/post.ts)
const SHAFTS_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uCount;
uniform vec4 uSrcs[${POST_SHAFTS}];
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  vec3 acc = vec3(0.0);
  for (int s = 0; s < ${POST_SHAFTS}; s++) {
    if (float(s) >= uCount) break;
    vec4 L = uSrcs[s];
    vec2 st = (L.xy - uv) / 28.0;
    vec2 p = uv; float w = 1.0; vec3 sum = vec3(0.0);
    for (int k = 0; k < 28; k++) { p += st; sum += texture(uSrc, p).rgb * w; w *= 0.94; }
    acc += sum * L.z / 28.0;
  }
  o = vec4(acc, 1.0);
}`;

const BRIGHT_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uTexel;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  vec3 c = texture(uSrc, uv).rgb;
  float l = max(c.r, max(c.g, c.b));
  o = vec4(c * smoothstep(0.85, 1.6, l), 1.0);
}`;

const BLUR_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uDir;
uniform vec2 uTexel;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  float w[5] = float[5](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  vec3 c = texture(uSrc, uv).rgb * w[0];
  for (int i = 1; i < 5; i++) {
    c += texture(uSrc, uv + uDir * uTexel * float(i) * 1.5).rgb * w[i];
    c += texture(uSrc, uv - uDir * uTexel * float(i) * 1.5).rgb * w[i];
  }
  o = vec4(c, 1.0);
}`;

const PRESENT_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uLit, uBloom, uShafts;
uniform vec2 uDevice, uShift, uBuf, uView;
uniform float uS, uBloomAmt, uVignette, uGrain, uScan, uTime, uFlash;
uniform vec3 uFlashCol;
uniform int uGrade;
uniform vec4 uFx;   // chroma, ringCount, heatCount, shaftAmt
uniform vec4 uRings[${POST_RINGS}];
uniform vec4 uHeat[${POST_HEAT}];
out vec4 o;
${NOISE_GLSL}
vec3 fetchB(vec2 b) { return texelFetch(uLit, ivec2(clamp(floor(b), vec2(0.0), uBuf - 1.0)), 0).rgb; }
void main() {
  vec2 d = vec2(gl_FragCoord.x, uDevice.y - gl_FragCoord.y);
  vec2 bp = (d + uShift) / uS + 1.0;
  vec2 off = vec2(0.0);
  for (int k = 0; k < ${POST_RINGS}; k++) {
    if (float(k) >= uFx.y) break;
    vec4 r = uRings[k];
    vec2 dv = bp - r.xy;
    float dist = max(length(dv), 1e-3), th = 2.5 + r.z * 0.1, x = (dist - r.z) / th;
    off += (dv / dist) * r.w * x * exp(-x * x);
  }
  for (int k = 0; k < ${POST_HEAT}; k++) {
    if (float(k) >= uFx.z) break;
    vec4 h = uHeat[k];
    vec2 q = (bp - h.xy) / vec2(h.z, h.z * 2.2) + vec2(0.0, 0.55);
    float fall = exp(-dot(q, q) * 1.6);
    if (fall > 0.01) off += (vec2(vnoise(bp * 0.31 + vec2(0.0, uTime * 4.0)), vnoise(bp * 0.29 + vec2(17.0, uTime * 3.3))) - 0.5) * fall * h.w * 3.0;
  }
  vec2 b = bp + off;
  vec3 c;
  if (uFx.x > 0.05) { vec2 dir = normalize(b - uBuf * 0.5 + vec2(1e-3)) * uFx.x; c = vec3(fetchB(b + dir).r, fetchB(b).g, fetchB(b - dir).b); }
  else c = fetchB(b);
  vec2 uvb = (floor(clamp(b, vec2(0.0), uBuf - 1.0)) + 0.5) / uBuf;
  c += texture(uBloom, uvb).rgb * uBloomAmt;
  c += texture(uShafts, uvb).rgb * uFx.w;
  float l = dot(c, vec3(0.3, 0.55, 0.15));
  if (uGrade == 2) c = mix(vec3(0.16, 0.1, 0.06), vec3(1.0, 0.9, 0.72), clamp(l * 1.05, 0.0, 1.2));
  else if (uGrade == 3) { c = mix(vec3(l), c, 1.4); c = (c - 0.5) * 1.12 + 0.5 + vec3(0.02, 0.0, -0.02); }
  else if (uGrade == 4) c = mix(c, vec3(l * 1.3, l * 0.16, l * 0.1), 0.78);
  else if (uGrade == 5) { float m = (l - 0.5) * 1.15 + 0.5; c = vec3(m); }
  else if (uGrade == 1) c = mix(vec3(l), c, 0.92);
  c += uFlashCol * uFlash;
  vec2 uv = d / uDevice;
  vec2 q = uv - 0.5;
  c *= 1.0 - uVignette * smoothstep(0.25, 0.75, length(q * vec2(1.0, uDevice.y / uDevice.x) * 1.15));
  if (uGrain > 0.0) c += (hash12(floor(b) + floor(uTime * 24.0) * 13.7) - 0.5) * 0.06 * uGrain;
  if (uScan > 0.0 && uS >= 2.0 && mod(d.y + uShift.y, uS) >= uS - 1.0) c *= 1.0 - uScan * 0.5;
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export class PostPass {
  bright: Target; blurA: Target; blurB: Target; shafts: Target;
  private pBright: Program; private pBlur: Program; private pPresent: Program; private pShafts: Program;
  private shaftsOn = false;
  constructor(private gl: GL) {
    this.bright = new Target(gl, ['rgba16f'], { filter: gl.LINEAR });
    this.blurA = new Target(gl, ['rgba16f'], { filter: gl.LINEAR });
    this.blurB = new Target(gl, ['rgba16f'], { filter: gl.LINEAR });
    this.shafts = new Target(gl, ['rgba16f'], { filter: gl.LINEAR });
    this.pShafts = new Program(gl, 'shafts', FULLSCREEN_VS, SHAFTS_FS);
    this.pBright = new Program(gl, 'bright', FULLSCREEN_VS, BRIGHT_FS);
    this.pBlur = new Program(gl, 'blur', FULLSCREEN_VS, BLUR_FS);
    this.pPresent = new Program(gl, 'present', FULLSCREEN_VS, PRESENT_FS);
  }
  resize(bw: number, bh: number) {
    const w = Math.max(1, Math.ceil(bw / 2)), h = Math.max(1, Math.ceil(bh / 2));
    this.bright.resize(w, h); this.blurA.resize(w, h); this.blurB.resize(w, h); this.shafts.resize(w, h);
  }
  /** bloom chain, plus the light shafts when a bright source is on screen */
  bloom(lit: WebGLTexture, amount: number, o?: PostParams) {
    const gl = this.gl;
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    const shafts = !!o && o.shaftCount > 0 && o.shaftAmt > 0;
    const clear = (t: Target) => { t.bind(); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); };
    if (!shafts && this.shaftsOn) { clear(this.shafts); this.shaftsOn = false; }
    if (amount <= 0 && !shafts) { clear(this.blurB); return; }
    const tw = 1 / this.bright.w, th = 1 / this.bright.h;
    this.bright.bind();
    this.pBright.use().tex('uSrc', 0, lit).f2('uTexel', tw, th);
    drawFullscreen(gl);
    if (amount > 0) {
      this.blurA.bind();
      this.pBlur.use().tex('uSrc', 0, this.bright.t).f2('uDir', 1, 0).f2('uTexel', tw, th);
      drawFullscreen(gl);
      this.blurB.bind();
      this.pBlur.tex('uSrc', 0, this.blurA.t).f2('uDir', 0, 1);
      drawFullscreen(gl);
    } else clear(this.blurB);
    if (shafts) {
      this.shafts.bind();
      this.pShafts.use().tex('uSrc', 0, this.bright.t).f2('uTexel', tw, th).f1('uCount', o.shaftCount).v4a('uSrcs', o.shafts);
      drawFullscreen(gl);
      this.shaftsOn = true;
    }
  }
  present(o: PostParams & { lit: WebGLTexture }) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, o.pw, o.ph);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    this.pPresent.use().tex('uLit', 0, o.lit).tex('uBloom', 1, this.blurB.t).tex('uShafts', 2, this.shafts.t)
      .f2('uDevice', o.pw, o.ph).f2('uShift', o.shiftX, o.shiftY).f2('uBuf', o.bw, o.bh).f1('uS', o.S)
      .f1('uBloomAmt', o.bloom).f1('uVignette', o.vignette).f1('uGrain', o.grain).f1('uScan', o.scan).f1('uTime', o.time)
      .i1('uGrade', o.grade).f1('uFlash', o.flash).f3('uFlashCol', o.flashCol[0], o.flashCol[1], o.flashCol[2])
      .f4('uFx', o.chroma, o.ringCount, o.heatCount, this.shaftsOn ? o.shaftAmt : 0).v4a('uRings', o.rings).v4a('uHeat', o.heat);
    drawFullscreen(gl);
  }
}
