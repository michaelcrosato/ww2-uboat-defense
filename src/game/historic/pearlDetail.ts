// Pearl Harbor ashore in detail (M18, re-fitted to survey points in M19): the ground painted with roads, the
// railway, runways, aprons and lawns, then real buildings placed on it from surveyed and estimated positions
// (docs/milestones/M18-effects-pearl.md and M19-gi-pearl-survey.md list them with their confidence): the Navy Yard with its dry docks, hammerhead
// crane and shops, the Naval Hospital on Hospital Point, the Submarine Base and its escape tower, the
// tank farms, Ford Island's hangars and quarters, Hickam's hangar line and Hale Makai, Fort Kamehameha,
// Pearl City, Aiea and its sugar mill. Towns are filled with houses along their streets, trees by
// district. Parked aircraft, AA positions, roads for traffic and boat routes are handed back to the
// scenario. Everything here is cosmetic placement (hashes, never the simulation RNG).

import type { World, Scenery } from '../world';
import type { RenderScene } from '../../render/scene';
import type { StackModel, VoxelModel } from '../../art/voxel';
import { geo, inPoly, LAND_Z, type LandArea, type LandMap, type Pt } from './land';
import { brg } from './scenario';
import * as A from '../../art/shoreArt';
import type { CraftKind } from '../../art/shoreArt';
import { hash2 } from '../../core/math';

/** the scenario's coordinate origin (Pearl Harbor and this file share it) */
export const P = geo(21.364, -157.958);
const ll = (...a: number[]): Pt[] => { const out: Pt[] = []; for (let i = 0; i < a.length; i += 2) out.push(P(a[i], a[i + 1])); return out; };
const DEG = Math.PI / 180;
/** the point d metres from p on compass bearing b */
export const go = (p: Pt, b: number, d: number): Pt => [p[0] + Math.sin(b * DEG) * d, p[1] - Math.cos(b * DEG) * d];
/** ground level of the land tiles (top of their single voxel layer) */
export const GROUND = LAND_Z;

const C = {
  asphalt: '#4f4e4a', street: '#5f5d56', dirt: '#86735a', rail: '#55493f', runway: '#55544e', shoulder: '#7b7867',
  apron: '#9b988d', concrete: '#a6a398', lawn: '#6c8b4d', parade: '#79974f', coal: '#2e2c2a', tennis: '#4f7a55', berm: '#7a6c52',
};
/** paints buildings and trees may stand on */
const SOFT = new Set([C.lawn, C.parade, C.berm]);

// ------------------------------------------------------------------ the corrected 1941 shoreline
/**
 * Land outlines, fitted (M19) to survey-grade points: USGS GNIS place points (Hospital Point, Bishop Point,
 * Waipio Point, McGrew Point, Pearl City Peninsula, Merry Point Landing; the Southeast Loch, Aiea Bay, East
 * Loch and Ford Island Channel water points), the Library of Congress HABS/HAER record points (Dry Docks 1-3,
 * the Ford Island seaplane ramps, hangars and administration building, Hickam's Hangar 35), the memorial and
 * pier markers along Battleship Row, the rail stations along Kamehameha Highway and the NOAA Halawa Landing
 * station. M18's outline put the main channel, Hospital Point and Hickam's shore 400-600 m too far east,
 * the dry docks' waterfront 400 m too far north, Ford Island's south shore 180 m too far north and Pearl City
 * peninsula's tip 500 m too far north. The modern points stand for 1941 except where fill changed the shore
 * later (Kuahua, the head of Magazine Loch, Ford Island's west side, Waipio): there the 1941 lines are drawn
 * a little inside today's.
 */
export const PEARL_LAND: LandArea[] = [
  // Ford Island: east shore by the Battleship Row markers, the Utah memorial to the north-west, the south
  // tip at seaplane ramp S360 and the 1933 ramps on the south shore
  { kind: 'base', pts: ll(21.35545, -157.96600, 21.35580, -157.96450, 21.35602, -157.96310, 21.35700, -157.96150, 21.35850, -157.95960, 21.36025, -157.95833, 21.36169, -157.95624, 21.36289, -157.95419, 21.36416, -157.95226, 21.36542, -157.95032, 21.36672, -157.94841, 21.36851, -157.94852, 21.37046, -157.94940, 21.37197, -157.95112, 21.37237, -157.95319, 21.37207, -157.95651, 21.36957, -157.96052, 21.36692, -157.96441, 21.36390, -157.96684, 21.36180, -157.96856, 21.36012, -157.96894, 21.35918, -157.96871, 21.35760, -157.96780, 21.35620, -157.96700) },
  // Navy Yard and Hospital Point: the dry docks open north onto a waterfront at ~21.3514, the 1010 Dock runs
  // north from No. 1's mouth, the Repair Basin east of it, Southeast Loch and Quarry Loch beyond (carved below)
  { kind: 'yard', pts: ll(21.34874, -157.96756, 21.34950, -157.96600, 21.35040, -157.96420, 21.35120, -157.96270, 21.35145, -157.96150, 21.35140, -157.95950, 21.35150, -157.95860, 21.35420, -157.95720, 21.35450, -157.95500, 21.35520, -157.95300, 21.35650, -157.95150, 21.35900, -157.95150, 21.36000, -157.95000, 21.36250, -157.94800, 21.36500, -157.94500, 21.36640, -157.94200, 21.36830, -157.94000, 21.36900, -157.93850, 21.36600, -157.93500, 21.35000, -157.93700, 21.34800, -157.93950, 21.34600, -157.94400, 21.34500, -157.95000, 21.34450, -157.95600, 21.34420, -157.96200, 21.34450, -157.96770, 21.34650, -157.96790) },
  // Makalapa, the tank farms and the main gate behind the yard, the Submarine Base and Kuahua
  { kind: 'scrub', pts: ll(21.3690, -157.9300, 21.3690, -157.9385, 21.3660, -157.9350, 21.3500, -157.9370, 21.3480, -157.9395, 21.3460, -157.9440, 21.3408, -157.9349, 21.3238, -157.9349, 21.3184, -157.9330, 21.3184, -157.9300) },
  // Halawa and Aiea round the north shore of East Loch to the Waiau plant: Aiea Bay and McGrew Point
  { kind: 'town', pts: ll(21.3690, -157.9300, 21.3690, -157.9385, 21.3705, -157.9373, 21.3725, -157.9345, 21.3772, -157.9358, 21.3768, -157.9395, 21.37624, -157.94177, 21.3782, -157.9440, 21.3810, -157.9462, 21.3830, -157.9505, 21.3852, -157.9560, 21.3868, -157.9592, 21.3870, -157.9610, 21.3990, -157.9610, 21.3990, -157.9300) },
  // Pearl City peninsula, its tip by the GNIS point
  { kind: 'town', pts: ll(21.3712, -157.9702, 21.3735, -157.9675, 21.3762, -157.9655, 21.3790, -157.9634, 21.3817, -157.9619, 21.3867, -157.9607, 21.3990, -157.9612, 21.3990, -157.9772, 21.3940, -157.9772, 21.3890, -157.9775, 21.3840, -157.9765, 21.3790, -157.9752, 21.3745, -157.9730) },
  // Waipio peninsula (sugar cane) from Waipio Point to the head of Middle Loch; West Loch lies beyond
  { kind: 'cane', pts: ll(21.34219, -157.97207, 21.3445, -157.9725, 21.3480, -157.9735, 21.3530, -157.9745, 21.3580, -157.9758, 21.3620, -157.9770, 21.3670, -157.9790, 21.3723, -157.9805, 21.3759, -157.9841, 21.3800, -157.9858, 21.3850, -157.9862, 21.3900, -157.9850, 21.3925, -157.9810, 21.3935, -157.9785, 21.3992, -157.9785, 21.3992, -158.0, 21.3624, -158.0, 21.3624, -157.9947, 21.3525, -157.9851, 21.3462, -157.9780, 21.3431, -157.9745) },
  // Hickam Field and Fort Kamehameha: the channel's east bank through Bishop Point to the yard
  { kind: 'base', pts: ll(21.34450, -157.96770, 21.34420, -157.96200, 21.34450, -157.95600, 21.34500, -157.95000, 21.34600, -157.94400, 21.3460, -157.9440, 21.3408, -157.9349, 21.3238, -157.9349, 21.3180, -157.9440, 21.3168, -157.9480, 21.3170, -157.9525, 21.3172, -157.9580, 21.3180, -157.9640, 21.3206, -157.9672, 21.3256, -157.9678, 21.33148, -157.96850, 21.3390, -157.9688) },
  // Iroquois Point: the west bank of the entrance channel, the West Loch entrance to its north
  { kind: 'scrub', pts: ll(21.3205, -157.9735, 21.3260, -157.9738, 21.3320, -157.9740, 21.3365, -157.9742, 21.3385, -157.9760, 21.3381, -157.9810, 21.3346, -157.9880, 21.3256, -157.9909, 21.3179, -157.9889, 21.3179, -157.9793) },
  // the rest of Oahu round the map: north of the lochs, east toward Honolulu, Ewa to the west
  { kind: 'cane', pts: ll(21.3990, -158.0, 21.42, -158.0, 21.42, -157.90, 21.3990, -157.90) },
  { kind: 'scrub', pts: ll(21.3990, -157.9300, 21.3990, -157.90, 21.318, -157.90, 21.3184, -157.9300) },
  { kind: 'scrub', pts: ll(21.3346, -158.0, 21.3346, -157.9889, 21.3179, -157.9889, 21.3179, -158.0) },
];

/**
 * Southeast Loch from the harbour to the tip of the Submarine Base (the GNIS water point lies in it), and
 * the two arms it forks into: Quarry Loch east along Merry Point (the landing on its south shore) under the
 * base's piers, Magazine Loch north of the base with Kuahua beyond
 */
export const SE_LOCH = ll(21.35650, -157.95150, 21.35900, -157.95150, 21.36000, -157.95000, 21.35880, -157.94720, 21.35460, -157.94720, 21.35500, -157.94950);
export const QUARRY_LOCH = ll(21.35460, -157.94720, 21.35560, -157.94720, 21.35440, -157.94460, 21.35420, -157.94220, 21.35340, -157.94220, 21.35345, -157.94500);
export const MAGAZINE_LOCH = ll(21.35720, -157.94720, 21.35880, -157.94720, 21.35830, -157.94400, 21.35780, -157.93860, 21.35680, -157.93860, 21.35700, -157.94400);

// ------------------------------------------------------------------ anchors
/**
 * Dry Dock No. 1 (1919, 1,002 x 138 ft): its centre from the HAER record, the caisson at the north end on the
 * yard's waterfront, the head to the south. No. 2 (new, complete and dry in December 1941) lies west of it
 * across the approach pier, No. 3 (497 ft, half built) west again; all from their HAER record points.
 */
export const DOCK_MOUTH = P(21.35130, -157.95931), DOCK_AXIS = 180;
export const DRYDOCK2 = { ...(() => { const c = P(21.34989, -157.96079); return { x: c[0], y: c[1] }; })(), h: brg(180), hl: 153, hw: 21 };
export const DRYDOCK3 = { ...(() => { const c = P(21.35078, -157.96142); return { x: c[0], y: c[1] }; })(), h: brg(180), hl: 77, hw: 17 };
/** the 1010 Dock: north from the east side of No. 1's mouth along Sixth Street; its middle and axis */
export const DOCK_1010 = P(21.35285, -157.95790), DOCK_1010_AXIS = 23;
/** Hospital Point (GNIS): the yard's south-west tip on the channel; Nevada's beaching spot on the bank just below it */
export const HOSPITAL_POINT = P(21.34874, -157.96756), NEVADA_BEACH = P(21.34844, -157.96769);
/** Hickam's Hangar 35 (HABS record point), the south-west end of the hangar line, which runs at 055 */
const HANGAR35 = P(21.33285, -157.96279), HICKAM_LINE = 55;

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
  const blk = (key: string, L: number, Wd: number, st: number, wall: string, roof: string, flat = false) => mod(key, () => A.blockArt(key, L, Wd, st, wall, roof, flat));
  const portal = mod('portal_crane', () => A.portalCraneArt());
  const shore = (k: CraftKind, at: Pt, h: number) => out.moored.push({ kind: k, x: at[0], y: at[1], h: brg(h) });

  // ---- Southeast Loch and its arms, Dry Docks 2 and 3, the piers and ramps built out into the water
  land.carvePoly(SE_LOCH);
  land.carvePoly(QUARRY_LOCH);
  land.carvePoly(MAGAZINE_LOCH);
  land.carve(DRYDOCK2);
  land.carve(DRYDOCK3);
  const pier = (base: Pt, b: number, len: number, wid: number, color = C.concrete) => {
    const a = go(base, b + 90, wid / 2), c = go(base, b - 90, wid / 2);
    land.addLand([a, go(a, b, len), go(c, b, len), c], 'yard');
    land.paintPoly([a, go(a, b, len), go(c, b, len), c], color);
  };
  // the Submarine Base's piers off the tip of the base into Southeast Loch
  const subPiers = [P(21.35600, -157.94720), P(21.35680, -157.94720)];
  for (const p of subPiers) pier(p, 250, 80, 14);
  // the approach pier between Dry Docks 1 and 2, Merry Point landing, Ford Island ferry slip S372
  pier(P(21.35140, -157.96005), 0, 40, 30);
  pier(P(21.35345, -157.94560), 0, 22, 10);
  const fiFerry = P(21.35775, -157.96050);
  pier(fiFerry, 150, 45, 12);
  // the seaplane ramps: S360 off the south tip, the 1933 ramps on the south shore
  pier(P(21.35560, -157.96600), 200, 30, 18);
  for (const dx of [-35, 0, 35]) pier(go(P(21.35610, -157.96310), 100, dx), 190, 28, 14);
  // Pearl City: the Pan Am base pier on Middle Loch, a landing on the East Loch side; Aiea Landing
  pier(P(21.38120, -157.97570), 255, 120, 14);
  pier(P(21.37970, -157.96310), 105, 70, 10);
  pier(P(21.37420, -157.93490), 265, 60, 10);

  // ---- roads and the railway (painted first so buildings keep off them)
  const KAM = ll(21.3260, -157.9300, 21.3330, -157.9330, 21.3400, -157.9360, 21.3480, -157.9395, 21.35356, -157.93570, 21.3620, -157.9345, 21.37089, -157.93422, 21.3790, -157.9390, 21.3822, -157.9435, 21.38400, -157.94763, 21.3870, -157.9545, 21.3893, -157.9612, 21.3935, -157.9710, 21.39644, -157.97959, 21.3985, -157.9900, 21.3990, -158.0);
  D.road(KAM, 4.5, C.asphalt);
  land.paintLine(ll(21.3300, -157.9310, 21.3480, -157.9385, 21.3600, -157.9338, 21.3685, -157.9330, 21.37420, -157.93355, 21.3790, -157.9405, 21.3825, -157.9475, 21.3895, -157.9600, 21.3920, -157.9720, 21.3915, -157.9930), 1.6, C.rail);
  // the Navy Yard: the road in from Kamehameha Highway through the Main (Nimitz) Gate by the Marine
  // guard barracks, and the yard's streets on Sixth Street's north-south axis
  D.road(ll(21.3490, -157.9390, 21.3504, -157.9440, 21.3503, -157.9485), 4, C.asphalt);
  const YARD = ll(21.35100, -157.95850, 21.35380, -157.95720, 21.35410, -157.95500, 21.35480, -157.95300, 21.35420, -157.95050, 21.35300, -157.94850, 21.35150, -157.94750, 21.34900, -157.94800, 21.34700, -157.95000, 21.34620, -157.95500, 21.34650, -157.95800, 21.34800, -157.95880);
  const yardLots = grid(D, YARD, P(21.3500, -157.9560), 0, 140, 105, 4);
  // the waterfront road along the dry docks' caissons and the 1010 Dock
  D.road(ll(21.35100, -157.96250, 21.35105, -157.95880, 21.35370, -157.95745, 21.35400, -157.95500, 21.35470, -157.95300), 4);
  const SUB = ll(21.35500, -157.94650, 21.35650, -157.94650, 21.35680, -157.94000, 21.35480, -157.94000);
  const subLots = grid(D, SUB, P(21.3557, -157.9430), 0, 110, 90, 3.5);
  const KUAHUA = ll(21.35920, -157.94800, 21.36150, -157.94800, 21.36450, -157.94450, 21.36620, -157.94150, 21.36500, -157.93950, 21.35880, -157.93900, 21.35850, -157.94400);
  const kuaLots = grid(D, KUAHUA, P(21.3615, -157.9435), 40, 120, 90, 3.5);
  const FI = PEARL_LAND[0].pts;
  const fiC: Pt = [FI.reduce((a, p) => a + p[0], 0) / FI.length, FI.reduce((a, p) => a + p[1], 0) / FI.length];
  const ring = FI.map((p) => { const d = Math.hypot(p[0] - fiC[0], p[1] - fiC[1]); return [p[0] + (fiC[0] - p[0]) * 45 / d, p[1] + (fiC[1] - p[1]) * 45 / d] as Pt; });
  D.road([...ring, ring[0]], 3.5, C.street);

  // ---- Ford Island: the landing field on the 04/22 axis, the hangar line south-west from the tower
  // (Hangars 37, 79 and 54 by their record points), the apron between, the seaplane hangars and ramps
  const fiRwy = P(21.36489, -157.95976);
  land.paintRect(fiRwy[0], fiRwy[1], brg(45), 610, 23, C.runway);
  const tower = P(21.3640, -157.9570), h37 = P(21.36294, -157.95850), h79 = P(21.3600, -157.9617), h54 = P(21.3582, -157.9640);
  land.paintPoly([go(go(tower, 48, 60), 318, 40), go(go(h54, 228, 60), 318, 40), go(go(h54, 228, 60), 318, 230), go(go(tower, 48, 60), 318, 230)], C.apron);
  const hang = mod('h_ford', () => A.hangarArt('h_ford', 70, 60, false, '#7a7c78', '#c9c5b6'));
  for (const p of [h37, h79, h54]) D.fit(hang, p, brg(138), 37, 36, 138, { big: true });
  D.put(mod('tower_ford', () => A.towerArt('ford')), tower[0], tower[1], brg(48), 5, 5, { force: true });
  const h6 = P(21.3567, -157.9652);
  land.paintRect(...go(h6, 200, 45), brg(200), 40, 45, C.apron);
  D.fit(mod('h_sea', () => A.hangarArt('h_sea', 80, 55, false, '#8a8a84', '#c4c0b2')), h6, brg(20), 42, 34, 20, { big: true });
  D.fit(blk('fi_admin', 64, 18, 2, '#e4dfd2', '#6a6a64'), P(21.36114, -157.96289), brg(138), 33, 10, 318);
  // PBY Catalinas of the patrol squadrons: drawn up by the seaplane ramps and on the apron
  const pby = mod('sp_pby', () => A.shorePlaneArt('pby')), pbyW = mod('sp_pby_w', () => A.shorePlaneArt('pby', true));
  const pbySpots: Pt[] = [];
  for (let i = 0; i < 7; i++) pbySpots.push(go(go(P(21.35700, -157.96350), 100, (i - 3) * 34), 10, 30));
  for (let i = 0; i < 7; i++) pbySpots.push(go(go(h79, 318, 110), 48, (i - 3) * 34));
  for (const q of pbySpots) {
    const sc = D.put(pby, q[0], q[1], brg(138), 10, 16, { onPaint: true, building: false });
    if (sc) out.planes.push({ s: sc, wreck: pbyW, alive: true, x: q[0], y: q[1] });
  }
  // barracks and the BOQ round the administration building; the fuel tanks by the F-4 gasoline berth
  const fiBlk = blk('fi_bks', 60, 15, 2, '#e2ddcf', '#6a6a64');
  for (const p of [go(h79, 138, 140), go(h37, 138, 150), go(h54, 138, 130), go(tower, 138, 150)]) D.fit(fiBlk, p, brg(48), 31, 9, 138);
  for (let i = 0; i < 9; i++) { const q = go(go(P(21.3620, -157.9562), 48, (i % 3 - 1) * 16), 138, (Math.floor(i / 3) - 1) * 16); D.put(mod('tank_11_9_0', () => A.tankArt(11, 9)), q[0], q[1], 0, 6, 6); }
  // Nob Hill's officers' houses at the north end, the chiefs' bungalows facing Battleship Row
  const nob = P(21.3705, -157.9585);
  for (let i = 0; i < 19; i++) { const q = go(go(nob, 54, (i % 10 - 4.5) * 34), 324, (i < 10 ? -1 : 1) * 30); D.put(mod('qtrs0', () => A.quartersArt(0)), q[0], q[1], brg(i < 10 ? 234 : 54), 9, 8); }
  const cpo = P(21.3660, -157.9525);
  for (let i = 0; i < 12; i++) { const q = go(go(cpo, 54, (i % 6 - 2.5) * 26), 324, (i < 6 ? -1 : 1) * 24); D.put(mod('bung1', () => A.bungalowArt(1)), q[0], q[1], brg(i < 6 ? 144 : 324), 7, 6); }

  // ---- Navy Yard: the hammerhead at berth B-12 on the Repair Basin, portal cranes on the docks and
  // along the 1010 Dock
  D.put(mod('hammerhead', () => A.hammerheadArt()), ...P(21.35425, -157.95600), brg(0), 12, 8, { force: true, building: false });
  const dockSide = (lon: number, b: number) => { for (const d of [70, 200]) { const q = go(P(21.35130, lon), 180, d); D.put(portal, q[0], q[1], brg(b), 6, 6, { force: true, building: false }); } };
  dockSide(-157.95900, 270); dockSide(-157.95962, 90); dockSide(-157.96048, 270); dockSide(-157.96112, 90);
  for (let i = 0; i < 6; i++) { const q = go(go(DOCK_1010, DOCK_1010_AXIS, (i - 2.5) * 52), DOCK_1010_AXIS + 90, 12); D.put(portal, q[0], q[1], brg(DOCK_1010_AXIS + 270), 6, 6, { force: true, building: false }); }
  // the coal dock at the end of South Avenue below Hospital Point: piles, and the minesweepers nested
  // in the channel alongside (Bobolink, Vireo, Turkey, Rail outboard)
  land.paintRect(...P(21.3460, -157.9672), brg(5), 70, 14, C.coal);
  for (let i = 0; i < 4; i++) shore('sweeper', [P(21.3458, -157.96791)[0] - i * 11.5, P(21.3458, -157.96791)[1]], 5);
  // the Naval Hospital on Hospital Point, facing the channel; tennis courts behind the laboratory
  const hosp = P(21.3478, -157.9650);
  land.paintRect(...hosp, Math.PI / 2, 70, 55, C.lawn);
  D.fit(mod('naval_hospital', () => A.hospitalArt()), hosp, Math.PI / 2, 47, 32, 90, { big: true });
  land.paintRect(...go(hosp, 90, 70), brg(0), 18, 9, C.tennis);
  houses(D, grid(D, ll(21.34930, -157.96400, 21.34930, -157.96200, 21.34700, -157.96180, 21.34680, -157.96420), P(21.3481, -157.9630), 0, 70, 60), 0, 70, 60, 0.9, 11, true);
  // the Marine guard barracks round their parade ground at the Main Gate
  const mb = P(21.35108, -157.94597);
  land.paintRect(...go(mb, 270, 60), brg(0), 55, 35, C.parade);
  const mbBlk = blk('marine_bks', 80, 16, 3, '#d8d2c0', '#7b5644');
  for (const sd of [-1, 1]) { const q = go(go(mb, 270, 60), 0, sd * 52); D.put(mbBlk, q[0], q[1], brg(90), 41, 9); }
  // fuel: Merry Point's tanks by the landing, the lower tank farm by the coaling station, the middle farm
  const tank = (c: Pt, nx: number, ny: number, d: number, h: number, gap: number, fakeAt = -1) => {
    for (let i = 0; i < nx * ny; i++) {
      const q = go(go(c, 90, ((i % nx) - (nx - 1) / 2) * gap), 180, (Math.floor(i / nx) - (ny - 1) / 2) * gap);
      const fake = i === fakeAt;
      // an earth berm round each tank (painted once it has found room, so roads stay whole)
      if (D.put(mod(`tank_${d}_${h}_${fake ? 1 : 0}`, () => A.tankArt(d, h, fake)), q[0], q[1], 0, d / 2 + 1, d / 2 + 1, { big: true })) land.paintDisc(q[0], q[1], d / 2 + 7, C.berm);
    }
  };
  tank(P(21.35210, -157.94600), 3, 1, 32, 12, 42);
  tank(P(21.34600, -157.95850), 4, 3, 34, 12, 46, 6);
  tank(P(21.35120, -157.94050), 5, 2, 38, 14, 50, 3);
  // shops fill the grid round the landmarks: machine, boiler, sheet metal, foundry, storehouses; Power
  // Plant No. 2 (Building 149) with its stacks
  const shops = [
    mod('shop_mon', () => A.shopArt('shop_mon', 110, 60, 16, '#a9a69a', '#6d6e6a', 'monitor')),
    mod('shop_saw', () => A.shopArt('shop_saw', 90, 70, 12, '#8c5a46', '#6a6a66', 'saw')),
    mod('shop_gab', () => A.shopArt('shop_gab', 100, 40, 12, '#b4b0a2', '#7c7a72', 'gable')),
    mod('store_flat', () => A.blockArt('store_flat', 100, 40, 3, '#bdb8a8', '#6a6a64', true)),
  ];
  const dims: [number, number][] = [[56, 31], [46, 36], [51, 21], [51, 21]];
  let power = false;
  for (const [k, p] of yardLots.entries()) {
    const v = Math.floor(hash2(k, 77) * 4);
    if (!power && k >= 5 && D.put(mod('power149', () => A.powerHouseArt('power149', 60, 30, 3)), p[0], p[1], brg(90), 32, 22, { big: true })) {
      power = true;
      out.stacks.push(...[0, 1, 2].map((sx) => { const q = go(go(p, 90, -30 + 60 * (sx + 0.5) / 3), 180, -18); return { x: q[0], y: q[1], z: GROUND + 38 }; }));
      continue;
    }
    const placed = D.put(shops[v], p[0], p[1], brg(90), dims[v][0], dims[v][1], { big: true }) ? dims[v] : D.put(shops[2], p[0], p[1], brg(90), 51, 21, { big: true }) ? dims[2] : null;
    if (!placed) continue;
    // trucks and the workmen's cars drawn up along the shop's long side
    for (let x = -placed[0] + 6; x < placed[0] - 4; x += 6) {
      if (hash2(k * 31 + x, 5) > 0.55) continue;
      const c = go(go(p, 90, x), 180, placed[1] + 5), cv = (k * 3 + x) & 7, kind = cv < 3 ? 'navytruck' : 'sedan';
      D.put(D.model(() => A.carArt(kind, cv), `car_${kind}${cv}`), c[0], c[1], brg(180), 2.5, 1, { building: false });
    }
  }

  // ---- Submarine Base and Kuahua: Lockwood Hall, the escape training tower, barracks and shops, the PT
  // boats and their tender barge at the piers, the big storehouses on Kuahua
  D.fit(blk('lockwood', 70, 16, 3, '#e4dfcf', '#94503e'), P(21.35423, -157.94122), brg(90), 36, 9, 90);
  D.put(mod('tower_escape', () => A.towerArt('escape')), ...P(21.3560, -157.9408), 0, 7, 7, { force: true });
  const subBlk = [blk('sub_bks', 70, 15, 3, '#e4dfcf', '#94503e'), blk('sub_shop', 60, 30, 2, '#bdb8a8', '#6a6a64', true)];
  for (const [k, p] of subLots.entries()) D.put(subBlk[k % 2], p[0], p[1], brg(90), k % 2 ? 31 : 36, k % 2 ? 16 : 9);
  for (let i = 0; i < 6; i++) { const q = go(go(subPiers[i % 2], 250, 22 + Math.floor(i / 2) * 26), 160, (i % 2 ? 1 : -1) * 11); shore('pt', q, 250); }
  shore('lighter', go(go(subPiers[0], 250, 60), 160, -19), 250);
  D.fit(blk('kuahua_store', 120, 45, 6, '#c8c2b0', '#6a6a64', true), P(21.3601, -157.9417), brg(40), 61, 23, 220, { big: true });
  for (const [k, p] of kuaLots.entries()) D.put(subBlk[(k + 1) % 2], p[0], p[1], brg(40), k % 2 ? 36 : 31, k % 2 ? 9 : 16);
  // the upper tank farm east of the railway, 17 tanks of 164 ft (one painted to pass for a building)
  tank(P(21.35720, -157.93220), 6, 3, 50, 14, 62, 10);

  // ---- Hickam Field: the hangar line from Hangar 35 at 055, the apron, the main landing mat and the
  // three smaller runways, Hale Makai at the head of the parade mall, the water tower at its far end
  const along = (d: number) => go(HANGAR35, HICKAM_LINE, d);
  const SE = HICKAM_LINE + 90, NW = HICKAM_LINE - 90;
  const rwy = P(21.3342, -157.9548);
  land.paintRect(...rwy, brg(56), 1074, 122, C.shoulder);
  land.paintRect(...rwy, brg(56), 1074, 23, C.runway);
  const T = go(rwy, 146, 950);
  const V = [go(T, 316, 470), go(T, 76, 470), go(T, 196, 470)];
  for (let i = 0; i < 3; i++) { const a = V[i], c = V[(i + 1) % 3]; const m: Pt = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2]; land.paintRect(m[0], m[1], Math.atan2(c[1] - a[1], c[0] - a[0]), Math.hypot(c[0] - a[0], c[1] - a[1]) / 2 + 40, 38, C.runway); }
  land.paintPoly([go(along(-90), SE, 60), go(along(1080), SE, 60), go(along(1080), SE, 250), go(along(-90), SE, 250)], C.apron);
  // hangar line, south-west to north-east: Hangar 35 (double), the paired hangars 15/17, 11/13, 7/9, 3/5,
  // the air operations building with its tower, Hangars 2 and 4
  const pair = mod('h_hickam', () => A.hangarArt('h_hickam', 66, 52, true, '#7e807c', '#d6d2c4'));
  for (let i = 0; i < 7; i++) {
    const q = along(i * 165);
    if (i === 5) { D.put(blk('hickam_ops', 50, 22, 3, '#e2ded0', '#6a6a64', true), q[0], q[1], brg(HICKAM_LINE), 26, 12, { force: true, big: true }); D.put(mod('tower_ford', () => A.towerArt('ford')), ...go(q, NW, 18), brg(HICKAM_LINE), 5, 5, { force: true }); continue; }
    D.put(pair, q[0], q[1], brg(SE), 34, 68, { force: true, big: true });
  }
  // the bombers on the apron, wingtip to wingtip as on the morning of the attack
  const park = (kind: A.ShorePlane, n: number, from: Pt, gap: number) => {
    const m = mod(`sp_${kind}`, () => A.shorePlaneArt(kind)), wk = mod(`sp_${kind}_w`, () => A.shorePlaneArt(kind, true));
    for (let i = 0; i < n; i++) {
      const q = go(from, HICKAM_LINE, i * gap);
      const sc = D.put(m, q[0], q[1], brg(SE), 10, 14, { force: true, building: false });
      if (sc) out.planes.push({ s: sc, wreck: wk, alive: true, x: q[0], y: q[1] });
    }
  };
  park('b18', 26, go(along(-40), SE, 120), 30);
  park('b17', 12, go(along(200), SE, 200), 36);
  park('a20', 12, go(along(800), SE, 150), 22);
  // Hale Makai: the long spine parallel to the flight line, its wings, the mall and the water tower
  const hale = P(21.33766, -157.95886), tw = P(21.34257, -157.96219);
  const spine = mod('hale_spine', () => A.haleMakaiArt('spine')), wing = mod('hale_wing', () => A.haleMakaiArt('wing'));
  for (let i = 0; i < 5; i++) { const q = go(hale, HICKAM_LINE, (i - 2) * 42); D.put(spine, q[0], q[1], brg(HICKAM_LINE), 21, 9, { force: true, big: true }); }
  for (let i = 0; i < 6; i++) { const q = go(go(hale, HICKAM_LINE, (i % 3 - 1) * 84), SE, (i < 3 ? 1 : -1) * 38); D.put(wing, q[0], q[1], brg(HICKAM_LINE), 8, 29, { force: true, big: true }); }
  const mall: Pt = [(hale[0] + tw[0]) / 2, (hale[1] + tw[1]) / 2];
  land.paintRect(...mall, Math.atan2(tw[1] - hale[1], tw[0] - hale[0]), Math.hypot(tw[0] - hale[0], tw[1] - hale[1]) / 2 - 60, 40, C.parade);
  D.put(mod('tower_water', () => A.towerArt('water')), tw[0], tw[1], 0, 8, 8, { force: true });
  // officers' and NCO housing west to the channel
  const hickHouse = ll(21.3436, -157.9672, 21.3436, -157.9642, 21.3405, -157.9628, 21.3360, -157.9650, 21.3310, -157.9668, 21.3268, -157.9672, 21.3268, -157.9680, 21.3330, -157.9684, 21.3400, -157.9686);
  houses(D, grid(D, hickHouse, P(21.3380, -157.9665), HICKAM_LINE, 80, 70), HICKAM_LINE, 80, 70, 0.85, 23, true);
  // ---- Fort Kamehameha: Batteries Jackson, Selfridge and Closson on the shore, quarters behind
  for (const [la, lo, g] of [[21.31833, -157.95611, 2], [21.31806, -157.95250, 2], [21.3175, -157.9490, 2]] as [number, number, number][]) D.fit(mod(`battery${g}`, () => A.batteryArt(g)), P(la, lo), brg(80), 27, 13, 0);
  houses(D, grid(D, ll(21.3250, -157.9645, 21.3245, -157.9600, 21.3212, -157.9605, 21.3208, -157.9650), P(21.3230, -157.9625), 80, 70, 60), 80, 70, 60, 0.9, 31, true);

  // ---- Pearl City, Aiea, Halawa, Waiau: the landmarks first, then the houses round them
  D.fit(mod('h_panam', () => A.hangarArt('h_panam', 45, 36, false, '#8a8c88', '#d8d4c8')), P(21.3810, -157.9745), brg(75), 24, 20, 75, { big: true });
  const mill = D.fit(mod('sugar_mill', () => A.sugarMillArt()), P(21.38078, -157.92706), brg(20), 42, 26, 200, { big: true });
  // the chimney stands at model (-20, -22): back along the mill's axis, then to its port side
  if (mill) { const q = go(go([mill.x, mill.y], 20, -20), 290, 22); out.stacks.push({ x: q[0], y: q[1], z: GROUND + 46 }); }
  const waiau = D.fit(mod('power_waiau', () => A.powerHouseArt('power_waiau', 50, 28, 2)), P(21.3888, -157.9608), brg(80), 27, 20, 0, { big: true });
  if (waiau) for (let sx = 0; sx < 2; sx++) { const q = go(go([waiau.x, waiau.y], 80, -25 + 50 * (sx + 0.5) / 2), 170, -17); out.stacks.push({ x: q[0], y: q[1], z: GROUND + 38 }); }
  const pc = ll(21.3722, -157.9695, 21.3790, -157.9645, 21.3880, -157.9615, 21.3925, -157.9620, 21.3930, -157.9765, 21.3845, -157.9758, 21.3790, -157.9745, 21.3740, -157.9722);
  houses(D, grid(D, pc, P(21.3820, -157.9690), 350, 75, 110), 350, 75, 110, 0.7, 41);
  const aiea = ll(21.3778, -157.9330, 21.3800, -157.9390, 21.3880, -157.9420, 21.3930, -157.9350, 21.3880, -157.9300, 21.3790, -157.9300);
  houses(D, grid(D, aiea, P(21.3840, -157.9340), 20, 70, 90), 20, 70, 90, 0.75, 53);
  houses(D, grid(D, ll(21.3700, -157.9375, 21.3712, -157.9362, 21.3722, -157.9312, 21.3695, -157.9305), P(21.3708, -157.9340), 15, 70, 80), 15, 70, 80, 0.7, 59);

  // ---- trees by district, then AA pits
  trees(D);
  aaSites(D, mod);

  // ---- harbour craft routes (water lanes; estimated)
  out.routes.push(
    { kind: 'launch', pts: [go(fiFerry, 150, 60), P(21.3545, -157.9598), P(21.3524, -157.9592)], speed: 4, loop: true },
    { kind: 'launch', pts: [P(21.3574, -157.9488), P(21.3588, -157.9508), P(21.3606, -157.9535)], speed: 4.5, loop: true },
    { kind: 'launch', pts: [P(21.3787, -157.9628), P(21.3760, -157.9590), P(21.3735, -157.9545)], speed: 4, loop: true },
    { kind: 'launch', pts: [P(21.3738, -157.9365), P(21.3720, -157.9420), P(21.3705, -157.9470)], speed: 4, loop: true },
    // rescue boats along Battleship Row once the torpedoes have struck
    { kind: 'whaleboat', pts: [P(21.3612, -157.9545), P(21.3640, -157.9505), P(21.3655, -157.9480)], speed: 2, start: '08:10', loop: true },
    { kind: 'whaleboat', pts: [P(21.3632, -157.9525), P(21.3600, -157.9572)], speed: 2, start: '08:14', loop: true },
    { kind: 'launch', pts: [P(21.3645, -157.9478), P(21.3622, -157.9520)], speed: 3, start: '08:20', loop: true },
    // Hoga (YT-146) leaves the 1010 Dock for the burning battleships; YG-17 plays a hose on them
    { kind: 'tug', pts: [go(DOCK_1010, DOCK_1010_AXIS + 270, 45), P(21.3570, -157.9560), P(21.3610, -157.9530), P(21.3628, -157.9492)], speed: 3.5, start: '08:45', hose: true },
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
  for (const [la, lo] of [[21.3505, -157.9560], [21.3490, -157.9520], [21.3480, -157.9480], [21.3470, -157.9600], [21.3498, -157.9625], [21.3535, -157.9545]]) site(la, lo, 0, 2, '08:12');
  for (const [la, lo] of [[21.3560, -157.9450], [21.3555, -157.9420], [21.3600, -157.9440]]) site(la, lo, 0, 2, '07:58');
  for (const [la, lo] of [[21.3620, -157.9585], [21.3665, -157.9520], [21.3610, -157.9640], [21.3700, -157.9560]]) site(la, lo, 0, 2, '08:00');
  // Battery D, 97th Coast Artillery ("Naval AA Shore Battery No. 1") behind Hickam's hangar line
  for (const [la, lo] of [[21.3402, -157.9592], [21.3409, -157.9580], [21.3396, -157.9576], [21.3404, -157.9566]]) site(la, lo, 1, 0, '08:25');
  for (const [la, lo] of [[21.3232, -157.9580], [21.3226, -157.9566], [21.3237, -157.9558], [21.3220, -157.9594]]) site(la, lo, 1, 0, '08:12');
  for (const [la, lo] of [[21.3330, -157.9600], [21.3370, -157.9520], [21.3300, -157.9500]]) site(la, lo, 0, 2, '08:08');
}
