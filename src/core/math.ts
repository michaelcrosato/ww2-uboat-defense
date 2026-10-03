// Small math kit shared by every system. World space: x = east, y = south, z = up (meters).
// Heading angles are radians in the xy plane with forward = (cos h, sin h); they grow clockwise on screen.

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const KNOT = 0.514444; // m/s per knot

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const sign = (v: number) => (v < 0 ? -1 : 1);
export const sq = (v: number) => v * v;

/** wrap an angle to (-PI, PI] */
export const wrapAngle = (a: number) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};
/** shortest signed difference b - a */
export const angleDiff = (a: number, b: number) => wrapAngle(b - a);
/** heading (radians) -> compass bearing in degrees, 0 = north (-y), 90 = east */
export const toBearing = (h: number) => {
  let b = (h / DEG + 90) % 360;
  if (b < 0) b += 360;
  return b;
};
export const fromBearing = (deg: number) => (deg - 90) * DEG;
/** exponential approach factor for frame-rate independent smoothing */
export const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
export const approach = (v: number, target: number, maxDelta: number) =>
  v < target ? Math.min(target, v + maxDelta) : Math.max(target, v - maxDelta);

export interface V2 { x: number; y: number }
export interface V3 { x: number; y: number; z: number }
export interface Quat { x: number; y: number; z: number; w: number }

export const v2 = (x = 0, y = 0): V2 => ({ x, y });
export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const len2 = (x: number, y: number) => Math.sqrt(x * x + y * y);
export const dist2 = (ax: number, ay: number, bx: number, by: number) => Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));
export const dist3 = (a: V3, b: V3) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);

/** rotate local vector (x,y,z) by quaternion q into out */
export function qrot(q: Quat, x: number, y: number, z: number, out: V3 = v3()): V3 {
  const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  out.x = x + qw * tx + (qy * tz - qz * ty);
  out.y = y + qw * ty + (qz * tx - qx * tz);
  out.z = z + qw * tz + (qx * ty - qy * tx);
  return out;
}
/** inverse-rotate world vector into the local frame of q */
export function qrotInv(q: Quat, x: number, y: number, z: number, out: V3 = v3()): V3 {
  return qrot({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, x, y, z, out);
}
export function quatFromYaw(h: number): Quat {
  return { x: 0, y: 0, z: Math.sin(h / 2), w: Math.cos(h / 2) };
}
export function quatFromEuler(roll: number, pitch: number, yaw: number): Quat {
  // intrinsic Z (yaw) * Y (pitch) * X (roll)
  const cr = Math.cos(roll / 2), sr = Math.sin(roll / 2);
  const cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
  return {
    w: cr * cp * cy + sr * sp * sy,
    x: sr * cp * cy - cr * sp * sy,
    y: cr * sp * cy + sr * cp * sy,
    z: cr * cp * sy - sr * sp * cy,
  };
}
/** yaw (heading) of a body: angle of its local +x axis projected on the ground plane */
export function yawOf(q: Quat): number {
  const f = qrot(q, 1, 0, 0, _t);
  return Math.atan2(f.y, f.x);
}
const _t = v3();
/** roll (about local x, positive = starboard down) and pitch (positive = bow up) for display / logic */
export function rollPitchOf(q: Quat): { roll: number; pitch: number } {
  const f = qrot(q, 1, 0, 0, v3());
  const r = qrot(q, 0, 1, 0, v3());
  return { pitch: Math.asin(clamp(f.z, -1, 1)), roll: -Math.asin(clamp(r.z, -1, 1)) };
}

// ---------------------------------------------------------------------------------------------
// Deterministic RNG (sfc32) so arenas, loot and AI can be replayed from a seed.
export class Rng {
  private a: number; private b: number; private c: number; private d: number;
  constructor(seed: number | string = 1) {
    let h = typeof seed === 'string' ? hashStr(seed) : seed >>> 0;
    this.a = h ^ 0xdeadbeef; this.b = h ^ 0x41c6ce57; this.c = h * 31 + 7; this.d = 1;
    for (let i = 0; i < 12; i++) this.next();
  }
  next(): number {
    let a = this.a >>> 0, b = this.b >>> 0, c = this.c >>> 0, d = this.d >>> 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    this.a = a; this.b = b; this.c = c; this.d = d;
    return (t >>> 0) / 4294967296;
  }
  range(a: number, b: number) { return a + (b - a) * this.next(); }
  int(a: number, b: number) { return Math.floor(a + (b - a + 1) * this.next()); }
  chance(p: number) { return this.next() < p; }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length) % arr.length]; }
  sign() { return this.next() < 0.5 ? -1 : 1; }
  /** gaussian-ish (sum of 3 uniforms) */
  gauss(mean = 0, sd = 1) { return mean + sd * ((this.next() + this.next() + this.next()) * 2 - 3) * 0.8165; }
  weighted<T>(items: readonly T[], weight: (t: T) => number): T {
    let total = 0;
    for (const it of items) total += Math.max(0, weight(it));
    let r = this.next() * total;
    for (const it of items) { r -= Math.max(0, weight(it)); if (r <= 0) return it; }
    return items[items.length - 1];
  }
}
export function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** global non-deterministic rng for cosmetic effects */
export const fx = new Rng((Math.random() * 2 ** 31) | 0);

// ---------------------------------------------------------------------------------------------
// Cheap 2D value noise for CPU-side cosmetic use (wind gusts, flicker).
export function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function noise2(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
export const noise1 = (t: number, seed = 0) => noise2(t, seed * 17.13);

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}
export const hex01 = (hex: string): [number, number, number] => {
  const [r, g, b] = hexToRgb(hex);
  return [r / 255, g / 255, b / 255];
};
export function mixHex(a: string, b: string, t: number): string {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t));
}
export function formatTime(s: number): string {
  s = Math.max(0, Math.floor(s));
  const m = Math.floor(s / 60), r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}
export const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
