// The Pacific fleets of 1941-42, to scale: every class present at Pearl Harbor (7 December 1941) and in
// the Kido Butai at Midway (4 June 1942), with real lengths, beams, drafts, displacements, speeds and
// gun layouts. Gun and torpedo ranges use the game's compressed scale (see vesselClasses.ts); the
// ships, the harbour and the distances between them do not. Rosters list the actual ships by name.

import type { GunSpec, VesselClass } from '../vesselClasses';
import { carrierArt, fleetSubArt, midgetSubArt, warshipArt, IJN, USN41, USN42, type WarshipSpec } from '../../art/navyArt';

const deg = Math.PI / 180;
const FWD: [number, number] = [-150 * deg, 150 * deg], AFT: [number, number] = [30 * deg, 330 * deg];
const gun = (mount: string, caliber: number, arc: [number, number], reload: number, range: number, damage: number): GunSpec =>
  ({ mount, caliber, arc, traverse: (caliber > 200 ? 4 : caliber > 140 ? 8 : 20) * deg, reload, velocity: caliber > 200 ? 700 : 600, range, damage, spread: caliber > 200 ? 0.006 : 0.009 });
const g5 = (m: string, arc: [number, number]) => gun(m, 127, arc, 4, 2800, 80);          // US 5"/38
const g4in = (m: string, arc: [number, number]) => gun(m, 102, arc, 4, 2400, 65);         // US 4"/50 (flush-deckers)
const g127 = (m: string, arc: [number, number]) => gun(m, 127, arc, 2.2, 2800, 80);       // IJN 12.7 cm twin
const g6sub = (m: string, arc: [number, number]) => gun(m, 152, arc, 8, 3000, 110);       // Nautilus 6"/53

// ------------------------------------------------------------------ US battleships (Measure 1, Dec 1941)
const bb = (o: Partial<WarshipSpec> & Pick<WarshipSpec, 'id' | 'L' | 'B' | 'T'>): WarshipSpec => ({
  fb: [6.2, 7.2, 9.4], forecastle: undefined, bowStart: 0.45, bowPow: 1.4, rake: 0.03, stern: 'cruiser', vee: 0.1,
  topHeight: 46, res: 1, paint: USN41, wood: true, ...o,
});
const NEVADA = bb({
  id: 'bb_nevada', L: 177.7, B: 32.9, T: 8.7,
  turrets: [{ x: 58, type: 'bb14x3' }, { x: 46, lift: 2.4, type: 'bb14x2' }, { x: -50, lift: 2.4, type: 'bb14x2', aft: true }, { x: -62, type: 'bb14x3', aft: true }],
  houses: [{ x0: 18, x1: 36, hw: 7, h: 4 }, { x0: 22, x1: 34, hw: 5, h: 3, base: 11.2 }, { x0: -24, x1: 18, hw: 10, h: 3 }],
  funnels: [{ x: 4, rx: 4.2, ry: 3.2, h: 13 }], masts: [{ x: 26, type: 'tripod', h: 30 }, { x: -30, type: 'tripod', h: 22 }],
  casemates: { x0: 14, x1: 44, z: 4, every: 7 }, boats: [[-10, -8], [-10, 8]], catapult: { x: -78 },
});
const PENNSYLVANIA = bb({
  id: 'bb_pennsylvania', L: 185.4, B: 32.4, T: 8.8,
  turrets: [{ x: 62, type: 'bb14x3' }, { x: 49, lift: 2.4, type: 'bb14x3' }, { x: -51, lift: 2.4, type: 'bb14x3', aft: true }, { x: -64, type: 'bb14x3', aft: true }],
  houses: [{ x0: 20, x1: 38, hw: 7, h: 4 }, { x0: 24, x1: 36, hw: 5, h: 3, base: 11.2 }, { x0: -24, x1: 20, hw: 10, h: 3 }],
  funnels: [{ x: 4, rx: 4.4, ry: 3.4, h: 13 }], masts: [{ x: 28, type: 'tripod', h: 31 }, { x: -32, type: 'tripod', h: 23 }],
  casemates: { x0: 16, x1: 46, z: 4, every: 7 }, boats: [[-10, -8], [-10, 8]], catapult: { x: -80 },
});
const TENNESSEE = bb({
  id: 'bb_tennessee', L: 190.2, B: 29.7, T: 9.2,
  turrets: [{ x: 64, type: 'bb14x3' }, { x: 51, lift: 2.4, type: 'bb14x3' }, { x: -53, lift: 2.4, type: 'bb14x3', aft: true }, { x: -66, type: 'bb14x3', aft: true }],
  houses: [{ x0: 22, x1: 38, hw: 7, h: 5 }, { x0: -30, x1: 22, hw: 9, h: 3 }],
  funnels: [{ x: 10, rx: 3.4, ry: 2.8, h: 12 }, { x: -2, rx: 3.4, ry: 2.8, h: 12 }], masts: [{ x: 30, type: 'cage', h: 34 }, { x: -24, type: 'cage', h: 28 }],
  casemates: { x0: 16, x1: 46, z: 4.5, every: 7 }, boats: [[-12, -8], [-12, 8]], catapult: { x: -82 },
});
const COLORADO = bb({
  id: 'bb_colorado', L: 190.2, B: 29.7, T: 9.3,
  turrets: [{ x: 64, type: 'bb16x2' }, { x: 51, lift: 2.6, type: 'bb16x2' }, { x: -53, lift: 2.6, type: 'bb16x2', aft: true }, { x: -66, type: 'bb16x2', aft: true }],
  houses: [{ x0: 22, x1: 38, hw: 7, h: 5 }, { x0: -30, x1: 22, hw: 9, h: 3 }],
  funnels: [{ x: 10, rx: 3.4, ry: 2.8, h: 12 }, { x: -2, rx: 3.4, ry: 2.8, h: 12 }], masts: [{ x: 30, type: 'cage', h: 34 }, { x: -24, type: 'cage', h: 28 }],
  casemates: { x0: 16, x1: 46, z: 4.5, every: 7 }, boats: [[-12, -8], [-12, 8]], catapult: { x: -82 },
});
/** USS Utah (AG-16): the Florida-class battleship demilitarised as a target ship, turrets timbered over */
const UTAH = bb({
  id: 'ag_utah', L: 159, B: 32.3, T: 8.6, topHeight: 34,
  houses: [{ x0: 14, x1: 28, hw: 6, h: 4 }, { x0: -20, x1: 14, hw: 9, h: 3 }],
  funnels: [{ x: 6, rx: 3.6, ry: 2.8, h: 11 }, { x: -6, rx: 3.6, ry: 2.8, h: 11 }], masts: [{ x: 22, type: 'pole', h: 24 }, { x: -24, type: 'pole', h: 18 }],
  timbered: { x0: -70, x1: 66 },
});

// ------------------------------------------------------------------ US cruisers and destroyers
const OMAHA: WarshipSpec = {
  id: 'cl_omaha', L: 169.3, B: 16.9, T: 6.1, fb: [5.6, 6.2, 8.2], forecastle: { from: 0.2, height: 2.2 }, bowStart: 0.35, rake: 0.05, topHeight: 32, res: 1, paint: USN41,
  turrets: [{ x: 60, type: 'cl6x2' }, { x: -62, type: 'cl6x2', aft: true }],
  houses: [{ x0: 38, x1: 50, hw: 5, h: 5 }, { x0: -48, x1: -38, hw: 4, h: 3 }],
  funnels: [{ x: 26, rx: 2.6, ry: 2.2, h: 10 }, { x: 15, rx: 2.6, ry: 2.2, h: 10 }, { x: 4, rx: 2.6, ry: 2.2, h: 10 }, { x: -7, rx: 2.6, ry: 2.2, h: 10 }],
  masts: [{ x: 42, type: 'tripod', h: 24 }, { x: -40, type: 'tripod', h: 18 }], casemates: { x0: 40, x1: 56, z: 6, every: 8 },
  catapult: { x: -18 },
};
const BROOKLYN: WarshipSpec = {
  id: 'cl_brooklyn', L: 185.4, B: 18.8, T: 6.9, fb: [5.4, 7.0, 9.2], forecastle: { from: 0.3, height: 2.4 }, bowStart: 0.38, rake: 0.05, stern: 'transom', topHeight: 34, res: 1, paint: USN41,
  turrets: [{ x: 66, type: 'cl6x3' }, { x: 56, lift: 2.4, type: 'cl6x3' }, { x: 46, lift: 0.6, type: 'cl6x3' }, { x: -50, lift: 2.4, type: 'cl6x3', aft: true }, { x: -60, type: 'cl6x3', aft: true }],
  houses: [{ x0: 24, x1: 40, hw: 6, h: 7 }, { x0: -38, x1: 24, hw: 7, h: 3 }],
  funnels: [{ x: 12, rx: 3.2, ry: 2.6, h: 10 }, { x: -4, rx: 3.2, ry: 2.6, h: 10 }], masts: [{ x: 30, type: 'pole', h: 24 }, { x: -20, type: 'pole', h: 18 }],
  aaTubs: [[18, -7, 9], [18, 7, 9], [-12, -7, 9], [-12, 7, 9]],
};
const NEW_ORLEANS: WarshipSpec = {
  id: 'ca_neworleans', L: 179.2, B: 18.8, T: 5.9, fb: [5.0, 6.8, 9.0], forecastle: { from: 0.05, height: 2.4 }, bowStart: 0.38, rake: 0.05, topHeight: 36, res: 1, paint: USN41,
  turrets: [{ x: 58, type: 'ca8x3' }, { x: 46, lift: 2.6, type: 'ca8x3' }, { x: -56, type: 'ca8x3', aft: true }],
  houses: [{ x0: 22, x1: 38, hw: 6, h: 7 }, { x0: -40, x1: 22, hw: 7, h: 3 }],
  funnels: [{ x: 10, rx: 3.0, ry: 2.4, h: 10 }, { x: -6, rx: 3.0, ry: 2.4, h: 10 }], masts: [{ x: 30, type: 'tripod', h: 24 }, { x: -24, type: 'pole', h: 18 }],
  catapult: { x: -18, y: -5, base: 9 },
};
const dd = (o: Partial<WarshipSpec> & Pick<WarshipSpec, 'id' | 'L' | 'B' | 'T'>): WarshipSpec => ({
  fb: [3.0, 3.8, 5.0], forecastle: { from: 0.18, height: 1.8 }, bowStart: 0.32, bowPow: 1.6, rake: 0.07, stern: 'cruiser', vee: 0.35,
  topHeight: 24, res: 0.5, paint: USN41, ...o,
});
const FARRAGUT = dd({
  id: 'dd_farragut', L: 104, B: 10.4, T: 3.4,
  turrets: [{ x: 38, type: 'dd5x1' }, { x: 30, lift: 1.4, type: 'dd5x1' }, { x: -16, lift: 1.2, type: 'dd5x1', aft: true }, { x: -30, lift: 1.0, type: 'dd5x1', aft: true }, { x: -40, type: 'dd5x1', aft: true }],
  houses: [{ x0: 20, x1: 28, hw: 3.4, h: 3.2 }, { x0: 21, x1: 27, hw: 2.6, h: 2.2, base: 10.0 }, { x0: -20, x1: -10, hw: 2.8, h: 2.4 }],
  funnels: [{ x: 8, rx: 2.0, ry: 1.5, h: 7.5, rake: 0.08 }, { x: -2, rx: 2.0, ry: 1.5, h: 7.0, rake: 0.08 }],
  masts: [{ x: 18, type: 'tripod', h: 15 }], tubes: [{ x: 2, quad: true }, { x: -7, quad: true }], boats: [[12, -4.2], [12, 4.2]],
});
const MAHAN = dd({
  id: 'dd_mahan', L: 104, B: 10.7, T: 3.1,
  turrets: [{ x: 38, type: 'dd5x1' }, { x: 30, lift: 1.4, type: 'dd5x1' }, { x: -18, lift: 1.2, type: 'dd5x1', aft: true }, { x: -31, lift: 1.0, type: 'dd5x1', aft: true }, { x: -41, type: 'dd5x1', aft: true }],
  houses: [{ x0: 20, x1: 28, hw: 3.4, h: 3.2 }, { x0: 21, x1: 27, hw: 2.6, h: 2.2, base: 10.0 }, { x0: -22, x1: -12, hw: 2.8, h: 2.4 }],
  funnels: [{ x: 8, rx: 2.0, ry: 1.5, h: 7.5 }, { x: -3, rx: 2.0, ry: 1.5, h: 7.0 }],
  masts: [{ x: 18, type: 'pole', h: 16 }], tubes: [{ x: 2, quad: true }, { x: -8, quad: true }, { x: -1, quad: true }], boats: [[12, -4.2], [12, 4.2]],
});
/** the flush-deck "four-pipers" of 1918-21 (USS Ward fired the first American shot of the Pacific war) */
const WICKES = dd({
  id: 'dd_wickes', L: 95.8, B: 9.4, T: 2.8, fb: [2.8, 3.4, 5.2], forecastle: undefined,
  turrets: [{ x: 34, type: 'dd4x1' }, { x: 2, lift: 1.4, type: 'dd4x1', y: -3.2 }, { x: 2, lift: 1.4, type: 'dd4x1', y: 3.2 }, { x: -38, type: 'dd4x1', aft: true }],
  houses: [{ x0: 24, x1: 31, hw: 2.6, h: 3.4 }, { x0: -32, x1: -26, hw: 2.0, h: 2.0 }],
  funnels: [{ x: 16, rx: 1.3, ry: 1.1, h: 7.5 }, { x: 8, rx: 1.3, ry: 1.1, h: 7.5 }, { x: -2, rx: 1.3, ry: 1.1, h: 7.5 }, { x: -10, rx: 1.3, ry: 1.1, h: 7.5 }],
  masts: [{ x: 22, type: 'pole', h: 16 }, { x: -24, type: 'pole', h: 11 }], tubes: [{ x: -16 }, { x: -20 }],
});

// ------------------------------------------------------------------ US auxiliaries at Pearl Harbor
const aux = (o: Partial<WarshipSpec> & Pick<WarshipSpec, 'id' | 'L' | 'B' | 'T'>): WarshipSpec => ({
  fb: [5.2, 5.0, 7.6], forecastle: { from: 0.32, height: 2.4 }, bowStart: 0.4, bowPow: 1.3, rake: 0.06, stern: 'counter', vee: 0.12,
  topHeight: 30, res: 1, paint: USN41, ...o,
});
const VESTAL = aux({ id: 'ar_vestal', L: 142, B: 18.3, T: 6.8,
  houses: [{ x0: 14, x1: 28, hw: 7, h: 6 }, { x0: -46, x1: -30, hw: 7, h: 4 }], funnels: [{ x: -38, rx: 2.6, ry: 2.2, h: 14 }],
  masts: [{ x: 44, type: 'pole', h: 22 }, { x: -12, type: 'pole', h: 20 }] });
const NEOSHO = aux({ id: 'ao_neosho', L: 168.6, B: 22.9, T: 9.6, fb: [4.6, 3.0, 6.4],
  houses: [{ x0: 20, x1: 32, hw: 8, h: 7 }, { x0: -78, x1: -54, hw: 9, h: 5 }], funnels: [{ x: -66, rx: 3, ry: 2.6, h: 9 }],
  masts: [{ x: 50, type: 'pole', h: 20 }, { x: -40, type: 'pole', h: 18 }] });
const OGLALA = aux({ id: 'cm_oglala', L: 117.7, B: 15.9, T: 4.8, fb: [6.4, 6.0, 8.0], stern: 'counter',
  houses: [{ x0: -40, x1: 34, hw: 6.5, h: 6 }, { x0: 18, x1: 30, hw: 5, h: 3, base: 12 }], funnels: [{ x: 0, rx: 3.0, ry: 2.6, h: 9 }],
  masts: [{ x: 44, type: 'pole', h: 22 }, { x: -46, type: 'pole', h: 18 }] });
const CURTISS = aux({ id: 'av_curtiss', L: 160.7, B: 21.1, T: 6.4, stern: 'cruiser',
  turrets: [{ x: 56, type: 'aa5x1' }, { x: 48, lift: 2, type: 'aa5x1' }, { x: -56, type: 'aa5x1', aft: true }, { x: -48, lift: 2, type: 'aa5x1', aft: true }],
  houses: [{ x0: 12, x1: 40, hw: 8, h: 8 }, { x0: -40, x1: 12, hw: 9, h: 5 }], funnels: [{ x: 0, rx: 3.6, ry: 3, h: 10 }],
  masts: [{ x: 32, type: 'pole', h: 22 }, { x: -30, type: 'pole', h: 24 }] });

// ------------------------------------------------------------------ IJN surface ships (Midway)
const KONGO: WarshipSpec = {
  id: 'bb_kongo', L: 222, B: 31.0, T: 9.7, fb: [6.4, 7.6, 10.2], bowStart: 0.45, bowPow: 1.6, rake: 0.08, topHeight: 52, res: 1, paint: { ...IJN, deck: '#a48a62', deckSeam: '#8a7350' }, wood: true,
  turrets: [{ x: 74, type: 'jbb14x2' }, { x: 62, lift: 2.6, type: 'jbb14x2' }, { x: -24, lift: 0.6, type: 'jbb14x2', aft: true }, { x: -70, type: 'jbb14x2', aft: true }],
  houses: [{ x0: -50, x1: 50, hw: 9, h: 3 }],
  funnels: [{ x: 22, rx: 4.6, ry: 3.6, h: 14, rake: 0.1 }, { x: 4, rx: 4.6, ry: 3.6, h: 13, rake: 0.1 }],
  masts: [{ x: 36, type: 'pagoda', h: 34, x1: 50, hw0: 6, hw1: 2 }, { x: -44, type: 'tripod', h: 22 }],
  casemates: { x0: -40, x1: 40, z: 4.5, every: 11 }, boats: [[-12, -10], [-12, 10]],
};
const TONE: WarshipSpec = {
  id: 'ca_tone', L: 201.6, B: 18.5, T: 6.2, fb: [4.6, 6.4, 9.4], forecastle: { from: 0.2, height: 2.4 }, bowStart: 0.38, bowPow: 1.7, rake: 0.09, topHeight: 40, res: 1, paint: IJN,
  // all four twin 20 cm turrets forward; the quarterdeck is a seaplane deck
  turrets: [{ x: 76, type: 'ja20x2' }, { x: 66, lift: 2.4, type: 'ja20x2' }, { x: 56, lift: 2.4, type: 'ja20x2' }, { x: 46, lift: 0.4, type: 'ja20x2', aft: true }],
  houses: [{ x0: 22, x1: 38, hw: 6, h: 4 }, { x0: -30, x1: 22, hw: 6, h: 3 }],
  funnels: [{ x: 6, rx: 4.4, ry: 2.8, h: 11, rake: 0.25 }], masts: [{ x: 24, type: 'pagoda', h: 20, x1: 36, hw0: 5, hw1: 1.8 }, { x: -18, type: 'tripod', h: 16 }],
  catapult: { x: -40, y: -4, base: 7 },
};
const NAGARA: WarshipSpec = {
  id: 'cl_nagara', L: 162.2, B: 14.2, T: 4.8, fb: [4.4, 5.2, 8.0], forecastle: { from: 0.18, height: 2.2 }, bowStart: 0.35, rake: 0.08, topHeight: 34, res: 1, paint: IJN,
  turrets: [{ x: 62, type: 'j14x1' }, { x: 54, lift: 1.6, type: 'j14x1' }, { x: 36, lift: 1.4, type: 'j14x1', y: -4 }, { x: 36, lift: 1.4, type: 'j14x1', y: 4 }, { x: -46, type: 'j14x1', aft: true }, { x: -56, lift: 1.4, type: 'j14x1', aft: true }, { x: -64, type: 'j14x1', aft: true }],
  houses: [{ x0: 38, x1: 48, hw: 4, h: 3 }],
  funnels: [{ x: 18, rx: 2.4, ry: 2.0, h: 10, rake: 0.1 }, { x: 6, rx: 2.4, ry: 2.0, h: 10, rake: 0.1 }, { x: -6, rx: 2.4, ry: 2.0, h: 10, rake: 0.1 }],
  masts: [{ x: 38, type: 'pagoda', h: 16, x1: 46, hw0: 3.5, hw1: 1.4 }, { x: -30, type: 'pole', h: 16 }], tubes: [{ x: -16, quad: true }, { x: -24, quad: true }],
};
const jdd = (id: string, L: number): WarshipSpec => ({
  id, L, B: 10.8, T: 3.8, fb: [3.0, 3.8, 5.6], forecastle: { from: 0.2, height: 2.0 }, bowStart: 0.32, bowPow: 1.7, rake: 0.09, stern: 'cruiser', vee: 0.35,
  topHeight: 24, res: 0.5, paint: IJN,
  turrets: [{ x: L * 0.38, type: 'jdd127x2' }, { x: -L * 0.22, lift: 1.8, type: 'jdd127x2', aft: true }, { x: -L * 0.32, type: 'jdd127x2', aft: true }],
  houses: [{ x0: L * 0.22, x1: L * 0.31, hw: 3.4, h: 3.4 }, { x0: L * 0.235, x1: L * 0.3, hw: 2.4, h: 2.4, base: 11.2 }],
  funnels: [{ x: L * 0.1, rx: 2.4, ry: 1.7, h: 7, rake: 0.18 }, { x: -L * 0.02, rx: 2.2, ry: 1.6, h: 6.4, rake: 0.18 }],
  masts: [{ x: L * 0.2, type: 'tripod', h: 14 }], tubes: [{ x: L * 0.04, quad: true }, { x: -L * 0.12, quad: true }],
});

// ------------------------------------------------------------------ carriers
const YORKTOWN = () => carrierArt({
  id: 'cv_yorktown', L: 251.4, B: 25.4, T: 7.9, hullFb: 8.5, fdZ: 17.5,
  fd: { x0: -120, x1: 120, hw: 16.7 }, hangar: { x0: -100, x1: 100, hw: 12, open: true },
  island: { x0: 8, x1: 34, side: 1, w: 6, h: 10, mast: 'tripod', funnel: { x: 14, rx: 6, ry: 2.6, h: 6 } },
  elevators: [[72, 7], [6, 7], [-58, 7]], paint: { ...USN42, deckLine: '#c8c8c0' }, usMarks: true,
  aaSponsons: [{ x: 70, side: 1 }, { x: 70, side: -1 }, { x: -70, side: 1 }, { x: -70, side: -1 }],
  parked: [-100, -88, -76].flatMap((x) => [-6, 6].map((y) => ({ x, y, span: 12.7, len: 10, color: '#647686', nose: 1 }))),
});
const AKAGI = () => carrierArt({
  id: 'cv_akagi', L: 260.7, B: 31.3, T: 8.7, hullFb: 10, fdZ: 21,
  fd: { x0: -125, x1: 124, hw: 15.3 }, hangar: { x0: -110, x1: 110, hw: 13 },
  // the island stood on the port side amidships; the funnels on the starboard side
  island: { x0: 4, x1: 16, side: -1, w: 6, h: 9, mast: 'pole' },
  sideFunnels: [{ x: 0, side: 1, out: 8, drop: 10, r: 3.4 }], upFunnels: [{ x: 10, y: 15, r: 1.6, h: 4 }],
  elevators: [[72, 7], [16, 6], [-68, 6]], paint: { ...IJN, deck: '#a4865a', deckLine: '#e2ddd0' }, hinomaru: 96,
  casemates: { x0: -110, x1: -60, every: 12 },
});
const KAGA = () => carrierArt({
  id: 'cv_kaga', L: 247.6, B: 32.5, T: 9.5, hullFb: 10.5, fdZ: 21,
  fd: { x0: -120, x1: 118, hw: 15 }, hangar: { x0: -108, x1: 104, hw: 14 },
  island: { x0: 28, x1: 40, side: 1, w: 6, h: 8, mast: 'pole' },
  sideFunnels: [{ x: -10, side: 1, out: 6, drop: 9, r: 3.0 }],
  elevators: [[70, 7], [10, 6], [-62, 6]], paint: { ...IJN, deck: '#a4865a', deckLine: '#e2ddd0' }, hinomaru: 92,
  casemates: { x0: -105, x1: -45, every: 12 },
});
const SORYU = () => carrierArt({
  id: 'cv_soryu', L: 227.5, B: 21.3, T: 7.6, hullFb: 8, fdZ: 15,
  fd: { x0: -108, x1: 107, hw: 13.1 }, hangar: { x0: -96, x1: 96, hw: 9.5 },
  island: { x0: 44, x1: 54, side: 1, w: 5, h: 7, mast: 'pole' },
  sideFunnels: [{ x: 12, side: 1, out: 5, drop: 7, r: 2.4 }, { x: 4, side: 1, out: 5, drop: 7, r: 2.4 }],
  elevators: [[64, 6], [8, 6], [-56, 6]], paint: { ...IJN, deck: '#a4865a', deckLine: '#e2ddd0' }, hinomaru: 86,
});
const HIRYU = () => carrierArt({
  id: 'cv_hiryu', L: 227.4, B: 22.3, T: 7.8, hullFb: 8.2, fdZ: 15.2,
  fd: { x0: -108, x1: 107, hw: 13.5 }, hangar: { x0: -96, x1: 96, hw: 10 },
  island: { x0: 0, x1: 10, side: -1, w: 5, h: 7, mast: 'pole' },
  sideFunnels: [{ x: 12, side: 1, out: 5, drop: 7, r: 2.4 }, { x: 4, side: 1, out: 5, drop: 7, r: 2.4 }],
  elevators: [[64, 6], [10, 6], [-56, 6]], paint: { ...IJN, deck: '#a4865a', deckLine: '#e2ddd0' }, hinomaru: 86,
});

// ------------------------------------------------------------------ class table
type C = VesselClass;
const capital = (o: Omit<C, 'kind' | 'side' | 'role' | 'noise' | 'guns' | 'sensors'> & Partial<C>): C => ({
  kind: 'escort', side: 'allied', role: 'capital', noise: 146, guns: [], sensors: { hydrophone: 0, lookout: 3400 }, ...o,
});
const usDD = (id: string, name: string, art: WarshipSpec, d: { L: number; B: number; T: number; disp: number; kn: number }, guns: GunSpec[], tubes: number): C => ({
  id, name, kind: 'escort', side: 'allied', navy: 'USN', hullType: 'DD', art: () => warshipArt(art),
  length: d.L, beam: d.B, draft: d.T, freeboard: 4.2, displacement: d.disp, maxSpeedKn: d.kn, accelTime: 55, turnRadius: 380,
  hp: 1150, noise: 134, sensors: { asdic: 1150, hydrophone: 950, lookout: 2800 },
  guns, dc: { capacity: 28, rails: 2, kguns: 0, reload: 2.4 }, aa: { heavy: 2, light: 4, range: 1400 },
  torpedoes: { bow: tubes, stern: 0, reloads: 0, reloadTime: 60, speedKn: 36, range: 3600, damage: 900, wake: true },
});

// IJN destroyers: the Type 93 sonar heard a submarine only at short range and low speed (asdic 800)
export const NAVY: Record<string, C> = {
  bb_nevada: capital({ id: 'bb_nevada', name: 'Nevada-class battleship', navy: 'USN', hullType: 'BB', art: () => warshipArt(NEVADA),
    length: 177.7, beam: 32.9, draft: 8.7, freeboard: 7.2, displacement: 29000, maxSpeedKn: 20.5, accelTime: 180, turnRadius: 640, hp: 7000,
    aa: { heavy: 8, light: 8, range: 2200 }, magazine: 0.05 }),
  bb_pennsylvania: capital({ id: 'bb_pennsylvania', name: 'Pennsylvania-class battleship', navy: 'USN', hullType: 'BB', art: () => warshipArt(PENNSYLVANIA),
    length: 185.4, beam: 32.4, draft: 8.8, freeboard: 7.2, displacement: 33100, maxSpeedKn: 21, accelTime: 190, turnRadius: 660, hp: 7400,
    aa: { heavy: 8, light: 8, range: 2200 }, magazine: 0.05 }),
  bb_tennessee: capital({ id: 'bb_tennessee', name: 'Tennessee-class battleship', navy: 'USN', hullType: 'BB', art: () => warshipArt(TENNESSEE),
    length: 190.2, beam: 29.7, draft: 9.2, freeboard: 7.2, displacement: 32300, maxSpeedKn: 21, accelTime: 190, turnRadius: 680, hp: 7600,
    aa: { heavy: 8, light: 10, range: 2200 }, magazine: 0.04 }),
  bb_colorado: capital({ id: 'bb_colorado', name: 'Colorado-class battleship', navy: 'USN', hullType: 'BB', art: () => warshipArt(COLORADO),
    length: 190.2, beam: 29.7, draft: 9.3, freeboard: 7.2, displacement: 32600, maxSpeedKn: 21, accelTime: 190, turnRadius: 680, hp: 7600,
    aa: { heavy: 8, light: 10, range: 2200 }, magazine: 0.04 }),
  ag_utah: capital({ id: 'ag_utah', name: 'Target ship (ex-Florida-class)', navy: 'USN', hullType: 'AG', art: () => warshipArt(UTAH),
    length: 159, beam: 32.3, draft: 8.6, freeboard: 7.0, displacement: 21825, maxSpeedKn: 18, accelTime: 180, turnRadius: 600, hp: 4200, aa: { heavy: 0, light: 2, range: 900 } }),
  cl_omaha: capital({ id: 'cl_omaha', name: 'Omaha-class light cruiser', navy: 'USN', hullType: 'CL', art: () => warshipArt(OMAHA),
    length: 169.3, beam: 16.9, draft: 6.1, freeboard: 6.2, displacement: 7050, maxSpeedKn: 34, accelTime: 110, turnRadius: 560, hp: 2600, aa: { heavy: 4, light: 4, range: 1800 } }),
  cl_brooklyn: capital({ id: 'cl_brooklyn', name: 'Brooklyn-class light cruiser', navy: 'USN', hullType: 'CL', art: () => warshipArt(BROOKLYN),
    length: 185.4, beam: 18.8, draft: 6.9, freeboard: 7.0, displacement: 10000, maxSpeedKn: 32.5, accelTime: 120, turnRadius: 600, hp: 3200, aa: { heavy: 8, light: 8, range: 2200 } }),
  ca_neworleans: capital({ id: 'ca_neworleans', name: 'New Orleans-class heavy cruiser', navy: 'USN', hullType: 'CA', art: () => warshipArt(NEW_ORLEANS),
    length: 179.2, beam: 18.8, draft: 5.9, freeboard: 6.8, displacement: 9950, maxSpeedKn: 32.7, accelTime: 120, turnRadius: 600, hp: 3200, aa: { heavy: 8, light: 8, range: 2200 } }),
  dd_farragut: usDD('dd_farragut', 'Farragut-class destroyer', FARRAGUT, { L: 104, B: 10.4, T: 3.4, disp: 1365, kn: 36.5 },
    [g5('gunA', FWD), g5('gunB', FWD), g5('gunC', AFT), g5('gunD', AFT), g5('gunE', AFT)], 8),
  dd_mahan: usDD('dd_mahan', 'Mahan-class destroyer', MAHAN, { L: 104, B: 10.7, T: 3.1, disp: 1500, kn: 36.5 },
    [g5('gunA', FWD), g5('gunB', FWD), g5('gunC', AFT), g5('gunD', AFT), g5('gunE', AFT)], 12),
  dd_wickes: usDD('dd_wickes', 'Wickes-class destroyer', WICKES, { L: 95.8, B: 9.4, T: 2.8, disp: 1090, kn: 35 },
    [g4in('gunA', FWD), g4in('gunB', [-170 * deg, -10 * deg]), g4in('gunC', [10 * deg, 170 * deg]), g4in('gunD', AFT)], 12),
  ar_vestal: capital({ id: 'ar_vestal', name: 'Repair ship', navy: 'USN', hullType: 'AR', art: () => warshipArt(VESTAL), role: undefined,
    length: 142, beam: 18.3, draft: 6.8, freeboard: 5.0, displacement: 8100, maxSpeedKn: 16, accelTime: 150, turnRadius: 520, hp: 2400, aa: { heavy: 2, light: 2, range: 1400 } }),
  ao_neosho: capital({ id: 'ao_neosho', name: 'Cimarron-class oiler', navy: 'USN', hullType: 'AO', art: () => warshipArt(NEOSHO), role: undefined,
    length: 168.6, beam: 22.9, draft: 9.6, freeboard: 3.0, displacement: 22000, maxSpeedKn: 18, accelTime: 170, turnRadius: 620, hp: 2800, aa: { heavy: 2, light: 4, range: 1400 } }),
  cm_oglala: capital({ id: 'cm_oglala', name: 'Minelayer (ex-coastal liner)', navy: 'USN', hullType: 'CM', art: () => warshipArt(OGLALA), role: undefined,
    length: 117.7, beam: 15.9, draft: 4.8, freeboard: 6.0, displacement: 3746, maxSpeedKn: 14, accelTime: 110, turnRadius: 420, hp: 1500, aa: { heavy: 0, light: 2, range: 900 } }),
  av_curtiss: capital({ id: 'av_curtiss', name: 'Seaplane tender', navy: 'USN', hullType: 'AV', art: () => warshipArt(CURTISS), role: undefined,
    length: 160.7, beam: 21.1, draft: 6.4, freeboard: 5.0, displacement: 8671, maxSpeedKn: 19.7, accelTime: 150, turnRadius: 560, hp: 2600, aa: { heavy: 4, light: 6, range: 2000 } }),
  cv_yorktown: capital({ id: 'cv_yorktown', name: 'Yorktown-class aircraft carrier', navy: 'USN', hullType: 'CV', art: YORKTOWN, role: 'carrier',
    length: 251.4, beam: 25.4, draft: 7.9, freeboard: 17.5, displacement: 19875, maxSpeedKn: 32.5, accelTime: 160, turnRadius: 800, hp: 5200,
    sensors: { hydrophone: 0, lookout: 3600, radar: 4000 }, aa: { heavy: 8, light: 24, range: 2200 } }),
  ss_narwhal: {
    id: 'ss_narwhal', name: 'Narwhal-class submarine', kind: 'uboat', side: 'axis', navy: 'USN', hullType: 'SS',
    art: () => fleetSubArt('ss_narwhal', 113.1, 10.1, 4.8, '#3a3e42', [20, -24]),
    length: 113.1, beam: 10.1, draft: 4.8, freeboard: 1.2, displacement: 2730, maxSpeedKn: 17.4, accelTime: 60, turnRadius: 420,
    // double hull, 2,730 t: far more to hole than a 770 t Type VII (620)
    hp: 1300, noise: 124, sensors: { hydrophone: 2400, lookout: 2400 },
    guns: [g6sub('gunA', FWD), g6sub('gunB', AFT)],
    // Mark 14: ran deep and its exploders failed until late 1943; most 1942 attacks were spoiled by one or the other
    torpedoes: { bow: 4, stern: 2, reloads: 18, reloadTime: 40, speedKn: 46, range: 3600, damage: 1050, wake: true, dud: 0.6 },
    sub: { surfacedKn: 17.4, submergedKn: 8, silentKn: 3, periscopeDepth: 18, testDepth: 91, crushDepth: 140, battery: 110, diveTime: 60, hullHeight: 9.6, snorkel: false },
  },
  ss_kohyoteki: {
    id: 'ss_kohyoteki', name: 'Type A midget submarine', kind: 'uboat', side: 'axis', navy: 'IJN', hullType: 'SSm',
    art: midgetSubArt,
    length: 23.9, beam: 1.85, draft: 1.85, freeboard: 0.6, displacement: 46, maxSpeedKn: 19, accelTime: 20, turnRadius: 90,
    hp: 120, noise: 112, sensors: { hydrophone: 900, lookout: 1600 }, guns: [],
    torpedoes: { bow: 2, stern: 0, reloads: 0, reloadTime: 0, speedKn: 44, range: 3000, damage: 950, wake: true },
    sub: { surfacedKn: 23, submergedKn: 19, silentKn: 4, periscopeDepth: 5, testDepth: 30, crushDepth: 100, battery: 25, diveTime: 10, hullHeight: 3, snorkel: false },
  },
  // ---- Imperial Japanese Navy, June 1942
  cv_akagi: capital({ id: 'cv_akagi', name: 'Akagi', navy: 'IJN', hullType: 'CV', art: AKAGI, role: 'carrier',
    length: 260.7, beam: 31.3, draft: 8.7, freeboard: 21, displacement: 36500, maxSpeedKn: 31.2, accelTime: 180, turnRadius: 900, hp: 6000, aa: { heavy: 12, light: 28, range: 2200 } }),
  cv_kaga: capital({ id: 'cv_kaga', name: 'Kaga', navy: 'IJN', hullType: 'CV', art: KAGA, role: 'carrier',
    length: 247.6, beam: 32.5, draft: 9.5, freeboard: 21, displacement: 38200, maxSpeedKn: 28, accelTime: 190, turnRadius: 900, hp: 6200, aa: { heavy: 16, light: 22, range: 2200 } }),
  cv_soryu: capital({ id: 'cv_soryu', name: 'Soryu', navy: 'IJN', hullType: 'CV', art: SORYU, role: 'carrier',
    length: 227.5, beam: 21.3, draft: 7.6, freeboard: 15, displacement: 15900, maxSpeedKn: 34.5, accelTime: 150, turnRadius: 780, hp: 4200, aa: { heavy: 12, light: 28, range: 2200 } }),
  cv_hiryu: capital({ id: 'cv_hiryu', name: 'Hiryu', navy: 'IJN', hullType: 'CV', art: HIRYU, role: 'carrier',
    length: 227.4, beam: 22.3, draft: 7.8, freeboard: 15.2, displacement: 17300, maxSpeedKn: 34.4, accelTime: 150, turnRadius: 780, hp: 4400, aa: { heavy: 12, light: 31, range: 2200 } }),
  bb_kongo: capital({ id: 'bb_kongo', name: 'Kongo-class battleship', navy: 'IJN', hullType: 'BB', art: () => warshipArt(KONGO),
    length: 222, beam: 31.0, draft: 9.7, freeboard: 7.6, displacement: 32200, maxSpeedKn: 30.3, accelTime: 180, turnRadius: 760, hp: 7200, aa: { heavy: 8, light: 20, range: 2200 } }),
  ca_tone: capital({ id: 'ca_tone', name: 'Tone-class heavy cruiser', navy: 'IJN', hullType: 'CA', art: () => warshipArt(TONE),
    length: 201.6, beam: 18.5, draft: 6.2, freeboard: 6.4, displacement: 11215, maxSpeedKn: 35, accelTime: 120, turnRadius: 640, hp: 3400, aa: { heavy: 8, light: 12, range: 2200 } }),
  cl_nagara: capital({ id: 'cl_nagara', name: 'Nagara-class light cruiser', navy: 'IJN', hullType: 'CL', art: () => warshipArt(NAGARA),
    length: 162.2, beam: 14.2, draft: 4.8, freeboard: 5.2, displacement: 5170, maxSpeedKn: 36, accelTime: 100, turnRadius: 520, hp: 2400, aa: { heavy: 0, light: 6, range: 1600 } }),
  dd_kagero: { ...usDD('dd_kagero', 'Kagero-class destroyer', jdd('dd_kagero', 118.5), { L: 118.5, B: 10.8, T: 3.8, disp: 2033, kn: 35.5 },
    [g127('gunA', FWD), g127('gunB', AFT), g127('gunC', AFT)], 8), navy: 'IJN', sensors: { asdic: 800, hydrophone: 1050, lookout: 3000 },
    dc: { capacity: 16, rails: 2, kguns: 2, reload: 2.6 }, aa: { heavy: 0, light: 4, range: 1200 } },
  dd_yugumo: { ...usDD('dd_yugumo', 'Yugumo-class destroyer', jdd('dd_yugumo', 119.2), { L: 119.2, B: 10.8, T: 3.8, disp: 2077, kn: 35 },
    [g127('gunA', FWD), g127('gunB', AFT), g127('gunC', AFT)], 8), navy: 'IJN', sensors: { asdic: 800, hydrophone: 1050, lookout: 3000 },
    dc: { capacity: 36, rails: 2, kguns: 2, reload: 2.6 }, aa: { heavy: 0, light: 4, range: 1200 } },
};
for (const c of Object.values(NAVY)) c.navy ??= 'USN';

/** the ships themselves: name, class and pennant */
export interface ShipRef { name: string; cls: keyof typeof NAVY; hull?: string }
