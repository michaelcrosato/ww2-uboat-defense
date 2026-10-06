// 2D global illumination on WebGPU (M19), over the occluder window. Emissive things (effect particles,
// omni lights, burning oil on the water) and walls (whatever the occluder heightmap says stands taller
// than `wallH`) are composed into a material grid; a jump flood turns emitters and walls into a
// nearest-seed map, i.e. a distance field; every open texel marches a few rays through it (rotated by
// noise every frame) and gathers what they hit: an emitter's light, or a wall reflecting the light that
// reached it last frame (one bounce per frame, so light keeps bouncing over time). An exponential moving
// average, reprojected as the window follows the camera, smooths the noise. The lighting pass adds the
// result as soft, occluded indirect light: fires and blasts light the hulls, quays and buildings round them.

import { shaderModule, validated, type GpuContext } from '../device';
import { BU, TU, Ubo, createTarget, type GpuTarget, type Samplers } from '../targets';
import { NOISE_WGSL } from '../wgsl/common';
import type { FxPassGPU } from './fx';
import { MAX_GI_EMITTERS } from '../../fx';

/**
 * GI uniforms (float offsets): 0 (N, wallH, frame, rays) · 4 (steps, bounce, blend, lightGain)
 * 8 occRect rel origin (x, y, w, h) · 12 window abs (x, y, span, -) · 16 previous window abs (x, y, span, valid)
 * 20 sim window rel origin (x, y, size, oilGain) · 24 (ray radiance clamp, -, -, -)
 */
const GI_FLOATS = 28;
const UNIFORMS = /* wgsl */ `
struct Gi { p0: vec4f, p1: vec4f, occRect: vec4f, cur: vec4f, prev: vec4f, sim: vec4f, p6: vec4f };
@group(0) @binding(0) var<uniform> G: Gi;
`;

const COMPOSE_WGSL = /* wgsl */ `
${UNIFORMS}
@group(0) @binding(1) var occTex: texture_2d<f32>;
@group(0) @binding(2) var emitTex: texture_2d<f32>;
@group(0) @binding(3) var dyeTex: texture_2d<f32>;
@group(0) @binding(4) var lin: sampler;
@group(0) @binding(5) var sceneOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var seedOut: texture_storage_2d<rgba16float, write>;
// material: rgb = emission (emitters) or albedo (walls); a = 0 open, 1 emitter, 2 wall
@compute @workgroup_size(8, 8) fn compose(@builtin(global_invocation_id) id: vec3u) {
  let N = u32(G.p0.x);
  if (id.x >= N || id.y >= N) { return; }
  // the tallest thing among the occluder texels under this GI texel
  let on = vec2f(textureDimensions(occTex));
  var h = -50.0;
  for (var k = 0; k < 4; k++) {
    let d = vec2f(f32(k & 1), f32(k >> 1)) * 0.5 + 0.25;
    h = max(h, textureLoad(occTex, vec2i((vec2f(id.xy) + d) / f32(N) * on), 0).r);
  }
  var e = textureLoad(emitTex, vec2i(id.xy), 0).rgb;
  // burning oil on the sea glows (the dye sim's fourth channel)
  let uv = (vec2f(id.xy) + 0.5) / f32(N);
  let suv = (G.occRect.xy + uv * G.occRect.zw - G.sim.xy) / G.sim.z;
  if (all(suv > vec2f(0.0)) && all(suv < vec2f(1.0))) {
    let burn = textureSampleLevel(dyeTex, lin, suv, 0.0).a;
    e += vec3f(2.4, 1.0, 0.28) * clamp(burn, 0.0, 2.0) * G.sim.w;
  }
  var m = vec4f(0.0);
  if (max(e.r, max(e.g, e.b)) > 0.015) { m = vec4f(e, 1.0); }
  else if (h > G.p0.y) { m = vec4f(0.5, 0.48, 0.45, 2.0); }
  textureStore(sceneOut, vec2i(id.xy), m);
  var seed = vec4f(-1.0, -1.0, 0.0, 0.0);
  if (m.a > 0.5) { seed = vec4f(vec2f(id.xy), 1.0, 0.0); }
  textureStore(seedOut, vec2i(id.xy), seed);
}`;

const JFA_WGSL = /* wgsl */ `
struct J { jump: vec4f };
@group(0) @binding(0) var<uniform> J0: J;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba16float, write>;
// one jump-flood pass: look at 9 texels 'jump' apart and keep the nearest seed any of them knows about
@compute @workgroup_size(8, 8) fn jfa(@builtin(global_invocation_id) id: vec3u) {
  let size = vec2i(textureDimensions(src));
  let p = vec2i(id.xy);
  if (p.x >= size.x || p.y >= size.y) { return; }
  let k = i32(J0.jump.x);
  var best = vec4f(-1.0, -1.0, 0.0, 0.0);
  var bestD = 1e9;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let q = p + vec2i(dx, dy) * k;
      if (q.x < 0 || q.y < 0 || q.x >= size.x || q.y >= size.y) { continue; }
      let s = textureLoad(src, q, 0);
      if (s.z < 0.5) { continue; }
      let d = distance(s.xy, vec2f(p));
      if (d < bestD) { bestD = d; best = s; }
    }
  }
  textureStore(dst, p, best);
}`;

const TRACE_WGSL = /* wgsl */ `
${UNIFORMS}
${NOISE_WGSL}
@group(0) @binding(1) var sceneTex: texture_2d<f32>;
@group(0) @binding(2) var jfaTex: texture_2d<f32>;
@group(0) @binding(3) var prevTex: texture_2d<f32>;
@group(0) @binding(4) var lin: sampler;
@group(0) @binding(5) var accOut: texture_storage_2d<rgba16float, write>;
const TAU = 6.2831853;
// last frame's light at GI texel position q of this frame's window (the window moves with the camera)
fn prevAt(q: vec2f) -> vec4f {
  if (G.prev.w < 0.5) { return vec4f(0.0); }
  let w = G.cur.xy + q / G.p0.x * G.cur.z;
  let uv = (w - G.prev.xy) / G.prev.z;
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return vec4f(0.0); }
  return textureSampleLevel(prevTex, lin, uv, 0.0);
}
// march one ray through the jump-flooded distance field; returns the light it brings back
fn traceRay(p: vec2f, dir: vec2f, N: f32) -> vec3f {
  var t = 0.75;
  let steps = i32(G.p1.x);
  for (var i = 0; i < 64; i++) {
    if (i >= steps) { break; }
    let q = p + dir * t;
    if (q.x < 0.0 || q.y < 0.0 || q.x >= N || q.y >= N) { return vec3f(0.0); }
    let s = textureLoad(jfaTex, vec2i(q), 0);
    if (s.z < 0.5) { return vec3f(0.0); }
    let d = length(s.xy + 0.5 - q);
    if (d < 1.0) {
      // light falls off as over a ground plane (with the square of distance), not as in flatland, where
      // 1/d lets a field of fires sum into one glare; p6.y = distance (m) at which it has halved
      let tm = t * G.cur.z / N / G.p6.y;
      let fall = 1.0 / (1.0 + tm * tm);
      let m = textureLoad(sceneTex, vec2i(s.xy), 0);
      if (m.a < 1.5) { return min(m.rgb, vec3f(G.p6.x)) * fall; }
      // a wall reflects (albedo x bounce) what reached its face last frame
      let back = prevAt(q - dir * 1.5);
      return m.rgb * back.rgb * G.p1.y * fall;
    }
    t += max(d - 0.75, 0.75);
  }
  return vec3f(0.0);
}
@compute @workgroup_size(8, 8) fn trace(@builtin(global_invocation_id) id: vec3u) {
  let N = G.p0.x;
  if (f32(id.x) >= N || f32(id.y) >= N) { return; }
  let p = vec2f(id.xy) + 0.5;
  let here = textureLoad(sceneTex, vec2i(id.xy), 0);
  var raw = vec4f(0.0);
  if (here.a < 0.5) {
    // rays spread evenly round the circle, the whole fan turned by per-texel, per-frame noise
    let n = i32(G.p0.w);
    let jitter = fract(hash12(p * 0.73 + vec2f(17.0, 3.0)) + G.p0.z * 0.61803398875);
    var sum = vec3f(0.0);
    for (var r = 0; r < 32; r++) {
      if (r >= n) { break; }
      let a = (f32(r) + jitter) / f32(n) * TAU;
      sum += traceRay(p, vec2f(cos(a), sin(a)), N);
    }
    raw = vec4f(sum / f32(n), 1.0);
  } else if (here.a < 1.5) {
    // an emitter lights what stands in it (the deck under a fire)
    raw = vec4f(here.rgb * 0.5, 1.0);
  }
  let old = prevAt(p);
  let acc = select(raw, mix(old, raw, G.p1.z), G.prev.w > 0.5);
  textureStore(accOut, vec2i(id.xy), acc);
}`;

/** omni lights from the lighting pass's light buffer (and the game's steady GI emitters, packed the same
 *  way), splatted as soft discs into the emission grid */
const LIGHTS_WGSL = /* wgsl */ `
${UNIFORMS}
@group(0) @binding(1) var<storage, read> lights: array<vec4f>;
struct VO { @builtin(position) pos: vec4f, @location(0) c: vec2f, @location(1) @interpolate(flat) col: vec3f };
@vertex fn vsLight(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  var o: VO;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  let l0 = lights[ii * 4u]; let l1 = lights[ii * 4u + 1u]; let l2 = lights[ii * 4u + 2u]; let l3 = lights[ii * 4u + 3u];
  if (l2.w > -1.5) { return o; }            // spotlights light a cone, not their surroundings
  var cs = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let c = cs[vi];
  let r = clamp(l3.w * 2.0 + l0.w * 0.06, 3.0, 18.0);
  let uv = (l0.xy - G.occRect.xy) / G.occRect.zw;
  let s = r / G.occRect.z * 2.0;
  o.pos = vec4f(uv.x * 2.0 - 1.0 + c.x * s, 1.0 - uv.y * 2.0 - c.y * s, 0.0, 1.0);
  o.c = c;
  // the same light spread over a disc: keep its total near what the direct pass gives
  o.col = l1.rgb * l1.w * G.p1.w / (1.0 + r * 0.15);
  return o;
}
@fragment fn fsLight(i: VO) -> @location(0) vec4f {
  let d = dot(i.c, i.c);
  if (d > 1.0) { discard; }
  // nearly flat discs: in 2D the light a texel gathers falls off as size / distance, so a fire needs a
  // solid patch of emitter, not a point, to throw a pool of light tens of metres wide
  return vec4f(i.col * (1.0 - d * d), 0.0);
}`;

const ADD: GPUBlendState = { color: { operation: 'add', srcFactor: 'one', dstFactor: 'one' }, alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one' } };
const FMT: GPUTextureFormat = 'rgba16float';

export interface GiFrame {
  N: number; wallH: number; frame: number; rays: number; steps: number; bounce: number; blend: number; lightGain: number;
  occRel: [number, number, number, number]; cur: [number, number, number]; prev: [number, number, number] | null;
  sim: [number, number, number]; oilGain: number; lightCount: number;
  /** steady emitters packed like lights (16 floats each), and how many */
  emitters: Float32Array<ArrayBuffer>; emitterCount: number;
  /** most light one ray may bring back (small, very bright emitters otherwise speckle the grid) */
  clamp: number;
  /** distance (m) at which gathered light has fallen to half */
  reach: number;
}

export class GiPassGPU {
  private ubo: Ubo;
  private pCompose!: GPUComputePipeline;
  private pJfa!: GPUComputePipeline;
  private pTrace!: GPUComputePipeline;
  private pLights!: GPURenderPipeline;
  private N = 0;
  private emit: GpuTarget | null = null;
  private scene: GPUTexture | null = null;
  private seed: GPUTexture[] = [];
  private rad: GPUTexture[] = [];
  private radViews: [GPUTextureView, GPUTextureView] | null = null;
  private jumpUbos: Ubo[] = [];
  private bgCompose: GPUBindGroup | null = null;
  private bgJfa: GPUBindGroup[] = [];
  private bgTrace: GPUBindGroup[] = [];
  private bgLights: GPUBindGroup | null = null;
  private bgEmitters: GPUBindGroup | null = null;
  private emitBuf: GPUBuffer;
  private inputs: { occ: GPUTextureView; dye: GPUTextureView; lights: GPUBuffer } | null = null;
  /** which accumulation texture holds this frame's result (the lighting pass samples it) */
  cur = 0;

  private constructor(private g: GpuContext, private s: Samplers) {
    this.ubo = new Ubo(g.device, GI_FLOATS, 'gi');
    this.emitBuf = g.device.createBuffer({ label: 'gi.emitters', size: MAX_GI_EMITTERS * 16 * 4, usage: BU.STORAGE | BU.COPY_DST });
  }

  static async create(g: GpuContext, s: Samplers): Promise<GiPassGPU> {
    const p = new GiPassGPU(g, s);
    const d = g.device;
    const [mc, mj, mt, ml] = await Promise.all([
      shaderModule(g, 'gi.compose', COMPOSE_WGSL), shaderModule(g, 'gi.jfa', JFA_WGSL),
      shaderModule(g, 'gi.trace', TRACE_WGSL), shaderModule(g, 'gi.lights', LIGHTS_WGSL),
    ]);
    await validated(g, 'gi pipelines', () => {
      p.pCompose = d.createComputePipeline({ label: 'gi.compose', layout: 'auto', compute: { module: mc, entryPoint: 'compose' } });
      p.pJfa = d.createComputePipeline({ label: 'gi.jfa', layout: 'auto', compute: { module: mj, entryPoint: 'jfa' } });
      p.pTrace = d.createComputePipeline({ label: 'gi.trace', layout: 'auto', compute: { module: mt, entryPoint: 'trace' } });
      p.pLights = d.createRenderPipeline({
        label: 'gi.lights', layout: 'auto',
        vertex: { module: ml, entryPoint: 'vsLight' },
        fragment: { module: ml, entryPoint: 'fsLight', targets: [{ format: FMT, blend: ADD }] },
        primitive: { topology: 'triangle-list' },
      });
    });
    return p;
  }

  /** (re)create the grid textures for an N x N grid, and every bind group that does not depend on inputs */
  private resize(N: number) {
    if (N === this.N || !this.inputs) return;
    const d = this.g.device;
    this.emit?.texture.destroy(); this.scene?.destroy();
    for (const t of [...this.seed, ...this.rad]) t.destroy();
    for (const u of this.jumpUbos) u.destroy();
    this.N = N;
    const st = (label: string) => d.createTexture({ label, format: FMT, size: { width: N, height: N }, usage: TU.STORAGE_BINDING | TU.TEXTURE_BINDING });
    this.emit = createTarget(d, FMT, N, N, 0, 'gi.emit');
    this.scene = st('gi.scene');
    this.seed = [st('gi.seedA'), st('gi.seedB')];
    this.rad = [st('gi.radA'), st('gi.radB')];
    this.radViews = [this.rad[0].createView(), this.rad[1].createView()];
    const seedViews = this.seedViews = this.seed.map((t) => t.createView()), sceneView = this.scene.createView();
    // one tiny uniform per jump size (N/2, N/4, ... 1); the passes alternate seed A -> B -> A ...
    this.jumpUbos = [];
    for (let j = N >> 1; j >= 1; j >>= 1) { const u = new Ubo(d, 4, 'gi.jump'); u.f[0] = j; u.write(); this.jumpUbos.push(u); }
    this.bgJfa = this.jumpUbos.map((u, i) => d.createBindGroup({
      label: 'gi.jfa', layout: this.pJfa.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: u.buffer } }, { binding: 1, resource: seedViews[i & 1] }, { binding: 2, resource: seedViews[(i + 1) & 1] }],
    }));
    const finalSeed = seedViews[this.jumpUbos.length & 1];
    this.bgTrace = [0, 1].map((c) => d.createBindGroup({
      label: 'gi.trace', layout: this.pTrace.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.ubo.buffer } }, { binding: 1, resource: sceneView }, { binding: 2, resource: finalSeed },
        { binding: 3, resource: this.radViews![1 - c] }, { binding: 4, resource: this.s.linear }, { binding: 5, resource: this.radViews![c] },
      ],
    }));
    this.bgLights = d.createBindGroup({
      label: 'gi.lights', layout: this.pLights.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.ubo.buffer } }, { binding: 1, resource: { buffer: this.inputs.lights } }],
    });
    this.bgEmitters = d.createBindGroup({
      label: 'gi.emitters', layout: this.pLights.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.ubo.buffer } }, { binding: 1, resource: { buffer: this.emitBuf } }],
    });
    this.bgCompose = null;
  }

  /** occluder map, dye texture (burning oil; it ping-pongs every frame), the light buffer */
  setInputs(occ: GPUTextureView, dye: GPUTextureView, lights: GPUBuffer) {
    const I = this.inputs;
    if (I && I.occ === occ && I.dye === dye && I.lights === lights) return;
    if (I && I.lights !== lights) this.N = 0;   // the light bind group must be rebuilt
    this.inputs = { occ, dye, lights };
    this.bgCompose = null;
  }

  private bindCompose() {
    if (this.bgCompose || !this.inputs || !this.scene) return;
    const I = this.inputs;
    this.bgCompose = this.g.device.createBindGroup({
      label: 'gi.compose', layout: this.pCompose.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.ubo.buffer } }, { binding: 1, resource: I.occ }, { binding: 2, resource: this.emit!.view },
        { binding: 3, resource: I.dye }, { binding: 4, resource: this.s.linear },
        { binding: 5, resource: this.scene.createView() }, { binding: 6, resource: this.seed[0].createView() },
      ],
    });
  }

  /** the jump-flooded seed map (debug view) */
  get seedView() { return this.seed.length ? this.seedViews![(this.jumpUbos.length) & 1] : null; }
  private seedViews: GPUTextureView[] | null = null;
  /** both accumulation textures; the lighting pass keeps one bind group per side and samples `cur` */
  get views() { return this.radViews; }
  /** the grid size in use (0 before the first GI frame) */
  get size() { return this.N; }

  /** whole GI frame: splat emitters, compose, flood, trace (one render pass + one compute pass) */
  encode(enc: GPUCommandEncoder, f: GiFrame, fx: FxPassGPU, timestampWrites?: GPUComputePassTimestampWrites) {
    this.resize(f.N);
    this.bindCompose();
    if (!this.bgCompose) return;
    this.cur = 1 - this.cur;
    const u = this.ubo.f;
    u[0] = f.N; u[1] = f.wallH; u[2] = f.frame; u[3] = f.rays;
    u[4] = f.steps; u[5] = f.bounce; u[6] = f.blend; u[7] = f.lightGain;
    u.set(f.occRel, 8);
    u[12] = f.cur[0]; u[13] = f.cur[1]; u[14] = f.cur[2];
    if (f.prev) { u[16] = f.prev[0]; u[17] = f.prev[1]; u[18] = f.prev[2]; u[19] = 1; } else u[19] = 0;
    u[20] = f.sim[0]; u[21] = f.sim[1]; u[22] = f.sim[2]; u[23] = f.oilGain;
    u[24] = f.clamp; u[25] = f.reach;
    this.ubo.write();
    // emitters: the effect particles' light and the omni lights
    const rp = enc.beginRenderPass({ label: 'gi.emit', colorAttachments: [{ view: this.emit!.view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] });
    fx.encode(rp, 'emit');
    rp.setPipeline(this.pLights);
    if (f.lightCount > 0) { rp.setBindGroup(0, this.bgLights!); rp.draw(6, f.lightCount); }
    if (f.emitterCount > 0) {
      this.g.device.queue.writeBuffer(this.emitBuf, 0, f.emitters, 0, f.emitterCount * 16);
      rp.setBindGroup(0, this.bgEmitters!); rp.draw(6, f.emitterCount);
    }
    rp.end();
    const wg = Math.ceil(f.N / 8);
    const cp = enc.beginComputePass({ label: 'gi', timestampWrites });
    cp.setPipeline(this.pCompose); cp.setBindGroup(0, this.bgCompose); cp.dispatchWorkgroups(wg, wg);
    cp.setPipeline(this.pJfa);
    for (const bg of this.bgJfa) { cp.setBindGroup(0, bg); cp.dispatchWorkgroups(wg, wg); }
    cp.setPipeline(this.pTrace); cp.setBindGroup(0, this.bgTrace[this.cur]); cp.dispatchWorkgroups(wg, wg);
    cp.end();
  }

  dispose() {
    this.ubo.destroy(); this.emitBuf.destroy(); this.emit?.texture.destroy(); this.scene?.destroy();
    for (const t of [...this.seed, ...this.rad]) t.destroy();
    for (const j of this.jumpUbos) j.destroy();
  }
}
