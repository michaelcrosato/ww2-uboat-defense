// Pearl Harbor ashore in detail (M18): the ground painted with roads, the railway, runways, aprons and
// lawns, then real buildings placed on it from surveyed and estimated positions (docs/milestones/
// M18-effects-pearl.md lists them with their confidence): the Navy Yard with its dry docks, hammerhead
// crane and shops, the Naval Hospital on Hospital Point, the Submarine Base and its escape tower, the
// tank farms, Ford Island's hangars and quarters, Hickam's hangar line and Hale Makai, Fort Kamehameha,
// Pearl City, Aiea and its sugar mill. Towns are filled with houses along their streets, trees by
// district. Parked aircraft, AA positions, roads for traffic and boat routes are handed back to the
// scenario. Everything here is cosmetic placement (hashes, never the simulation RNG).

import type { World, Scenery } from '../world';
import type { RenderScene } from '../../render/scene';
import type { StackModel, VoxelModel } from '../../art/voxel';
import { geo, inPoly, type LandArea, type LandMap, type Pt } from './land';
import { brg } from './scenario';
import * as A from '../../art/shoreArt';
import { hash2 } from '../../core/math';

/** the scenario's coordinate origin (Pearl Harbor and this file share it) */
export const P = geo(21.364, -157.958);
const ll = (...a: number[]): Pt[] => { const out: Pt[] = []; for (let i = 0; i < a.length; i += 2) out.push(P(a[i], a[i + 1])); return out; };
const DEG = Math.PI / 180;
/** the point d metres from p on compass bearing b */
export const go = (p: Pt, b: number, d: number): Pt => [p[0] + Math.sin(b * DEG) * d, p[1] - Math.cos(b * DEG) * d];
/** ground level of the land tiles (top of their single voxel layer) */
export const GROUND = 1.5;

const C = {
  asphalt: '#4f4e4a', street: '#5f5d56', dirt: '#86735a', rail: '#55493f', runway: '#55544e', shoulder: '#7b7867',
  apron: '#9b988d', concrete: '#a6a398', lawn: '#6c8b4d', parade: '#79974f', coal: '#2e2c2a', tennis: '#4f7a55', berm: '#7a6c52',
};
/** paints buildings and trees may stand on */
const SOFT = new Set([C.lawn, C.parade, C.berm]);

// ------------------------------------------------------------------ the corrected 1941 shoreline
/**
 * Land outlines. Corrections over M17 from surveyed points: the north shore of East Loch runs past
 * Aiea Bay, Kalauao and Waimalu to the Waiau plant (it lay ~1 km too far north); Pearl City peninsula
 * is wider on its Middle Loch side; Waipio peninsula reaches north to the head of Middle Loch; the land
 * east of the Navy Yard (Makalapa, the tank farms, the main gate) was missing; Ford Island's east seawall
 * stands ~35 m inboard of Battleship Row and its north-west shore by the Utah memorial.
 */
export const PEARL_LAND: LandArea[] = [
  // Ford Island
  { kind: 'base', pts: ll(21.35918, -157.96871, 21.35777, -157.96717, 21.35724, -157.96513, 21.35802, -157.96242, 21.36025, -157.95833, 21.36169, -157.95624, 21.36289, -157.95419, 21.36416, -157.95226, 21.36542, -157.95032, 21.36672, -157.94841, 21.36851, -157.94852, 21.37046, -157.94940, 21.37197, -157.95112, 21.37237, -157.95319, 21.37207, -157.95651, 21.36957, -157.96052, 21.36692, -157.96441, 21.36390, -157.96684, 21.36180, -157.96856, 21.36012, -157.96894) },
  // Navy Yard and Hospital Point
  { kind: 'yard', pts: ll(21.3467, -157.9606, 21.3494, -157.9616, 21.3521, -157.9619, 21.3543, -157.9608, 21.3558, -157.9581, 21.3570, -157.9557, 21.3591, -157.9518, 21.3592, -157.9504, 21.3568, -157.9475, 21.3541, -157.9436, 21.3518, -157.9402, 21.3485, -157.9417, 21.3458, -157.9494, 21.3440, -157.9571, 21.3444, -157.9610) },
  // Submarine Base, Kuahua
  { kind: 'yard', pts: ll(21.3592, -157.9504, 21.3603, -157.9489, 21.3621, -157.9465, 21.3644, -157.9436, 21.3664, -157.9407, 21.3678, -157.9388, 21.3682, -157.9359, 21.3660, -157.9320, 21.3579, -157.9320, 21.3530, -157.9368, 21.3518, -157.9402, 21.3541, -157.9436, 21.3568, -157.9475) },
  // Makalapa, the tank farms and the main gate between the yard, the Sub Base and Hickam
  { kind: 'scrub', pts: ll(21.3660, -157.9300, 21.3660, -157.9320, 21.3579, -157.9320, 21.3530, -157.9368, 21.3518, -157.9402, 21.3485, -157.9417, 21.3408, -157.9349, 21.3238, -157.9349, 21.3184, -157.9330, 21.3184, -157.9300) },
  // Halawa and Aiea round the north shore of East Loch to the Waiau plant
  { kind: 'town', pts: ll(21.3660, -157.9320, 21.3678, -157.9388, 21.3705, -157.9373, 21.3742, -157.9345, 21.3765, -157.9385, 21.3790, -157.9425, 21.3810, -157.9460, 21.3830, -157.9505, 21.3852, -157.9560, 21.3868, -157.9592, 21.3870, -157.9610, 21.3990, -157.9610, 21.3990, -157.9300, 21.3660, -157.9300) },
  // Pearl City peninsula
  { kind: 'town', pts: ll(21.3777, -157.9658, 21.3790, -157.9634, 21.3817, -157.9619, 21.3867, -157.9607, 21.3990, -157.9612, 21.3990, -157.9772, 21.3940, -157.9772, 21.3890, -157.9775, 21.3840, -157.9762, 21.3805, -157.9735, 21.3786, -157.9690) },
  // Waipio peninsula (sugar cane) up to the head of Middle Loch; West Loch lies beyond the map's west edge
  { kind: 'cane', pts: ll(21.3458, -157.9648, 21.3498, -157.9658, 21.3552, -157.9682, 21.3602, -157.9725, 21.3660, -157.9759, 21.3723, -157.9774, 21.3759, -157.9841, 21.3800, -157.9858, 21.3850, -157.9862, 21.3900, -157.9850, 21.3925, -157.9810, 21.3935, -157.9778, 21.3992, -157.9778, 21.3992, -158.0, 21.3624, -158.0, 21.3624, -157.9947, 21.3525, -157.9851, 21.3462, -157.9754, 21.3431, -157.9687) },
  // Hickam Field and Fort Kamehameha
  { kind: 'base', pts: ll(21.3467, -157.9606, 21.3444, -157.9610, 21.3390, -157.9619, 21.3319, -157.9634, 21.3256, -157.9650, 21.3206, -157.9666, 21.3188, -157.9629, 21.3184, -157.9542, 21.3197, -157.9446, 21.3238, -157.9349, 21.3408, -157.9349, 21.3485, -157.9417, 21.3458, -157.9494, 21.3440, -157.9571) },
  // Iroquois Point
  { kind: 'scrub', pts: ll(21.3202, -157.9699, 21.3256, -157.9693, 21.3328, -157.9685, 21.3381, -157.9682, 21.3404, -157.9711, 21.3381, -157.9783, 21.3346, -157.9880, 21.3256, -157.9909, 21.3179, -157.9889, 21.3179, -157.9793) },
  // the rest of Oahu round the map: north of the lochs, east toward Honolulu, Ewa to the west
  { kind: 'cane', pts: ll(21.3990, -158.0, 21.42, -158.0, 21.42, -157.90, 21.3990, -157.90) },
  { kind: 'scrub', pts: ll(21.3990, -157.9300, 21.3990, -157.90, 21.318, -157.90, 21.3184, -157.9300) },
  { kind: 'scrub', pts: ll(21.3346, -158.0, 21.3346, -157.9889, 21.3179, -157.9889, 21.3179, -158.0) },
];

/** Southeast Loch: the inlet from Merry Point between the Navy Yard and the Submarine Base */
export const SE_LOCH = ll(21.3596, -157.9512, 21.3612, -157.9478, 21.3565, -157.9440, 21.3525, -157.9410, 21.3505, -157.9430, 21.3548, -157.9470);

// ------------------------------------------------------------------ anchors
const DOCK_MOUTH = P(21.3551, -157.9594), DOCK_AXIS = 149;
const DOCK_1010 = P(21.3582, -157.9536);
/** Drydock No. 2 (1,000 x 147 ft, flooded and new in December 1941) parallel to No. 1 across the approach pier */
export const DRYDOCK2 = { ...(() => { const c = go(go(DOCK_MOUTH, DOCK_AXIS, 158), DOCK_AXIS + 90, 78); return { x: c[0], y: c[1] }; })(), h: brg(DOCK_AXIS), hl: 152, hw: 22 };

export interface ParkedPlane { s: Scenery; wreck: StackModel; alive: boolean; x: number; y: number }
export interface LandAA { x: number; y: number; z: number; heavy: number; light: number; range: number; ready: string }
export interface Building { x: number; y: number; h: number; hl: number; hw: number; big: boolean; burning?: boolean }
export interface CraftRoute { kind: A.CraftKind; pts: Pt[]; speed: number; start?: string; loop?: boolean; hose?: boolean }

export interface PearlDetail {
  planes: ParkedPlane[];
  aa: LandAA[];
  buildings: Building[];
  roads: Pt[][];
  routes: CraftRoute[];
  moored: { kind: A.CraftKind; x: number; y: number; h: number }[];
  stacks: { x: number; y: number; z: number }[];
}

// ------------------------------------------------------------------ placement
class Dresser {
  readonly occ: Uint8Array;
  private cache = new Map<string, StackModel>();
  readonly out: PearlDetail = { planes: [], aa: [], buildings: [], roads: [], routes: [], moored: [], stacks: [] };
  constructor(readonly w: World, readonly scene: RenderScene, readonly land: LandMap) { this.occ = new Uint8Array(land.nx * land.ny); }

  model(build: () => VoxelModel, key: string) {
    let m = this.cache.get(key);
    if (!m) { m = this.scene.atlas.add(build()); this.cache.set(key, m); }
    return m;
  }
  /** visit the land cells under an oriented rectangle; stop (false) as soon as fn says so */
  private cells(x: number, y: number, h: number, hl: number, hw: number, fn: (k: number) => boolean) {
    const L = this.land, res = L.res, r = Math.hypot(hl, hw) + res, cs = Math.cos(h), sn = Math.sin(h);
    for (let j = Math.floor((y - r - L.y0) / res); j <= Math.ceil((y + r - L.y0) / res); j++) for (let i = Math.floor((x - r - L.x0) / res); i <= Math.ceil((x + r - L.x0) / res); i++) {
      const dx = L.x0 + (i + 0.5) * res - x, dy = L.y0 + (j + 0.5) * res - y;
      // cells whose centre lies under the footprint (a small house covers a cell or two)
      if (Math.abs(dx * cs + dy * sn) > hl + res * 0.25 || Math.abs(-dx * sn + dy * cs) > hw + res * 0.25) continue;
      if (i < 0 || j < 0 || i >= L.nx || j >= L.ny) return false;
      if (!fn(j * L.nx + i)) return false;
    }
    return true;
  }
  free(x: number, y: number, h: number, hl: number, hw: number, onPaint = false) {
    const L = this.land;
    return this.cells(x, y, h, hl, hw, (k) => L.cell[k] > 0 && !this.occ[k] && (onPaint || !L.paint[k] || SOFT.has(L.palette[L.paint[k] - 1])));
  }
  claim(x: number, y: number, h: number, hl: number, hw: number) { this.cells(x, y, h, hl, hw, (k) => { this.occ[k] = 1; return true; }); }
  /** place a model if its footprint is free (or `force`); returns the scenery entry */
  put(m: StackModel, x: number, y: number, h: number, hl: number, hw: number, o: { z?: number; force?: boolean; onPaint?: boolean; building?: boolean; big?: boolean } = {}): Scenery | null {
    if (!o.force && !this.free(x, y, h, hl, hw, o.onPaint)) return null;
    this.claim(x, y, h, hl, hw);
    this.w.addScenery(m, x, y, o.z ?? GROUND, h);
    if (o.building !== false && hl * hw > 30) this.out.buildings.push({ x, y, h, hl, hw, big: !!o.big });
    return this.w.scenery[this.w.scenery.length - 1];
  }
  /** place at p, else nudge along bearing b in 10 m steps (estimated positions that land on the shore) */
  fit(m: StackModel, p: Pt, h: number, hl: number, hw: number, b: number, o: { big?: boolean } = {}) {
    for (let d = 0; d <= 160; d += 10) {
      const q = go(p, b, d);
      const s = this.put(m, q[0], q[1], h, hl, hw, { big: o.big });
      if (s) return s;
    }
    return null;
  }
  /** a road for the ground and, cut to its stretches over land, for the traffic */
  road(pts: Pt[], hw: number, color = C.street, traffic = true) {
    this.land.paintLine(pts, hw, color);
    if (!traffic) return;
    let run: Pt[] = [];
    const flush = () => { if (run.length > 1) this.out.roads.push(run); run = []; };
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 20));
      for (let s = i === 1 ? 0 : 1; s <= n; s++) {
        const p: Pt = [ax + (bx - ax) * s / n, ay + (by - ay) * s / n];
        if (this.land.isLand(p[0], p[1])) run.push(p); else flush();
      }
    }
    flush();
  }
}

/** a street grid over a polygon: streets every `sx`/`sy` m on axes at compass bearing b; returns lot centres */
function grid(D: Dresser, poly: Pt[], o: Pt, b: number, sx: number, sy: number, hw = 3.5, color = C.street) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const R = Math.hypot(x1 - x0, y1 - y0);
  const lots: Pt[] = [];
  const clip = (a: Pt, c: Pt) => {
    // keep the parts of the line inside the polygon
    const n = Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1]) / 10);
    let run: Pt[] = [];
    for (let s = 0; s <= n; s++) {
      const p: Pt = [a[0] + (c[0] - a[0]) * s / n, a[1] + (c[1] - a[1]) * s / n];
      if (inPoly(p[0], p[1], poly)) run.push(p); else { if (run.length > 1) D.road([run[0], run[run.length - 1]], hw, color); run = []; }
    }
    if (run.length > 1) D.road([run[0], run[run.length - 1]], hw, color);
  };
  const N = Math.ceil(R / Math.min(sx, sy)) + 1;
  for (let i = -N; i <= N; i++) {
    const a = go(go(o, b + 90, i * sx), b, -R), c = go(go(o, b + 90, i * sx), b, R);
    clip(a, c);
    const e = go(go(o, b, i * sy), b + 90, -R), f = go(go(o, b, i * sy), b + 90, R);
    clip(e, f);
  }
  for (let i = -N; i <= N; i++) for (let j = -N; j <= N; j++) {
    const p = go(go(o, b + 90, (i + 0.5) * sx), b, (j + 0.5) * sy);
    if (inPoly(p[0], p[1], poly)) lots.push(p);
  }
  return lots;
}

/** fill lots with houses (2-4 a lot, facing the street) and a few shops and churches */
function houses(D: Dresser, lots: Pt[], b: number, sx: number, sy: number, density: number, tag: number, quarters = false) {
  const h = brg(b + 90);
  for (const [k, p] of lots.entries()) {
    const r = hash2(Math.round(p[0] / 7) + tag, Math.round(p[1] / 7));
    if (r > density) continue;
    if (r < density * 0.04 && !quarters) { const m = D.model(() => A.townBuildingArt(r < density * 0.015 ? 'church' : 'store', k), r < density * 0.015 ? 'church' : `store${k % 3}`); D.put(m, p[0], p[1], h, 10, 7); continue; }
    // a row of houses along each long side of the lot, a car in some of the driveways between them
    const per = Math.max(1, Math.floor((sx - 6) / 22));
    for (const side of [-1, 1]) for (let n = 0; n < per; n++) {
      const v = (k * 7 + n * 3 + (side > 0 ? 1 : 0) + tag) % 6;
      if (hash2(k * 13 + n, side + tag) > 0.85) continue;
      const q = go(go(p, b + 90, (n - (per - 1) / 2) * 22), b, side * (sy / 2 - 13));
      const m = quarters ? D.model(() => A.quartersArt(v % 2), `qtrs${v % 2}`) : D.model(() => A.bungalowArt(v), `bung${v}`);
      // houses face the street: front (+y) toward the lot's edge
      if (!D.put(m, q[0], q[1], side > 0 ? h + Math.PI : h, quarters ? 9 : 7, quarters ? 7 : 6)) continue;
      if (n < per - 1 && hash2(k * 5 + n, side * 3 + tag) < 0.45) {
        const c = go(go(q, b + 90, 11), b, side * 3), cv = (k + n + tag) % 8;
        D.put(D.model(() => A.carArt(cv % 5 === 4 ? 'pickup' : 'sedan', cv), `car_${cv % 5 === 4 ? 'pickup' : 'sedan'}${cv}`), c[0], c[1], brg(side > 0 ? b : b + 180), 2.5, 1, { building: false });
      }
    }
  }
}

// ------------------------------------------------------------------ the dressing
export function dressPearl(w: World, scene: RenderScene, land: LandMap): PearlDetail {
  const D = new Dresser(w, scene, land), out = D.out;
  const mod = (key: string, build: () => VoxelModel) => D.model(build, key);

  // ---- Southeast Loch, Drydock No. 2 and the piers built out into the water
  land.carvePoly(SE_LOCH);
  land.carve(DRYDOCK2);
  const pier = (base: Pt, b: number, len: number, wid: number) => {
    const a = go(base, b + 90, wid / 2), c = go(base, b - 90, wid / 2);
    land.addLand([a, go(a, b, len), go(c, b, len), c], 'yard');
    land.paintPoly([a, go(a, b, len), go(c, b, len), c], C.concrete);
  };
  // Submarine Base piers off the north-east bank of the loch; PT boats at S-13 on the middle one
  const subPiers = [ll(21.3584, -157.9455)[0], ll(21.3568, -157.9441)[0], ll(21.3552, -157.9428)[0]];
  for (const p of subPiers) pier(go(p, 56, 25), 236, 135, 18);
  // approach pier between the dry docks, Merry Point landing, Ford Island ferry landing
  pier(go(DOCK_MOUTH, DOCK_AXIS + 90, 39), DOCK_AXIS + 180, 30, 24);
  pier(P(21.3593, -157.9512), 340, 45, 12);
  const fiFerry = P(21.3601, -157.9611);
  pier(fiFerry, 125, 55, 12);
  // Pearl City: the Pan Am base pier on Middle Loch, a landing on the East Loch side; Aiea landing
  pier(P(21.3812, -157.9750), 255, 120, 14);
  pier(P(21.3797, -157.9645), 105, 70, 10);
  pier(P(21.3757, -157.9356), 235, 70, 10);

  // ---- roads and the railway (painted first so buildings keep off them)
  const KAM = ll(21.3260, -157.9300, 21.3330, -157.9330, 21.3400, -157.9360, 21.3480, -157.9395, 21.35356, -157.93570, 21.3620, -157.9345, 21.37089, -157.93422, 21.3790, -157.9390, 21.3822, -157.9435, 21.38400, -157.94763, 21.3870, -157.9545, 21.3893, -157.9612, 21.3935, -157.9710, 21.39644, -157.97959, 21.3985, -157.9900, 21.3990, -158.0);
  D.road(KAM, 4.5, C.asphalt);
  land.paintLine(ll(21.3300, -157.9310, 21.3480, -157.9385, 21.3600, -157.9338, 21.3685, -157.9330, 21.37420, -157.93355, 21.3790, -157.9405, 21.3825, -157.9475, 21.3895, -157.9600, 21.3920, -157.9720, 21.3915, -157.9930), 1.6, C.rail);
  // Navy Yard: Main Gate road in, and the yard's street grid on the 1010 Dock's axes
  D.road(ll(21.3482, -157.9398, 21.3492, -157.9430, 21.3510, -157.9470), 4, C.asphalt);
  // (the grid keeps clear of Hospital Point and the officers' quarters south of the shops)
  const YARD = ll(21.3494, -157.9605, 21.3521, -157.9612, 21.3543, -157.9600, 21.3558, -157.9575, 21.3570, -157.9552, 21.3588, -157.9520, 21.3568, -157.9478, 21.3541, -157.9440, 21.3518, -157.9408, 21.3490, -157.9420, 21.3472, -157.9480, 21.3480, -157.9565);
  const yardO = go(DOCK_1010, 150, 160);
  const yardLots = grid(D, YARD, yardO, 150, 140, 105, 4);
  // Sub Base, Hickam, Ford Island, towns
  const SUB = PEARL_LAND[2].pts;
  const subLots = grid(D, SUB, P(21.3590, -157.9430), 146, 110, 90, 3.5);
  const FI = PEARL_LAND[0].pts;
  const fiC: Pt = [FI.reduce((a, p) => a + p[0], 0) / FI.length, FI.reduce((a, p) => a + p[1], 0) / FI.length];
  const ring = FI.map((p) => { const d = Math.hypot(p[0] - fiC[0], p[1] - fiC[1]); return [p[0] + (fiC[0] - p[0]) * 45 / d, p[1] + (fiC[1] - p[1]) * 45 / d] as Pt; });
  D.road([...ring, ring[0]], 3.5, C.street);

  // ---- Ford Island: landing field, apron, hangar line, tower, quarters
  const fiRwy = P(21.36489, -157.95976);
  land.paintRect(fiRwy[0], fiRwy[1], brg(42), 610, 23, C.runway);
  const tower = P(21.3612, -157.9608);
  const h37 = go(tower, 215, 80), h79 = P(21.3600, -157.9617), h54 = go(tower, 215, 245);
  land.paintPoly([go(go(tower, 35, 60), 125, 40), go(go(h54, 215, 60), 125, 40), go(go(h54, 215, 60), 125, 260), go(go(tower, 35, 60), 125, 260)], C.apron);
  const hang = mod('h_ford', () => A.hangarArt('h_ford', 70, 60, false, '#7a7c78', '#c9c5b6'));
  for (const p of [h37, h79, h54]) D.fit(hang, p, brg(125), 37, 36, 305, { big: true });
  // Hangar 6 (1922) and the seaplane ramps at the south end
  const h6 = P(21.3583, -157.9644);
  D.fit(mod('h_sea', () => A.hangarArt('h_sea', 80, 55, false, '#8a8a84', '#c4c0b2')), h6, brg(135), 42, 34, 45, { big: true });
  for (let i = 0; i < 3; i++) land.paintRect(...go(go(h6, 135, 90), 45, (i - 1) * 45), brg(135), 40, 7, C.concrete);
  D.put(mod('tower_ford', () => A.towerArt('ford')), tower[0], tower[1], brg(42), 5, 5, { force: true });
  // PBY Catalinas of the patrol squadrons drawn up on the apron and the ramps
  const pby = mod('sp_pby', () => A.shorePlaneArt('pby')), pbyW = mod('sp_pby_w', () => A.shorePlaneArt('pby', true));
  for (let i = 0; i < 14; i++) {
    const q = go(go(h79, 125, 85 + Math.floor(i / 7) * 36), 35, (i % 7 - 3) * 34);
    const sc = D.put(pby, q[0], q[1], brg(305), 10, 16, { onPaint: true, building: false });
    if (sc) out.planes.push({ s: sc, wreck: pbyW, alive: true, x: q[0], y: q[1] });
  }
  // administration, barracks and the BOQ between the hangars and the quarters
  const blk = (key: string, L: number, Wd: number, st: number, wall: string, roof: string, flat = false) => mod(key, () => A.blockArt(key, L, Wd, st, wall, roof, flat));
  const fiBlk = blk('fi_bks', 60, 15, 2, '#e2ddcf', '#6a6a64');
  for (const p of [go(tower, 125 + 180, 120), go(tower, 35, 140), go(go(tower, 35, 140), 305, 60), go(tower, 35, 260)]) D.fit(fiBlk, p, brg(35), 31, 9, 305);
  // Nob Hill officers' bungalows at the north end, the chiefs' bungalows on the north-east tip
  const nob = P(21.3705, -157.9580);
  for (let i = 0; i < 19; i++) { const q = go(go(nob, 54, (i % 10 - 4.5) * 34), 324, (i < 10 ? -1 : 1) * 30); D.put(mod('qtrs0', () => A.quartersArt(0)), q[0], q[1], brg(i < 10 ? 234 : 54), 9, 8); }
  const cpo = P(21.3675, -157.9495);
  for (let i = 0; i < 12; i++) { const q = go(go(cpo, 324, (i % 6 - 2.5) * 26), 54, (i < 6 ? -1 : 1) * 24); D.put(mod('bung1', () => A.bungalowArt(1)), q[0], q[1], brg(i < 6 ? 324 : 144), 7, 6); }
  D.fit(mod('tank_30_12_0', () => A.tankArt(30, 12)), P(21.3686, -157.9540), 0, 16, 16, 234);

  // ---- Navy Yard
  const hh = mod('hammerhead', () => A.hammerheadArt());
  const hhAt = go(go(DOCK_MOUTH, DOCK_AXIS, 110), DOCK_AXIS - 90, 38);
  D.put(hh, hhAt[0], hhAt[1], brg(DOCK_AXIS + 90), 12, 8, { force: true, building: false });
  // dock-side and quay cranes: both dry docks, the 1010 Dock
  const portal = mod('portal_crane', () => A.portalCraneArt());
  // east of No. 1, on the approach pier between the docks, west of No. 2; jibs over the nearest dock
  for (const d of [60, 190]) for (const [off, b] of [[-28, 90], [38, 90], [108, -90]]) { const q = go(go(DOCK_MOUTH, DOCK_AXIS, d), DOCK_AXIS + 90, off); D.put(portal, q[0], q[1], brg(DOCK_AXIS + b), 6, 6, { force: true, building: false }); }
  for (let i = 0; i < 6; i++) { const q = go(go(DOCK_1010, 60, (i - 2.5) * 70), 150, 14); D.put(portal, q[0], q[1], brg(330), 6, 6, { force: true, building: false }); }
  // coal docks on the west waterfront: piles and the minesweepers nested alongside
  const coal = P(21.3492, -157.9608);
  land.paintRect(coal[0], coal[1], brg(170), 80, 22, C.coal);
  for (let i = 0; i < 4; i++) { const q = go(go(P(21.3489, -157.9622), 260, i * 11.5), 170, 0); out.moored.push({ kind: 'sweeper', x: q[0], y: q[1], h: brg(350) }); }
  // the Naval Hospital on Hospital Point, its wards toward the yard, tennis courts behind the lab
  const hosp = P(21.3462, -157.9594);
  land.paintRect(...go(hosp, 90, 30), Math.PI / 2, 75, 70, C.lawn);
  D.fit(mod('naval_hospital', () => A.hospitalArt()), hosp, Math.PI / 2, 47, 32, 90, { big: true });
  land.paintRect(...go(hosp, 90, 75), brg(0), 18, 9, C.tennis);
  for (let i = 0; i < 4; i++) { const q = go(go(hosp, 0, (i - 1.5) * 40), 90, 100); D.put(mod('qtrs1', () => A.quartersArt(1)), q[0], q[1], Math.PI / 2, 9, 8); }
  // Marine Barracks round a parade ground by the Main Gate, officers' quarters south of the shops
  const mb = P(21.3488, -157.9440);
  land.paintRect(mb[0], mb[1], brg(60), 70, 40, C.parade);
  const mbBlk = blk('marine_bks', 80, 16, 3, '#d8d2c0', '#7b5644');
  for (const s of [-1, 1]) { const q = go(mb, 150, s * 58); D.put(mbBlk, q[0], q[1], brg(60), 41, 9); }
  houses(D, grid(D, ll(21.3452, -157.9560, 21.3466, -157.9500, 21.3478, -157.9505, 21.3466, -157.9565), P(21.3466, -157.9530), 150, 90, 60), 150, 90, 60, 0.9, 11, true);
  // Merry Point: the landing and its fuel tanks
  for (let i = 0; i < 3; i++) { const q = go(P(21.3578, -157.9512), 150, i * 42); D.put(mod('tank_32_12_0', () => A.tankArt(32, 12)), q[0], q[1], 0, 17, 17); }

  // shops fill the grid round the landmarks: machine, boiler, sheet metal, foundry, storehouses; the power plant
  const shops = [
    mod('shop_mon', () => A.shopArt('shop_mon', 110, 60, 16, '#a9a69a', '#6d6e6a', 'monitor')),
    mod('shop_saw', () => A.shopArt('shop_saw', 90, 70, 12, '#8c5a46', '#6a6a66', 'saw')),
    mod('shop_gab', () => A.shopArt('shop_gab', 100, 40, 12, '#b4b0a2', '#7c7a72', 'gable')),
    mod('store_flat', () => A.blockArt('store_flat', 100, 40, 3, '#bdb8a8', '#6a6a64', true)),
  ];
  const dims: [number, number][] = [[56, 31], [46, 36], [51, 21], [51, 21]];
  for (const [k, p] of yardLots.entries()) {
    const v = Math.floor(hash2(k, 77) * 4);
    if (k === 7) { D.put(mod('power149', () => A.powerHouseArt('power149', 60, 30, 3)), p[0], p[1], brg(60), 32, 22, { big: true }); out.stacks.push(...[0, 1, 2].map((s) => { const q = go(go(p, 60, -30 + 60 * (s + 0.5) / 3), 150, -18); return { x: q[0], y: q[1], z: GROUND + 38 }; })); continue; }
    const placed = D.put(shops[v], p[0], p[1], brg(60), dims[v][0], dims[v][1], { big: true }) ? dims[v] : D.put(shops[2], p[0], p[1], brg(60), 51, 21, { big: true }) ? dims[2] : null;
    if (!placed) continue;
    // trucks and the workmen's cars drawn up along the shop's long side
    for (let x = -placed[0] + 6; x < placed[0] - 4; x += 6) {
      if (hash2(k * 31 + x, 5) > 0.55) continue;
      const c = go(go(p, 60, x), 150, placed[1] + 5), cv = (k * 3 + x) & 7, kind = cv < 3 ? 'navytruck' : 'sedan';
      D.put(D.model(() => A.carArt(kind, cv), `car_${kind}${cv}`), c[0], c[1], brg(150), 2.5, 1, { building: false });
    }
  }
  // ---- Submarine Base, the tank farms
  D.put(blk('lockwood', 70, 16, 3, '#e4dfcf', '#94503e'), ...P(21.35423, -157.94122), brg(146), 36, 9) ?? D.fit(blk('lockwood', 70, 16, 3, '#e4dfcf', '#94503e'), P(21.35423, -157.94122), brg(146), 36, 9, 56);
  const esc = P(21.3530, -157.9400);
  D.put(mod('tower_escape', () => A.towerArt('escape')), esc[0], esc[1], 0, 7, 7, { force: true });
  D.put(mod('church', () => A.townBuildingArt('church')), ...go(esc, 90, 28), brg(146), 11, 6);
  const tanks = (c: Pt, nx: number, ny: number, fakeAt: number) => {
    for (let i = 0; i < nx * ny; i++) {
      const q = go(go(c, 56, ((i % nx) - (nx - 1) / 2) * 62), 146, (Math.floor(i / nx) - (ny - 1) / 2) * 62);
      const fake = i === fakeAt;
      // an earth berm round each tank (painted once the tank has found room, so roads stay whole)
      if (D.put(mod(`tank_38_14_${fake ? 1 : 0}`, () => A.tankArt(38, 14, fake)), q[0], q[1], 0, 20, 20, { big: true })) land.paintDisc(q[0], q[1], 27, C.berm);
    }
  };
  tanks(P(21.3502, -157.9408), 4, 4, 9);   // the lower farm (16 tanks)
  tanks(P(21.3575, -157.9345), 5, 2, 3);   // the upper farm (10)
  const subBlk = [blk('sub_bks', 70, 15, 3, '#e4dfcf', '#94503e'), blk('sub_shop', 60, 30, 2, '#bdb8a8', '#6a6a64', true)];
  for (const [k, p] of subLots.entries()) D.put(subBlk[k % 2], p[0], p[1], brg(56), k % 2 ? 31 : 36, k % 2 ? 16 : 9);
  for (let i = 0; i < 6; i++) { const q = go(go(subPiers[1], 236, 60 + Math.floor(i / 2) * 26), 146, (i % 2 ? 1 : -1) * 13); out.moored.push({ kind: 'pt', x: q[0], y: q[1], h: brg(236) }); }
  out.moored.push({ kind: 'lighter', ...(() => { const q = go(go(subPiers[1], 236, 145), 146, 0); return { x: q[0], y: q[1] }; })(), h: brg(236) });

  // ---- Hickam Field
  const rwy = P(21.3290, -157.9470);
  land.paintRect(rwy[0], rwy[1], brg(45), 1074, 122, C.shoulder);
  land.paintRect(rwy[0], rwy[1], brg(45), 1074, 46, C.runway);
  // the three smaller runways: a triangle south-east of the main one (layout estimated)
  const T = go(rwy, 135, 450);
  const V = [go(T, 300, 450), go(T, 60, 450), go(T, 180, 450)];
  for (let i = 0; i < 3; i++) { const a = V[i], c = V[(i + 1) % 3], L = [1440, 1227, 1411][i]; const m: Pt = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2]; land.paintRect(m[0], m[1], Math.atan2(c[1] - a[1], c[0] - a[0]), L / 2, 38, C.runway); }
  const HM = P(21.3320, -157.9500);
  land.paintRect(...go(HM, 135, 115), brg(45), 600, 75, C.apron);
  // hangar line, south-west to north-east: Hangar 35 (double), the paired hangars, the air operations
  // building and Hangars 2 and 4
  const pair = mod('h_hickam', () => A.hangarArt('h_hickam', 66, 52, true, '#7e807c', '#d6d2c4'));
  for (let i = 0; i < 7; i++) {
    const q = go(HM, 45, (i - 3) * 165);
    if (i === 5) { D.put(blk('hickam_ops', 50, 22, 3, '#e2ded0', '#6a6a64', true), q[0], q[1], brg(45), 26, 12, { force: true, big: true }); D.put(mod('tower_ford', () => A.towerArt('ford')), ...go(q, 315, 18), brg(45), 5, 5, { force: true }); continue; }
    D.put(pair, q[0], q[1], brg(135), 34, 68, { force: true, big: true });
  }
  // the bombers on the apron, wingtip to wingtip as on the morning of the attack
  const park = (kind: A.ShorePlane, n: number, from: Pt, gap: number) => {
    const m = mod(`sp_${kind}`, () => A.shorePlaneArt(kind)), wk = mod(`sp_${kind}_w`, () => A.shorePlaneArt(kind, true));
    for (let i = 0; i < n; i++) {
      const q = go(from, 45, i * gap);
      const s = D.put(m, q[0], q[1], brg(135), 10, 14, { force: true, building: false });
      if (s) out.planes.push({ s, wreck: wk, alive: true, x: q[0], y: q[1] });
    }
  };
  park('b18', 26, go(go(HM, 225, 520), 135, 95), 30);
  park('b17', 12, go(go(HM, 225, 100), 135, 150), 35);
  park('a20', 12, go(go(HM, 45, 340), 135, 150), 22);
  // Hale Makai: the long spine with its wings, the parade mall and the water tower at its end
  const hale = P(21.3365, -157.9530);
  const spine = mod('hale_spine', () => A.haleMakaiArt('spine')), wing = mod('hale_wing', () => A.haleMakaiArt('wing'));
  for (let i = 0; i < 5; i++) { const q = go(hale, 45, (i - 2) * 42); D.put(spine, q[0], q[1], brg(45), 21, 9, { force: true, big: true }); }
  for (let i = 0; i < 6; i++) { const q = go(go(hale, 45, (i % 3 - 1) * 84), 135, (i < 3 ? 1 : -1) * 38); D.put(wing, q[0], q[1], brg(45), 8, 29, { force: true, big: true }); }
  const mallEnd = go(hale, 315, 500);
  land.paintRect(...go(hale, 315, 270), brg(315), 230, 40, C.parade);
  D.put(mod('tower_water', () => A.towerArt('water')), mallEnd[0], mallEnd[1], 0, 8, 8, { force: true });
  // officers' and NCO housing west toward the harbour entrance
  const hickHouse = ll(21.3440, -157.9600, 21.3425, -157.9560, 21.3360, -157.9575, 21.3290, -157.9600, 21.3255, -157.9620, 21.3265, -157.9645, 21.3330, -157.9628, 21.3400, -157.9612);
  houses(D, grid(D, hickHouse, P(21.3380, -157.9580), 45, 80, 70), 45, 80, 70, 0.85, 23, true);
  // ---- Fort Kamehameha: coast batteries on the shore, barracks and quarters behind
  for (const [la, lo, g] of [[21.3203, -157.9568, 2], [21.3199, -157.9527, 2], [21.3203, -157.9492, 2]] as [number, number, number][]) D.fit(mod(`battery${g}`, () => A.batteryArt(g)), P(la, lo), brg(80), 27, 13, 0);
  houses(D, grid(D, ll(21.3250, -157.9625, 21.3245, -157.9585, 21.3215, -157.9590, 21.3212, -157.9640), P(21.3232, -157.9610), 80, 70, 60), 80, 70, 60, 0.9, 31, true);

  // ---- Pearl City, Aiea, Halawa, Waiau: the landmarks first, then the houses round them
  D.fit(mod('h_panam', () => A.hangarArt('h_panam', 45, 36, false, '#8a8c88', '#d8d4c8')), P(21.3815, -157.9738), brg(75), 24, 20, 75, { big: true });
  const mill = D.fit(mod('sugar_mill', () => A.sugarMillArt()), P(21.3835, -157.9305), brg(20), 42, 26, 200, { big: true });
  // the chimney stands at model (-20, -22): back along the mill's axis, then to its port side
  if (mill) { const q = go(go([mill.x, mill.y], 20, -20), 290, 22); out.stacks.push({ x: q[0], y: q[1], z: GROUND + 46 }); }
  const waiau = D.fit(mod('power_waiau', () => A.powerHouseArt('power_waiau', 50, 28, 2)), P(21.3888, -157.9608), brg(80), 27, 20, 0, { big: true });
  if (waiau) for (let s = 0; s < 2; s++) { const q = go(go([waiau.x, waiau.y], 80, -25 + 50 * (s + 0.5) / 2), 170, -17); out.stacks.push({ x: q[0], y: q[1], z: GROUND + 38 }); }
  const pc = ll(21.3790, -157.9645, 21.3880, -157.9615, 21.3925, -157.9620, 21.3930, -157.9765, 21.3845, -157.9758, 21.3800, -157.9720);
  houses(D, grid(D, pc, P(21.3850, -157.9690), 350, 75, 110), 350, 75, 110, 0.7, 41);
  const aiea = ll(21.3770, -157.9330, 21.3800, -157.9390, 21.3880, -157.9420, 21.3930, -157.9350, 21.3880, -157.9300, 21.3790, -157.9300);
  houses(D, grid(D, aiea, P(21.3840, -157.9340), 20, 70, 90), 20, 70, 90, 0.75, 53);
  houses(D, grid(D, ll(21.3672, -157.9375, 21.3700, -157.9365, 21.3720, -157.9310, 21.3665, -157.9305), P(21.3690, -157.9335), 15, 70, 80), 15, 70, 80, 0.7, 59);

  // ---- trees by district, then AA pits
  trees(D);
  aaSites(D, mod);

  // ---- harbour craft routes (water lanes; positions estimated, see the milestone notes)
  out.routes.push(
    { kind: 'launch', pts: [go(fiFerry, 125, 70), P(21.3585, -157.9590), P(21.3572, -157.9568)], speed: 4, loop: true },
    { kind: 'launch', pts: [P(21.3602, -157.9515), P(21.3628, -157.9505), P(21.3655, -157.9470)], speed: 4.5, loop: true },
    { kind: 'launch', pts: [P(21.3787, -157.9632), P(21.3760, -157.9590), P(21.3735, -157.9545)], speed: 4, loop: true },
    { kind: 'launch', pts: [P(21.3750, -157.9370), P(21.3742, -157.9440), P(21.3725, -157.9495)], speed: 4, loop: true },
    // rescue boats along Battleship Row once the torpedoes have struck
    { kind: 'whaleboat', pts: [P(21.3612, -157.9545), P(21.3640, -157.9505), P(21.3655, -157.9480)], speed: 2, start: '08:10', loop: true },
    { kind: 'whaleboat', pts: [P(21.3632, -157.9525), P(21.3600, -157.9572)], speed: 2, start: '08:14', loop: true },
    { kind: 'launch', pts: [P(21.3645, -157.9478), P(21.3622, -157.9520)], speed: 3, start: '08:20', loop: true },
    // Hoga (YT-146) leaves the 1010 Dock for the burning battleships; YG-17 plays a hose on them
    { kind: 'tug', pts: [go(DOCK_1010, 330, 45), P(21.3610, -157.9530), P(21.3628, -157.9492)], speed: 3.5, start: '08:45', hose: true },
    { kind: 'lighter', pts: [P(21.3612, -157.9540), P(21.3632, -157.9505)], speed: 1.5, start: '08:25', hose: true },
  );
  return out;
}

/** trees by district: palms along the bases and the shore, shade trees in the towns, kiawe in the scrub */
function trees(D: Dresser) {
  const L = D.land, step = 14;
  const palm = [0, 1, 2, 3].map((v) => D.model(() => A.palmArt(v), `palm${v}`));
  const shade = [0, 1, 2].map((v) => D.model(() => A.treeArt(v), `tree${v}`));
  const kiawe = [0, 1, 2].map((v) => D.model(() => A.treeArt(v, true), `kiawe${v}`));
  for (let y = L.y0 + step / 2; y < L.y0 + L.ny * L.res; y += step) for (let x = L.x0 + step / 2; x < L.x0 + L.nx * L.res; x += step) {
    const a = L.at(x, y);
    if (!a) continue;
    const kind = L.areas[a - 1].kind;
    const n = hash2(Math.round(x / step) * 3 + 1, Math.round(y / step) * 7 + 5);
    const p = kind === 'town' ? 0.16 : kind === 'base' ? 0.07 : kind === 'yard' ? 0.025 : kind === 'scrub' ? 0.05 : 0.004;
    if (n > p) continue;
    const jx = x + (hash2(x | 0, 3) - 0.5) * step * 0.8, jy = y + (hash2(y | 0, 9) - 0.5) * step * 0.8;
    const v = Math.floor(n / p * 97) % 4;
    const shore = !L.isLand(jx + 25, jy) || !L.isLand(jx - 25, jy) || !L.isLand(jx, jy + 25) || !L.isLand(jx, jy - 25);
    const m = kind === 'scrub' && !shore ? kiawe[v % 3] : kind === 'town' && !shore && v < 2 ? shade[v % 3] : palm[v];
    D.put(m, jx, jy, n * 40, m === palm[v] ? 1.5 : 4, m === palm[v] ? 1.5 : 4, { building: false });
  }
}

/** AA positions ashore (the Marines' machine guns at the Navy Yard, the Sub Base, Ford Island, Hickam's
 *  Battery D of the 97th Coast Artillery, Fort Kamehameha's guns); positions estimated */
function aaSites(D: Dresser, mod: (key: string, build: () => VoxelModel) => StackModel) {
  const gun = mod('aapit_gun3', () => A.aaPitArt('gun3')), mg = mod('aapit_mg', () => A.aaPitArt('mg'));
  const site = (la: number, lo: number, heavy: number, light: number, ready: string) => {
    const p = P(la, lo);
    for (let d = 0; d < 120; d += 10) {
      const q = go(p, (d * 37) % 360, d);
      if (D.put(heavy ? gun : mg, q[0], q[1], hash2(la * 1e4, lo * 1e4) * 6.28, heavy ? 5 : 3, heavy ? 5 : 3, { building: false })) {
        D.out.aa.push({ x: q[0], y: q[1], z: GROUND + 2, heavy, light, range: heavy ? 2800 : 1300, ready });
        return;
      }
    }
  };
  for (const [la, lo] of [[21.3555, -157.9560], [21.3530, -157.9520], [21.3505, -157.9480], [21.3478, -157.9540], [21.3520, -157.9590], [21.3570, -157.9535]]) site(la, lo, 0, 2, '08:12');
  for (const [la, lo] of [[21.3575, -157.9470], [21.3560, -157.9420], [21.3600, -157.9440]]) site(la, lo, 0, 2, '07:58');
  for (const [la, lo] of [[21.3620, -157.9585], [21.3665, -157.9520], [21.3640, -157.9640], [21.3700, -157.9560]]) site(la, lo, 0, 2, '08:00');
  for (const [la, lo] of [[21.3428, -157.9455], [21.3436, -157.9445], [21.3420, -157.9440], [21.3430, -157.9432]]) site(la, lo, 1, 0, '08:25');
  for (const [la, lo] of [[21.3240, -157.9560], [21.3236, -157.9548], [21.3246, -157.9540], [21.3230, -157.9575]]) site(la, lo, 1, 0, '08:12');
  for (const [la, lo] of [[21.3300, -157.9550], [21.3350, -157.9470], [21.3270, -157.9420]]) site(la, lo, 0, 2, '08:08');
}
