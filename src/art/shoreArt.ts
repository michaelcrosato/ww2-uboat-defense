// Shore scenery for the historical harbours (M18): buildings, fuel tanks, cranes and towers, trees, AA
// pits, parked aircraft, cars and harbour craft. Every model is built once and placed many times (the
// slice atlas holds it once); models are centred on their origin with z = 0 at their base, so a placement
// is just a position and a heading. Buildings use 1 m voxels (one buffer pixel at the default zoom),
// vehicles, boats and aircraft 0.5 m like the ships.

import { VoxelModel, VM } from './voxel';
import { shade } from './shipBuilder';
import { hash2 } from '../core/math';

/** a model of L x W x H metres centred on its origin, base at z = 0 */
function mk(name: string, L: number, W: number, H: number, res: number, zres: number, z0 = 0) {
  return new VoxelModel(name, Math.ceil(L / res) + 2, Math.ceil(W / res) + 2, Math.ceil((H - z0) / zres) + 1, res, zres, -L / 2 - res, -W / 2 - res, z0);
}

// ------------------------------------------------------------------ building parts
/** walls of a block with rows of dark windows on every face, `storeys` rows */
function walls(m: VoxelModel, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, wall: string, win: string | null, storeys = 1, every = 3) {
  m.box(x0, x1, y0, y1, z0, z1, wall, VM.WOOD);
  if (!win) return;
  const sh = (z1 - z0) / storeys;
  for (let s = 0; s < storeys; s++) {
    const kz = m.vz(z0 + sh * s + sh * 0.55);
    for (let i = m.vx(x0) + 1; i < m.vx(x1) - 1; i++) if ((i - m.vx(x0)) % every === 1) { m.set(i, m.vy(y0), kz, win, VM.GLASS); m.set(i, m.vy(y1) - 1, kz, win, VM.GLASS); }
    for (let j = m.vy(y0) + 1; j < m.vy(y1) - 1; j++) if ((j - m.vy(y0)) % every === 1) { m.set(m.vx(x0), j, kz, win, VM.GLASS); m.set(m.vx(x1) - 1, j, kz, win, VM.GLASS); }
  }
}

/** hipped roof: each layer steps in one voxel on every side up to the ridge */
function hipRoof(m: VoxelModel, x0: number, x1: number, y0: number, y1: number, z0: number, color: string, eave = 1) {
  let i0 = m.vx(x0 - eave), i1 = m.vx(x1 + eave) - 1, j0 = m.vy(y0 - eave), j1 = m.vy(y1 + eave) - 1, k = m.vz(z0);
  while (i0 <= i1 && j0 <= j1 && k < m.nz) {
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      // tiles in courses: a faint stripe every other row, darker on the ridge line
      const c = i === i0 || i === i1 || j === j0 || j === j1 ? shade(color, (j + k) % 2 ? -0.04 : 0.02) : color;
      m.set(i, j, k, c, VM.WOOD);
    }
    i0++; i1--; j0++; j1--; k++;
  }
}

/** gable roof with the ridge along x */
function gableRoof(m: VoxelModel, x0: number, x1: number, y0: number, y1: number, z0: number, color: string, eave = 1) {
  let j0 = m.vy(y0 - eave), j1 = m.vy(y1 + eave) - 1, k = m.vz(z0);
  const i0 = m.vx(x0 - eave), i1 = m.vx(x1 + eave) - 1;
  while (j0 <= j1 && k < m.nz) {
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) m.set(i, j, k, j === j0 || j === j1 ? shade(color, -0.05) : color, VM.WOOD);
    j0++; j1--; k++;
  }
}

/** barrel (arched) roof with the arch across y, ridge along x: hangars */
function barrelRoof(m: VoxelModel, x0: number, x1: number, y0: number, y1: number, z0: number, rise: number, color: string, skylights = false) {
  const hw = (y1 - y0) / 2, cy = (y0 + y1) / 2;
  for (let k = m.vz(z0); k < m.vz(z0 + rise); k++) {
    const h = (m.mz(k) - z0) / rise, w = hw * Math.sqrt(Math.max(0, 1 - h * h));
    for (let j = m.vy(cy - w); j < m.vy(cy + w); j++) for (let i = m.vx(x0); i < m.vx(x1); i++) {
      const sky = skylights && (i - m.vx(x0)) % 8 === 4 && Math.abs(m.my(j) - cy) < hw * 0.6;
      m.set(i, j, k, sky ? '#8fa2ac' : (j & 1 ? color : shade(color, -0.04)), sky ? VM.GLASS : VM.METAL);
    }
  }
}

// ------------------------------------------------------------------ palettes
const WALLS = ['#d9d0b3', '#e4e1d6', '#b9c6a3', '#dacd9a', '#c9c3b2', '#d6bca8'];
const ROOFS = ['#94503e', '#55684e', '#6b6862', '#7b5644', '#4f504c', '#8d8b84'];
const WIN = '#2a3238';

/** a plantation-style bungalow: hipped roof over the house and a lower one over the front lanai */
export function bungalowArt(v: number): VoxelModel {
  const L = 10 + (v % 3) * 1.5, W = 7 + ((v >> 1) % 2) * 1.5;
  const m = mk(`bung${v}`, L + 4, W + 6, 9, 1, 1);
  const wall = WALLS[v % WALLS.length], roof = ROOFS[(v * 5 + 1) % ROOFS.length];
  walls(m, -L / 2, L / 2, -W / 2, W / 2, 0, 3, wall, WIN, 1, 2);
  hipRoof(m, -L / 2, L / 2, -W / 2, W / 2, 3, roof);
  // lanai on the front (+y), and on some an ell at the back
  m.box(-L / 2 + 1, L / 2 - 1, W / 2, W / 2 + 2, 2, 3, shade(roof, -0.1), VM.WOOD);
  if (v % 4 === 3) { walls(m, L / 2 - 4, L / 2, -W / 2 - 3, -W / 2, 0, 3, wall, null); hipRoof(m, L / 2 - 4, L / 2, -W / 2 - 3, -W / 2, 3, roof, 0); }
  return m;
}

/** two-storey quarters (officers' houses on Ford Island and Hickam, CPO houses) */
export function quartersArt(v: number): VoxelModel {
  const L = 15, W = 10, wall = v % 2 ? '#e4e1d6' : '#d9d0b3', roof = v % 2 ? '#55684e' : '#94503e';
  const m = mk(`qtrs${v}`, L + 4, W + 6, 12, 1, 1);
  walls(m, -L / 2, L / 2, -W / 2, W / 2, 0, 6, wall, WIN, 2, 2);
  hipRoof(m, -L / 2, L / 2, -W / 2, W / 2, 6, roof);
  m.box(-L / 2 + 2, L / 2 - 2, W / 2, W / 2 + 2.5, 2.5, 3.5, shade(wall, -0.15), VM.WOOD);
  return m;
}

/** a long block of `storeys` with windows: barracks, offices, stores, schools */
export function blockArt(name: string, L: number, W: number, storeys: number, wall: string, roof: string, flat = false): VoxelModel {
  const H = storeys * 3.6, m = mk(name, L + 2, W + 2, H + W / 2 + 2, 1, 1.2);
  walls(m, -L / 2, L / 2, -W / 2, W / 2, 0, H, wall, WIN, storeys, 2);
  if (flat) { m.box(-L / 2, L / 2, -W / 2, W / 2, H, H + 0.6, roof, VM.WOOD); m.box(-L / 2 + 1, L / 2 - 1, -W / 2 + 1, W / 2 - 1, H + 0.6, H + 1.2, shade(roof, -0.12), VM.WOOD); }
  else hipRoof(m, -L / 2, L / 2, -W / 2, W / 2, H, roof);
  return m;
}

/** industrial shop: concrete or brick walls, a monitor (raised clerestory) or sawtooth roof */
export function shopArt(name: string, L: number, W: number, H: number, wall: string, roof: string, kind: 'monitor' | 'saw' | 'gable'): VoxelModel {
  const m = mk(name, L + 2, W + 2, H + 8, 1, 1.5);
  walls(m, -L / 2, L / 2, -W / 2, W / 2, 0, H, wall, '#30383c', 2, 3);
  if (kind === 'monitor') {
    m.box(-L / 2, L / 2, -W / 2, W / 2, H, H + 1.5, roof, VM.METAL);
    m.box(-L / 2 + 2, L / 2 - 2, -W * 0.15, W * 0.15, H + 1.5, H + 4.5, (_i, _j, k) => (k === m.vz(H + 2) ? '#7d929c' : roof), VM.METAL);
    m.box(-L / 2 + 2, L / 2 - 2, -W * 0.15, W * 0.15, H + 4.5, H + 6, shade(roof, -0.1), VM.METAL);
  } else if (kind === 'saw') {
    // sawtooth bays across the building: a glazed north face, a sloped roof
    for (let i = m.vx(-L / 2); i < m.vx(L / 2); i++) {
      const u = ((m.mx(i) + L / 2) % 8) / 8, top = H + 1 + u * 4;
      for (let k = m.vz(H); k < m.vz(top); k++) for (let j = m.vy(-W / 2); j < m.vy(W / 2); j++) m.set(i, j, k, u > 0.88 ? '#7d929c' : roof, u > 0.88 ? VM.GLASS : VM.METAL);
    }
  } else gableRoof(m, -L / 2, L / 2, -W / 2, W / 2, H, roof, 0);
  return m;
}

/**
 * Aircraft hangar, doors at both x ends. `twin` puts two arched bays side by side with a lean-to of
 * shops between them (the paired hangars of Hickam's flight line).
 */
export function hangarArt(name: string, L: number, W: number, twin = false, roof = '#7d7f7a', wall = '#c4c1b4'): VoxelModel {
  const H = 11, rise = 7, lean = twin ? 22 : 0, T = twin ? W * 2 + lean : W;
  const m = mk(name, L + 2, T + 10, H + rise + 2, 1, 1.5);
  const bays = twin ? [-T / 2 + W / 2, T / 2 - W / 2] : [0];
  for (const cy of bays) {
    walls(m, -L / 2, L / 2, cy - W / 2, cy + W / 2, 0, H, wall, '#4a5458', 1, 4);
    barrelRoof(m, -L / 2, L / 2, cy - W / 2, cy + W / 2, H, rise, roof, true);
    // big doors at both ends: dark steel panels across the bay
    m.box(-L / 2, -L / 2 + 1, cy - W / 2 + 2, cy + W / 2 - 2, 0, H - 1, '#4c5054', VM.METAL);
    m.box(L / 2 - 1, L / 2, cy - W / 2 + 2, cy + W / 2 - 2, 0, H - 1, '#4c5054', VM.METAL);
  }
  // shops along the sides (and the lean-to between twin bays)
  if (twin) { walls(m, -L / 2 + 4, L / 2 - 4, -lean / 2, lean / 2, 0, 7, wall, WIN, 2, 3); m.box(-L / 2 + 4, L / 2 - 4, -lean / 2, lean / 2, 7, 7.8, shade(roof, -0.1), VM.METAL); }
  walls(m, -L / 2 + 6, L / 2 - 6, -T / 2 - 5, -T / 2, 0, 4.5, wall, WIN, 1, 3);
  walls(m, -L / 2 + 6, L / 2 - 6, T / 2, T / 2 + 5, 0, 4.5, wall, WIN, 1, 3);
  m.box(-L / 2 + 6, L / 2 - 6, -T / 2 - 5, -T / 2, 4.5, 5.2, shade(roof, -0.1), VM.METAL);
  m.box(-L / 2 + 6, L / 2 - 6, T / 2, T / 2 + 5, 4.5, 5.2, shade(roof, -0.1), VM.METAL);
  return m;
}

/** the Naval Hospital at Hospital Point: a two-storey main block, three wards behind it, a portico */
export function hospitalArt(): VoxelModel {
  const L = 92, W = 15, H = 8.4, wall = '#e6e2d6', roof = '#9a5a44';
  const m = mk('naval_hospital', L + 4, 60, 16, 1, 1.2);
  walls(m, -L / 2, L / 2, 6, 6 + W, 0, H, wall, WIN, 2, 2);
  hipRoof(m, -L / 2, L / 2, 6, 6 + W, H, roof);
  for (const x of [-34, 0, 34]) {
    walls(m, x - 7, x + 7, -24, 6, 0, H, wall, WIN, 2, 2);
    hipRoof(m, x - 7, x + 7, -24, 6, H, roof);
  }
  // entrance portico with columns on the harbour front
  m.box(-8, 8, 6 + W, 6 + W + 4, 0, H - 1, (i, _j, k) => (k < m.vz(H - 2) && i % 2 ? null : '#ecebe4'), VM.WOOD);
  hipRoof(m, -8, 8, 6 + W, 6 + W + 4, H - 1, shade(roof, 0.05), 0);
  return m;
}

/** one wing and one spine segment of Hale Makai, Hickam's big barracks (assembled by placement) */
export function haleMakaiArt(part: 'wing' | 'spine'): VoxelModel {
  const wall = '#e6e3d8', roof = '#7d4a3a';
  const [L, W] = part === 'wing' ? [16, 58] : [42, 18];
  const m = mk(`hale_${part}`, L + 2, W + 2, 18, 1, 1.2);
  walls(m, -L / 2, L / 2, -W / 2, W / 2, 0, 11, wall, WIN, 3, 2);
  hipRoof(m, -L / 2, L / 2, -W / 2, W / 2, 11, roof);
  return m;
}

/** fuel oil tank (dia, height); `fake` paints a house on the roof and windows on the shell */
export function tankArt(d: number, h: number, fake = false): VoxelModel {
  const m = mk(`tank_${d}_${h}_${fake ? 1 : 0}`, d + 2, d + 2, h + 3, 1, 1.5);
  const col = fake ? '#b8b29c' : '#7f8378';
  m.cyl(0, 0, d / 2, 0, h, (i, j, k) => (fake && k === m.vz(h * 0.5) && (i + j) % 3 === 0 ? WIN : hash2(i >> 2, k) > 0.8 ? shade(col, -0.06) : col), VM.METAL);
  // shallow cone roof
  m.cyl(0, 0, d / 2 - 1, h, h + 1.5, shade(col, 0.06), VM.METAL);
  m.cyl(0, 0, d / 4, h + 1.5, h + 3, shade(col, 0.1), VM.METAL);
  if (fake) {
    // a pitched roof and a lawn painted on top so it reads as a building from the air
    for (let j = m.vy(-d / 2); j < m.vy(d / 2); j++) for (let i = m.vx(-d / 2); i < m.vx(d / 2); i++) {
      const x = m.mx(i), y = m.my(j);
      const k = m.topZ(i, j);
      if (k < 0) continue;
      const c = Math.abs(x) < d * 0.3 && Math.abs(y) < d * 0.2 ? (y > 0 ? '#8a5040' : '#7a4636') : '#6e8a52';
      m.set(i, j, k, c, VM.WOOD);
    }
  }
  return m;
}

/** towers: Ford Island's new control tower (top platform unfinished), Hickam's water tower, the
 *  Submarine Base escape training tower (striped) */
export function towerArt(kind: 'ford' | 'water' | 'escape'): VoxelModel {
  if (kind === 'ford') {
    const m = mk('tower_ford', 10, 10, 48, 1, 2);
    const steel = '#6c5a4c';
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) m.line([sx * 4, sy * 4, 0], [sx * 2.5, sy * 2.5, 46], steel);
    for (let z = 4; z < 46; z += 6) { const r = 4 - (z / 46) * 1.5; m.box(-r, r + 1, -r, -r + 1, z, z + 1, steel); m.box(-r, r + 1, r, r + 1, z, z + 1, steel); m.box(-r, -r + 1, -r, r + 1, z, z + 1, steel); m.box(r, r + 1, -r, r + 1, z, z + 1, steel); }
    m.box(-3.5, 3.5, -3.5, 3.5, 40, 41.5, '#8a8478', VM.METAL);
    return m;
  }
  if (kind === 'water') {
    const m = mk('tower_water', 16, 16, 54, 1, 2);
    m.cyl(0, 0, 3.2, 0, 40, '#dedbd0', VM.WOOD);
    m.cyl(0, 0, 7, 40, 50, (_i, _j, k) => (k === m.vz(41) ? '#b8b4a8' : '#e6e3da'), VM.WOOD);
    m.cyl(0, 0, 4, 50, 53, '#9a978e', VM.METAL);
    return m;
  }
  const m = mk('tower_escape', 14, 14, 42, 1, 1.5);
  m.cyl(0, 0, 3, 0, 34, (_i, _j, k) => (Math.floor(m.mz(k) / 3) % 2 ? '#b8382e' : '#e4e2da'), VM.METAL);
  walls(m, -5, 5, -5, 5, 34, 39, '#e4e2da', WIN, 1, 2);
  m.box(-5.5, 5.5, -5.5, 5.5, 39, 40, '#6a6862', VM.METAL);
  return m;
}

/** hammerhead crane beside Drydock 1: lattice tower, a long jib with the hoist trolley, counterweight
 *  aft; jib along +x */
export function hammerheadArt(): VoxelModel {
  const m = mk('hammerhead', 84, 16, 60, 1, 1.5);
  const c = '#5a5e5e';
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) m.line([-14 + sx * 6, sy * 6, 0], [-14 + sx * 4, sy * 4, 48], c);
  for (let z = 6; z < 48; z += 6) m.box(-20, -8, -6, 6, z, z + 1, (i, j) => (i === m.vx(-20) || i === m.vx(-8) - 1 || j === m.vy(-6) || j === m.vy(6) - 1 ? c : null), VM.METAL);
  // jib: a box truss 7 m wide, 6 m deep
  m.box(-42, 41, -3.5, 3.5, 48, 54, (i, j, k) => (k === m.vz(48) || k === m.vz(54) - 1 || j === m.vy(-3.5) || j === m.vy(3.5) - 1 ? (i % 4 === 0 ? shade(c, -0.15) : c) : null), VM.METAL);
  m.box(-42, -30, -4.5, 4.5, 44, 54, '#4a4c4c', VM.METAL);      // counterweight
  walls(m, -20, -8, -5, 5, 54, 58, '#7a7c78', WIN, 1, 3);       // machinery house
  m.box(28, 32, -2.5, 2.5, 45, 48, '#3a3c3c', VM.METAL);        // trolley and hook block
  m.line([30, 0, 45], [30, 0, 32], '#2a2a2a');
  return m;
}

/** dockside portal crane: a gantry on four legs, cab and luffing jib along +x */
export function portalCraneArt(): VoxelModel {
  const m = mk('portal_crane', 40, 12, 32, 1, 1.5);
  const c = '#6b6e6a';
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) m.line([-8 + sx * 5, sy * 5, 0], [-8 + sx * 3, sy * 3, 12], c);
  m.box(-12, -4, -4, 4, 12, 13.5, c, VM.METAL);
  walls(m, -12, -5, -3, 3, 13.5, 17.5, '#8a8c86', WIN, 1, 3);
  m.box(-12.5, -4.5, -3.5, 3.5, 17.5, 18.5, '#5a5c58', VM.METAL);
  m.line([-5, -1, 15], [18, -1, 29], c); m.line([-5, 1, 15], [18, 1, 29], c);
  m.line([18, 0, 29], [18, 0, 18], '#2a2a2a');
  return m;
}

/** a Ford Island mooring quay: a concrete block with bollards, standing out of the water */
export function quayArt(): VoxelModel {
  const m = mk('mooring_quay', 14, 9, 4, 1, 1, -2);
  m.box(-6, 6, -3.5, 3.5, -2, 2.5, (i, j) => (hash2(i, j) > 0.85 ? '#9a978c' : '#a9a69b'), VM.WOOD);
  for (const x of [-4, 0, 4]) m.box(x, x + 1, 2, 3, 2.5, 3.5, '#3a3a38', VM.METAL);
  return m;
}

/** Fort Kamehameha coast battery: a long concrete emplacement with gun platforms */
export function batteryArt(guns: number): VoxelModel {
  const L = 22 * guns + 10, m = mk(`battery${guns}`, L, 26, 8, 1, 1);
  m.box(-L / 2, L / 2, -12, 12, 0, 4, (i, j) => (hash2(i >> 1, j >> 1) > 0.8 ? '#8e8b80' : '#9d9a8e'), VM.WOOD);
  m.box(-L / 2, L / 2, -13, -12, 0, 2, '#6f8a52', VM.WOOD);
  for (let g = 0; g < guns; g++) {
    const x = -L / 2 + 16 + g * 22;
    m.cyl(x, 2, 7, 3, 4, '#7d7a70', VM.WOOD);
    m.cylX(x, x + 10, 2, 4.8, 0.7, '#3c403c', VM.METAL);
    m.box(x - 2, x + 2, 0, 4, 4, 5.5, '#4a4e4a', VM.METAL);
  }
  return m;
}

/** brick power house with smoke stacks (stacks listed so the placement can smoke them) */
export function powerHouseArt(name: string, L: number, W: number, stacks: number): VoxelModel {
  const m = mk(name, L + 2, W + 2, 40, 1, 1.5);
  walls(m, -L / 2, L / 2, -W / 2, W / 2, 0, 16, '#8a5a46', '#2a2e30', 3, 3);
  gableRoof(m, -L / 2, L / 2, -W / 2, W / 2, 16, '#5c5c58', 0);
  for (let s = 0; s < stacks; s++) {
    const x = -L / 2 + L * (s + 0.5) / stacks;
    m.cyl(x, -W / 2 - 3, 2, 0, 38, (_i, _j, k) => (k > m.vz(35) ? '#2a2a28' : '#7a4e3e'), VM.WOOD);
  }
  return m;
}

/** sugar mill: corrugated sheds round a tall brick chimney */
export function sugarMillArt(): VoxelModel {
  const m = mk('sugar_mill', 84, 50, 48, 1, 1.5);
  walls(m, -38, 10, -18, 18, 0, 14, '#9a9488', '#3a3c3c', 2, 4);
  gableRoof(m, -38, 10, -18, 18, 14, '#8a7a6a', 0);
  walls(m, 10, 38, -12, 12, 0, 9, '#a8a294', '#3a3c3c', 1, 4);
  gableRoof(m, 10, 38, -12, 12, 9, '#7c6e60', 0);
  m.cyl(-20, -22, 2.4, 0, 46, (_i, _j, k) => (k > m.vz(43) ? '#2a2826' : '#8a4e3a'), VM.WOOD);
  return m;
}

/** a white clapboard church with a steeple; a false-front store; a two-room school */
export function townBuildingArt(kind: 'church' | 'store' | 'school', v = 0): VoxelModel {
  if (kind === 'church') {
    const m = mk('church', 22, 12, 20, 1, 1);
    walls(m, -9, 9, -5, 5, 0, 5, '#e8e6de', WIN, 1, 3);
    gableRoof(m, -9, 9, -5, 5, 5, '#5a5c58');
    m.box(9, 13, -2, 2, 0, 12, '#e8e6de', VM.WOOD);
    hipRoof(m, 9, 13, -2, 2, 12, '#4a4c48', 0);
    return m;
  }
  if (kind === 'store') {
    const m = mk(`store${v}`, 16, 12, 7, 1, 1);
    const wall = ['#c4b28c', '#b8c0a4', '#d0c4ac'][v % 3];
    walls(m, -7, 7, -5, 5, 0, 4, wall, WIN, 1, 2);
    m.box(-7, 7, -5, 5, 4, 4.8, '#6a6862', VM.METAL);
    m.box(-7, 7, 4, 5, 4.8, 6, wall, VM.WOOD);                       // false front
    m.box(-6, 6, 5, 7, 2.8, 3.4, '#7a5a44', VM.WOOD);                // awning
    return m;
  }
  return blockArt('school', 30, 10, 1, '#d9cfae', '#7b5644');
}

// ------------------------------------------------------------------ trees
/** coconut palm: a leaning trunk and a crown of drooping fronds */
export function palmArt(v: number): VoxelModel {
  const H = 9 + (v % 3) * 2, m = mk(`palm${v}`, 12, 12, H + 2, 0.5, 0.5);
  const lean = ((v % 4) - 1.5) * 0.12;
  for (let z = 0; z < H; z += 0.5) {
    const t = z / H, x = lean * z * t * 1.2;
    m.set(m.vx(x), m.vy(0), m.vz(z), t > 0.9 ? '#5a4e3a' : (Math.floor(z * 2) % 3 ? '#7a6a52' : '#6a5c46'), VM.WOOD);
  }
  const tx = lean * H * 1.2, fr = ['#6a8c40', '#7a9a46', '#5e8038', '#8a9448'];
  for (let f = 0; f < 9; f++) {
    const a = f * 0.698 + v * 0.37, len = 4.8 + hash2(f, v) * 1.4;
    for (let s = 0; s <= len; s += 0.4) {
      const u = s / len, x = tx + Math.cos(a) * s, y = Math.sin(a) * s, z = H + 0.6 - u * u * 2.4;
      const c = fr[(f + v) % fr.length];
      m.set(m.vx(x), m.vy(y), m.vz(z), c, VM.WOOD);
      if (u > 0.15 && u < 0.85) { m.set(m.vx(x - Math.sin(a) * 0.5), m.vy(y + Math.cos(a) * 0.5), m.vz(z - 0.3), shade(c, -0.1), VM.WOOD); m.set(m.vx(x + Math.sin(a) * 0.5), m.vy(y - Math.cos(a) * 0.5), m.vz(z - 0.3), shade(c, -0.1), VM.WOOD); }
    }
  }
  m.set(m.vx(tx), m.vy(0), m.vz(H), '#6a5a2a', VM.WOOD);
  return m;
}

/** broad shade tree (monkeypod, banyan): an umbrella crown on a short trunk; `kiawe` is scrub */
export function treeArt(v: number, kiawe = false): VoxelModel {
  const D = kiawe ? 5 + (v % 3) : 12 + (v % 3) * 3, H = kiawe ? 4 : 9 + (v % 2) * 2;
  const m = mk(`${kiawe ? 'kiawe' : 'tree'}${v}`, D + 2, D + 2, H + 1, 1, 1);
  m.box(-0.5, 0.5, -0.5, 0.5, 0, H * 0.5, '#5a4a3a', VM.WOOD);
  const top = kiawe ? '#4c5c34' : '#466a32', dark = kiawe ? '#3c4a2a' : '#34522a';
  for (let k = m.vz(H * 0.45); k < m.vz(H); k++) {
    const z = m.mz(k), u = (z - H * 0.45) / (H * 0.55), r = D / 2 * Math.sqrt(Math.max(0.05, 1 - (u - 0.35) * (u - 0.35) * 2.2));
    for (let j = m.vy(-r); j <= m.vy(r); j++) for (let i = m.vx(-r); i <= m.vx(r); i++) {
      const dx = m.mx(i), dy = m.my(j), n = hash2(i * 3 + v, j * 5 + k);
      if (dx * dx + dy * dy > r * r * (0.75 + n * 0.35)) continue;
      m.set(i, j, k, n > 0.7 ? shade(top, 0.08) : u < 0.4 ? dark : top, VM.WOOD);
    }
  }
  return m;
}

// ------------------------------------------------------------------ defences
/** sandbagged AA pit with a 3-inch gun or a .50 calibre machine gun, barrel along +x, elevated */
export function aaPitArt(kind: 'gun3' | 'mg'): VoxelModel {
  const R = kind === 'gun3' ? 4 : 2.2, m = mk(`aapit_${kind}`, R * 2 + 6, R * 2 + 2, 6, 0.5, 0.5);
  m.cyl(0, 0, R, 0, 1.2, (i, j, k, mm) => {
    const x = mm.mx(i), y = mm.my(j);
    if (x * x + y * y < (R - 0.9) * (R - 0.9)) return k === 0 ? '#7a7058' : null;
    return (i + k) % 3 === 0 ? '#8a7a5a' : '#a08e6a';
  }, VM.WOOD);
  if (kind === 'gun3') {
    m.cyl(0, 0, 0.9, 0, 1.8, '#4a5038', VM.METAL);
    m.line([0, 0, 1.8], [3.2, 0, 4.6], '#3a3e32'); m.line([0, 0.25, 1.8], [3.2, 0.25, 4.6], '#3a3e32');
  } else {
    m.box(-0.4, 0.4, -0.4, 0.4, 0, 1.3, '#3a3e32', VM.METAL);
    m.line([0, 0, 1.3], [1.6, 0, 2.2], '#2a2c28');
  }
  return m;
}

// ------------------------------------------------------------------ parked aircraft
export type ShorePlane = 'b17' | 'b18' | 'a20' | 'pby';
const LANDPLANE: Record<ShorePlane, { len: number; span: number; r: number; eng: number[]; top: string; under: string; boat?: boolean }> = {
  // Boeing B-17D: olive drab over neutral grey, four engines, the small fin of the early models
  b17: { len: 20.7, span: 31.6, r: 1.15, eng: [4.4, 8.6], top: '#5c5a3e', under: '#8c8c86' },
  // Douglas B-18 Bolo: the portly twin of the Hawaiian Air Force's bomber groups
  b18: { len: 17.6, span: 27.3, r: 1.3, eng: [4.3], top: '#5c5a3e', under: '#8c8c86' },
  // Douglas A-20A Havoc
  a20: { len: 14.6, span: 18.7, r: 0.8, eng: [3.2], top: '#5c5a3e', under: '#8c8c86' },
  // Consolidated PBY-5 Catalina: blue-grey over light grey, a parasol wing on a pylon
  pby: { len: 19.5, span: 31.7, r: 1.1, eng: [3.6], top: '#66788a', under: '#bfc4c6', boat: true },
};
/** a parked (or, `wreck`, burnt-out) aircraft, nose toward +x, sitting on its gear at z = 0 */
export function shorePlaneArt(kind: ShorePlane, wreck = false): VoxelModel {
  const s = LANDPLANE[kind], r = 0.5, L = s.len, W = s.span;
  const m = mk(`sp_${kind}${wreck ? '_w' : ''}`, L + 2, W + 2, 8, r, r);
  const burn = (c: string, i: number, j: number) => (wreck ? (hash2(i, j) > 0.55 ? '#1c1a18' : hash2(i + 9, j) > 0.5 ? '#3a3632' : shade(c, -0.45)) : c);
  const gz = s.boat ? 1.3 : 1.6;   // fuselage axis height on the ground
  for (let i = m.vx(-L / 2); i < m.vx(L / 2); i++) {
    const x = m.mx(i), t = (x + L / 2) / L;
    if (wreck && t > 0.25 && t < 0.4) continue;                       // broken in two
    const rr = s.r * (0.35 + 0.65 * Math.min(1, t * 2.5)) * (t > 0.9 ? 1 - (t - 0.9) * 4 : 1);
    m.cylX(x, x + r, 0, gz + (1 - t) * 0.4, Math.max(0.3, rr), (ii, jj, k, mm) => burn(mm.mz(k) < gz ? s.under : s.top, ii, jj), VM.METAL);
  }
  const wz = s.boat ? gz + 3 : gz - 0.2;
  // wings: tapered, the PBY's carried high on a pylon with floats at the tips
  for (let j = m.vy(-W / 2); j <= m.vy(W / 2); j++) {
    const y = m.my(j), u = Math.abs(y) / (W / 2);
    if (wreck && y > W * 0.18 && hash2(j, 7) > 0.3) continue;          // a wing gone
    const chord = (kind === 'pby' ? 3.4 : 3.6 - u * 1.8) + 0.3, x0 = L * 0.08 - chord * 0.5;
    m.box(x0, x0 + chord, y - r / 2, y + r / 2, wz, wz + 0.5, (ii, jj) => burn(s.top, ii, jj), VM.METAL);
  }
  if (s.boat) {
    m.box(L * 0.06 - 1, L * 0.06 + 1, -0.5, 0.5, gz + 0.8, wz, burn(s.top, 1, 1), VM.METAL);
    for (const sg of [-1, 1]) m.box(L * 0.04, L * 0.04 + 1.6, sg * W * 0.45 - 0.4, sg * W * 0.45 + 0.4, wz - 1.6, wz - 0.8, burn(s.under, 2, 2), VM.METAL);
  }
  for (const e of s.eng) for (const sg of [-1, 1]) {
    if (wreck && sg > 0 && e > W * 0.18) continue;
    m.cylX(L * 0.08 - 1.4, L * 0.08 + 1.6, sg * e, wz + (s.boat ? 0.6 : 0), 0.65, burn('#3e3e38', e, sg), VM.METAL);
  }
  if (!wreck) {
    // star insignia on the wing tops: white star on a blue disc with a red centre (1941)
    for (const sg of [-1, 1]) m.cyl(L * 0.06, sg * W * 0.36, 1, wz + 0.4, wz + 0.5, (i, j, _k, mm) => { const dx = mm.mx(i) - L * 0.06, dy = mm.my(j) - sg * W * 0.36, d = Math.hypot(dx, dy); return d < 0.3 ? '#b03030' : d < 0.7 ? '#e8e8e2' : '#24324e'; }, VM.METAL);
    m.box(L * 0.3, L * 0.38, -0.4, 0.4, gz + s.r * 0.6, gz + s.r * 0.6 + 0.6, '#7f97a8', VM.GLASS);
  }
  // tail: tailplane and a single fin
  m.box(-L / 2, -L / 2 + 2.2, -W * 0.16, W * 0.16, gz + 0.6, gz + 1.0, (ii, jj) => burn(s.top, ii, jj), VM.METAL);
  if (!wreck || hash2(3, 4) > 0.5) m.box(-L / 2, -L / 2 + 2.6, -0.25, 0.25, gz + 0.6, gz + 4.2, (ii, jj) => burn(s.top, ii, jj), VM.METAL);
  return m;
}

// ------------------------------------------------------------------ cars and trucks
const CAR_COLS = ['#1e1e20', '#2e4232', '#5a2626', '#26304a', '#a89a7a', '#6a6a66', '#3a3a36', '#7a6a4e'];
/** 1930s sedan, pickup, 2 1/2-ton truck (army olive or navy grey) or a bus; nose toward +x */
export function carArt(kind: 'sedan' | 'pickup' | 'truck' | 'navytruck' | 'bus', v = 0): VoxelModel {
  const dims: Record<string, [number, number, number]> = { sedan: [4.8, 1.8, 1.6], pickup: [4.9, 1.8, 1.8], truck: [6.8, 2.3, 2.8], navytruck: [6.8, 2.3, 2.8], bus: [10, 2.5, 3] };
  const [L, W, H] = dims[kind];
  const m = mk(`car_${kind}${v}`, L + 1, W + 1, H + 1, 0.5, 0.5);
  const body = kind === 'truck' ? '#4b5032' : kind === 'navytruck' ? '#6d7272' : kind === 'bus' ? (v % 2 ? '#c8a03c' : '#5a7a5a') : CAR_COLS[v % CAR_COLS.length];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) m.box(sx * L * 0.32 - 0.4, sx * L * 0.32 + 0.4, sy * W / 2 - 0.4, sy * W / 2, 0, 0.6, '#151515', VM.METAL);
  m.box(-L / 2, L / 2, -W / 2, W / 2, 0.4, 1.1, body, VM.METAL);
  if (kind === 'sedan') { m.box(-L * 0.28, L * 0.14, -W / 2 + 0.2, W / 2 - 0.2, 1.1, 1.6, '#2a3238', VM.GLASS); m.box(-L * 0.26, L * 0.12, -W / 2 + 0.3, W / 2 - 0.3, 1.5, 1.6, body, VM.METAL); }
  else if (kind === 'pickup') { m.box(-0.2, L * 0.18, -W / 2 + 0.2, W / 2 - 0.2, 1.1, 1.8, body, VM.METAL); m.box(L * 0.1, L * 0.18, -W / 2 + 0.3, W / 2 - 0.3, 1.2, 1.6, '#2a3238', VM.GLASS); }
  else if (kind === 'bus') { m.box(-L / 2, L / 2, -W / 2, W / 2, 1.1, 2.8, (_i, j, k) => (k === m.vz(2) && j % 2 ? '#2a3238' : body), VM.METAL); m.box(-L / 2, L / 2, -W / 2, W / 2, 2.8, 3, '#d8d4c8', VM.METAL); }
  else { m.box(L * 0.18, L / 2 - 0.4, -W / 2, W / 2, 1.1, 2.2, body, VM.METAL); m.box(-L / 2, L * 0.15, -W / 2, W / 2, 1.1, 2.8, kind === 'truck' ? '#6b6a4a' : '#8a8e8a', VM.CANVAS); }
  return m;
}

// ------------------------------------------------------------------ harbour craft
/** small craft hull, bow toward +x: half beam B/2 tapering to a point at the bow, a transom aft */
function boatHull(m: VoxelModel, L: number, B: number, zTop: number, draft: number, hull: string, top: string, pointedStern = false) {
  for (let i = m.vx(-L / 2); i < m.vx(L / 2); i++) {
    const x = m.mx(i), u = (x + L / 2) / L;
    let hw = B / 2 * (u > 0.62 ? Math.sqrt(Math.max(0, 1 - ((u - 0.62) / 0.38) ** 2)) : 1);
    if (pointedStern && u < 0.25) hw *= Math.sqrt(u / 0.25);
    if (hw < 0.2) continue;
    for (let k = m.vz(-draft); k < m.vz(zTop); k++) {
      const z = m.mz(k), w = hw * (z < 0 ? 0.8 + 0.2 * (1 + z / draft) : 1);
      for (let j = m.vy(-w); j <= m.vy(w); j++) {
        const edge = Math.abs(m.my(j)) > w - 0.5;
        m.set(i, j, k, k === m.vz(zTop) - 1 ? (edge ? shade(hull, 0.1) : top) : z < 0.2 ? shade(hull, -0.25) : hull, VM.METAL);
      }
    }
  }
}

export type CraftKind = 'launch' | 'whaleboat' | 'tug' | 'lighter' | 'sweeper' | 'pt';
/** harbour craft: 50 ft motor launch, 26 ft whaleboat, a YT harbour tug, a YG lighter, a Lapwing-class
 *  minesweeper, an Elco PT boat. Built to the waterline at z = 0 */
export function craftArt(kind: CraftKind): VoxelModel {
  const D: Record<CraftKind, [number, number, number, number]> = { launch: [15.2, 3.8, 1.3, 0.9], whaleboat: [7.9, 2.2, 0.8, 0.5], tug: [30.5, 7.6, 2.2, 2.8], lighter: [33, 9, 1.8, 2.4], sweeper: [57, 10.8, 4, 3.2], pt: [23.5, 6, 1.6, 1.2] };
  const [L, B, fb, T] = D[kind];
  const H = kind === 'sweeper' ? 22 : kind === 'tug' ? 12 : 5;
  const m = mk(`craft_${kind}`, L + 1, B + 1, H + T, 0.5, 0.5, -T);
  const grey = '#7c8286', deckWood = '#8a7a5e';
  if (kind === 'launch') {
    boatHull(m, L, B, fb, T, grey, deckWood);
    walls(m, -2, 3, -1.3, 1.3, fb, fb + 1.6, '#8c9296', '#2a3238', 1, 2);
    m.box(-2.2, 3.2, -1.5, 1.5, fb + 1.6, fb + 1.9, '#6c7276', VM.METAL);
  } else if (kind === 'whaleboat') {
    boatHull(m, L, B, fb, T, '#c8ccca', deckWood, true);
    for (const x of [-2, 0, 2]) m.box(x, x + 0.5, -B / 2 + 0.5, B / 2 - 0.5, fb - 0.5, fb, '#6a5a44', VM.WOOD);
    m.paintTop(-L / 2 + 1.5, L / 2 - 1.5, -B / 2 + 0.6, B / 2 - 0.6, '#5a4c3a');
  } else if (kind === 'tug') {
    boatHull(m, L, B, fb, T, '#2a2a2a', '#5a5248');
    m.box(L / 2 - 3, L / 2, -B / 2 + 1, B / 2 - 1, fb, fb + 0.8, '#1a1a1a', VM.WOOD);            // bow fender
    walls(m, -6, 6, -2.4, 2.4, fb, fb + 2.6, '#9a9a90', WIN, 1, 2);
    walls(m, 2, 6, -1.8, 1.8, fb + 2.6, fb + 4.6, '#a8a89e', WIN, 1, 2);
    m.box(1.8, 6.2, -2, 2, fb + 4.6, fb + 5, '#5a5a56', VM.METAL);
    m.cyl(-1, 0, 1.1, fb + 2.6, fb + 6.5, (_i, _j, k) => (k > m.vz(fb + 5.5) ? '#1a1a1a' : '#a8a89e'), VM.METAL);
  } else if (kind === 'lighter') {
    boatHull(m, L, B, fb, T, '#3a3c3a', '#5a5450');
    m.box(-L / 2 + 3, L / 2 - 5, -B / 2 + 1, B / 2 - 1, fb - 0.6, fb, '#2a2826', VM.WOOD);
    walls(m, -L / 2 + 1, -L / 2 + 6, -2.5, 2.5, fb, fb + 2.4, '#7a7c78', WIN, 1, 2);
    m.cyl(-L / 2 + 3, 0, 0.6, fb + 2.4, fb + 5, '#2a2a2a', VM.METAL);
  } else if (kind === 'sweeper') {
    boatHull(m, L, B, fb, T, grey, '#6a6e70');
    m.box(L * 0.1, L / 2 - 4, -B / 2 + 0.6, B / 2 - 0.6, fb, fb + 2.2, grey, VM.METAL);             // fo'c'sle
    walls(m, L * 0.12, L * 0.28, -2.6, 2.6, fb + 2.2, fb + 5, '#868c90', WIN, 1, 2);
    m.cyl(-2, 0, 1.3, fb, fb + 9, (_i, _j, k) => (k > m.vz(fb + 8) ? '#1a1a1a' : '#868c90'), VM.METAL);
    m.line([L * 0.22, 0, fb + 5], [L * 0.22, 0, fb + 17], '#5a5e60');
    m.line([-L * 0.25, 0, fb], [-L * 0.25, 0, fb + 13], '#5a5e60');
    m.line([-L * 0.25, 0, fb + 4], [-L * 0.45, 0, fb + 6], '#5a5e60');
  } else {
    boatHull(m, L, B, fb, T, '#6e7478', '#6e7478');
    m.box(-1, 3, -1.4, 1.4, fb, fb + 1.2, '#5e6468', VM.METAL);
    for (const sg of [-1, 1]) { m.cylX(-7, -1.5, sg * 2.2, fb + 0.5, 0.35, '#4a4e50'); m.cylX(2, 7.5, sg * 2.2, fb + 0.5, 0.35, '#4a4e50'); }
    for (const sg of [-1, 1]) m.cyl(0.5, sg * 1.9, 0.5, fb, fb + 1.6, '#3a3e40', VM.METAL);
  }
  return m;
}
