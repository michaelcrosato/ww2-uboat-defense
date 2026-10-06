// Voxel art for the 1941-42 Pacific fleets (historical battles): battleships, carriers, cruisers,
// destroyers, auxiliaries and submarines of the US Navy and the Imperial Japanese Navy, to scale.
// Every class is a spec for one of a few parametric builders; ships over ~150 m are built from 1 m
// voxels (a 250 m carrier at the convoy ships' 0.5 m would fill a quarter of the slice atlas by itself).

import { hash2 } from '../core/math';
import { VoxelModel, VM, type ColorFn } from './voxel';
import { buildHull, buildSub, carley, deckhouse, funnel, hullNumber, lifeboat, planks, plating, shade, vent, weather } from './shipBuilder';
import type { MountArt, ShipArt } from './ships';

// ------------------------------------------------------------------ paints
/** US Navy Measure 1 (1941): 5-D dark grey to the top of the superstructure, 5-L light grey above */
export const USN41 = { side: '#545c62', upper: '#5c656b', mast: '#a3aaae', deck: '#4f5862', deckSeam: '#444c55', boot: '#1e1e1e' };
/** US Navy Measure 11/12 (1942): sea blue */
export const USN42 = { side: '#3e4a5a', upper: '#465364', mast: '#6f7c8c', deck: '#4b5561', deckSeam: '#3c4550', boot: '#1e1e1e' };
/** IJN Kure grey, linoleum decks with brass strips */
export const IJN = { side: '#6e7375', upper: '#767b7d', mast: '#6a6f71', deck: '#6b4f38', deckSeam: '#57412f', boot: '#3a1f1a' };

const linoleum = (base: string, strip: string): ColorFn => (i, j) => (i % 8 === 0 && j % 2 === 0 ? strip : hash2(i >> 2, j) > 0.9 ? shade(base, -0.06) : base);
const solid = (c: string): ColorFn => (i, _j, k) => weather(c, i, k);

// ------------------------------------------------------------------ gun houses
export type TurretType = 'bb14x3' | 'bb14x2' | 'bb16x2' | 'jbb14x2' | 'ca8x3' | 'ja20x2' | 'cl6x3' | 'cl6x2' | 'dd5x1' | 'jdd127x2' | 'dd4x1' | 'aa5x1' | 'j14x1' | 'sub6x1';
const TT: Record<TurretType, { len: number; wid: number; hgt: number; barrels: number; blen: number; br: number; open?: boolean }> = {
  bb14x3: { len: 10.5, wid: 9.6, hgt: 3.2, barrels: 3, blen: 16, br: 0.45 },
  bb14x2: { len: 9.5, wid: 8.2, hgt: 3.2, barrels: 2, blen: 16, br: 0.45 },
  bb16x2: { len: 11, wid: 9.4, hgt: 3.4, barrels: 2, blen: 18, br: 0.5 },
  jbb14x2: { len: 10, wid: 8.4, hgt: 3.3, barrels: 2, blen: 16, br: 0.45 },
  ca8x3: { len: 7.8, wid: 7.2, hgt: 2.8, barrels: 3, blen: 11, br: 0.3 },
  ja20x2: { len: 7.4, wid: 6.2, hgt: 2.8, barrels: 2, blen: 10.5, br: 0.3 },
  cl6x3: { len: 7, wid: 6.6, hgt: 2.6, barrels: 3, blen: 8, br: 0.25 },
  cl6x2: { len: 5.6, wid: 5, hgt: 2.4, barrels: 2, blen: 8, br: 0.25 },
  dd5x1: { len: 4.2, wid: 3.4, hgt: 2.4, barrels: 1, blen: 5, br: 0.2 },
  jdd127x2: { len: 5.2, wid: 4.2, hgt: 2.5, barrels: 2, blen: 6.4, br: 0.2 },
  dd4x1: { len: 2.6, wid: 2.4, hgt: 1.6, barrels: 1, blen: 5, br: 0.18, open: true },
  aa5x1: { len: 2.6, wid: 2.6, hgt: 1.4, barrels: 1, blen: 3.6, br: 0.18, open: true },
  j14x1: { len: 3.2, wid: 2.8, hgt: 2.0, barrels: 1, blen: 7, br: 0.2 },
  sub6x1: { len: 2.6, wid: 2.4, hgt: 1.5, barrels: 1, blen: 7.5, br: 0.2, open: true },
};
const turretCache = new Map<string, VoxelModel>();
/** a gun house (or open mount) centred on its pivot, barrels toward +x */
export function turret(type: TurretType, color: string): VoxelModel {
  const key = type + color;
  const hit = turretCache.get(key);
  if (hit) return hit;
  const t = TT[type], r = 0.5;
  const m = new VoxelModel(`tur_${key}`, Math.ceil((t.len / 2 + t.blen + 2) / r) + Math.ceil((t.len / 2 + 1) / r), Math.ceil((t.wid + 1.5) / r), Math.ceil((t.hgt + 1.5) / r), r, r, -t.len / 2 - 0.5, -t.wid / 2 - 0.75, 0);
  if (t.open) {
    m.cyl(0, 0, t.wid / 2, 0, 0.6, shade(color, -0.1));
    m.box(-t.len * 0.25, t.len * 0.35, -t.wid * 0.35, t.wid * 0.35, 0.5, t.hgt, solid(color));
  } else {
    // armoured house: sloped face, flat roof with rangefinder ears on the big ones
    for (let i = 0; i < m.nx; i++) {
      const x = m.mx(i);
      if (x < -t.len / 2 || x > t.len / 2) continue;
      const u = (x + t.len / 2) / t.len;
      const h = t.hgt * (u > 0.7 ? 1 - (u - 0.7) * 1.1 : 1);
      const hw = t.wid / 2 * (u < 0.15 ? 0.85 + u : 1);
      m.box(x - r / 2, x + r / 2, -hw, hw, 0, h, (ii, _j, kk) => weather(kk === m.vz(h) - 1 ? shade(color, 0.12) : color, ii, kk));
    }
    if (t.len > 9) for (const s of [-1, 1]) m.box(-t.len * 0.3, -t.len * 0.1, s * t.wid / 2 - 0.5, s * t.wid / 2 + 0.5, t.hgt * 0.4, t.hgt * 0.8, shade(color, -0.2));
  }
  for (let b = 0; b < t.barrels; b++) {
    const y = t.barrels === 1 ? 0 : (b - (t.barrels - 1) / 2) * Math.min(1.9, t.wid / (t.barrels + 0.6));
    m.cylX(t.len * 0.3, t.len / 2 + t.blen, y, t.hgt * 0.55, t.br, '#2a2c2e');
  }
  turretCache.set(key, m);
  return m;
}

// ------------------------------------------------------------------ masts
/** tripod: a vertical leg and two raked struts, with a fire-control top */
export function tripod(m: VoxelModel, x: number, z0: number, z1: number, color: string, top = true, spread = 3) {
  m.line([x, 0, z0], [x, 0, z1 + 4], color);
  for (const s of [-1, 1]) m.line([x - spread * 1.2, s * spread, z0], [x, 0, z1 - 1], color);
  if (top) {
    m.box(x - 2.2, x + 2.2, -2.2, 2.2, z1, z1 + 2.5, solid(shade(color, -0.25)));
    m.box(x - 1.5, x + 1.5, -1.5, 1.5, z1 - 4, z1 - 3.4, shade(color, -0.1));
  }
}
/**
 * Cage (lattice) mast of the US standard battleships: a twisted hyperboloid of tubes with rings,
 * carrying an enclosed fire-control top.
 */
export function cageMast(m: VoxelModel, x: number, z0: number, z1: number, color: string, r0 = 4.2, r1 = 2.4) {
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    for (const tw of [0.9, -0.9]) {
      m.line([x + Math.cos(a) * r0, Math.sin(a) * r0, z0], [x + Math.cos(a + tw) * r1, Math.sin(a + tw) * r1, z1], color);
    }
  }
  for (let z = z0 + 6; z < z1; z += 7) {
    const t = (z - z0) / (z1 - z0), r = r0 + (r1 - r0) * t;
    for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; m.set(m.vx(x + Math.cos(a) * r), m.vy(Math.sin(a) * r), m.vz(z), color); }
  }
  m.cyl(x, 0, 3.4, z1, z1 + 3.2, (i, j, k) => (k === m.vz(z1 + 2) && (i + j) % 2 === 0 ? '#1c2226' : weather(shade(color, -0.2), i, k)));
  m.cyl(x, 0, 2.0, z1 + 3.2, z1 + 4.6, shade(color, -0.3));
  m.line([x, 0, z1 + 4.6], [x, 0, z1 + 8], color);
}
/** IJN pagoda foremast: stacked platforms narrowing to the director tower */
export function pagoda(m: VoxelModel, x0: number, x1: number, z0: number, z1: number, hw0: number, hw1: number, color: string) {
  const levels = Math.max(3, Math.round((z1 - z0) / 2.6));
  for (let l = 0; l < levels; l++) {
    const t = l / levels, za = z0 + (z1 - z0) * t, zb = za + (z1 - z0) / levels;
    const hw = hw0 + (hw1 - hw0) * t, xa = x0 + (x1 - x0) * t * 0.35, xb = x1 - (x1 - x0) * t * 0.35;
    m.box(xa, xb, -hw, hw, za, zb - 0.6, solid(color));
    m.box(xa - 0.6, xb + 0.6, -hw - 0.6, hw + 0.6, zb - 0.6, zb, shade(color, -0.15));
    if (l % 2 === 0) for (let i = m.vx(xa); i < m.vx(xb); i += 2) for (const y of [-hw, hw - m.res]) m.set(i, m.vy(y), m.vz(za + 1), '#1c2226', VM.GLASS);
  }
  const xc = (x0 + x1) / 2;
  m.box(xc - 1.6, xc + 1.6, -hw1 - 1.5, hw1 + 1.5, z1, z1 + 1.6, shade(color, -0.2));   // rangefinder
  m.line([xc - 1, 0, z1 + 1.6], [xc - 1, 0, z1 + 7], '#3a3c3e');
}
export function pole(m: VoxelModel, x: number, z0: number, z1: number, color: string, yard = 3) {
  m.line([x, 0, z0], [x, 0, z1], color);
  m.line([x, -yard, z1 - 2], [x, yard, z1 - 2], color);
}

// ------------------------------------------------------------------ surface warships
export interface WarshipSpec {
  id: string;
  L: number; B: number; T: number;
  fb: [number, number, number];          // freeboard aft, midships, bow
  forecastle?: { from: number; height: number };
  bowStart?: number; bowPow?: number; rake?: number; stern?: 'cruiser' | 'transom' | 'counter'; sternStart?: number; vee?: number;
  topHeight: number;
  res?: number;
  paint: { side: string; upper: string; mast: string; deck: string; deckSeam: string; boot: string };
  wood?: boolean;                          // planked deck (US battleships) instead of steel / linoleum
  turrets?: { x: number; lift?: number; type: TurretType; aft?: boolean; y?: number; id?: string }[];
  houses?: { x0: number; x1: number; hw: number; h: number; base?: number; windows?: boolean }[];
  funnels?: { x: number; rx: number; ry: number; h: number; rake?: number; base?: number; y?: number }[];
  masts?: { x: number; type: 'pole' | 'tripod' | 'cage' | 'pagoda'; h: number; base?: number; x1?: number; hw0?: number; hw1?: number }[];
  /** gun ports along the hull side (US battleship casemates, Akagi/Kaga 20 cm) */
  casemates?: { x0: number; x1: number; z: number; every: number };
  boats?: [number, number][];
  catapult?: { x: number; y?: number; base?: number };
  tubes?: { x: number; quad?: boolean }[];
  aaTubs?: [number, number, number][];
  /** wooden planks over the gun positions (USS Utah as a target ship) */
  timbered?: { x0: number; x1: number };
  hullNumber?: string;
  hullNumberX?: number;
}

/** build a gun-armed warship; turrets become mounts gunA, gunB... in the order given */
export function warshipArt(s: WarshipSpec): ShipArt {
  const res = s.res ?? (s.L > 150 ? 1 : 0.5);
  const p = s.paint;
  const sideFn: ColorFn = (i, j, k, mm) => (mm.mz(k) < 0.4 && mm.mz(k) > -0.6 ? p.boot : mm.mz(k) < -0.6 ? '#5a3a34' : weather(p.side, i, k));
  const h = buildHull({
    name: s.id, length: s.L, beam: s.B, draft: s.T, fbAft: s.fb[0], fbMid: s.fb[1], fbFwd: s.fb[2],
    forecastle: s.forecastle, bowStart: s.bowStart ?? 0.4, bowPow: s.bowPow ?? 1.6, rake: s.rake ?? 0.05,
    stern: s.stern ?? 'cruiser', sternStart: s.sternStart ?? -0.7, vee: s.vee ?? 0.2, topHeight: s.topHeight,
    res, zres: res, side: sideFn, deck: s.wood ? planks(p.deck, p.deckSeam) : s.paint === IJN ? linoleum(p.deck, '#76604a') : plating(p.deck),
    rails: res < 1, rail: '#c8ccc8',
  });
  const m = h.m;
  const dz = (x: number) => h.deckZ(Math.max(-s.L / 2 + 1, Math.min(s.L / 2 - 1, x)));
  for (const hs of s.houses ?? []) {
    const z0 = (hs.base ?? dz((hs.x0 + hs.x1) / 2));
    deckhouse(m, hs.x0, hs.x1, hs.hw, z0, z0 + hs.h, solid(p.upper), shade(p.upper, -0.2), hs.windows === false ? undefined : { color: '#1a2228', z: z0 + hs.h - 0.8, every: 2, front: true });
  }
  if (s.casemates) for (let x = s.casemates.x0; x < s.casemates.x1; x += s.casemates.every) {
    for (const side of [-1, 1]) {
      const y = side * (h.halfBeam(x, s.casemates.z) - res * 0.5);
      m.box(x - 0.8, x + 0.8, y - 0.6, y + 0.6, s.casemates.z - 0.6, s.casemates.z + 0.6, '#1c1e20');
      m.cylX(x - 0.3, x + 1.2, y + side * 0.6, s.casemates.z, 0.2, '#2a2c2e');
    }
  }
  for (const f of s.funnels ?? []) funnel(m, f.x, f.rx, f.ry, f.base ?? dz(f.x), (f.base ?? dz(f.x)) + f.h, p.upper, shade(p.upper, -0.1), f.rake ?? 0);
  for (const ms of s.masts ?? []) {
    const z0 = ms.base ?? dz(ms.x);
    if (ms.type === 'tripod') tripod(m, ms.x, z0, z0 + ms.h, p.mast);
    else if (ms.type === 'cage') cageMast(m, ms.x, z0, z0 + ms.h, p.mast);
    else if (ms.type === 'pagoda') pagoda(m, ms.x, ms.x1 ?? ms.x + 8, z0, z0 + ms.h, ms.hw0 ?? 4, ms.hw1 ?? 1.6, p.upper);
    else pole(m, ms.x, z0, z0 + ms.h, p.mast);
  }
  for (const [x, y] of s.boats ?? []) lifeboat(m, x, y, dz(x) + 1, res < 1 ? 7 : 9, res < 1 ? 1.8 : 2.4);
  for (const t of s.tubes ?? []) {
    const z = dz(t.x);
    m.box(t.x - 1.5, t.x + 1.5, -1.3, 1.3, z, z + 0.8, '#50565a');
    for (const y of t.quad ? [-0.9, -0.3, 0.3, 0.9] : [-0.6, 0.6]) m.cylX(t.x - 3.5, t.x + 3.5, y, z + 1.1, 0.27, '#2c3032');
  }
  for (const [x, y, z] of s.aaTubs ?? []) m.cyl(x, y, 1.6, z, z + 1.2, shade(p.upper, -0.08));
  if (s.catapult) {
    const c = s.catapult, z = c.base ?? dz(c.x) + 1.5;
    m.box(c.x - 9, c.x + 9, (c.y ?? 0) - 0.6, (c.y ?? 0) + 0.6, z, z + 0.6, '#4a4e50');
    floatplane(m, c.x, c.y ?? 0, z + 0.6, s.paint === IJN ? '#7a8a6a' : '#7c8a96');
  }
  if (s.timbered) m.paintTop(s.timbered.x0, s.timbered.x1, -s.B / 2 + 2, s.B / 2 - 2, (i) => (i % 2 ? '#8a7046' : '#7a6240'));
  if (res < 1) for (let x = -s.L * 0.3; x < s.L * 0.3; x += 14) { vent(m, x, -s.B / 2 + 1.6, dz(x)); carley(m, x + 5, s.B / 2 - 1.4, dz(x + 5)); }
  // destroyers wore white hull numbers on the bow; at 1 m the 3x5 glyphs would be unreadable smears
  if (s.hullNumber && res < 1) hullNumber(h, s.hullNumber, s.hullNumberX ?? s.L * 0.36);
  const mounts: MountArt[] = (s.turrets ?? []).map((t, i) => ({
    id: t.id ?? 'gun' + 'ABCDEFGHIJKLMNOP'[i], model: turret(t.type, shade(p.upper, 0.05)),
    x: t.x, y: t.y ?? 0, z: dz(t.x) + (t.lift ?? 0), yaw: t.aft ? Math.PI : 0,
  }));
  const f0 = (s.funnels ?? [])[0];
  return {
    hull: m, mounts,
    funnels: (s.funnels ?? []).map((f) => [f.x, f.y ?? 0, (f.base ?? dz(f.x)) + f.h] as [number, number, number]),
    lamps: f0 ? [[f0.x + 10, 0, dz(f0.x) + 10]] : [],
  };
}

/** a catapult floatplane (Kingfisher / Jake): float, fuselage, wing */
function floatplane(m: VoxelModel, x: number, y: number, z: number, color: string) {
  m.cylX(x - 4, x + 4, y, z + 1.6, 0.5, color);
  m.box(x - 1, x + 1, y - 5.5, y + 5.5, z + 1.8, z + 2.3, color, VM.CANVAS);
  m.cylX(x - 2.5, x + 3, y, z + 0.4, 0.4, shade(color, -0.2));
  m.box(x - 4, x - 3.2, y - 1.8, y + 1.8, z + 1.8, z + 2.2, color);
}

/** parked aircraft on a flight deck: a cross of wing and fuselage in the given colours */
export function parkedPlane(m: VoxelModel, x: number, y: number, z: number, span: number, len: number, top: string, nose: number, roundel?: string) {
  m.box(x - len / 2, x + len / 2, y - 0.6, y + 0.6, z, z + 1, top, VM.CANVAS);
  m.box(x + nose * len * 0.1 - 1.2, x + nose * len * 0.1 + 1.2, y - span / 2, y + span / 2, z, z + 1, top, VM.CANVAS);
  m.box(x - nose * len * 0.42 - 0.5, x - nose * len * 0.42 + 0.5, y - span * 0.22, y + span * 0.22, z, z + 1, top, VM.CANVAS);
  if (roundel) for (const s of [-1, 1]) m.set(m.vx(x + nose * len * 0.1), m.vy(y + s * span * 0.34), m.vz(z + 0.5), roundel, VM.CANVAS);
}


// ------------------------------------------------------------------ aircraft carriers
export interface CarrierSpec {
  id: string;
  L: number; B: number; T: number;
  hullFb: number;                          // hull (hangar) deck height above water, midships
  fdZ: number;                             // flight deck height above water
  fd: { x0: number; x1: number; hw: number; taperFwd?: number };
  hangar: { x0: number; x1: number; hw: number; open?: boolean };
  island?: { x0: number; x1: number; side: 1 | -1; w: number; h: number; mast?: 'tripod' | 'pole'; funnel?: { x: number; rx: number; ry: number; h: number } };
  /** IJN side funnels curving down and out (starboard), length out from the hull and drop */
  sideFunnels?: { x: number; side: 1 | -1; out: number; drop: number; r: number }[];
  /** small upright funnel (Akagi's second) */
  upFunnels?: { x: number; y: number; r: number; h: number }[];
  elevators: [number, number][];           // centre x, half size
  paint: { side: string; upper: string; mast: string; deck: string; deckLine: string; boot: string };
  hinomaru?: number;                       // x of the red disc (IJN)
  usMarks?: boolean;                       // white centreline dashes and deck edge lines
  parked?: { x: number; y: number; span: number; len: number; color: string; nose: number }[];
  aaSponsons?: { x: number; side: 1 | -1 }[];
  casemates?: { x0: number; x1: number; every: number };
}

export function carrierArt(s: CarrierSpec): ShipArt {
  const res = 1, p = s.paint, FD = s.fdZ;
  const sideFn: ColorFn = (i, j, k, mm) => (mm.mz(k) < 0.4 && mm.mz(k) > -0.6 ? p.boot : mm.mz(k) < -0.6 ? '#5a3a34' : weather(p.side, i, k));
  const h = buildHull({
    name: s.id, length: s.L, beam: s.B, draft: s.T, fbAft: s.hullFb * 0.9, fbMid: s.hullFb, fbFwd: s.hullFb + 2,
    bowStart: 0.45, bowPow: 1.5, rake: 0.08, stern: 'cruiser', sternStart: -0.75, vee: 0.2,
    topHeight: FD + (s.island?.h ?? 4) + 14, res, zres: res, side: sideFn, deck: plating(shade(p.side, -0.2)), rails: false,
  });
  const m = h.m;
  // hangar: closed sides (IJN, Yorktown's had roller curtains: dark openings)
  for (let i = 0; i < m.nx; i++) {
    const x = m.mx(i);
    if (x < s.hangar.x0 || x > s.hangar.x1) continue;
    const hw = Math.min(s.hangar.hw, h.halfBeam(x, s.hullFb) - 0.5);
    if (hw < 2) continue;
    for (let k = m.vz(h.deckZ(x)); k < m.vz(FD - 1); k++) for (let j = m.vy(-hw); j <= m.vy(hw); j++) {
      const edge = Math.abs(m.my(j)) > hw - 1.2;
      const opening = s.hangar.open && edge && (k - m.vz(h.deckZ(x))) % 7 > 1 && i % 12 > 2 && i % 12 < 10;
      m.set(i, j, k, opening ? '#1a1e22' : weather(p.side, i, k), VM.METAL);
    }
  }
  // flight deck on its supports, overhanging the hull fore and aft
  const deckFn: ColorFn = (i, j) => {
    const x = m.mx(i), y = m.my(j), hw = deckHw(s, x);
    if (Math.abs(y) > hw - 1) return p.deckLine;
    for (const [ex, es] of s.elevators) if (Math.abs(x - ex) < es && Math.abs(y) < es) return Math.abs(x - ex) > es - 1 || Math.abs(y) > es - 1 ? '#2a2826' : shade(p.deck, -0.1);
    if (s.usMarks && Math.abs(y) < 0.6 && i % 10 < 5) return '#d8d8d0';
    if (s.hinomaru !== undefined) {
      const r = Math.hypot(x - s.hinomaru, y);
      if (r < 5.5) return '#b8232a';
      if (r < 7.5) return '#e8e4dc';
    }
    return j % 2 === 0 && hash2(i >> 2, j) > 0.7 ? shade(p.deck, -0.07) : p.deck;
  };
  for (let i = m.vx(s.fd.x0); i < m.vx(s.fd.x1); i++) {
    const x = m.mx(i), hw = deckHw(s, x);
    for (let j = m.vy(-hw); j <= m.vy(hw); j++) { const c = deckFn(i, j, 0, m); if (c) m.set(i, j, m.vz(FD - 0.5), c, VM.WOOD); }
  }
  for (const x of [s.fd.x0 + 4, s.fd.x0 + 12, s.fd.x1 - 6, s.fd.x1 - 14]) for (const y of [-s.hangar.hw * 0.6, s.hangar.hw * 0.6]) {
    if (Math.abs(x) < s.L / 2 - 2) m.line([x, y, h.deckZ(x)], [x, y, FD - 1], '#3e4244');
  }
  // island with its funnel and mast
  if (s.island) {
    const is = s.island, yIn = is.side * (deckHw(s, (is.x0 + is.x1) / 2) - is.w), yOut = is.side * (deckHw(s, (is.x0 + is.x1) / 2) + 0.5);
    const y0 = Math.min(yIn, yOut), y1 = Math.max(yIn, yOut);
    m.box(is.x0, is.x1, y0, y1, FD, FD + is.h, solid(p.upper));
    m.box(is.x0 + 1, is.x1 - 1, y0 + 0.5, y1 - 0.5, FD + is.h, FD + is.h + 2.5, solid(shade(p.upper, -0.1)));
    for (let i = m.vx(is.x0); i < m.vx(is.x1); i += 2) m.set(i, m.vy(is.side > 0 ? y0 : y1 - 1), m.vz(FD + is.h - 1), '#1a2228', VM.GLASS);
    const mx = (is.x0 + is.x1) / 2, my = (y0 + y1) / 2;
    if (is.funnel) {
      for (let k = m.vz(FD); k < m.vz(FD + is.h + is.funnel.h); k++) m.cyl(is.funnel.x, my, is.funnel.ry, m.mz(k) - 0.5, m.mz(k) + 0.5, k > m.vz(FD + is.h + is.funnel.h) - 2 ? '#141414' : weather(p.upper, k, k), VM.METAL, is.funnel.rx);
    }
    if (is.mast === 'tripod') { m.line([mx, my, FD + is.h + 2.5], [mx, my, FD + is.h + 14], p.mast); for (const d of [-2, 2]) m.line([mx - 3, my + d, FD + is.h], [mx, my, FD + is.h + 10], p.mast); }
    else if (is.mast === 'pole') m.line([mx, my, FD + is.h + 2.5], [mx, my, FD + is.h + 10], p.mast);
  }
  // IJN boiler uptakes: trunked out of the starboard side and bent down toward the sea
  for (const f of s.sideFunnels ?? []) {
    const yb = f.side * h.halfBeam(f.x, s.hullFb * 0.9);
    for (let t = 0; t <= 1; t += 0.05) {
      const y = yb + f.side * f.out * t, z = FD - 3 - f.drop * t * t;
      m.cyl(f.x, y, f.r, z - f.r, z + f.r, t > 0.92 ? '#141414' : weather(p.side, Math.round(t * 20), 3), VM.METAL);
    }
  }
  for (const f of s.upFunnels ?? []) m.cyl(f.x, f.y, f.r, FD - 2, FD + f.h, (i, j, k) => (k > m.vz(FD + f.h) - 2 ? '#141414' : weather(p.upper, i, k)));
  for (const a of s.aaSponsons ?? []) {
    const y = a.side * (h.halfBeam(a.x, s.hullFb) + 1.5);
    m.box(a.x - 2.5, a.x + 2.5, y - 2, y + 2, FD - 3.5, FD - 2.5, shade(p.side, -0.1));
    m.cylX(a.x - 0.5, a.x + 3, y, FD - 1.8, 0.2, '#2a2c2e');
  }
  if (s.casemates) for (let x = s.casemates.x0; x < s.casemates.x1; x += s.casemates.every) for (const side of [-1, 1]) {
    const y = side * (h.halfBeam(x, s.hullFb - 1.5) - 0.5);
    m.box(x - 1, x + 1, y - 0.6, y + 0.6, s.hullFb - 2.2, s.hullFb - 0.8, '#1c1e20');
    m.cylX(x, x + 3, y + side * 0.6, s.hullFb - 1.5, 0.25, '#2a2c2e');
  }
  for (const pk of s.parked ?? []) parkedPlane(m, pk.x, pk.y, FD, pk.span, pk.len, pk.color, pk.nose, s.hinomaru !== undefined ? '#b8232a' : '#e8e8e2');
  const isl = s.island;
  return {
    hull: m, mounts: [],
    funnels: isl?.funnel ? [[isl.funnel.x, isl.side * deckHw(s, isl.funnel.x), FD + isl.h + isl.funnel.h]] : (s.sideFunnels ?? []).map((f) => [f.x, f.side * (s.B / 2 + f.out), FD - 3 - f.drop] as [number, number, number]),
    lamps: [[(isl?.x0 ?? 0) + 2, (isl?.side ?? 1) * s.fd.hw, FD + (isl?.h ?? 2)]],
  };
}
function deckHw(s: CarrierSpec, x: number) {
  const t = s.fd.taperFwd ?? 0.15, L = s.fd.x1 - s.fd.x0, u = (x - s.fd.x0) / L;
  // the flight deck narrows toward its forward and after ends
  const k = u > 1 - t ? 1 - ((u - (1 - t)) / t) * 0.45 : u < 0.06 ? 0.75 + u / 0.06 * 0.25 : 1;
  return s.fd.hw * k;
}

// ------------------------------------------------------------------ submarines
export function fleetSubArt(id: string, L: number, B: number, T: number, color: string, guns: number[]): ShipArt {
  const m = buildSub({
    name: id, length: L, beam: B, hullR: B * 0.38, draftSurf: T, casingH: 2.8, saddle: B * 0.12,
    towerX: L * 0.08, towerLen: L * 0.13, towerW: 3.2, towerH: 4.2, colorTop: color, colorBottom: shade(color, -0.3), deck: '#4a4e50', tower: shade(color, 0.08),
    topHeight: 14, res: 0.5, zres: 0.5,
  });
  const deck = -T + B * 0.38 + 2.8;
  const mounts: MountArt[] = guns.map((x, i) => ({ id: 'gun' + 'AB'[i], model: turret('sub6x1', shade(color, 0.05)), x, y: 0, z: deck, yaw: i ? Math.PI : 0 }));
  mounts.push({ id: 'periscope', model: periscopeArt(id), x: L * 0.08 + 1, y: 0, z: deck + 4.2, yaw: 0 });
  return { hull: m, mounts, funnels: [[L * 0.05, 0, deck + 2]], lamps: [] };
}
/** IJN Type A (Ko-hyoteki) midget submarine: 24 m cigar, two bow tubes, a small sail */
export function midgetSubArt(): ShipArt {
  const m = buildSub({
    name: 'kohyoteki', length: 23.9, beam: 1.85, hullR: 0.92, draftSurf: 1.85, casingH: 0.95, saddle: 0,
    towerX: 2.5, towerLen: 3.2, towerW: 1.0, towerH: 1.5, colorTop: '#3a3e40', colorBottom: '#2e3234', deck: '#3a3e40', tower: '#404446',
    topHeight: 6, res: 0.25, zres: 0.25, streamlined: true,
  });
  m.line([11, 0, 0.9], [3, 0, 2.6], '#2a2a2a');   // net cutter guard wire
  return { hull: m, mounts: [{ id: 'periscope', model: periscopeArt('kohyoteki'), x: 2.5, y: 0, z: 2.4, yaw: 0 }], funnels: [], lamps: [] };
}
function periscopeArt(id: string): VoxelModel {
  const m = new VoxelModel('peri_' + id, 3, 3, 12, 0.5, 0.5, -0.75, -0.75, 0);
  m.line([0, 0, 0], [0, 0, 5.5], '#3a3c3e');
  m.set(m.vx(0.4), m.vy(0), m.vz(5.3), '#9ab0c0', VM.GLASS);
  return m;
}

// ------------------------------------------------------------------ carrier aircraft, 1941-42
export type Warplane = 'kate' | 'val' | 'zero' | 'sbd' | 'tbd' | 'f4f';
export type Load = 'torpedo' | 'bomb' | 'apbomb' | null;
const PLANE: Record<Warplane, { len: number; span: number; top: string; under: string; cowl: string; ijn: boolean; gear?: boolean; crew: number }> = {
  // Nakajima B5N2: light grey-green, three-seat glasshouse
  kate: { len: 10.3, span: 15.5, top: '#9ba08a', under: '#b2b5a2', cowl: '#2a2a28', ijn: true, crew: 3 },
  // Aichi D3A1: fixed spatted gear, elliptical wings
  val: { len: 10.2, span: 14.4, top: '#b7b9a7', under: '#c3c5b4', cowl: '#2a2a28', ijn: true, gear: true, crew: 2 },
  // Mitsubishi A6M2 in ameiro
  zero: { len: 9.1, span: 12.0, top: '#c2c3ac', under: '#c8c9b4', cowl: '#2a2a28', ijn: true, crew: 1 },
  // Douglas SBD-3 / TBD-1 / Grumman F4F-3 in blue-grey over light grey (1942)
  sbd: { len: 10.1, span: 12.7, top: '#647686', under: '#c9cdd0', cowl: '#56687a', ijn: false, crew: 2 },
  tbd: { len: 10.7, span: 15.2, top: '#647686', under: '#c9cdd0', cowl: '#56687a', ijn: false, crew: 3 },
  f4f: { len: 8.8, span: 11.6, top: '#647686', under: '#c9cdd0', cowl: '#56687a', ijn: false, crew: 1 },
};
export function planeSpec(k: Warplane) { return PLANE[k]; }

export function warplaneArt(kind: Warplane, load: Load): VoxelModel {
  const s = PLANE[kind], r = 0.5, L = s.len, W = s.span;
  const m = new VoxelModel(`wp_${kind}_${load ?? 'none'}`, Math.ceil(L / r) + 6, Math.ceil(W / r) + 4, 9, r, r, -L / 2 - 1.5, -W / 2 - 1, -1.8);
  const skin: ColorFn = (_i, _j, k, mm) => (mm.mz(k) < 0 ? s.under : s.top);
  // fuselage tapering to the tail, radial cowling at the nose
  for (let i = m.vx(-L / 2); i < m.vx(L / 2 - 1); i++) {
    const x = m.mx(i), t = (x + L / 2) / L;
    const rr = 0.5 + 0.55 * Math.min(1, t * 2.4);
    m.cylX(x, x + r, 0, 0.2 + (1 - t) * 0.2, rr, skin, VM.METAL);
  }
  m.cylX(L / 2 - 1.2, L / 2, 0, 0.3, 0.75, s.cowl, VM.METAL);
  m.set(m.vx(L / 2 + 0.2), m.vy(0), m.vz(0.3), '#1a1a18');
  // canopy: long glasshouse on the multi-seaters
  const cl = s.crew > 1 ? L * 0.38 : L * 0.14;
  m.box(L * 0.18 - cl, L * 0.18, -0.35, 0.35, 0.9, 1.4, '#7f97a8', VM.GLASS);
  // wings: tapered planform, rounded tips; the Val's are elliptical
  for (let j = m.vy(-W / 2); j <= m.vy(W / 2); j++) {
    const y = m.my(j), u = Math.abs(y) / (W / 2);
    const chord = (kind === 'val' ? 2.6 * Math.sqrt(Math.max(0, 1 - u * u)) : 2.7 - u * 1.3) + 0.3;
    const x0 = L * 0.08 - chord * 0.6;
    m.box(x0, x0 + chord, y - r / 2, y + r / 2, -0.1, 0.35, (_i, jj, k) => (k === m.vz(0.3) ? (hash2(jj >> 2, 3) > 0.5 ? s.top : shade(s.top, -0.05)) : s.under), VM.CANVAS);
  }
  // national markings on the wing tops
  for (const sgn of [-1, 1]) {
    const cy = sgn * W * 0.36;
    m.cyl(L * 0.06, cy, 0.85, 0.2, 0.4, s.ijn ? '#b8232a' : (_i, jj) => (Math.abs(m.my(jj) - cy) < 0.3 ? '#e8e8e2' : '#24324e'), VM.CANVAS);
  }
  // tailplane and fin
  m.box(-L / 2, -L / 2 + 1.3, -L * 0.18, L * 0.18, 0.1, 0.4, s.top, VM.CANVAS);
  m.box(-L / 2, -L / 2 + 1.4, -0.2, 0.2, 0.4, 1.9, s.top, VM.CANVAS);
  if (s.gear) for (const sgn of [-1, 1]) m.box(L * 0.12, L * 0.12 + 0.9, sgn * 1.6 - 0.25, sgn * 1.6 + 0.25, -1.3, -0.1, s.top);
  if (load === 'torpedo') m.cylX(-1.2, 3.4, 0, -0.9, 0.3, '#3a3c3e');
  else if (load === 'bomb' || load === 'apbomb') m.cylX(-0.4, 1.6, 0, -0.85, load === 'apbomb' ? 0.4 : 0.32, '#30302c');
  return m;
}
