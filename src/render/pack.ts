// CPU packers shared by every backend: they turn scene data into flat float arrays (positions
// relative to the render origin or the sim window) that a backend uploads as instance / storage
// buffers unchanged. Layouts here are the contract between the CPU and both shader sets.

import { MAT, PK } from './materials';
import type { ParticleSystem } from './particles';
import type { StackInstance } from './scene';
import type { HullInput, SplatInput } from '../water/simInputs';

/** floats per sprite-stack slice instance: pos+sliceZ, quat, rect, atlas uv, misc */
export const STACK_FLOATS = 24;
/** floats per particle: pos+size, rgba, material/emissive/up/smoke */
export const PARTICLE_FLOATS = 12;
/** floats per force-raster instance (hull or splat) */
export const FORCE_FLOATS = 20;

/** plain (non-shared) float array: what GPU upload calls accept */
export type F32 = Float32Array<ArrayBuffer>;

/** growable float buffer: returns `out` when it holds `n` floats, else a bigger copy */
export function ensure(out: F32, n: number): F32 {
  if (out.length >= n) return out;
  const g = new Float32Array(Math.max(n, out.length * 2, 64));
  g.set(out);
  return g;
}

/** one instance per voxel slice; returns the (possibly regrown) buffer and the instance count */
export function packStacks(stacks: StackInstance[], ox: number, oy: number, out: F32): { data: F32; count: number } {
  let n = 0;
  for (const it of stacks) n += it.model.slices.length;
  const d = ensure(out, n * STACK_FLOATS);
  let o = 0;
  for (const it of stacks) {
    for (const s of it.model.slices) {
      d[o] = it.x - ox; d[o + 1] = it.y - oy; d[o + 2] = it.z; d[o + 3] = s.z;
      d[o + 4] = it.q.x; d[o + 5] = it.q.y; d[o + 6] = it.q.z; d[o + 7] = it.q.w;
      d[o + 8] = s.x0; d[o + 9] = s.y0; d[o + 10] = s.w; d[o + 11] = s.h;
      d[o + 12] = s.u0; d[o + 13] = s.v0; d[o + 14] = s.u1; d[o + 15] = s.v1;
      d[o + 16] = it.damage ?? 0; d[o + 17] = it.flags ?? 0; d[o + 18] = it.clipX0 ?? -1e4; d[o + 19] = it.clipX1 ?? 1e4;
      const hs = it.hits;
      d[o + 20] = hs ? hs[0] : 0; d[o + 21] = hs ? hs[1] : 0; d[o + 22] = hs ? hs[2] : 0; d[o + 23] = hs ? hs[3] : 0;
      o += STACK_FLOATS;
    }
  }
  return { data: d, count: n };
}

/** particles relative to the origin with their per-kind look (alpha, material, emissive) resolved */
export function packParticles(ps: ParticleSystem, ox: number, oy: number, time: number, out: F32): { data: F32; count: number } {
  const B = ensure(out, ps.n * PARTICLE_FLOATS);
  for (let i = 0; i < ps.n; i++) {
    const o = i * PARTICLE_FLOATS, k = ps.kind[i], t = ps.max[i] > 0 ? ps.life[i] / ps.max[i] : 0;
    B[o] = ps.px[i] - ox; B[o + 1] = ps.py[i] - oy; B[o + 2] = ps.pz[i]; B[o + 3] = ps.size[i];
    let r = ps.r[i], g = ps.g[i], b = ps.b[i], a = 1, mat: number = MAT.SPRAY, em = 0, up = 0.3, smoke = 0;
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
  return { data: B, count: ps.n };
}

/**
 * Hull footprints then splats, relative to the sim window origin (winOx, winOy). Splats are tagged
 * kind 10 and their per-second sources are scaled by `dtScale` (1 / sim dt) so a one-frame splat
 * deposits its full amount.
 */
export function packForces(hulls: HullInput[], splats: SplatInput[], winOx: number, winOy: number, dtScale: number, out: F32): { data: F32; count: number } {
  const n = hulls.length + splats.length;
  const d = ensure(out, n * FORCE_FLOATS);
  let o = 0;
  for (const h of hulls) {
    d[o] = h.x - winOx; d[o + 1] = h.y - winOy; d[o + 2] = h.fx; d[o + 3] = h.fy;
    d[o + 4] = Math.max(0.5, h.halfLen); d[o + 5] = Math.max(0.4, h.halfBeam); d[o + 6] = h.vx; d[o + 7] = h.vy;
    d[o + 8] = h.angVel; d[o + 9] = h.thrust; d[o + 10] = h.draft; d[o + 11] = h.depth;
    d[o + 12] = h.foam; d[o + 13] = h.oil; d[o + 14] = h.fire; d[o + 15] = h.kind;
    d[o + 16] = 0; d[o + 17] = 0; d[o + 18] = 0; d[o + 19] = 0;
    o += FORCE_FLOATS;
  }
  for (const s of splats) {
    d[o] = s.x - winOx; d[o + 1] = s.y - winOy; d[o + 2] = 1; d[o + 3] = 0;
    d[o + 4] = Math.max(0.5, s.radius); d[o + 5] = 0; d[o + 6] = 0; d[o + 7] = 0;
    d[o + 8] = 0; d[o + 9] = 0; d[o + 10] = 0; d[o + 11] = 0;
    d[o + 12] = 0; d[o + 13] = s.oil * dtScale; d[o + 14] = s.fire * dtScale; d[o + 15] = 10;
    d[o + 16] = s.wave; d[o + 17] = s.foam * dtScale; d[o + 18] = s.bio * dtScale; d[o + 19] = s.push;
    o += FORCE_FLOATS;
  }
  return { data: d, count: n };
}
