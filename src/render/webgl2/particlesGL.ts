// WebGL2 drawing of the CPU particle system: square GL points into the G-buffer and the occluder
// heightmap. Translucency is screen-door dithering, which keeps the pixel-art look and needs no
// sorting. Data comes pre-packed (render/pack.ts, 12 floats per particle).

import { CAMERA_GLSL, DITHER_GLSL, GBUF_OUT_GLSL, MAT_GLSL } from './glsl/common';
import { Program, type GL } from './gl';
import { PARTICLE_FLOATS } from '../pack';

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

export class ParticlesGL {
  n = 0;
  private cap = 0;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  prog: Program;
  progOcc: Program;

  constructor(private gl: GL) {
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    for (let i = 0; i < 3; i++) {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, 4, gl.FLOAT, false, PARTICLE_FLOATS * 4, i * 16);
    }
    gl.bindVertexArray(null);
    this.prog = new Program(gl, 'particles', VS, FS);
    this.progOcc = new Program(gl, 'particles.occ', VS, OCC_FS);
  }

  upload(data: Float32Array, n: number) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    if (data.length > this.cap) { this.cap = data.length; gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW); }
    if (n) gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * PARTICLE_FLOATS);
    this.n = n;
  }
  draw() {
    if (!this.n) return;
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, 0, this.n);
    gl.bindVertexArray(null);
  }
}
