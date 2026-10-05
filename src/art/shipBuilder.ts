// Parametric ship construction in voxels: hull forms, paint schemes and fittings. Ship classes
// in ships.ts are written with these verbs, so new classes are quick to add.

import { clamp, hash2, hexToRgb, lerp, rgbToHex } from '../core/math';
import { VoxelModel, VM, type ColorFn } from './voxel';

export interface HullSpec {
  name: string;
  length: number; beam: number; draft: number;
  /** freeboard (deck height above waterline) at stern, midships, bow */
  fbAft: number; fbMid: number; fbFwd: number;
  forecastle?: { from: number; height: number };
  poop?: { to: number; height: number };
  bowStart?: number;      // u where the bow taper begins (0.2..0.5)
  bowPow?: number;        // taper exponent (1 = straight, 2 = full)
  rake?: number;          // stem rake (0..0.15 of length fraction)
  stern?: 'cruiser' | 'transom' | 'counter';
  sternStart?: number;    // u (negative) where the stern taper begins
  vee?: number;           // section V-ness (0 round bilge .. 1 V)
  topHeight: number;      // tallest point above waterline (masts)
  res?: number; zres?: number;
  side: ColorFn | string;
  deck: ColorFn | string;
  boot?: string; bottom?: string; rail?: string;
  rails?: boolean;
}

export interface Hull {
  m: VoxelModel;
  spec: HullSpec;
  deckZ: (x: number) => number;
  halfBeam: (x: number, z: number) => number;
}

export function buildHull(s: HullSpec): Hull {
  const res = s.res ?? 0.5, zres = s.zres ?? 0.5;
  const L = s.length, B = s.beam, T = s.draft;
  const nx = Math.ceil(L / res) + 4, ny = Math.ceil(B / res) + 4, nz = Math.ceil((T + s.topHeight) / zres) + 2;
  const m = new VoxelModel(s.name, nx, ny, nz, res, zres, -L / 2 - 2 * res, -B / 2 - 2 * res, -T);
  const bowStart = s.bowStart ?? 0.35, bowPow = s.bowPow ?? 1.7, rake = s.rake ?? 0.06;
  const sternStart = s.sternStart ?? -0.7;
  const deckZ = (x: number) => {
    const u = x / (L / 2);
    let z = u >= 0 ? lerp(s.fbMid, s.fbFwd, u * u) : lerp(s.fbMid, s.fbAft, Math.min(1, -u * 1.2));
    if (s.forecastle && u > s.forecastle.from) z += s.forecastle.height;
    if (s.poop && u < s.poop.to) z += s.poop.height;
    return z;
  };
  const plan = (u: number) => {
    if (u > bowStart) {
      const t = (u - bowStart) / (1 - bowStart);
      return Math.max(0, 1 - Math.pow(t, bowPow));
    }
    if (u < sternStart) {
      const t = (sternStart - u) / (1 + sternStart);
      if (s.stern === 'transom') return lerp(1, 0.72, Math.pow(t, 1.5));
      if (s.stern === 'counter') return Math.max(0, 1 - Math.pow(t, 2.2) * 0.85);
      return Math.max(0, Math.sqrt(Math.max(0, 1 - t * t * 0.92)));
    }
    return 1;
  };
  const halfBeam = (x: number, z: number) => {
    const u = x / (L / 2);
    const fb = deckZ(x);
    const zn = clamp((z + T) / T, 0, 1.0);
    // stem rakes forward with height; the forefoot is cut back at the keel
    const stem = 1 - rake * (1 - clamp((z + T) / (T + fb), 0, 1)) * 1.6;
    if (u > stem) return 0;
    // cruiser stern rises out of the water toward the stern post
    if (u < -0.92 && z < -T * 0.25 && s.stern !== 'transom') return 0;
    let p = plan(u / Math.max(0.5, stem));
    // finer entry at the waterline than at the flared deck edge
    if (u > bowStart && z < fb * 0.6) p = Math.pow(p, 1 + 0.5 * (1 - clamp(z / (fb * 0.6), 0, 1)));
    let sec: number;
    if (z < 0) {
      const round = Math.sqrt(Math.max(0, 1 - Math.pow(1 - zn, 2.4)));
      const vee = clamp((s.vee ?? 0.25) + Math.max(0, u - 0.2) * 0.9, 0, 1);
      sec = lerp(round, Math.pow(zn, 0.8), vee);
    } else {
      sec = 1 + 0.035 * (z / Math.max(fb, 1)) * (u > 0.3 ? 2.5 : 1);
    }
    return (B / 2) * p * sec;
  };
  const sideF = typeof s.side === 'string' ? () => s.side as string : s.side;
  const boot = s.boot ?? '#1b1d1f', bottom = s.bottom ?? '#6a2a22';
  for (let k = 0; k < nz; k++) {
    const z = m.mz(k);
    for (let i = 0; i < nx; i++) {
      const x = m.mx(i);
      if (z > deckZ(x)) continue;
      for (let j = 0; j < ny; j++) {
        const y = m.my(j);
        const w = halfBeam(x, z);
        if (w <= 0 || Math.abs(y) > w) continue;
        let c: string | [number, number, number] | null;
        if (z < -0.45) c = shade(bottom, (hash2(i, k) - 0.5) * 0.12);
        else if (z < 0.35) c = boot;
        else c = sideF(i, j, k, m);
        if (c) m.set(i, j, k, c, VM.METAL);
      }
    }
  }
  // deck surface
  const deckF = typeof s.deck === 'string' ? () => s.deck as string : s.deck;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = m.topZ(i, j);
    if (k < 0) continue;
    const c = deckF(i, j, k, m);
    if (c) m.set(i, j, k, c, VM.WOOD);
  }
  // deck-edge rails / bulwark caps
  if (s.rails !== false) {
    const rail = s.rail ?? '#d8d8d0';
    for (let i = 0; i < nx; i++) {
      const x = m.mx(i);
      const dz = deckZ(x);
      const k = m.vz(dz) ;
      for (let j = 0; j < ny; j++) {
        if (!m.filled(i, j, k - 1 >= 0 ? k - 1 : 0) && !m.filled(i, j, k)) continue;
        const top = m.topZ(i, j);
        if (top < 0) continue;
        const edge = !m.filled(i, j - 1, top) || !m.filled(i, j + 1, top);
        if (edge && (i % 2 === 0 || x > 0)) m.set(i, j, top + 1, rail, VM.METAL);
      }
    }
  }
  return { m, spec: s, deckZ, halfBeam };
}

// ---------------------------------------------------------------------------------------------
// paint

export function shade(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = amt >= 0 ? (v: number) => v + (255 - v) * amt : (v: number) => v * (1 + amt);
  return rgbToHex(f(r), f(g), f(b));
}

/** angular disruptive camouflage: overlapping rotated bands select colors */
export function camo(colors: string[], scale = 9, seed = 1, angle = 0.5): ColorFn {
  return (i, j, k, m) => {
    const x = m.mx(i), z = m.mz(k), y = m.my(j);
    const side = y > 0 ? 1 : -1;
    const a = angle * side;
    const t1 = Math.floor((x * Math.cos(a) + z * 3 * Math.sin(a)) / scale + seed * 0.37);
    const t2 = Math.floor((x * Math.cos(a + 1.9) + z * 2.4 * Math.sin(a + 1.9)) / (scale * 1.7) + seed);
    const h = hash2(t1 * 7 + seed, t2 * 13 + side * 3);
    const c = colors[Math.floor(h * colors.length) % colors.length];
    return weather(c, i, k);
  };
}

/** subtle rust streaks and grime */
export function weather(c: string, i: number, k: number): string {
  const streak = hash2(i, 991);
  if (streak > 0.93 && hash2(i, k >> 2) > 0.3) return shade(c, -0.18 - (streak - 0.93) * 2);
  if (hash2(i * 3, k * 5) > 0.97) return shade(c, -0.1);
  return c;
}

/** planked wooden deck */
export function planks(base: string, seam: string): ColorFn {
  return (i, j) => (j % 3 === 0 ? seam : hash2(i >> 3, j) > 0.85 ? shade(base, -0.08) : base);
}
/** steel deck with plating seams and non-slip grit */
export function plating(base: string): ColorFn {
  return (i, j) => ((i % 8 === 0 || j % 6 === 0) ? shade(base, -0.12) : hash2(i, j) > 0.92 ? shade(base, 0.06) : base);
}

// ---------------------------------------------------------------------------------------------
// fittings

export function deckhouse(m: VoxelModel, x0: number, x1: number, halfW: number, z0: number, z1: number, wall: ColorFn | string, roof: string, windows?: { color: string; z: number; every?: number; front?: boolean }) {
  m.box(x0, x1, -halfW, halfW, z0, z1, wall, VM.METAL);
  m.paintTop(x0, x1, -halfW, halfW, roof);
  if (windows) {
    const k = m.vz(windows.z), ev = windows.every ?? 3;
    for (let i = m.vx(x0); i < m.vx(x1); i++) {
      if ((i % ev) !== 0) continue;
      for (const y of [-halfW, halfW - m.res]) { const j = m.vy(y); if (m.filled(i, j, k)) m.set(i, j, k, windows.color, VM.GLASS); }
    }
    if (windows.front) {
      const i = m.vx(x1 - m.res);
      for (let j = m.vy(-halfW); j < m.vy(halfW); j += 1) if (j % 2 === 0) m.set(i, j, k, windows.color, VM.GLASS);
    }
  }
}

export function funnel(m: VoxelModel, cx: number, rx: number, ry: number, z0: number, z1: number, color: string, band: string, rake = 0) {
  const k0 = m.vz(z0), k1 = m.vz(z1);
  for (let k = k0; k < k1; k++) {
    const t = (k - k0) / Math.max(1, k1 - k0);
    const x = cx - rake * t * (z1 - z0);
    const col = t > 0.86 ? '#141414' : t > 0.7 ? band : color;
    m.cyl(x, 0, ry, m.mz(k) - m.zres / 2, m.mz(k) + m.zres / 2, (i, j, kk) => (kk === k1 - 1 && Math.abs(m.mx(i) - x) < rx * 0.55 && Math.abs(m.my(j)) < ry * 0.55 ? '#050505' : weather(col, i, kk)), VM.METAL, rx);
  }
}

export function mast(m: VoxelModel, x: number, z0: number, z1: number, color = '#3a3a38', yards: { z: number; half: number }[] = [], nest?: number) {
  m.line([x, 0, z0], [x, 0, z1], color);
  m.line([x + m.res, 0, z0], [x + m.res, 0, z0 + (z1 - z0) * 0.55], color);
  for (const yd of yards) m.line([x, -yd.half, yd.z], [x, yd.half, yd.z], color);
  if (nest !== undefined) m.cyl(x, 0, 0.8, nest, nest + 1.0, '#2c2c2a');
}

export function lifeboat(m: VoxelModel, x: number, y: number, z: number, len = 7, w = 2, color = '#d8d4c8') {
  for (let i = m.vx(x - len / 2); i < m.vx(x + len / 2); i++) {
    const u = (m.mx(i) - x) / (len / 2);
    const hw = (w / 2) * Math.sqrt(Math.max(0, 1 - u * u * u * u));
    for (let j = m.vy(y - hw); j <= m.vy(y + hw); j++) {
      m.set(i, j, m.vz(z), shade(color, -0.25), VM.WOOD);
      const edge = Math.abs(m.my(j) - y) > hw - m.res * 0.8;
      m.set(i, j, m.vz(z + m.zres), edge ? color : '#8a6a44', VM.WOOD);
    }
  }
}

export function hatch(m: VoxelModel, x0: number, x1: number, halfW: number, z: number, color = '#5a4a32', coaming = '#4a4a46') {
  m.box(x0, x1, -halfW, halfW, z, z + 0.6, coaming, VM.METAL);
  m.box(x0 + 0.5, x1 - 0.5, -halfW + 0.5, halfW - 0.5, z + 0.6, z + 1.0, (i) => (i % 4 === 0 ? shade(color, -0.25) : color), VM.CANVAS);
}

export function dcRack(m: VoxelModel, x0: number, x1: number, y: number, z: number) {
  for (let x = x0; x < x1; x += 0.9) m.cylX(x, x + 0.7, y, z + 0.45, 0.42, (i) => (i % 2 ? '#2a2c2e' : '#3a3e40'), VM.METAL);
  m.line([x0, y - 0.6, z + 0.2], [x1, y - 0.6, z + 0.2], '#50565a');
  m.line([x0, y + 0.6, z + 0.2], [x1, y + 0.6, z + 0.2], '#50565a');
}

export function kingpost(m: VoxelModel, x: number, z0: number, h: number, boomLen: number, dir: number, color = '#4a4440') {
  m.line([x, -1.6, z0], [x, -1.6, z0 + h], color);
  m.line([x, 1.6, z0], [x, 1.6, z0 + h], color);
  m.line([x, -1.6, z0 + h], [x, 1.6, z0 + h], color);
  m.line([x, 0, z0 + 1], [x + boomLen * dir, 0, z0 + h * 0.75], '#6a6058');
}

export function crate(m: VoxelModel, x: number, y: number, z: number, lx: number, ly: number, h: number, color: string) {
  m.box(x - lx / 2, x + lx / 2, y - ly / 2, y + ly / 2, z, z + h, (i, j, k) => ((i + j + k) % 5 === 0 ? shade(color, -0.2) : color), VM.WOOD);
}

// ---------------------------------------------------------------------------------------------
// submarine hull: cylindrical pressure hull inside a free-flooding casing with saddle tanks

export interface SubSpec {
  name: string;
  length: number; beam: number; hullR: number; draftSurf: number;
  casingH: number;        // casing deck height above hull centerline
  saddle: number;         // saddle tank bulge (m)
  towerX: number; towerLen: number; towerW: number; towerH: number;
  colorTop: string; colorBottom: string; deck: string; tower: string;
  topHeight: number;
  res?: number; zres?: number;
  streamlined?: boolean;  // Type XXI smooth hull
}

export function buildSub(s: SubSpec): VoxelModel {
  const res = s.res ?? 0.5, zres = s.zres ?? 0.5;
  const L = s.length, B = s.beam;
  // model z = 0 at the surfaced waterline; hull centerline sits below it
  const cz = -s.draftSurf + s.hullR;
  const bottom = cz - s.hullR - 0.4;
  const nx = Math.ceil(L / res) + 4, ny = Math.ceil(B / res) + 4, nz = Math.ceil((s.topHeight - bottom) / zres) + 2;
  const m = new VoxelModel(s.name, nx, ny, nz, res, zres, -L / 2 - 2 * res, -B / 2 - 2 * res, bottom);
  for (let i = 0; i < nx; i++) {
    const x = m.mx(i), u = x / (L / 2);
    if (Math.abs(u) > 1) continue;
    // tapered body of revolution
    const taper = u > 0 ? Math.sqrt(Math.max(0, 1 - Math.pow(u, 3.2))) : Math.sqrt(Math.max(0, 1 - Math.pow(-u, 2.2)));
    const r = s.hullR * taper;
    const sad = s.saddle * Math.max(0, 1 - Math.pow(u * 1.6, 2));
    const casingTop = cz + s.casingH * (s.streamlined ? Math.max(0.2, taper) : Math.max(0.15, 1 - Math.pow(Math.abs(u) * 1.05, 6)));
    const casingW = (s.streamlined ? r : Math.min(r, 1.6 + 0.6 * taper)) * (u > 0.8 ? (1 - u) * 5 : 1);
    for (let k = 0; k < nz; k++) {
      const z = m.mz(k);
      for (let j = 0; j < ny; j++) {
        const y = m.my(j);
        const dz = z - cz;
        const ry = r + sad * Math.max(0, 1 - Math.abs(dz + 0.3) / (s.hullR * 0.9));
        const inHull = (y * y) / (ry * ry + 1e-4) + (dz * dz) / (r * r + 1e-4) <= 1;
        const inCasing = z <= casingTop && z >= cz && Math.abs(y) <= casingW;
        if (!inHull && !inCasing) continue;
        const top = z > casingTop - zres;
        let c = z < -0.3 ? s.colorBottom : s.colorTop;
        if (inCasing && top) c = (i % 3 === 0 || Math.abs(y) > casingW - res) ? shade(s.deck, -0.15) : s.deck;
        else c = weather(c, i, k);
        m.set(i, j, k, c, inCasing && top ? VM.WOOD : VM.METAL);
      }
    }
  }
  // conning tower
  const tx0 = s.towerX - s.towerLen / 2, tx1 = s.towerX + s.towerLen / 2;
  const deckTop = cz + s.casingH;
  for (let i = m.vx(tx0); i < m.vx(tx1); i++) {
    const t = (m.mx(i) - tx0) / s.towerLen;
    const w = (s.towerW / 2) * Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.45) * 2, 4)));
    for (let k = m.vz(deckTop); k < m.vz(deckTop + s.towerH); k++) {
      const zt = (m.mz(k) - deckTop) / s.towerH;
      const ww = w * (1 - zt * 0.12);
      for (let j = m.vy(-ww); j <= m.vy(ww); j++) m.set(i, j, k, weather(s.tower, i, k), VM.METAL);
    }
  }
  // bridge well (dark) on top of the tower
  const ktop = m.vz(deckTop + s.towerH) - 1;
  for (let i = m.vx(tx0 + s.towerLen * 0.3); i < m.vx(tx0 + s.towerLen * 0.75); i++)
    for (let j = m.vy(-s.towerW / 2 + 0.6); j <= m.vy(s.towerW / 2 - 0.6); j++) if (m.filled(i, j, ktop)) m.set(i, j, ktop, '#1e2224', VM.METAL);
  return m;
}

// ---------------------------------------------------------------------------------------------
// markings and small fittings

/** 3×5 pixel glyphs for pennant numbers (rows top to bottom) */
const GLYPHS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'], '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'], '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '010', '010', '010'], '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'], D: ['110', '101', '101', '101', '110'], K: ['101', '101', '110', '101', '101'],
  U: ['101', '101', '101', '101', '111'], T: ['111', '010', '010', '010', '010'], H: ['101', '101', '111', '101', '101'],
};

/** the outermost hull voxel of column (i, k) on one side (+1 = +y, -1 = -y), or -1 */
function sideVoxel(m: VoxelModel, i: number, k: number, side: number): number {
  if (side > 0) { for (let j = m.ny - 1; j >= 0; j--) if (m.filled(i, j, k)) return j; }
  else for (let j = 0; j < m.ny; j++) if (m.filled(i, j, k)) return j;
  return -1;
}

/**
 * Pennant number painted on both sides of the hull, centred on `x`. Each side reads left to right
 * for a viewer looking at it (the camera sees the +y side when the bow points east).
 */
export function hullNumber(h: Hull, text: string, x: number, color = '#e8e8e2') {
  const m = h.m;
  const w = text.length * 4 - 1;
  const kTop = m.vz(h.deckZ(x) - 0.7);
  for (const side of [1, -1]) {
    let i0 = m.vx(x) - side * Math.floor(w / 2);
    for (const ch of text) {
      const g = GLYPHS[ch];
      if (g) for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
        if (g[r][c] !== '1') continue;
        const i = i0 + side * c, k = kTop - r, j = sideVoxel(m, i, k, side);
        if (j >= 0) m.set(i, j, k, color, VM.METAL);
      }
      i0 += side * 4;
    }
  }
}

/** cowl ventilator: a short pipe with a dark mouth facing forward */
export function vent(m: VoxelModel, x: number, y: number, z: number, color = '#9aa2a4', h = 1.5) {
  m.cyl(x, y, 0.45, z, z + h, color);
  m.set(m.vx(x + 0.4), m.vy(y), m.vz(z + h - 0.3), '#16181a');
}

/** Carley float: a buff-coloured ring raft with a dark net floor */
export function carley(m: VoxelModel, x: number, y: number, z: number, len = 2.5, w = 1.5) {
  m.box(x - len / 2, x + len / 2, y - w / 2, y + w / 2, z, z + 0.5, (i, j) => {
    const edge = i === m.vx(x - len / 2) || i === m.vx(x + len / 2) - 1 || j === m.vy(y - w / 2) || j === m.vy(y + w / 2) - 1;
    return edge ? '#c8b48a' : '#3a3a32';
  }, VM.CANVAS);
}

/** scrambling nets hung down both sides between x0 and x1 (rescue ships, troop ships) */
export function scramblingNets(h: Hull, x0: number, x1: number, color = '#4a3c2a') {
  const m = h.m;
  for (let i = m.vx(x0); i < m.vx(x1); i++) {
    const top = m.vz(h.deckZ(m.mx(i)) - 0.3);
    for (let k = m.vz(0.6); k < top; k++) {
      if ((i + k) % 3 !== 0 && (i - k + 300) % 3 !== 0) continue;
      for (const side of [1, -1]) { const j = sideVoxel(m, i, k, side); if (j >= 0) m.set(i, j, k, color, VM.CANVAS); }
    }
  }
}

/** a biplane parked on a flight deck (wings spread), nose toward +x */
export function parkedBiplane(m: VoxelModel, x: number, y: number, z: number) {
  m.cylX(x - 5, x + 5.5, y, z + 1.0, 0.5, (i) => (i % 5 === 0 ? '#3e4a40' : '#4e5a50'));
  m.box(x + 2.4, x + 4.0, y - 6.9, y + 6.9, z + 0.5, z + 1.0, (i, j) => (j % 6 === 0 ? '#4e5a4c' : '#5a6658'), VM.CANVAS);
  m.box(x + 2.8, x + 4.4, y - 6.9, y + 6.9, z + 2.0, z + 2.5, (i, j) => (j % 6 === 0 ? '#5e6a5c' : '#6a7668'), VM.CANVAS);
  m.box(x - 5.2, x - 4.2, y - 2.2, y + 2.2, z + 0.5, z + 1.0, '#5a6658', VM.CANVAS);
  m.box(x - 5.2, x - 4.4, y - 0.25, y + 0.25, z + 1.0, z + 2.5, '#4e5a50');
  m.set(m.vx(x + 5.7), m.vy(y), m.vz(z + 1.0), '#22221e');
  for (const s of [-1, 1]) m.line([x + 3.2, y + s * 3.5, z + 1.0], [x + 3.6, y + s * 3.5, z + 2.2], '#3a3a36');
}
