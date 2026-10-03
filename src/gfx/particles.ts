// CPU particles drawn as square GL points into the G-buffer (so fire lights nothing by itself
// but smoke is lit by searchlights and fires). Translucency is screen-door dithering, which keeps
// the pixel-art look and needs no sorting.

import { CAMERA_GLSL, DITHER_GLSL, GBUF_OUT_GLSL, MAT, MAT_GLSL } from './shaders/common';
import { Program, type GL } from './gl';
import { fx } from '../core/math';

export const PK = {
  SPRAY: 0, MIST: 1, SMOKE: 2, FIRE: 3, SPARK: 4, DEBRIS: 5, FOAMBIT: 6, STEAM: 7, TRACER: 8, SHEET: 9, FLASH: 10, SNOW: 11,
} as const;

const VS = /* glsl */ `#version 300 es
precision highp float;
${CAMERA_GLSL}
layout(location = 0) in vec4 aPos;    // x, y (rel), z, size (m)
layout(location = 1) in vec4 aCol;    // rgb, alpha
layout(location = 2) in vec4 aMat;    // material, emissive, nz (up-ness), occluder smoke
uniform float uMaxPx;
uniform int uOccluder;
uniform vec4 uOccRect;
uniform float uOccScale;
out vec4 vCol; flat out vec4 vMat; out float vZ;
void main() {
  vCol = aCol; vMat = aMat; vZ = aPos.z;
  if (uOccluder == 1) {
    vec2 c = (aPos.xy - uOccRect.xy) / uOccRect.zw * 2.0 - 1.0;
    gl_Position = vec4(c, 0.0, 1.0);
    gl_PointSize = max(1.0, aPos.w * uOccScale);
  } else {
    gl_Position = worldToClip(aPos.xyz);
    gl_PointSize = clamp(aPos.w * uCam.z, 1.0, uMaxPx);
  }
}`;

const FS = /* glsl */ `#version 300 es
precision highp float;
${CAMERA_GLSL}
${DITHER_GLSL}
${MAT_GLSL}
${GBUF_OUT_GLSL}
in vec4 vCol; flat in vec4 vMat; in float vZ;
void main() {
  vec2 pc = gl_PointCoord * 2.0 - 1.0;
  if (dot(pc, pc) > 1.15) discard;
  if (vCol.a < ditherHere()) discard;
  vec2 nxy = pc * 0.55 * (1.0 - vMat.z);
  oAlbedo = vec4(vCol.rgb, vMat.x / 255.0);
  oNormal = vec4(nxy, vZ, vMat.y);
}`;

const OCC_FS = /* glsl */ `#version 300 es
precision highp float;
in vec4 vCol; flat in vec4 vMat; in float vZ;
out vec4 o;
void main() {
  vec2 pc = gl_PointCoord * 2.0 - 1.0;
  float r = dot(pc, pc);
  if (r > 1.0) discard;
  o = vec4(-50.0, 0.0, 0.0, vMat.w * vCol.a * (1.0 - r));
}`;

export class Particles {
  readonly cap: number;
  n = 0;
  px: Float32Array; py: Float32Array; pz: Float32Array;
  vx: Float32Array; vy: Float32Array; vz: Float32Array;
  life: Float32Array; max: Float32Array; size: Float32Array; grow: Float32Array;
  kind: Uint8Array; r: Float32Array; g: Float32Array; b: Float32Array;
  drag: Float32Array; grav: Float32Array;
  private buf: Float32Array;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  prog: Program;
  progOcc: Program;
  /** impact points of spray hitting the water this frame (for ripples) */
  impacts: { x: number; y: number; s: number }[] = [];
  wind = { x: 0, y: 0 };

  constructor(private gl: GL, cap = 24000) {
    this.cap = cap;
    const F = () => new Float32Array(cap);
    this.px = F(); this.py = F(); this.pz = F(); this.vx = F(); this.vy = F(); this.vz = F();
    this.life = F(); this.max = F(); this.size = F(); this.grow = F();
    this.kind = new Uint8Array(cap); this.r = F(); this.g = F(); this.b = F();
    this.drag = F(); this.grav = F();
    this.buf = new Float32Array(cap * 12);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.buf.byteLength, gl.DYNAMIC_DRAW);
    for (let i = 0; i < 3; i++) {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, 4, gl.FLOAT, false, 48, i * 16);
    }
    gl.bindVertexArray(null);
    this.prog = new Program(gl, 'particles', VS, FS);
    this.progOcc = new Program(gl, 'particles.occ', VS, OCC_FS);
  }

  spawn(kind: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, col: [number, number, number], opts?: { drag?: number; grav?: number; grow?: number }) {
    let i = this.n;
    if (i >= this.cap) {
      // recycle a random old particle rather than dropping new effects
      i = (fx.next() * this.cap) | 0;
    } else this.n++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = life; this.max[i] = life; this.size[i] = size;
    this.kind[i] = kind; this.r[i] = col[0]; this.g[i] = col[1]; this.b[i] = col[2];
    const def = DEFAULTS[kind] ?? DEFAULTS[0];
    this.drag[i] = opts?.drag ?? def.drag;
    this.grav[i] = opts?.grav ?? def.grav;
    this.grow[i] = opts?.grow ?? def.grow;
  }

  /** water level lookup for landing tests */
  update(dt: number, waterAt: (x: number, y: number) => number) {
    this.impacts.length = 0;
    const wx = this.wind.x, wy = this.wind.y;
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      const k = this.kind[i];
      let dead = this.life[i] <= 0;
      if (!dead) {
        const dr = Math.exp(-this.drag[i] * dt);
        // smoke and steam drift with the wind
        const windK = k === PK.SMOKE || k === PK.STEAM || k === PK.MIST || k === PK.SNOW ? 1 - dr : 0;
        this.vx[i] = this.vx[i] * dr + wx * windK;
        this.vy[i] = this.vy[i] * dr + wy * windK;
        this.vz[i] = this.vz[i] * dr - this.grav[i] * dt;
        this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
        this.size[i] += this.grow[i] * dt;
        if (k === PK.SPRAY || k === PK.SPARK || k === PK.SHEET || k === PK.FOAMBIT || k === PK.DEBRIS || k === PK.SNOW) {
          const w = waterAt(this.px[i], this.py[i]);
          if (this.pz[i] < w && this.vz[i] < 0) {
            if (k === PK.DEBRIS) { this.pz[i] = w; this.vz[i] = 0; this.vx[i] *= 0.9; this.vy[i] *= 0.9; this.grav[i] = 0; this.drag[i] = 0.6; }
            else {
              if (k === PK.SPRAY && this.size[i] > 0.5 && this.impacts.length < 64) this.impacts.push({ x: this.px[i], y: this.py[i], s: this.size[i] });
              dead = true;
            }
          }
        }
      }
      if (dead) {
        const j = --this.n;
        if (i !== j) this.copy(j, i);
        continue;
      }
      i++;
    }
  }

  private copy(from: number, to: number) {
    this.px[to] = this.px[from]; this.py[to] = this.py[from]; this.pz[to] = this.pz[from];
    this.vx[to] = this.vx[from]; this.vy[to] = this.vy[from]; this.vz[to] = this.vz[from];
    this.life[to] = this.life[from]; this.max[to] = this.max[from]; this.size[to] = this.size[from]; this.grow[to] = this.grow[from];
    this.kind[to] = this.kind[from]; this.r[to] = this.r[from]; this.g[to] = this.g[from]; this.b[to] = this.b[from];
    this.drag[to] = this.drag[from]; this.grav[to] = this.grav[from];
  }

  /** fill the GPU buffer relative to origin; returns count */
  upload(ox: number, oy: number, time: number): number {
    const B = this.buf;
    for (let i = 0; i < this.n; i++) {
      const o = i * 12, k = this.kind[i], t = this.life[i] / this.max[i];
      B[o] = this.px[i] - ox; B[o + 1] = this.py[i] - oy; B[o + 2] = this.pz[i]; B[o + 3] = this.size[i];
      let r = this.r[i], g = this.g[i], b = this.b[i], a = 1, mat: number = MAT.SPRAY, em = 0, up = 0.3, smoke = 0;
      switch (k) {
        case PK.SPRAY: a = Math.min(1, t * 3); break;
        case PK.MIST: a = t * 0.55; up = 0.8; break;
        case PK.SMOKE: a = Math.min(1, t * 1.6) * 0.75; mat = MAT.SMOKE; up = 0.6; smoke = 0.9; break;
        case PK.STEAM: a = t * 0.6; mat = MAT.SMOKE; up = 0.7; smoke = 0.3; break;
        case PK.FIRE: {
          a = Math.min(1, t * 2.2);
          const fl = 0.8 + 0.2 * Math.sin(time * 40 + i * 1.7);
          const hot = t > 0.6;
          r = 1; g = hot ? 0.85 : 0.45 + 0.25 * t; b = hot ? 0.45 : 0.08;
          mat = MAT.FIRE; em = (1.6 + t * 1.6) * fl; break;
        }
        case PK.SPARK: mat = MAT.FIRE; em = 2.5 * t + 0.6; a = 1; break;
        case PK.FLASH: mat = MAT.FIRE; em = 4 * t; a = t; break;
        case PK.TRACER: mat = MAT.FIRE; em = 3; break;
        case PK.DEBRIS: mat = MAT.WOOD; a = Math.min(1, t * 4); up = 0.9; break;
        case PK.FOAMBIT: mat = MAT.FOAM; a = Math.min(1, t * 2); up = 1; break;
        case PK.SHEET: mat = MAT.FOAM; a = Math.min(1, t * 2.5) * 0.9; up = 0.9; break;
        case PK.SNOW: mat = MAT.FOAM; a = 0.9; up = 1; break;
      }
      B[o + 4] = r; B[o + 5] = g; B[o + 6] = b; B[o + 7] = a;
      B[o + 8] = mat; B[o + 9] = em; B[o + 10] = up; B[o + 11] = smoke;
    }
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, B, 0, this.n * 12);
    return this.n;
  }
  draw() {
    if (!this.n) return;
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, 0, this.n);
    gl.bindVertexArray(null);
  }
}

const DEFAULTS: Record<number, { drag: number; grav: number; grow: number }> = {
  [PK.SPRAY]: { drag: 0.4, grav: 9.81, grow: 0 },
  [PK.MIST]: { drag: 1.6, grav: 1.2, grow: 0.8 },
  [PK.SMOKE]: { drag: 0.9, grav: -1.4, grow: 1.6 },
  [PK.FIRE]: { drag: 1.2, grav: -4, grow: -0.4 },
  [PK.SPARK]: { drag: 0.3, grav: 9.81, grow: 0 },
  [PK.DEBRIS]: { drag: 0.2, grav: 9.81, grow: 0 },
  [PK.FOAMBIT]: { drag: 0.8, grav: 6, grow: 0 },
  [PK.STEAM]: { drag: 1.0, grav: -2.2, grow: 1.2 },
  [PK.TRACER]: { drag: 0, grav: 0, grow: 0 },
  [PK.SHEET]: { drag: 0.6, grav: 9.81, grow: 0.2 },
  [PK.FLASH]: { drag: 0, grav: 0, grow: 6 },
  [PK.SNOW]: { drag: 2.5, grav: 1.5, grow: 0 },
};
