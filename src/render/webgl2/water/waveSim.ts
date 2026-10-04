// Interactive water on the GPU.
//  1. Forcing raster: every hull footprint and splat is drawn as an instanced quad into three
//     force textures (displacement target + obstacle velocity, foam/bio/oil/fire sources, surface
//     push + vertical impulses). Shared by the wave sim and the fluid sim.
//  2. Wave equation heightfield (9-point Laplacian, damped, absorbing edges): bow waves, V wakes,
//     explosion rings, splash ripples. State texture RG16F: R = height (m), G = vertical velocity.

import { drawFullscreen, FULLSCREEN_VS, InstanceBatch, PingPong, Program, Target, type GL } from '../gl';
import { SimWindow } from '../../../water/simWindow';

const FORCE_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec2 aQuad;
layout(location = 1) in vec4 iA;   // center.xy (m, rel window), fwd.xy
layout(location = 2) in vec4 iB;   // halfLen, halfBeam, vx, vy
layout(location = 3) in vec4 iC;   // angVel, thrust, draft, depth
layout(location = 4) in vec4 iD;   // foam, oil, fire, kind (kind >= 10 = splat)
layout(location = 5) in vec4 iE;   // splat: wave, foam, bio, push
uniform float uSize;               // window size (m)
out vec2 vLocal;                   // local coords (-1.4..1.4 along, -2..2 across), or splat radial
out vec2 vWorld;
flat out vec4 vA; flat out vec4 vB; flat out vec4 vC; flat out vec4 vD; flat out vec4 vE;
void main() {
  vA = iA; vB = iB; vC = iC; vD = iD; vE = iE;
  vec2 q = aQuad * 2.0 - 1.0;
  vec2 p;
  if (iD.w >= 10.0) {
    // splat: square around center, radius in iB.x
    p = iA.xy + q * iB.x * 1.2;
    vLocal = q * 1.2;
  } else {
    float ex = 1.0 + 6.0 / max(iB.x, 1.0);          // extend astern for the propeller wash
    vec2 l = vec2(q.x < 0.0 ? q.x * (1.6 + ex) : q.x * 1.25, q.y * 2.2);
    vec2 f = iA.zw, r = vec2(-f.y, f.x);
    p = iA.xy + f * (l.x * iB.x) + r * (l.y * iB.y);
    vLocal = l;
  }
  vWorld = p;
  gl_Position = vec4(p / uSize * 2.0 - 1.0, 0.0, 1.0);
}`;

const FORCE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vLocal; in vec2 vWorld;
flat in vec4 vA; flat in vec4 vB; flat in vec4 vC; flat in vec4 vD; flat in vec4 vE;
uniform float uHullPush, uFoamAmt;
layout(location = 0) out vec4 oF0;  // displacement target, mask, obstacle vx, vy
layout(location = 1) out vec4 oF1;  // foam, bio, oil, fire sources (per second)
layout(location = 2) out vec4 oF2;  // push vx, vy, vertical impulse, -
float hullShape(vec2 l) {
  float taper = l.x > 0.25 ? mix(1.0, 0.08, (l.x - 0.25) / 0.75) : (l.x < -0.8 ? mix(1.0, 0.55, (-l.x - 0.8) / 0.2) : 1.0);
  float wy = abs(l.y) / max(taper, 0.05);
  if (abs(l.x) > 1.0 || wy > 1.0) return 0.0;
  return (1.0 - wy * wy) * (1.0 - l.x * l.x * l.x * l.x);
}
void main() {
  oF0 = vec4(0.0); oF1 = vec4(0.0); oF2 = vec4(0.0);
  float kind = vD.w;
  if (kind >= 10.0) {
    float r = length(vLocal);
    if (r > 1.2) discard;
    float fall = r < 1.0 ? 1.0 - r * r : 0.0;
    fall *= fall;
    vec2 dir = r > 0.001 ? vLocal / r : vec2(0.0);
    oF2 = vec4(dir * vE.w * fall, vE.x * fall, 0.0);
    float oil = max(vD.y, 0.0), fire = max(vD.z, 0.0);
    oF1 = vec4(vE.y * fall, vE.z * fall, oil * fall, fire * fall);
    return;
  }
  vec2 l = vLocal;
  vec2 f = vA.zw, rgt = vec2(-f.y, f.x);
  vec2 vel = vB.zw;
  float speed = length(vel);
  float fwdSpeed = dot(vel, f);
  float halfLen = vB.x, halfBeam = vB.y;
  float thrust = vC.y, draft = vC.z, depth = vC.w;
  float s = hullShape(l);
  // point velocity of the rigid hull: v + w x r
  vec2 rv = (vWorld - vA.xy);
  vec2 pv = vel + vC.x * vec2(-rv.y, rv.x);
  float surf = kind < 0.5 ? 1.0 : 0.0;
  if (kind > 2.5) surf = exp(-depth / 9.0) * 0.6;           // submerged sub: weak surface hump
  if (kind > 0.5 && kind < 2.5) surf = 0.0;                  // torpedo trail / periscope: no displacement
  float disp = -min(draft, 4.0) * 0.32 * uHullPush * s * surf;
  oF0 = vec4(disp, s * surf, pv * s * surf);
  float foamK = vD.x * uFoamAmt;
  // ---- foam & bioluminescence sources
  float foam = 0.0;
  if (kind < 0.5) {
    // bow wave breaking along the forward flanks
    float edge = s > 0.0 ? 0.0 : exp(-pow(abs(abs(l.y) - (l.x > 0.25 ? mix(1.0, 0.08, (l.x - 0.25) / 0.75) : 1.0)) * 3.0, 2.0));
    float bow = smoothstep(0.1, 0.9, l.x) * edge * smoothstep(1.5, 7.0, fwdSpeed);
    // churned water along the sides and the propeller wash astern
    float side = edge * smoothstep(2.0, 9.0, speed) * 0.35;
    float stern = (l.x < -0.95 && l.x > -4.0) ? exp(-l.y * l.y * 3.5) * smoothstep(-0.9, -1.4, l.x) * exp((l.x + 1.0) * 0.6) : 0.0;
    float wash = stern * (abs(thrust) * 0.9 + smoothstep(0.5, 8.0, speed) * 0.6);
    foam = (bow * 1.6 + side + wash * 1.4) * foamK;
    // propeller jet astern + water shoved aside at the bow
    vec2 push = stern * (-f) * thrust * 3.5 + rgt * sign(l.y) * edge * smoothstep(0.2, 1.0, l.x) * fwdSpeed * 0.12;
    oF2 = vec4(push, 0.0, 0.0);
  } else if (kind < 1.5) {
    // torpedo bubble trail: thin line behind the source point
    float line = exp(-l.y * l.y * 6.0) * (l.x < 0.0 ? exp(l.x * 0.5) : 0.0) * smoothstep(1.2, 0.8, abs(l.x) * 0.3);
    foam = line * 0.9 * foamK;
  } else if (kind < 2.5) {
    // periscope feather: small V of white water
    float v = exp(-pow(abs(l.y) - max(0.0, -l.x) * 0.4, 2.0) * 8.0) * (l.x < 0.2 ? exp(l.x * 0.7) : 0.0);
    foam = v * smoothstep(0.5, 3.0, speed) * foamK;
  } else {
    // submerged boat: a faint swirl/slick at shallow depth and speed
    float stern = (l.x < -0.9 && l.x > -4.0) ? exp(-l.y * l.y * 2.0) * exp((l.x + 1.0) * 0.5) : 0.0;
    foam = stern * smoothstep(1.0, 4.0, speed) * exp(-depth / 6.0) * 0.4 * foamK;
  }
  float oil = vD.y * s * 0.8;
  float fire = vD.z * (s > 0.0 ? 0.0 : exp(-pow(max(abs(l.y) - 1.0, 0.0) * 1.5, 2.0))) * 0.6;
  oF1 = vec4(foam, foam * 0.9, oil, fire);
}`;

const WAVE_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform sampler2D uF0;     // displacement target / mask
uniform sampler2D uF2;     // impulses in .z
uniform float uN, uDt, uC2, uDamp;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int n = int(uN) - 1;
  vec2 s = texelFetch(uState, p, 0).rg;
  float h = s.r, v = s.g;
  float hl = texelFetch(uState, ivec2(max(p.x - 1, 0), p.y), 0).r;
  float hr = texelFetch(uState, ivec2(min(p.x + 1, n), p.y), 0).r;
  float hd = texelFetch(uState, ivec2(p.x, max(p.y - 1, 0)), 0).r;
  float hu = texelFetch(uState, ivec2(p.x, min(p.y + 1, n)), 0).r;
  float h1 = texelFetch(uState, ivec2(max(p.x - 1, 0), max(p.y - 1, 0)), 0).r;
  float h2 = texelFetch(uState, ivec2(min(p.x + 1, n), max(p.y - 1, 0)), 0).r;
  float h3 = texelFetch(uState, ivec2(max(p.x - 1, 0), min(p.y + 1, n)), 0).r;
  float h4 = texelFetch(uState, ivec2(min(p.x + 1, n), min(p.y + 1, n)), 0).r;
  float lap = (4.0 * (hl + hr + hd + hu) + (h1 + h2 + h3 + h4) - 20.0 * h) / 6.0;
  vec4 f0 = texelFetch(uF0, p, 0);
  float imp = texelFetch(uF2, p, 0).z;
  v += uC2 * lap * uDt;
  // hulls drag the surface toward their displaced shape (spring-damper)
  float m = clamp(f0.g, 0.0, 1.0);
  v += m * ((f0.r - h) * 40.0 - v * 6.0) * uDt;
  v += imp;
  // damping, stronger toward the window edges so waves are absorbed instead of reflecting
  float e = min(min(float(p.x), float(n - p.x)), min(float(p.y), float(n - p.y)));
  float edge = 1.0 - smoothstep(0.0, 24.0, e);
  v *= 1.0 - clamp((uDamp + edge * 9.0) * uDt, 0.0, 0.9);
  h += v * uDt;
  h *= 1.0 - edge * 0.08;
  h = clamp(h, -6.0, 6.0);
  o = vec4(h, v, 0.0, 1.0);
}`;

export const SHIFT_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform ivec2 uShift;
uniform ivec2 uSize;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) + uShift;
  if (p.x < 0 || p.y < 0 || p.x >= uSize.x || p.y >= uSize.y) { o = vec4(0.0); return; }
  o = texelFetch(uSrc, p, 0);
}`;

export class WaveSim {
  win: SimWindow;
  state: PingPong;
  force: Target;
  private pForce: Program;
  private pStep: Program;
  private pShift: Program;
  private batch: InstanceBatch;
  enabled = true;
  c = 5.5;
  damping = 0.25;
  hullPush = 1;
  foamAmount = 1;

  constructor(private gl: GL, n: number, cell: number) {
    this.win = new SimWindow(n, cell);
    this.state = new PingPong(gl, ['rg16f'], { filter: gl.LINEAR });
    this.force = new Target(gl, ['rgba16f', 'rgba16f', 'rgba16f'], { filter: gl.LINEAR });
    this.pForce = new Program(gl, 'force', FORCE_VS, FORCE_FS);
    this.pStep = new Program(gl, 'wave', FULLSCREEN_VS, WAVE_FS);
    this.pShift = new Program(gl, 'shift', FULLSCREEN_VS, SHIFT_FS);
    this.batch = new InstanceBatch(gl, [4, 4, 4, 4, 4], 64, 1);
    this.resize(n, cell);
  }

  resize(n: number, cell: number) {
    this.win.n = n; this.win.cell = cell;
    this.state.resize(n, n);
    this.force.resize(n, n);
    this.clear();
  }

  clear() {
    const gl = this.gl;
    for (const t of [this.state.a, this.state.b, this.force]) { t.bind(); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
  }

  /** scroll the window to keep (cx, cy) centered; shifts state textures by whole cells */
  follow(cx: number, cy: number): [number, number] {
    const [dx, dy] = this.win.recenter(cx, cy);
    if (dx || dy) {
      if (Math.abs(dx) >= this.win.n || Math.abs(dy) >= this.win.n) this.clear();
      else this.shift(this.state, dx, dy);
    }
    return [dx, dy];
  }

  shift(pp: PingPong, dx: number, dy: number) {
    const gl = this.gl;
    pp.write.bind();
    this.pShift.use().tex('uSrc', 0, pp.read.t);
    gl.uniform2i(this.pShift.loc('uShift'), dx, dy);
    gl.uniform2i(this.pShift.loc('uSize'), pp.read.w, pp.read.h);
    gl.disable(gl.BLEND);
    drawFullscreen(gl);
    pp.swap();
  }

  /** rasterize packed hulls + splats (render/pack.ts `packForces`, relative to the window) into the force textures */
  rasterForces(data: Float32Array, count: number) {
    const gl = this.gl, b = this.batch;
    b.set(data, count);
    this.force.bind();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE);
    this.pForce.use().f1('uSize', this.win.size).f1('uHullPush', this.hullPush).f1('uFoamAmt', this.foamAmount);
    b.draw();
    gl.disable(gl.BLEND);
  }

  step(dt: number) {
    if (!this.enabled) return;
    const gl = this.gl;
    const cell = this.win.cell;
    // CFL: c*dt/dx < 0.5 for the 9-point stencil
    const maxDt = (0.45 * cell) / Math.max(this.c, 0.1);
    const n = Math.max(1, Math.ceil(dt / maxDt));
    const sdt = dt / n;
    this.pStep.use().f1('uN', this.win.n).f1('uDt', sdt).f1('uC2', (this.c * this.c) / (cell * cell)).f1('uDamp', this.damping);
    this.pStep.tex('uF0', 1, this.force.tex[0]).tex('uF2', 2, this.force.tex[2]);
    gl.disable(gl.BLEND);
    for (let i = 0; i < n; i++) {
      this.state.write.bind();
      this.pStep.tex('uState', 0, this.state.read.t);
      // impulses only on the first substep
      if (i === 1) this.pStep.tex('uF2', 2, null);
      drawFullscreen(gl);
      this.state.swap();
    }
  }

  get heightTex() { return this.state.read.t; }
}
