// Voxel models for sprite stacking. A ship is painted into a voxel volume (x = stern->bow,
// y = port->starboard, z = keel->masthead), then cut into horizontal slices. Each slice becomes
// a textured quad; drawn bottom-to-top with the body's full 3D rotation they read as a solid
// pixel-art model that can roll, pitch, heel and sink. Normals come from the occupancy gradient.

import { hexToRgb } from '../core/math';

export const VM = {
  METAL: 2, WOOD: 3, LAMP: 7, GLASS: 7, RUST: 2, CANVAS: 3, BLACK: 2,
} as const;

export class VoxelModel {
  readonly col: Uint8Array;   // rgba per voxel (a = 0 empty)
  readonly mat: Uint8Array;   // material id per voxel
  /** model-space position (m) of the corner of voxel (0,0,0) */
  ox: number; oy: number; oz: number;
  constructor(readonly name: string, readonly nx: number, readonly ny: number, readonly nz: number, readonly res: number, readonly zres: number, ox: number, oy: number, oz: number) {
    this.col = new Uint8Array(nx * ny * nz * 4);
    this.mat = new Uint8Array(nx * ny * nz);
    this.ox = ox; this.oy = oy; this.oz = oz;
  }
  idx(x: number, y: number, z: number) { return (z * this.ny + y) * this.nx + x; }
  inside(x: number, y: number, z: number) { return x >= 0 && y >= 0 && z >= 0 && x < this.nx && y < this.ny && z < this.nz; }
  filled(x: number, y: number, z: number) { return this.inside(x, y, z) && this.col[this.idx(x, y, z) * 4 + 3] > 0; }
  /** model meters -> voxel indices */
  vx(m: number) { return Math.floor((m - this.ox) / this.res); }
  vy(m: number) { return Math.floor((m - this.oy) / this.res); }
  vz(m: number) { return Math.floor((m - this.oz) / this.zres); }
  /** voxel center in model meters */
  mx(i: number) { return this.ox + (i + 0.5) * this.res; }
  my(j: number) { return this.oy + (j + 0.5) * this.res; }
  mz(k: number) { return this.oz + (k + 0.5) * this.zres; }

  set(x: number, y: number, z: number, rgb: [number, number, number] | string, mat: number = VM.METAL) {
    if (!this.inside(x, y, z)) return;
    const c = typeof rgb === 'string' ? hexToRgb(rgb) : rgb;
    const i = this.idx(x, y, z);
    this.col[i * 4] = c[0]; this.col[i * 4 + 1] = c[1]; this.col[i * 4 + 2] = c[2]; this.col[i * 4 + 3] = 255;
    this.mat[i] = mat;
  }
  clear(x: number, y: number, z: number) {
    if (!this.inside(x, y, z)) return;
    this.col[this.idx(x, y, z) * 4 + 3] = 0;
  }
  get(x: number, y: number, z: number): [number, number, number] | null {
    if (!this.filled(x, y, z)) return null;
    const i = this.idx(x, y, z) * 4;
    return [this.col[i], this.col[i + 1], this.col[i + 2]];
  }
  /** fill an axis-aligned box given in model meters (inclusive-exclusive) */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: ColorFn | string, mat: number = VM.METAL) {
    const f = typeof color === 'string' ? () => color : color;
    for (let k = this.vz(z0); k < this.vz(z1); k++) for (let j = this.vy(y0); j < this.vy(y1); j++) for (let i = this.vx(x0); i < this.vx(x1); i++) {
      if (!this.inside(i, j, k)) continue;
      const c = f(i, j, k, this);
      if (c) this.set(i, j, k, c, mat);
    }
  }
  /** vertical cylinder centered at (cx, cy) in meters */
  cyl(cx: number, cy: number, r: number, z0: number, z1: number, color: ColorFn | string, mat: number = VM.METAL, rx = r) {
    const f = typeof color === 'string' ? () => color : color;
    for (let k = this.vz(z0); k < this.vz(z1); k++) for (let j = this.vy(cy - r - 1); j <= this.vy(cy + r + 1); j++) for (let i = this.vx(cx - rx - 1); i <= this.vx(cx + rx + 1); i++) {
      if (!this.inside(i, j, k)) continue;
      const dx = (this.mx(i) - cx) / rx, dy = (this.my(j) - cy) / r;
      if (dx * dx + dy * dy <= 1.0) { const c = f(i, j, k, this); if (c) this.set(i, j, k, c, mat); }
    }
  }
  /** horizontal cylinder along x (gun barrels, pressure hulls) */
  cylX(x0: number, x1: number, cy: number, cz: number, r: number, color: ColorFn | string, mat: number = VM.METAL) {
    const f = typeof color === 'string' ? () => color : color;
    for (let k = this.vz(cz - r - 0.5); k <= this.vz(cz + r + 0.5); k++) for (let j = this.vy(cy - r - 0.5); j <= this.vy(cy + r + 0.5); j++) for (let i = this.vx(x0); i < this.vx(x1); i++) {
      if (!this.inside(i, j, k)) continue;
      const dy = this.my(j) - cy, dz = this.mz(k) - cz;
      if (dy * dy + dz * dz <= r * r + 0.02) { const c = f(i, j, k, this); if (c) this.set(i, j, k, c, mat); }
    }
  }
  /** a line of voxels between two model points (masts, rails, stays, barrels at an angle) */
  line(a: [number, number, number], b: [number, number, number], color: string, mat: number = VM.METAL) {
    const steps = Math.ceil(Math.max(Math.abs(b[0] - a[0]) / this.res, Math.abs(b[1] - a[1]) / this.res, Math.abs(b[2] - a[2]) / this.zres) * 1.5) + 1;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      this.set(this.vx(a[0] + (b[0] - a[0]) * t), this.vy(a[1] + (b[1] - a[1]) * t), this.vz(a[2] + (b[2] - a[2]) * t), color, mat);
    }
  }
  /** recolor the top-most voxel of every column inside a box (decks, hatches, painted markings) */
  paintTop(x0: number, x1: number, y0: number, y1: number, color: ColorFn | string, mat?: number) {
    const f = typeof color === 'string' ? () => color : color;
    for (let j = this.vy(y0); j < this.vy(y1); j++) for (let i = this.vx(x0); i < this.vx(x1); i++) {
      if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) continue;
      for (let k = this.nz - 1; k >= 0; k--) {
        if (this.filled(i, j, k)) { const c = f(i, j, k, this); if (c) this.set(i, j, k, c, mat ?? this.mat[this.idx(i, j, k)]); break; }
      }
    }
  }
  topZ(i: number, j: number): number {
    for (let k = this.nz - 1; k >= 0; k--) if (this.filled(i, j, k)) return k;
    return -1;
  }
}

export type ColorFn = (i: number, j: number, k: number, m: VoxelModel) => string | [number, number, number] | null;

// ---------------------------------------------------------------------------------------------
// Slice atlas

export interface Slice {
  z: number;                 // model-space height of the slice plane (top of the voxel layer)
  x0: number; y0: number;    // model-space corner (m)
  w: number; h: number;      // size (m)
  u0: number; v0: number; u1: number; v1: number; // atlas uv
}
export interface StackModel {
  name: string;
  slices: Slice[];
  length: number; beam: number; height: number;
  zMin: number; zMax: number;
  /** footprint at the waterline for physics/sims */
  model: VoxelModel;
}

export class SliceAtlas {
  readonly size: number;
  readonly albedo: Uint8Array;
  readonly normal: Uint8Array;
  private shelfX = 0; private shelfY = 0; private shelfH = 0;
  /** bumped on every change; each render backend re-uploads when it differs from what it last sent */
  version = 1;
  models = new Map<string, StackModel>();
  constructor(size = 2048) {
    this.size = size;
    this.albedo = new Uint8Array(size * size * 4);
    this.normal = new Uint8Array(size * size * 4);
  }

  private alloc(w: number, h: number): [number, number] {
    const pad = 1;
    if (this.shelfX + w + pad > this.size) { this.shelfX = 0; this.shelfY += this.shelfH + pad; this.shelfH = 0; }
    if (this.shelfY + h + pad > this.size) throw new Error('slice atlas full');
    const x = this.shelfX, y = this.shelfY;
    this.shelfX += w + pad;
    this.shelfH = Math.max(this.shelfH, h);
    return [x, y];
  }

  add(m: VoxelModel): StackModel {
    const existing = this.models.get(m.name);
    if (existing) return existing;
    const slices: Slice[] = [];
    const S = this.size;
    let zMin = Infinity, zMax = -Infinity;
    for (let k = 0; k < m.nz; k++) {
      // bounding box of this layer
      let i0 = m.nx, i1 = -1, j0 = m.ny, j1 = -1;
      for (let j = 0; j < m.ny; j++) for (let i = 0; i < m.nx; i++) if (m.filled(i, j, k)) {
        if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j;
      }
      if (i1 < 0) continue;
      const w = i1 - i0 + 1, h = j1 - j0 + 1;
      const [ax, ay] = this.alloc(w, h);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const t = ((ay + j - j0) * S + (ax + i - i0)) * 4;
        if (!m.filled(i, j, k)) { this.albedo[t + 3] = 0; continue; }
        const v = m.idx(i, j, k) * 4;
        this.albedo[t] = m.col[v]; this.albedo[t + 1] = m.col[v + 1]; this.albedo[t + 2] = m.col[v + 2]; this.albedo[t + 3] = 255;
        const [nx, ny, nz] = voxelNormal(m, i, j, k);
        this.normal[t] = Math.round((nx * 0.5 + 0.5) * 255);
        this.normal[t + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        this.normal[t + 2] = Math.round((nz * 0.5 + 0.5) * 255);
        this.normal[t + 3] = m.mat[m.idx(i, j, k)];
      }
      const z = m.oz + (k + 1) * m.zres;
      zMin = Math.min(zMin, z - m.zres); zMax = Math.max(zMax, z);
      slices.push({
        z, x0: m.ox + i0 * m.res, y0: m.oy + j0 * m.res, w: w * m.res, h: h * m.res,
        u0: ax / S, v0: ay / S, u1: (ax + w) / S, v1: (ay + h) / S,
      });
    }
    const sm: StackModel = { name: m.name, slices, length: m.nx * m.res, beam: m.ny * m.res, height: m.nz * m.zres, zMin, zMax, model: m };
    this.models.set(m.name, sm);
    this.version++;
    return sm;
  }
}

/** smoothed outward normal from the occupancy gradient (5x5x5 weighted) */
function voxelNormal(m: VoxelModel, i: number, j: number, k: number): [number, number, number] {
  // interior voxels are never seen; skip the expensive kernel
  if (m.filled(i + 1, j, k) && m.filled(i - 1, j, k) && m.filled(i, j + 1, k) && m.filled(i, j - 1, k) && m.filled(i, j, k + 1) && m.filled(i, j, k - 1)) return [0, 0, 1];
  let gx = 0, gy = 0, gz = 0;
  const R = 2;
  for (let dz = -R; dz <= R; dz++) for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    if (!dx && !dy && !dz) continue;
    if (m.filled(i + dx, j + dy, k + dz)) continue;
    // empty neighbour pulls the normal toward it (scaled for anisotropic voxels)
    const wx = dx * m.res, wy = dy * m.res, wz = dz * m.zres;
    const d2 = wx * wx + wy * wy + wz * wz;
    gx += wx / d2; gy += wy / d2; gz += wz / d2;
  }
  const l = Math.hypot(gx, gy, gz);
  if (l < 1e-6) return [0, 0, 1];
  return [gx / l, gy / l, gz / l];
}
