// WGSL ports of the WebGL2 water sims (render/webgl2/water/{waveSim,fluidSim}.ts) — same constants.
// GL fragment passes sample at texel centres, so its neighbour taps are exact texel reads with
// clamp-to-edge: here they are `textureLoad` with clamped coordinates. Semi-Lagrangian advection
// samples between texels and keeps linear `textureSampleLevel`. Cell (i, j) ↔ uv ((i, j) + 0.5) / n,
// row j = world y increasing (the force raster uses the y-flip rule so rows line up).

const GID = /* wgsl */ `
fn clampI(p: vec2<i32>, n: vec2<i32>) -> vec2<i32> { return clamp(p, vec2<i32>(0), n - 1); }
`;

// ---------------------------------------------------------------- force raster (render pass)
/** force uniforms: 0 (size, hullPush, foamAmt, -) */
export const FORCE_WGSL = /* wgsl */ `
struct FU_ { p: vec4f };
@group(0) @binding(0) var<uniform> FU: FU_;
struct FIn {
  @location(0) a: vec4f,   // center.xy (m, rel window), fwd.xy
  @location(1) b: vec4f,   // halfLen, halfBeam, vx, vy
  @location(2) c: vec4f,   // angVel, thrust, draft, depth
  @location(3) d: vec4f,   // foam, oil, fire, kind (kind >= 10 = splat)
  @location(4) e: vec4f,   // splat: wave, foam, bio, push
};
struct FOut {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,
  @location(1) world: vec2f,
  @location(2) @interpolate(flat) a: vec4f,
  @location(3) @interpolate(flat) b: vec4f,
  @location(4) @interpolate(flat) c: vec4f,
  @location(5) @interpolate(flat) d: vec4f,
  @location(6) @interpolate(flat) e: vec4f,
};
@vertex fn vsForce(@builtin(vertex_index) vi: u32, i: FIn) -> FOut {
  var o: FOut;
  o.a = i.a; o.b = i.b; o.c = i.c; o.d = i.d; o.e = i.e;
  let q = vec2f(f32(vi & 1u), f32(vi >> 1u)) * 2.0 - 1.0;
  var p: vec2f;
  if (i.d.w >= 10.0) {
    // splat: square around center, radius in b.x
    p = i.a.xy + q * i.b.x * 1.2;
    o.local = q * 1.2;
  } else {
    let ex = 1.0 + 6.0 / max(i.b.x, 1.0);          // extend astern for the propeller wash
    let l = vec2f(select(q.x * 1.25, q.x * (1.6 + ex), q.x < 0.0), q.y * 2.2);
    let f = i.a.zw;
    let r = vec2f(-f.y, f.x);
    p = i.a.xy + f * (l.x * i.b.x) + r * (l.y * i.b.y);
    o.local = l;
  }
  o.world = p;
  let uv = p / FU.p.x;
  o.pos = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
  return o;
}
fn hullShape(l: vec2f) -> f32 {
  let taper = select(select(1.0, mix(1.0, 0.55, (-l.x - 0.8) / 0.2), l.x < -0.8), mix(1.0, 0.08, (l.x - 0.25) / 0.75), l.x > 0.25);
  let wy = abs(l.y) / max(taper, 0.05);
  if (abs(l.x) > 1.0 || wy > 1.0) { return 0.0; }
  return (1.0 - wy * wy) * (1.0 - l.x * l.x * l.x * l.x);
}
struct FOuts {
  @location(0) f0: vec4f,   // displacement target, mask, obstacle vx, vy
  @location(1) f1: vec4f,   // foam, bio, oil, fire sources (per second)
  @location(2) f2: vec4f,   // push vx, vy, vertical impulse, -
};
@fragment fn fsForce(i: FOut) -> FOuts {
  var o: FOuts;
  o.f0 = vec4f(0.0); o.f1 = vec4f(0.0); o.f2 = vec4f(0.0);
  let kind = i.d.w;
  if (kind >= 10.0) {
    let r = length(i.local);
    if (r > 1.2) { discard; }
    var fall = select(0.0, 1.0 - r * r, r < 1.0);
    fall *= fall;
    let dir = select(vec2f(0.0), i.local / r, r > 0.001);
    o.f2 = vec4f(dir * i.e.w * fall, i.e.x * fall, 0.0);
    let oil = max(i.d.y, 0.0);
    let fire = max(i.d.z, 0.0);
    o.f1 = vec4f(i.e.y * fall, i.e.z * fall, oil * fall, fire * fall);
    return o;
  }
  let l = i.local;
  let f = i.a.zw;
  let rgt = vec2f(-f.y, f.x);
  let vel = i.b.zw;
  let speed = length(vel);
  let fwdSpeed = dot(vel, f);
  let thrust = i.c.y; let draft = i.c.z; let depth = i.c.w;
  let s = hullShape(l);
  // point velocity of the rigid hull: v + w x r
  let rv = i.world - i.a.xy;
  let pv = vel + i.c.x * vec2f(-rv.y, rv.x);
  var surf = select(0.0, 1.0, kind < 0.5);
  if (kind > 2.5) { surf = exp(-depth / 9.0) * 0.6; }           // submerged sub: weak surface hump
  if (kind > 0.5 && kind < 2.5) { surf = 0.0; }                  // torpedo trail / periscope: no displacement
  let disp = -min(draft, 4.0) * 0.32 * FU.p.y * s * surf;
  o.f0 = vec4f(disp, s * surf, pv * s * surf);
  let foamK = i.d.x * FU.p.z;
  // ---- foam & bioluminescence sources
  var foam = 0.0;
  if (kind < 0.5) {
    // bow wave breaking along the forward flanks
    let edge = select(exp(-pow(abs(abs(l.y) - select(1.0, mix(1.0, 0.08, (l.x - 0.25) / 0.75), l.x > 0.25)) * 3.0, 2.0)), 0.0, s > 0.0);
    let bow = smoothstep(0.1, 0.9, l.x) * edge * smoothstep(1.5, 7.0, fwdSpeed);
    // churned water along the sides and the propeller wash astern
    let side = edge * smoothstep(2.0, 9.0, speed) * 0.35;
    let stern = select(0.0, exp(-l.y * l.y * 3.5) * smoothstep(-0.9, -1.4, l.x) * exp((l.x + 1.0) * 0.6), l.x < -0.95 && l.x > -4.0);
    let wash = stern * (abs(thrust) * 0.9 + smoothstep(0.5, 8.0, speed) * 0.6);
    foam = (bow * 1.6 + side + wash * 1.4) * foamK;
    // propeller jet astern + water shoved aside at the bow
    let push = stern * (-f) * thrust * 3.5 + rgt * sign(l.y) * edge * smoothstep(0.2, 1.0, l.x) * fwdSpeed * 0.12;
    o.f2 = vec4f(push, 0.0, 0.0);
  } else if (kind < 1.5) {
    // torpedo bubble trail: thin line behind the source point
    let line = exp(-l.y * l.y * 6.0) * select(0.0, exp(l.x * 0.5), l.x < 0.0) * smoothstep(1.2, 0.8, abs(l.x) * 0.3);
    foam = line * 0.9 * foamK;
  } else if (kind < 2.5) {
    // periscope feather: small V of white water
    let v = exp(-pow(abs(l.y) - max(0.0, -l.x) * 0.4, 2.0) * 8.0) * select(0.0, exp(l.x * 0.7), l.x < 0.2);
    foam = v * smoothstep(0.5, 3.0, speed) * foamK;
  } else {
    // submerged boat: a faint swirl/slick at shallow depth and speed
    let stern = select(0.0, exp(-l.y * l.y * 2.0) * exp((l.x + 1.0) * 0.5), l.x < -0.9 && l.x > -4.0);
    foam = stern * smoothstep(1.0, 4.0, speed) * exp(-depth / 6.0) * 0.4 * foamK;
  }
  let oil = i.d.y * s * 0.8;
  let fire = i.d.z * select(exp(-pow(max(abs(l.y) - 1.0, 0.0) * 1.5, 2.0)), 0.0, s > 0.0) * 0.6;
  o.f1 = vec4f(foam, foam * 0.9, oil, fire);
  return o;
}
`;

// ---------------------------------------------------------------- wave equation
/** wave uniforms: 0 (n, dt, c2, damp) · 4 (impulse on, -, -, -) */
export const WAVE_WGSL = /* wgsl */ `
${GID}
struct WU_ { a: vec4f, b: vec4f };
@group(0) @binding(0) var<uniform> U: WU_;
@group(0) @binding(1) var state: texture_2d<f32>;
@group(0) @binding(2) var f0Tex: texture_2d<f32>;    // displacement target / mask
@group(0) @binding(3) var f2Tex: texture_2d<f32>;    // impulses in .z
@group(0) @binding(4) var outTex: texture_storage_2d<rgba16float, write>;
fn hAt(p: vec2<i32>, n: vec2<i32>) -> f32 { return textureLoad(state, clampI(p, n), 0).r; }
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let N = i32(U.a.x + 0.5);
  let nn = vec2<i32>(N);
  let p = vec2<i32>(gid.xy);
  if (p.x >= N || p.y >= N) { return; }
  let dt = U.a.y;
  let n = N - 1;
  let s = textureLoad(state, p, 0).rg;
  var h = s.r;
  var v = s.g;
  let hl = hAt(p + vec2<i32>(-1, 0), nn);
  let hr = hAt(p + vec2<i32>(1, 0), nn);
  let hd = hAt(p + vec2<i32>(0, -1), nn);
  let hu = hAt(p + vec2<i32>(0, 1), nn);
  let h1 = hAt(p + vec2<i32>(-1, -1), nn);
  let h2 = hAt(p + vec2<i32>(1, -1), nn);
  let h3 = hAt(p + vec2<i32>(-1, 1), nn);
  let h4 = hAt(p + vec2<i32>(1, 1), nn);
  let lap = (4.0 * (hl + hr + hd + hu) + (h1 + h2 + h3 + h4) - 20.0 * h) / 6.0;
  let f0 = textureLoad(f0Tex, p, 0);
  let imp = select(0.0, textureLoad(f2Tex, p, 0).z, U.b.x > 0.5);
  v += U.a.z * lap * dt;
  // hulls drag the surface toward their displaced shape (spring-damper)
  let m = clamp(f0.g, 0.0, 1.0);
  v += m * ((f0.r - h) * 40.0 - v * 6.0) * dt;
  v += imp;
  // damping, stronger toward the window edges so waves are absorbed instead of reflecting
  let e = min(min(f32(p.x), f32(n - p.x)), min(f32(p.y), f32(n - p.y)));
  let edge = 1.0 - smoothstep(0.0, 24.0, e);
  v *= 1.0 - clamp((U.a.w + edge * 9.0) * dt, 0.0, 0.9);
  h += v * dt;
  h *= 1.0 - edge * 0.08;
  h = clamp(h, -6.0, 6.0);
  textureStore(outTex, p, vec4f(h, v, 0.0, 1.0));
}
`;

// ---------------------------------------------------------------- window shift (copy with offset)
/** shift uniforms: 0 (shift.x, shift.y, w, h) */
const shiftWgsl = (fmt: string) => /* wgsl */ `
struct SU_ { a: vec4f };
@group(0) @binding(0) var<uniform> U: SU_;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<${fmt}, write>;
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let size = vec2<i32>(i32(U.a.z + 0.5), i32(U.a.w + 0.5));
  let o = vec2<i32>(gid.xy);
  if (o.x >= size.x || o.y >= size.y) { return; }
  let p = o + vec2<i32>(i32(round(U.a.x)), i32(round(U.a.y)));
  var c = vec4f(0.0);
  if (p.x >= 0 && p.y >= 0 && p.x < size.x && p.y < size.y) { c = textureLoad(src, p, 0); }
  textureStore(dst, o, c);
}
`;
export const SHIFT_RGBA_WGSL = shiftWgsl('rgba16float');
export const SHIFT_R32_WGSL = shiftWgsl('r32float');

// ---------------------------------------------------------------- stable fluids
/** fluid uniforms: 0 (dt, size, diss, n) · 4 (eps, cell, -, -) */
const FLUID_HEAD = /* wgsl */ `
${GID}
struct FlU_ { a: vec4f, b: vec4f };
@group(0) @binding(0) var<uniform> U: FlU_;
fn cellUv(p: vec2<i32>) -> vec2f { return (vec2f(p) + 0.5) / U.a.w; }
`;

export const ADVECT_VEL_WGSL = /* wgsl */ `
${FLUID_HEAD}
@group(0) @binding(1) var vel: texture_2d<f32>;
@group(0) @binding(2) var f0Tex: texture_2d<f32>;    // obstacle: r disp, g mask, ba velocity
@group(0) @binding(3) var f2Tex: texture_2d<f32>;    // push xy
@group(0) @binding(4) var lin: sampler;
@group(0) @binding(5) var outTex: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let N = i32(U.a.w + 0.5);
  let p = vec2<i32>(gid.xy);
  if (p.x >= N || p.y >= N) { return; }
  let dt = U.a.x; let size = U.a.y; let diss = U.a.z;
  let uv = cellUv(p);
  let v = textureSampleLevel(vel, lin, uv, 0.0).xy;
  let back = uv - v * dt / size;
  var nv = textureSampleLevel(vel, lin, back, 0.0).xy * exp(-diss * dt);
  let f0 = textureSampleLevel(f0Tex, lin, uv, 0.0);
  let push = textureSampleLevel(f2Tex, lin, uv, 0.0).xy;
  let m = clamp(f0.g * 1.6, 0.0, 1.0);
  let obst = select(vec2f(0.0), f0.ba / max(f0.g, 0.001), m > 0.001);
  nv = mix(nv, obst, m * 0.9);
  nv += push * dt * 2.5;
  // fade toward the edges
  let e = min(uv, 1.0 - uv);
  nv *= smoothstep(0.0, 0.04, min(e.x, e.y));
  textureStore(outTex, p, vec4f(clamp(nv, vec2f(-30.0), vec2f(30.0)), 0.0, 1.0));
}
`;

export const CURL_WGSL = /* wgsl */ `
${FLUID_HEAD}
@group(0) @binding(1) var vel: texture_2d<f32>;
@group(0) @binding(2) var outTex: texture_storage_2d<r32float, write>;
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let N = i32(U.a.w + 0.5);
  let nn = vec2<i32>(N);
  let p = vec2<i32>(gid.xy);
  if (p.x >= N || p.y >= N) { return; }
  let l = textureLoad(vel, clampI(p + vec2<i32>(-1, 0), nn), 0).y;
  let r = textureLoad(vel, clampI(p + vec2<i32>(1, 0), nn), 0).y;
  let b = textureLoad(vel, clampI(p + vec2<i32>(0, -1), nn), 0).x;
  let t = textureLoad(vel, clampI(p + vec2<i32>(0, 1), nn), 0).x;
  textureStore(outTex, p, vec4f(0.5 * ((r - l) - (t - b)), 0.0, 0.0, 1.0));
}
`;

export const VORT_WGSL = /* wgsl */ `
${FLUID_HEAD}
@group(0) @binding(1) var vel: texture_2d<f32>;
@group(0) @binding(2) var curl: texture_2d<f32>;
@group(0) @binding(3) var outTex: texture_storage_2d<rgba16float, write>;
fn cAt(p: vec2<i32>, nn: vec2<i32>) -> f32 { return textureLoad(curl, clampI(p, nn), 0).x; }
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let N = i32(U.a.w + 0.5);
  let nn = vec2<i32>(N);
  let p = vec2<i32>(gid.xy);
  if (p.x >= N || p.y >= N) { return; }
  let l = abs(cAt(p + vec2<i32>(-1, 0), nn));
  let r = abs(cAt(p + vec2<i32>(1, 0), nn));
  let b = abs(cAt(p + vec2<i32>(0, -1), nn));
  let t = abs(cAt(p + vec2<i32>(0, 1), nn));
  let c = cAt(p, nn);
  let g = vec2f(r - l, t - b) * 0.5;
  let gl = length(g);
  let Nn = select(vec2f(0.0), g / gl, gl > 1e-5);
  let f = U.b.x * vec2f(Nn.y, -Nn.x) * c / max(U.b.y, 0.01) * 4.0;
  let v = textureLoad(vel, p, 0).xy + f * U.a.x;
  textureStore(outTex, p, vec4f(v, 0.0, 1.0));
}
`;

export const DIV_WGSL = /* wgsl */ `
${FLUID_HEAD}
@group(0) @binding(1) var vel: texture_2d<f32>;
@group(0) @binding(2) var outTex: texture_storage_2d<r32float, write>;
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let N = i32(U.a.w + 0.5);
  let nn = vec2<i32>(N);
  let p = vec2<i32>(gid.xy);
  if (p.x >= N || p.y >= N) { return; }
  let l = textureLoad(vel, clampI(p + vec2<i32>(-1, 0), nn), 0).x;
  let r = textureLoad(vel, clampI(p + vec2<i32>(1, 0), nn), 0).x;
  let b = textureLoad(vel, clampI(p + vec2<i32>(0, -1), nn), 0).y;
  let t = textureLoad(vel, clampI(p + vec2<i32>(0, 1), nn), 0).y;
  textureStore(outTex, p, vec4f(0.5 * ((r - l) + (t - b)), 0.0, 0.0, 1.0));
}
`;

export const JACOBI_WGSL = /* wgsl */ `
${FLUID_HEAD}
@group(0) @binding(1) var pTex: texture_2d<f32>;
@group(0) @binding(2) var divTex: texture_2d<f32>;
@group(0) @binding(3) var outTex: texture_storage_2d<r32float, write>;
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let N = i32(U.a.w + 0.5);
  let nn = vec2<i32>(N);
  let p = vec2<i32>(gid.xy);
  if (p.x >= N || p.y >= N) { return; }
  let l = textureLoad(pTex, clampI(p + vec2<i32>(-1, 0), nn), 0).x;
  let r = textureLoad(pTex, clampI(p + vec2<i32>(1, 0), nn), 0).x;
  let b = textureLoad(pTex, clampI(p + vec2<i32>(0, -1), nn), 0).x;
  let t = textureLoad(pTex, clampI(p + vec2<i32>(0, 1), nn), 0).x;
  let d = textureLoad(divTex, p, 0).x;
  textureStore(outTex, p, vec4f((l + r + b + t - d) * 0.25, 0.0, 0.0, 1.0));
}
`;

export const GRAD_WGSL = /* wgsl */ `
${FLUID_HEAD}
@group(0) @binding(1) var pTex: texture_2d<f32>;
@group(0) @binding(2) var vel: texture_2d<f32>;
@group(0) @binding(3) var outTex: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let N = i32(U.a.w + 0.5);
  let nn = vec2<i32>(N);
  let p = vec2<i32>(gid.xy);
  if (p.x >= N || p.y >= N) { return; }
  let l = textureLoad(pTex, clampI(p + vec2<i32>(-1, 0), nn), 0).x;
  let r = textureLoad(pTex, clampI(p + vec2<i32>(1, 0), nn), 0).x;
  let b = textureLoad(pTex, clampI(p + vec2<i32>(0, -1), nn), 0).x;
  let t = textureLoad(pTex, clampI(p + vec2<i32>(0, 1), nn), 0).x;
  let v = textureLoad(vel, p, 0).xy - 0.5 * vec2f(r - l, t - b);
  textureStore(outTex, p, vec4f(v, 0.0, 1.0));
}
`;

/** dye uniforms: 0 (dt, size, -, nd) · 4 drift (x, y, -, -) · 8 decay (foam, bio, oil, fire per s) */
export const DYE_WGSL = /* wgsl */ `
${GID}
struct DU_ { a: vec4f, drift: vec4f, decay: vec4f };
@group(0) @binding(0) var<uniform> U: DU_;
@group(0) @binding(1) var dye: texture_2d<f32>;
@group(0) @binding(2) var vel: texture_2d<f32>;
@group(0) @binding(3) var f1Tex: texture_2d<f32>;    // sources
@group(0) @binding(4) var lin: sampler;
@group(0) @binding(5) var outTex: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let N = i32(U.a.w + 0.5);
  let p = vec2<i32>(gid.xy);
  if (p.x >= N || p.y >= N) { return; }
  let dt = U.a.x;
  let uv = (vec2f(p) + 0.5) / U.a.w;
  let v = textureSampleLevel(vel, lin, uv, 0.0).xy + U.drift.xy;
  let back = uv - v * dt / U.a.y;
  var d = textureSampleLevel(dye, lin, back, 0.0);
  d *= exp(-U.decay * dt);
  // burning oil consumes oil and dies without it
  let burn = d.a * 0.08 * dt;
  d.b = max(0.0, d.b - burn);
  d.a *= select(exp(-1.5 * dt), 1.0, d.b > 0.02);
  let src = textureSampleLevel(f1Tex, lin, uv, 0.0);
  d += src * dt;
  let e = min(uv, 1.0 - uv);
  d *= smoothstep(0.0, 0.02, min(e.x, e.y));
  textureStore(outTex, p, clamp(d, vec4f(0.0), vec4f(2.0, 2.0, 2.0, 1.5)));
}
`;
