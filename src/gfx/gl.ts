// Thin WebGL2 helpers: programs with readable compile errors, textures, render targets (MRT),
// ping-pong pairs and a fullscreen triangle. Everything the renderer, water sims and lighting use.

export type GL = WebGL2RenderingContext;

export interface GLCaps {
  floatRT: boolean;      // can render to RGBA16F / R16F
  floatLinear: boolean;  // linear filtering of 32F textures
  maxTex: number;
  renderer: string;
}

export function createGL(canvas: HTMLCanvasElement): { gl: GL; caps: GLCaps } {
  const gl = canvas.getContext('webgl2', {
    antialias: false, alpha: false, depth: true, stencil: false, premultipliedAlpha: false,
    preserveDrawingBuffer: false, powerPreference: 'high-performance',
  });
  if (!gl) throw new Error('WebGL2 is not available in this browser. Wolfpack & Escort needs WebGL2.');
  const floatRT = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
  const floatLinear = !!gl.getExtension('OES_texture_float_linear');
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  return { gl, caps: { floatRT, floatLinear, maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, renderer } };
}

function numbered(src: string) {
  return src.split('\n').map((l, i) => String(i + 1).padStart(4) + ': ' + l).join('\n');
}

export class Program {
  readonly prog: WebGLProgram;
  private locs = new Map<string, WebGLUniformLocation | null>();
  constructor(readonly gl: GL, readonly name: string, vs: string, fs: string) {
    const v = compile(gl, gl.VERTEX_SHADER, vs, name + '.vs');
    const f = compile(gl, gl.FRAGMENT_SHADER, fs, name + '.fs');
    const p = gl.createProgram()!;
    gl.attachShader(p, v); gl.attachShader(p, f);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(p);
      throw new Error(`Program ${name} link failed: ${log}`);
    }
    gl.deleteShader(v); gl.deleteShader(f);
    this.prog = p;
  }
  use() { this.gl.useProgram(this.prog); return this; }
  loc(n: string) {
    let l = this.locs.get(n);
    if (l === undefined) { l = this.gl.getUniformLocation(this.prog, n); this.locs.set(n, l); }
    return l;
  }
  f1(n: string, a: number) { const l = this.loc(n); if (l) this.gl.uniform1f(l, a); return this; }
  f2(n: string, a: number, b: number) { const l = this.loc(n); if (l) this.gl.uniform2f(l, a, b); return this; }
  f3(n: string, a: number, b: number, c: number) { const l = this.loc(n); if (l) this.gl.uniform3f(l, a, b, c); return this; }
  f4(n: string, a: number, b: number, c: number, d: number) { const l = this.loc(n); if (l) this.gl.uniform4f(l, a, b, c, d); return this; }
  i1(n: string, a: number) { const l = this.loc(n); if (l) this.gl.uniform1i(l, a); return this; }
  v2a(n: string, arr: Float32Array | number[]) { const l = this.loc(n); if (l) this.gl.uniform2fv(l, arr); return this; }
  v3a(n: string, arr: Float32Array | number[]) { const l = this.loc(n); if (l) this.gl.uniform3fv(l, arr); return this; }
  v4a(n: string, arr: Float32Array | number[]) { const l = this.loc(n); if (l) this.gl.uniform4fv(l, arr); return this; }
  m3(n: string, arr: Float32Array | number[]) { const l = this.loc(n); if (l) this.gl.uniformMatrix3fv(l, false, arr); return this; }
  m4(n: string, arr: Float32Array | number[]) { const l = this.loc(n); if (l) this.gl.uniformMatrix4fv(l, false, arr); return this; }
  /** bind texture to unit and set sampler uniform */
  tex(n: string, unit: number, t: WebGLTexture | null) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    const l = this.loc(n); if (l) gl.uniform1i(l, unit);
    return this;
  }
}

function compile(gl: GL, type: number, src: string, name: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s) ?? '';
    console.error(`Shader ${name} failed:\n${log}\n${numbered(src)}`);
    throw new Error(`Shader ${name} failed to compile: ${log.split('\n')[0]}`);
  }
  return s;
}

export interface TexOpts {
  internal?: number; format?: number; type?: number;
  filter?: number; wrap?: number; data?: ArrayBufferView | null;
}

export function makeTex(gl: GL, w: number, h: number, o: TexOpts = {}): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  const filter = o.filter ?? gl.NEAREST, wrap = o.wrap ?? gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === gl.LINEAR_MIPMAP_LINEAR || filter === gl.NEAREST_MIPMAP_NEAREST ? gl.NEAREST : filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, o.internal ?? gl.RGBA8, w, h, 0, o.format ?? gl.RGBA, o.type ?? gl.UNSIGNED_BYTE, o.data ?? null);
  return t;
}

export type Fmt = 'rgba8' | 'rgba16f' | 'rg16f' | 'r16f' | 'r8' | 'rgba32f';
export function fmtOf(gl: GL, f: Fmt): { internal: number; format: number; type: number } {
  switch (f) {
    case 'rgba8': return { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE };
    case 'rgba16f': return { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT };
    case 'rg16f': return { internal: gl.RG16F, format: gl.RG, type: gl.HALF_FLOAT };
    case 'r16f': return { internal: gl.R16F, format: gl.RED, type: gl.HALF_FLOAT };
    case 'r8': return { internal: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE };
    case 'rgba32f': return { internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT };
  }
}

/** a framebuffer with one or more color attachments and an optional depth buffer */
export class Target {
  fb: WebGLFramebuffer | null = null;
  tex: WebGLTexture[] = [];
  depth: WebGLRenderbuffer | null = null;
  w = 0; h = 0;
  constructor(readonly gl: GL, readonly fmts: Fmt[], readonly opts: { depth?: boolean; filter?: number; wrap?: number } = {}) {}
  get t(): WebGLTexture { return this.tex[0]; }
  resize(w: number, h: number) {
    w = Math.max(1, w | 0); h = Math.max(1, h | 0);
    if (w === this.w && h === this.h && this.fb) return false;
    const gl = this.gl;
    this.dispose();
    this.w = w; this.h = h;
    this.fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    const bufs: number[] = [];
    this.fmts.forEach((f, i) => {
      const t = makeTex(gl, w, h, { ...fmtOf(gl, f), filter: this.opts.filter ?? gl.NEAREST, wrap: this.opts.wrap });
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
      this.tex.push(t);
      bufs.push(gl.COLOR_ATTACHMENT0 + i);
    });
    if (this.opts.depth) {
      this.depth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depth);
    }
    gl.drawBuffers(bufs);
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) console.error('framebuffer incomplete', this.fmts, st.toString(16));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return true;
  }
  bind() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.viewport(0, 0, this.w, this.h);
  }
  dispose() {
    const gl = this.gl;
    for (const t of this.tex) gl.deleteTexture(t);
    this.tex = [];
    if (this.fb) gl.deleteFramebuffer(this.fb);
    if (this.depth) gl.deleteRenderbuffer(this.depth);
    this.fb = null; this.depth = null; this.w = 0; this.h = 0;
  }
}

export class PingPong {
  a: Target; b: Target;
  constructor(gl: GL, fmts: Fmt[], opts: { filter?: number; wrap?: number } = {}) {
    this.a = new Target(gl, fmts, opts);
    this.b = new Target(gl, fmts, opts);
  }
  resize(w: number, h: number) { const r = this.a.resize(w, h); this.b.resize(w, h); return r; }
  get read() { return this.a; }
  get write() { return this.b; }
  swap() { const t = this.a; this.a = this.b; this.b = t; }
  dispose() { this.a.dispose(); this.b.dispose(); }
}

/** fullscreen triangle generated from gl_VertexID; bind any VAO-less state and draw 3 vertices */
export const FULLSCREEN_VS = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

let emptyVao: WebGLVertexArrayObject | null = null;
export function drawFullscreen(gl: GL) {
  if (!emptyVao) emptyVao = gl.createVertexArray();
  gl.bindVertexArray(emptyVao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/** a dynamic instanced quad batch: per-instance float attributes laid out in `layout` (sizes in floats) */
export class InstanceBatch {
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  quad: WebGLBuffer;
  data: Float32Array;
  count = 0;
  readonly stride: number;
  constructor(readonly gl: GL, readonly layout: number[], public capacity = 1024, firstLoc = 1) {
    this.stride = layout.reduce((a, b) => a + b, 0);
    this.data = new Float32Array(capacity * this.stride);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    let off = 0;
    layout.forEach((n, i) => {
      const loc = firstLoc + i;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, n, gl.FLOAT, false, this.stride * 4, off * 4);
      gl.vertexAttribDivisor(loc, 1);
      off += n;
    });
    gl.bindVertexArray(null);
  }
  begin() { this.count = 0; }
  /** returns write offset into data for one more instance (grows as needed) */
  push(): number {
    if (this.count >= this.capacity) this.grow();
    return this.count++ * this.stride;
  }
  private grow() {
    const gl = this.gl;
    this.capacity *= 2;
    const d = new Float32Array(this.capacity * this.stride);
    d.set(this.data);
    this.data = d;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
  }
  draw() {
    if (!this.count) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.count * this.stride);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
    gl.bindVertexArray(null);
  }
}
