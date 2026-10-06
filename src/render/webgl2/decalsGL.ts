// Ground decals on WebGL2 (M19): the twin of webgpu/passes/decals.ts (keep the look 1:1). Drawn into the
// G-buffer after the sprite stacks with only the albedo attachment enabled (drawBuffers [0, NONE]), so
// normals and heights stay; alpha blending keeps the material id in the albedo's alpha.

import { InstanceBatch, Program, type GL } from './gl';
import { CAMERA_GLSL, DITHER_GLSL, NOISE_GLSL } from './glsl/common';
import { DECAL_FLOATS } from '../pack';

const VS = /* glsl */ `#version 300 es
precision highp float;
${CAMERA_GLSL}
layout(location = 0) in vec2 aQuad;
layout(location = 1) in vec4 aPos;   // x, y (rel origin), z, radius
layout(location = 2) in vec4 aP;     // kind, seed, strength, -
out vec2 vQ; flat out vec4 vP;
void main() {
  vec2 c = aQuad * 2.0 - 1.0;
  float a = aP.y * 6.2831853;
  vec2 r = vec2(cos(a) * c.x - sin(a) * c.y, sin(a) * c.x + cos(a) * c.y) * aPos.w;
  gl_Position = worldToClip(vec3(aPos.xy + r, aPos.z + 0.35));
  vQ = c; vP = aP;
}`;

const FS = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 uPixOff;
${NOISE_GLSL}
${DITHER_GLSL}
in vec2 vQ; flat in vec4 vP;
layout(location = 0) out vec4 o;
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  int kind = int(vP.x + 0.5);
  float r = length(vQ);
  if (r > 1.0) discard;
  float seed = vP.y * 97.0, ang = atan(vQ.y, vQ.x);
  float edge = 0.78 + 0.22 * vn(vec2(ang * 2.2 + seed, seed * 0.37));
  vec3 col = vec3(0.0); float a = 0.0;
  if (kind == 0) {
    float pit = 1.0 - smoothstep(0.32 * edge, 0.42 * edge, r);
    float lip = smoothstep(0.36 * edge, 0.46 * edge, r) * (1.0 - smoothstep(0.5 * edge, 0.64 * edge, r));
    float streak = vn(vec2(ang * 7.0 + seed, r * 3.0));
    float burn = (1.0 - smoothstep(0.4, 1.0 * edge, r)) * (0.55 + 0.45 * streak);
    col = mix(vec3(0.07, 0.06, 0.05), vec3(0.36, 0.28, 0.2), lip);
    a = max(max(pit * 0.95, lip * 0.8), burn * 0.75);
    if (pit > 0.5) col = vec3(0.05, 0.045, 0.04) + vec3(0.03) * vn(vQ * 9.0 + seed);
    else if (lip < 0.3) col = vec3(0.08, 0.07, 0.06);
  } else if (kind == 1) {
    float n = vn(vQ * 3.5 + seed) * 0.6 + vn(vQ * 8.0 + seed * 1.7) * 0.4;
    a = (1.0 - smoothstep(0.45 * edge, edge, r)) * (0.45 + 0.55 * n);
    col = vec3(0.06, 0.055, 0.05);
  } else if (kind == 2) {
    float n = vn(vQ * 5.0 + seed);
    float ash = smoothstep(0.55 * edge, 0.8 * edge, r) * (1.0 - smoothstep(0.85 * edge, edge, r));
    a = max((1.0 - smoothstep(0.5 * edge, 0.75 * edge, r)) * (0.6 + 0.4 * n), ash * 0.5);
    col = mix(vec3(0.05, 0.045, 0.04), vec3(0.38, 0.36, 0.33), ash);
  } else {
    float cell = floor((vQ.x + 1.0) * 6.0);
    float cx = (cell + 0.5) / 6.0 * 2.0 - 1.0 + (hash12(vec2(cell, seed)) - 0.5) * 0.12;
    float d = length(vec2((vQ.x - cx) * 6.0, vQ.y * 3.0 - (hash12(vec2(seed, cell)) - 0.5)));
    a = (1.0 - smoothstep(0.25, 0.5, d)) * 0.8;
    col = vec3(0.12, 0.1, 0.08);
  }
  a *= vP.z;
  a = floor(a * 4.0 + ditherHere()) * 0.25;
  if (a <= 0.0) discard;
  o = vec4(col, a);
}`;

export class DecalsGL {
  readonly prog: Program;
  private batch: InstanceBatch;
  constructor(private gl: GL) {
    this.prog = new Program(gl, 'decals', VS, FS);
    this.batch = new InstanceBatch(gl, [4, 4], 256);
  }
  set(data: Float32Array, count: number) { this.batch.set(data.subarray(0, count * DECAL_FLOATS), count); }
  /** draw into the bound G-buffer (depth test on, LESS-EQUAL), albedo attachment only */
  draw() {
    if (!this.batch.count) return;
    const gl = this.gl;
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);
    gl.depthMask(false);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    this.batch.draw();
    gl.disable(gl.BLEND);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  }
  dispose() { this.gl.deleteProgram(this.prog.prog); }
}
