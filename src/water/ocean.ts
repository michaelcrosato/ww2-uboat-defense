// The open-ocean surface: a sum of Gerstner (trochoidal) waves whose amplitudes follow a
// Pierson-Moskowitz wind-sea spectrum for the Beaufort sea state, plus a long background swell.
// The exact same math runs in GLSL (src/render/webgl2/glsl/ocean.ts) for rendering and here on the CPU for buoyancy,
// so ships ride the waves you see.

import { Rng, TAU } from '../core/math';

export const G = 9.81;
export const MAX_WAVES = 16;

export interface WaveComp {
  dx: number; dy: number;   // unit travel direction
  k: number;                // wavenumber (rad/m)
  A: number;                // amplitude (m)
  omega: number;            // angular frequency (rad/s), deep-water dispersion
  phase0: number;           // random initial phase
  Q: number;                // Gerstner steepness (0..1)
}

/** Beaufort -> mean wind speed (m/s) */
export const BEAUFORT_WIND = [0.2, 1.0, 2.5, 4.4, 6.7, 9.3, 12.3, 15.5, 18.9, 22.6, 26.4, 30.5, 34];
export const BEAUFORT_NAME = ['Calm', 'Light air', 'Light breeze', 'Gentle breeze', 'Moderate breeze', 'Fresh breeze', 'Strong breeze', 'Near gale', 'Gale', 'Strong gale', 'Storm', 'Violent storm', 'Hurricane'];

export interface SeaParams {
  seaState: number;       // Beaufort 0..12 (fractional ok)
  windDir: number;        // radians, direction the wind sea travels toward
  swellHeight: number;    // significant height of the background swell (m)
  swellDir: number;       // radians, swell travel direction
  swellLength: number;    // swell wavelength (m)
  choppiness: number;     // 0..1 Gerstner sharpness
  count: number;          // number of wave components (<= MAX_WAVES)
  ampScale: number;       // gameplay scale on wind-sea amplitude
  seed: number;
}

export interface OceanSample {
  h: number;              // surface height (m)
  nx: number; ny: number; nz: number; // surface normal
  vz: number;             // vertical surface velocity (m/s)
  ux: number; uy: number; // horizontal orbital velocity (m/s)
  jac: number;            // Jacobian determinant (< ~0.3 = breaking crest)
}

export class Ocean {
  waves: WaveComp[] = [];
  time = 0;
  params: SeaParams = { seaState: 4, windDir: 0, swellHeight: 1, swellDir: 0.3, swellLength: 160, choppiness: 0.55, count: 12, ampScale: 1, seed: 7 };
  /** significant wave height of the wind sea, for HUD/AI */
  hs = 0;
  windSpeed = 0;
  /** extra transient rings from big explosions, sampled on the CPU too so ships rock */
  rings: { x: number; y: number; t0: number; amp: number; speed: number; width: number }[] = [];

  setSea(p: Partial<SeaParams>) {
    Object.assign(this.params, p);
    const P = this.params;
    const rng = new Rng(P.seed * 7919 + 13);
    const B = Math.max(0, Math.min(12, P.seaState));
    const bi = Math.floor(B), bf = B - bi;
    const U = BEAUFORT_WIND[bi] * (1 - bf) + BEAUFORT_WIND[Math.min(12, bi + 1)] * bf;
    this.windSpeed = U;
    const out: WaveComp[] = [];
    const nSwell = P.swellHeight > 0.05 ? 2 : 0;
    const nWind = Math.max(2, Math.min(MAX_WAVES, P.count) - nSwell);
    // Pierson-Moskowitz: S(w) = a g^2 w^-5 exp(-1.25 (wp/w)^4)
    const wp = U > 0.5 ? (0.877 * G) / U : 3.5;
    const w0 = wp * 0.62, w1 = Math.max(wp * 4.2, 2.6);
    const alpha = 0.0081;
    let m0 = 0;
    for (let i = 0; i < nWind; i++) {
      const t0 = i / nWind, t1 = (i + 1) / nWind;
      const wa = w0 * Math.pow(w1 / w0, t0), wb = w0 * Math.pow(w1 / w0, t1);
      const w = Math.sqrt(wa * wb) * (1 + rng.range(-0.08, 0.08));
      const S = (alpha * G * G) / Math.pow(w, 5) * Math.exp(-1.25 * Math.pow(wp / w, 4));
      let A = Math.sqrt(2 * S * (wb - wa));
      if (U < 1.5) A = Math.max(A, 0.02 + 0.03 * rng.next()); // glassy calm still has tiny ripples
      A *= P.ampScale;
      m0 += (A * A) / 2;
      const k = (w * w) / G;
      // directional spreading widens for short waves
      const spread = (0.35 + 0.65 * t0) * 1.05;
      const dir = P.windDir + rng.gauss(0, spread * 0.6) + (i % 2 ? 1 : -1) * spread * 0.25;
      out.push({ dx: Math.cos(dir), dy: Math.sin(dir), k, A, omega: w, phase0: rng.range(0, TAU), Q: 0 });
    }
    this.hs = 4 * Math.sqrt(m0);
    for (let i = 0; i < nSwell; i++) {
      const L = P.swellLength * (i === 0 ? 1 : 0.83);
      const k = TAU / L, w = Math.sqrt(G * k);
      const A = (P.swellHeight / 2) * (i === 0 ? 0.78 : 0.55);
      const dir = P.swellDir + (i === 0 ? 0 : 0.21);
      out.push({ dx: Math.cos(dir), dy: Math.sin(dir), k, A, omega: w, phase0: rng.range(0, TAU), Q: 0 });
    }
    // Gerstner steepness: distribute choppiness so sum(Q k A) stays below 1 (no loops)
    let sumKA = 0;
    for (const c of out) sumKA += c.k * c.A;
    const target = Math.min(0.95, P.choppiness);
    for (const c of out) c.Q = sumKA > 1e-6 ? Math.min(1, target / sumKA) : 0;
    this.waves = out;
  }

  update(dt: number) {
    this.time += dt;
    if (this.rings.length) this.rings = this.rings.filter((r) => this.time - r.t0 < 14);
  }

  addRing(x: number, y: number, amp: number, speed = 9, width = 6) {
    this.rings.push({ x, y, t0: this.time, amp, speed, width });
    if (this.rings.length > 8) this.rings.shift();
  }

  /** height only (fast path) at world point */
  height(x: number, y: number): number {
    const qx0 = x, qy0 = y;
    let qx = x, qy = y;
    const W = this.waves, t = this.time;
    // invert the Gerstner horizontal displacement (2 fixed-point iterations)
    for (let it = 0; it < 2; it++) {
      let dx = 0, dy = 0;
      for (let i = 0; i < W.length; i++) {
        const c = W[i];
        const s = Math.sin(c.k * (c.dx * qx + c.dy * qy) - c.omega * t + c.phase0) * c.Q * c.A;
        dx += c.dx * s; dy += c.dy * s;
      }
      qx = qx0 + dx; qy = qy0 + dy;
    }
    let h = 0;
    for (let i = 0; i < W.length; i++) {
      const c = W[i];
      h += c.A * Math.cos(c.k * (c.dx * qx + c.dy * qy) - c.omega * t + c.phase0);
    }
    return h + this.ringHeight(x, y);
  }

  private ringHeight(x: number, y: number): number {
    let h = 0;
    for (const r of this.rings) {
      const age = this.time - r.t0;
      const d = Math.hypot(x - r.x, y - r.y);
      const front = age * r.speed;
      const u = (d - front) / r.width;
      if (u < -6 || u > 2) continue;
      const decay = r.amp / (1 + age * 0.6) / Math.sqrt(1 + d * 0.05);
      h += decay * Math.cos(u * 2.2) * Math.exp(-u * u * 0.15);
    }
    return h;
  }

  sample(x: number, y: number, out: OceanSample): OceanSample {
    const qx0 = x, qy0 = y;
    let qx = x, qy = y;
    const W = this.waves, t = this.time;
    for (let it = 0; it < 2; it++) {
      let dx = 0, dy = 0;
      for (let i = 0; i < W.length; i++) {
        const c = W[i];
        const s = Math.sin(c.k * (c.dx * qx + c.dy * qy) - c.omega * t + c.phase0) * c.Q * c.A;
        dx += c.dx * s; dy += c.dy * s;
      }
      qx = qx0 + dx; qy = qy0 + dy;
    }
    let h = 0, jxx = 1, jyy = 1, jxy = 0, hx = 0, hy = 0, vz = 0, ux = 0, uy = 0;
    for (let i = 0; i < W.length; i++) {
      const c = W[i];
      const th = c.k * (c.dx * qx + c.dy * qy) - c.omega * t + c.phase0;
      const cs = Math.cos(th), sn = Math.sin(th);
      const kA = c.k * c.A;
      h += c.A * cs;
      hx -= c.dx * kA * sn; hy -= c.dy * kA * sn;
      const qka = c.Q * kA * cs;
      jxx -= qka * c.dx * c.dx; jyy -= qka * c.dy * c.dy; jxy -= qka * c.dx * c.dy;
      vz += c.A * c.omega * sn;            // d/dt of A cos(k.x - w t)
      ux += c.dx * c.A * c.omega * cs;     // orbital velocity at the surface
      uy += c.dy * c.A * c.omega * cs;
    }
    // tangents dP/dqx = (jxx, jxy, hx), dP/dqy = (jxy, jyy, hy); normal = cross
    let nx = jxy * hy - hx * jyy, ny = hx * jxy - jxx * hy, nz = jxx * jyy - jxy * jxy;
    const inv = 1 / Math.hypot(nx, ny, nz);
    nx *= inv; ny *= inv; nz *= inv;
    out.h = h + this.ringHeight(x, y);
    out.nx = nx; out.ny = ny; out.nz = nz;
    out.vz = vz; out.ux = ux; out.uy = uy;
    out.jac = jxx * jyy - jxy * jxy;
    return out;
  }

  /** pack wave uniforms relative to a render origin (keeps shader numbers small and precise) */
  pack(ox: number, oy: number, a: Float32Array, b: Float32Array): number {
    const W = this.waves, t = this.time;
    for (let i = 0; i < MAX_WAVES; i++) {
      const c = W[i];
      if (!c) { a.fill(0, i * 4, i * 4 + 4); b.fill(0, i * 4, i * 4 + 4); continue; }
      let ph = c.phase0 - c.omega * t + c.k * (c.dx * ox + c.dy * oy);
      ph = ph % TAU; if (ph < 0) ph += TAU;
      a[i * 4] = c.dx; a[i * 4 + 1] = c.dy; a[i * 4 + 2] = c.k; a[i * 4 + 3] = c.A;
      b[i * 4] = ph; b[i * 4 + 1] = c.Q; b[i * 4 + 2] = c.omega; b[i * 4 + 3] = 0;
    }
    return W.length;
  }

  /** pack the explosion rings for the shader (x, y relative to origin, age, amp) */
  packRings(ox: number, oy: number, out: Float32Array): number {
    let n = 0;
    for (const r of this.rings) {
      if (n >= 8) break;
      out[n * 4] = r.x - ox; out[n * 4 + 1] = r.y - oy; out[n * 4 + 2] = this.time - r.t0; out[n * 4 + 3] = r.amp;
      n++;
    }
    return n;
  }
}
