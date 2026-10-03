// Stable-fluids surface current (Stam) for turbulent wakes. Hulls are moving obstacles (their
// footprint takes the rigid-body velocity), propellers push jets astern, explosions push radially.
// Vorticity confinement keeps eddies alive. The velocity field advects a "dye" texture at the
// wave-sim resolution: R = foam (white water), G = bioluminescence, B = oil slick, A = burning oil.

import { drawFullscreen, FULLSCREEN_VS, PingPong, Program, Target, type GL } from '../gfx/gl';
import { SHIFT_FS } from './waveSim';

const ADVECT_VEL_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uVel;
uniform sampler2D uF0;   // obstacle: r disp, g mask, ba velocity
uniform sampler2D uF2;   // push xy
uniform float uDt, uSize, uDiss;
uniform vec2 uTexel;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  vec2 v = texture(uVel, uv).xy;
  vec2 back = uv - v * uDt / uSize;
  vec2 nv = texture(uVel, back).xy * exp(-uDiss * uDt);
  vec4 f0 = texture(uF0, uv);
  vec2 push = texture(uF2, uv).xy;
  float m = clamp(f0.g * 1.6, 0.0, 1.0);
  vec2 obst = m > 0.001 ? f0.ba / max(f0.g, 0.001) : vec2(0.0);
  nv = mix(nv, obst, m * 0.9);
  nv += push * uDt * 2.5;
  // fade toward the edges
  vec2 e = min(uv, 1.0 - uv);
  nv *= smoothstep(0.0, 0.04, min(e.x, e.y));
  o = vec4(clamp(nv, vec2(-30.0), vec2(30.0)), 0.0, 1.0);
}`;

const CURL_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uVel;
uniform vec2 uTexel;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  float l = texture(uVel, uv - vec2(uTexel.x, 0.0)).y;
  float r = texture(uVel, uv + vec2(uTexel.x, 0.0)).y;
  float b = texture(uVel, uv - vec2(0.0, uTexel.y)).x;
  float t = texture(uVel, uv + vec2(0.0, uTexel.y)).x;
  o = vec4(0.5 * ((r - l) - (t - b)), 0.0, 0.0, 1.0);
}`;

const VORT_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uVel;
uniform sampler2D uCurl;
uniform vec2 uTexel;
uniform float uEps, uDt, uCell;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  float l = abs(texture(uCurl, uv - vec2(uTexel.x, 0.0)).x);
  float r = abs(texture(uCurl, uv + vec2(uTexel.x, 0.0)).x);
  float b = abs(texture(uCurl, uv - vec2(0.0, uTexel.y)).x);
  float t = abs(texture(uCurl, uv + vec2(0.0, uTexel.y)).x);
  float c = texture(uCurl, uv).x;
  vec2 g = vec2(r - l, t - b) * 0.5;
  float gl = length(g);
  vec2 N = gl > 1e-5 ? g / gl : vec2(0.0);
  vec2 f = uEps * vec2(N.y, -N.x) * c / max(uCell, 0.01) * 4.0;
  vec2 v = texture(uVel, uv).xy + f * uDt;
  o = vec4(v, 0.0, 1.0);
}`;

const DIV_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uVel;
uniform vec2 uTexel;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  float l = texture(uVel, uv - vec2(uTexel.x, 0.0)).x;
  float r = texture(uVel, uv + vec2(uTexel.x, 0.0)).x;
  float b = texture(uVel, uv - vec2(0.0, uTexel.y)).y;
  float t = texture(uVel, uv + vec2(0.0, uTexel.y)).y;
  o = vec4(0.5 * ((r - l) + (t - b)), 0.0, 0.0, 1.0);
}`;

const JACOBI_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uP;
uniform sampler2D uDiv;
uniform vec2 uTexel;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  float l = texture(uP, uv - vec2(uTexel.x, 0.0)).x;
  float r = texture(uP, uv + vec2(uTexel.x, 0.0)).x;
  float b = texture(uP, uv - vec2(0.0, uTexel.y)).x;
  float t = texture(uP, uv + vec2(0.0, uTexel.y)).x;
  float d = texture(uDiv, uv).x;
  o = vec4((l + r + b + t - d) * 0.25, 0.0, 0.0, 1.0);
}`;

const GRAD_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uP;
uniform sampler2D uVel;
uniform vec2 uTexel;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  float l = texture(uP, uv - vec2(uTexel.x, 0.0)).x;
  float r = texture(uP, uv + vec2(uTexel.x, 0.0)).x;
  float b = texture(uP, uv - vec2(0.0, uTexel.y)).x;
  float t = texture(uP, uv + vec2(0.0, uTexel.y)).x;
  vec2 v = texture(uVel, uv).xy - 0.5 * vec2(r - l, t - b);
  o = vec4(v, 0.0, 1.0);
}`;

const DYE_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uDye;
uniform sampler2D uVel;
uniform sampler2D uF1;   // sources
uniform float uDt, uSize;
uniform vec2 uTexel;
uniform vec2 uDrift;     // wind drift (m/s)
uniform vec4 uDecay;     // per-channel decay rates (1/s)
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  vec2 v = texture(uVel, uv).xy + uDrift;
  vec2 back = uv - v * uDt / uSize;
  vec4 d = texture(uDye, back);
  d *= exp(-uDecay * uDt);
  // burning oil consumes oil and dies without it
  float burn = d.a * 0.08 * uDt;
  d.b = max(0.0, d.b - burn);
  d.a *= d.b > 0.02 ? 1.0 : exp(-1.5 * uDt);
  vec4 src = texture(uF1, uv);
  d += src * uDt;
  vec2 e = min(uv, 1.0 - uv);
  d *= smoothstep(0.0, 0.02, min(e.x, e.y));
  o = clamp(d, vec4(0.0), vec4(2.0, 2.0, 2.0, 1.5));
}`;

export class FluidSim {
  vel: PingPong;
  pressure: PingPong;
  div: Target;
  curl: Target;
  dye: PingPong;
  enabled = true;
  nf = 256;
  nd = 768;
  vorticity = 0.6;
  iterations = 18;
  foamDecay = 1;
  drift = { x: 0, y: 0 };
  private pAdv: Program; private pCurl: Program; private pVort: Program; private pDiv: Program;
  private pJac: Program; private pGrad: Program; private pDye: Program; private pShift: Program;

  constructor(private gl: GL) {
    const L = gl.LINEAR;
    this.vel = new PingPong(gl, ['rg16f'], { filter: L });
    this.pressure = new PingPong(gl, ['r16f'], { filter: L });
    this.div = new Target(gl, ['r16f'], { filter: L });
    this.curl = new Target(gl, ['r16f'], { filter: L });
    this.dye = new PingPong(gl, ['rgba16f'], { filter: L });
    const P = (n: string, fs: string) => new Program(gl, n, FULLSCREEN_VS, fs);
    this.pAdv = P('advectVel', ADVECT_VEL_FS); this.pCurl = P('curl', CURL_FS); this.pVort = P('vort', VORT_FS);
    this.pDiv = P('div', DIV_FS); this.pJac = P('jacobi', JACOBI_FS); this.pGrad = P('grad', GRAD_FS);
    this.pDye = P('dye', DYE_FS); this.pShift = P('fshift', SHIFT_FS);
  }

  resize(nf: number, nd: number) {
    this.nf = nf; this.nd = nd;
    this.vel.resize(nf, nf); this.pressure.resize(nf, nf); this.div.resize(nf, nf); this.curl.resize(nf, nf);
    this.dye.resize(nd, nd);
    this.clear();
  }

  clear() {
    const gl = this.gl;
    for (const t of [this.vel.a, this.vel.b, this.pressure.a, this.pressure.b, this.dye.a, this.dye.b]) {
      t.bind(); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    }
  }

  /** shift by whole dye cells; velocity shifts by the matching (rounded) number of fluid cells */
  shift(dxDye: number, dyDye: number) {
    if (Math.abs(dxDye) >= this.nd || Math.abs(dyDye) >= this.nd) { this.clear(); return; }
    this.shiftPP(this.dye, dxDye, dyDye);
    const r = this.nf / this.nd;
    const fx = Math.round(dxDye * r), fy = Math.round(dyDye * r);
    if (fx || fy) { this.shiftPP(this.vel, fx, fy); this.shiftPP(this.pressure, fx, fy); }
  }
  private shiftPP(pp: PingPong, dx: number, dy: number) {
    const gl = this.gl;
    pp.write.bind();
    this.pShift.use().tex('uSrc', 0, pp.read.t);
    gl.uniform2i(this.pShift.loc('uShift'), dx, dy);
    gl.uniform2i(this.pShift.loc('uSize'), pp.read.w, pp.read.h);
    drawFullscreen(gl);
    pp.swap();
  }

  step(dt: number, size: number, force: Target) {
    if (!this.enabled) return;
    const gl = this.gl;
    gl.disable(gl.BLEND);
    dt = Math.min(dt, 1 / 20);
    const tf = 1 / this.nf, cell = size / this.nf;
    // 1. advect + obstacles + push
    this.vel.write.bind();
    this.pAdv.use().tex('uVel', 0, this.vel.read.t).tex('uF0', 1, force.tex[0]).tex('uF2', 2, force.tex[2])
      .f1('uDt', dt).f1('uSize', size).f1('uDiss', 0.08).f2('uTexel', tf, tf);
    drawFullscreen(gl);
    this.vel.swap();
    // 2. vorticity confinement
    if (this.vorticity > 0) {
      this.curl.bind();
      this.pCurl.use().tex('uVel', 0, this.vel.read.t).f2('uTexel', tf, tf);
      drawFullscreen(gl);
      this.vel.write.bind();
      this.pVort.use().tex('uVel', 0, this.vel.read.t).tex('uCurl', 1, this.curl.t).f2('uTexel', tf, tf)
        .f1('uEps', this.vorticity).f1('uDt', dt).f1('uCell', cell);
      drawFullscreen(gl);
      this.vel.swap();
    }
    // 3. projection
    this.div.bind();
    this.pDiv.use().tex('uVel', 0, this.vel.read.t).f2('uTexel', tf, tf);
    drawFullscreen(gl);
    this.pJac.use().tex('uDiv', 1, this.div.t).f2('uTexel', tf, tf);
    for (let i = 0; i < this.iterations; i++) {
      this.pressure.write.bind();
      this.pJac.tex('uP', 0, this.pressure.read.t);
      drawFullscreen(gl);
      this.pressure.swap();
    }
    this.vel.write.bind();
    this.pGrad.use().tex('uP', 0, this.pressure.read.t).tex('uVel', 1, this.vel.read.t).f2('uTexel', tf, tf);
    drawFullscreen(gl);
    this.vel.swap();
    // 4. dye
    const td = 1 / this.nd, k = 1 / Math.max(0.05, this.foamDecay);
    this.dye.write.bind();
    this.pDye.use().tex('uDye', 0, this.dye.read.t).tex('uVel', 1, this.vel.read.t).tex('uF1', 2, force.tex[1])
      .f1('uDt', dt).f1('uSize', size).f2('uTexel', td, td).f2('uDrift', this.drift.x, this.drift.y)
      .f4('uDecay', 0.028 * k, 0.16 * k, 0.0015, 0.02);
    drawFullscreen(gl);
    this.dye.swap();
  }

  get velTex() { return this.vel.read.t; }
  get dyeTex() { return this.dye.read.t; }
}
