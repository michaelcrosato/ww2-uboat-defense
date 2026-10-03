// Voxel art for every vessel class. Hull + fixed superstructure in one model; gun mounts,
// periscopes and searchlights that move are separate small models placed by `mounts`.

import { hash2 } from '../core/math';
import { VoxelModel, VM } from './voxel';
import {
  buildHull, buildSub, camo, crate, dcRack, deckhouse, funnel, hatch, kingpost, lifeboat, mast, planks, plating, shade, weather,
} from './shipBuilder';

export interface MountArt {
  id: string;              // logical id used by gameplay (e.g. 'gunA', 'searchlight', 'periscope')
  model: VoxelModel;
  x: number; y: number; z: number;
  yaw: number;             // rest heading relative to the bow
}
export interface ShipArt {
  hull: VoxelModel;
  mounts: MountArt[];
  /** local points where funnel smoke leaves (x, y, z) */
  funnels: [number, number, number][];
  /** local points of lamps for lights (bridge searchlight etc) */
  lamps: [number, number, number][];
}

// ------------------------------------------------------------------ mounts
function gunMount(name: string, color: string, barrels = 1, len = 5, shieldL = 3.2, shieldW = 2.8, shieldH = 2.2): VoxelModel {
  const m = new VoxelModel(name, Math.ceil((shieldL + len + 2) / 0.5), Math.ceil((shieldW + 1) / 0.5), Math.ceil((shieldH + 1.5) / 0.5), 0.5, 0.5, -shieldL / 2 - 0.5, -shieldW / 2 - 0.5, 0);
  // shield: sloped front, open back
  for (let i = 0; i < m.nx; i++) {
    const x = m.mx(i);
    if (x < -shieldL / 2 || x > shieldL / 2) continue;
    const t = (x + shieldL / 2) / shieldL;
    const h = shieldH * (t > 0.6 ? 1 - (t - 0.6) * 0.9 : 1);
    m.box(x - 0.25, x + 0.25, -shieldW / 2, shieldW / 2, 0, h, (ii, jj, kk) => weather(kk === m.vz(h) - 1 ? shade(color, 0.12) : color, ii, kk), VM.METAL);
  }
  for (let b = 0; b < barrels; b++) {
    const y = barrels === 1 ? 0 : (b - (barrels - 1) / 2) * 0.9;
    m.cylX(shieldL / 2 - 0.5, shieldL / 2 + len, y, shieldH * 0.55, 0.22, '#2a2c2e', VM.METAL);
  }
  return m;
}

function searchlightModel(name: string): VoxelModel {
  const m = new VoxelModel(name, 5, 5, 4, 0.5, 0.5, -1.25, -1.25, 0);
  m.cyl(0, 0, 0.9, 0, 1.2, '#3a3e40');
  m.box(0.3, 0.9, -0.6, 0.6, 0.3, 1.2, '#e8f0ff', VM.LAMP);
  return m;
}

function periscopeModel(name: string): VoxelModel {
  const m = new VoxelModel(name, 3, 3, 12, 0.5, 0.5, -0.75, -0.75, 0);
  m.line([0, 0, 0], [0, 0, 5.5], '#3a3c3e');
  m.set(m.vx(0.4), m.vy(0), m.vz(5.3), '#9ab0c0', VM.GLASS);
  return m;
}

// ------------------------------------------------------------------ escorts

const WA_CAMO = ['#e4e8e6', '#e4e8e6', '#a9c4cc', '#7fa2ad'];           // Western Approaches
const ADM_CAMO = ['#7c8b92', '#a7b3b6', '#4f5f68', '#c9d0d0', '#5d6e75']; // Admiralty disruptive

export function destroyerArt(): ShipArt {
  const L = 98, B = 10.4;
  const h = buildHull({
    name: 'destroyer', length: L, beam: B, draft: 3.5, fbAft: 3.0, fbMid: 3.6, fbFwd: 4.6,
    forecastle: { from: 0.12, height: 1.6 }, bowStart: 0.3, bowPow: 1.6, rake: 0.07, stern: 'cruiser', sternStart: -0.72, vee: 0.35,
    topHeight: 22, side: camo(ADM_CAMO, 10, 3, 0.55), deck: plating('#4c4f50'), rail: '#c8ccc8',
  });
  const m = h.m;
  const dz = (x: number) => h.deckZ(x);
  // bridge block + compass platform
  deckhouse(m, 18, 25, 3.2, dz(21), dz(21) + 3.0, camo(ADM_CAMO, 6, 5), '#3e4244', { color: '#1a2228', z: dz(21) + 2.2, every: 2, front: true });
  deckhouse(m, 19.5, 24.5, 2.4, dz(21) + 3.0, dz(21) + 5.0, '#a7b3b6', '#36393a', { color: '#1a2228', z: dz(21) + 4.3, every: 2, front: true });
  m.box(20, 24, -2.6, 2.6, dz(21) + 5.0, dz(21) + 5.4, '#c8ccc8');   // splinter shield rim
  // funnels
  funnel(m, 6, 2.2, 1.5, dz(6), dz(6) + 7.2, '#8e9a9e', '#2a2a2a', 0.12);
  funnel(m, -7, 2.0, 1.4, dz(-7), dz(-7) + 6.6, '#8e9a9e', '#2a2a2a', 0.12);
  // masts
  mast(m, 15.5, dz(15), dz(15) + 16, '#2e2e2c', [{ z: dz(15) + 11, half: 3.2 }], dz(15) + 9);
  mast(m, -24, dz(-24), dz(-24) + 9, '#2e2e2c', [{ z: dz(-24) + 7, half: 2 }]);
  // HF/DF frame and radar lantern on the foremast
  m.cyl(15.5, 0, 0.9, dz(15) + 16, dz(15) + 17.2, '#5a6062');
  // torpedo tubes (quad) midships
  m.box(-2, 2, -1.2, 1.2, dz(0), dz(0) + 1.0, '#555c60');
  m.cylX(-3, 3.5, -0.6, dz(0) + 1.2, 0.3, '#2c3032'); m.cylX(-3, 3.5, 0.6, dz(0) + 1.2, 0.3, '#2c3032');
  // aft deckhouse with searchlight platform
  deckhouse(m, -16, -10, 2.6, dz(-13), dz(-13) + 2.4, camo(ADM_CAMO, 6, 9), '#3e4244');
  // depth charge rails at the stern + K-guns
  dcRack(m, -47, -40, -1.8, dz(-44));
  dcRack(m, -47, -40, 1.8, dz(-44));
  for (const y of [-3.6, 3.6]) m.box(-37, -35.8, y - 0.5, y + 0.5, dz(-36), dz(-36) + 1.2, '#30343a');
  // whalers
  lifeboat(m, 1, -4.2, dz(1) + 1.2, 7, 1.8);
  lifeboat(m, 1, 4.2, dz(1) + 1.2, 7, 1.8);
  // anchor chain / capstan dark spots on the forecastle
  m.paintTop(38, 40, -2.5, 2.5, '#2a2a2a');
  const gun = gunMount('dd_gun', '#9aa6aa', 1, 5.5, 3.4, 3.0, 2.3);
  return {
    hull: m,
    mounts: [
      { id: 'gunA', model: gun, x: 33, y: 0, z: dz(33), yaw: 0 },
      { id: 'gunB', model: gun, x: 27, y: 0, z: dz(27) + 1.2, yaw: 0 },
      { id: 'gunX', model: gun, x: -20, y: 0, z: dz(-20) + 1.0, yaw: Math.PI },
      { id: 'gunY', model: gun, x: -31, y: 0, z: dz(-31), yaw: Math.PI },
      { id: 'searchlight', model: searchlightModel('sl'), x: -13, y: 0, z: dz(-13) + 2.4, yaw: 0 },
    ],
    funnels: [[6, 0, dz(6) + 7.2], [-7.8, 0, dz(-7) + 6.6]],
    lamps: [[-13, 0, dz(-13) + 3.4]],
  };
}

export function corvetteArt(): ShipArt {
  const L = 62, B = 10.1;
  const h = buildHull({
    name: 'corvette', length: L, beam: B, draft: 3.5, fbAft: 2.6, fbMid: 2.9, fbFwd: 4.4,
    forecastle: { from: 0.18, height: 1.9 }, bowStart: 0.25, bowPow: 1.4, rake: 0.08, stern: 'counter', sternStart: -0.65, vee: 0.2,
    topHeight: 18, side: camo(WA_CAMO, 8, 7, 0.35), deck: plating('#55595a'), rail: '#e0e4e2',
  });
  const m = h.m;
  const dz = (x: number) => h.deckZ(x);
  deckhouse(m, 9, 16, 3.1, dz(12), dz(12) + 2.6, camo(WA_CAMO, 5, 2), '#44484a', { color: '#1a2228', z: dz(12) + 1.9, every: 2, front: true });
  deckhouse(m, 11, 15, 2.4, dz(12) + 2.6, dz(12) + 4.4, '#e4e8e6', '#3a3d3e', { color: '#1a2228', z: dz(12) + 3.8, every: 2, front: true });
  funnel(m, -2, 2.0, 1.6, dz(-2), dz(-2) + 5.6, '#e4e8e6', '#7fa2ad', 0.1);
  mast(m, 17.5, dz(17), dz(17) + 13, '#2e2e2c', [{ z: dz(17) + 9, half: 2.6 }], dz(17) + 7.5);
  m.cyl(13.2, 0, 1.0, dz(12) + 4.4, dz(12) + 6.2, '#cfd6d8');        // Type 271 radar lantern
  deckhouse(m, -14, -8, 2.4, dz(-11), dz(-11) + 2.0, camo(WA_CAMO, 5, 4), '#44484a');
  dcRack(m, -30, -24.5, -1.6, dz(-27));
  dcRack(m, -30, -24.5, 1.6, dz(-27));
  for (const y of [-3.4, 3.4]) m.box(-21, -20, y - 0.5, y + 0.5, dz(-20), dz(-20) + 1.1, '#30343a');
  lifeboat(m, -4, -4.0, dz(-4) + 1.0, 6, 1.7);
  lifeboat(m, -4, 4.0, dz(-4) + 1.0, 6, 1.7);
  const gun = gunMount('cv_gun', '#cfd6d8', 1, 4.6, 2.8, 2.6, 2.0);
  const pom = gunMount('pompom', '#aab4b6', 2, 2.4, 2.2, 2.2, 1.4);
  return {
    hull: m,
    mounts: [
      { id: 'gunA', model: gun, x: 22, y: 0, z: dz(22), yaw: 0 },
      { id: 'gunX', model: pom, x: -12.5, y: 0, z: dz(-11) + 2.0, yaw: Math.PI },
      { id: 'searchlight', model: searchlightModel('sl'), x: 13, y: 0, z: dz(12) + 4.4, yaw: 0 },
    ],
    funnels: [[-2.6, 0, dz(-2) + 5.6]],
    lamps: [[13, 0, dz(12) + 5.4]],
  };
}

export function frigateArt(): ShipArt {
  const L = 91, B = 11.1;
  const h = buildHull({
    name: 'frigate', length: L, beam: B, draft: 3.9, fbAft: 2.8, fbMid: 3.2, fbFwd: 4.8,
    forecastle: { from: 0.0, height: 1.8 }, bowStart: 0.3, bowPow: 1.5, rake: 0.08, stern: 'transom', sternStart: -0.74, vee: 0.25,
    topHeight: 20, side: camo(WA_CAMO, 10, 11, 0.45), deck: plating('#505455'), rail: '#e0e4e2',
  });
  const m = h.m;
  const dz = (x: number) => h.deckZ(x);
  deckhouse(m, 12, 22, 3.4, dz(17), dz(17) + 2.8, camo(WA_CAMO, 6, 12), '#404446', { color: '#1a2228', z: dz(17) + 2.1, every: 2, front: true });
  deckhouse(m, 14, 21, 2.6, dz(17) + 2.8, dz(17) + 4.8, '#e4e8e6', '#383b3c', { color: '#1a2228', z: dz(17) + 4.2, every: 2, front: true });
  funnel(m, -3, 2.1, 1.6, dz(-3), dz(-3) + 6, '#e4e8e6', '#7fa2ad', 0.08);
  mast(m, 10, dz(10), dz(10) + 15, '#2e2e2c', [{ z: dz(10) + 10, half: 3 }], dz(10) + 8);
  m.cyl(18, 0, 1.0, dz(17) + 4.8, dz(17) + 6.6, '#cfd6d8');
  deckhouse(m, -20, -10, 2.8, dz(-15), dz(-15) + 2.2, camo(WA_CAMO, 6, 13), '#404446');
  // Squid/hedgehog mount behind the forward gun
  m.box(25, 28, -1.6, 1.6, dz(26), dz(26) + 1.2, '#4a5052');
  for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) m.set(m.vx(25.3 + r * 0.7), m.vy(-1.4 + c * 0.55), m.vz(dz(26) + 1.4), '#2a2c2e');
  dcRack(m, -44, -37, -1.8, dz(-40));
  dcRack(m, -44, -37, 1.8, dz(-40));
  lifeboat(m, -6, -4.5, dz(-6) + 1.1, 6.5, 1.8);
  lifeboat(m, -6, 4.5, dz(-6) + 1.1, 6.5, 1.8);
  const gun = gunMount('ff_gun', '#cfd6d8', 2, 4.8, 3.0, 3.0, 2.1);
  return {
    hull: m,
    mounts: [
      { id: 'gunA', model: gun, x: 32, y: 0, z: dz(32), yaw: 0 },
      { id: 'gunX', model: gunMount('ff_gun2', '#cfd6d8', 1, 4.2, 2.6, 2.6, 1.9), x: -28, y: 0, z: dz(-28), yaw: Math.PI },
      { id: 'searchlight', model: searchlightModel('sl'), x: 18, y: 0, z: dz(17) + 4.8, yaw: 0 },
    ],
    funnels: [[-3.5, 0, dz(-3) + 6]],
    lamps: [[18, 0, dz(17) + 5.8]],
  };
}

// ------------------------------------------------------------------ merchants

const MERCH_GREYS = ['#6f767a', '#767d80', '#686f73'];
function merchantSide(seed: number) {
  return (i: number, _j: number, k: number) => weather(MERCH_GREYS[Math.floor(hash2(i >> 4, seed) * 3)], i, k);
}

export function freighterArt(variant = 0): ShipArt {
  const L = 128 + variant * 6, B = 17.3;
  const h = buildHull({
    name: 'freighter' + variant, length: L, beam: B, draft: 7.6, fbAft: 3.2, fbMid: 2.9, fbFwd: 5.0,
    forecastle: { from: 0.78, height: 2.4 }, poop: { to: -0.82, height: 2.2 }, bowStart: 0.55, bowPow: 1.6, rake: 0.06, stern: 'counter', sternStart: -0.8, vee: 0.1,
    topHeight: 24, side: merchantSide(variant), deck: planks('#8a7458', '#5a4a38'), boot: '#262626', bottom: '#73302a', rail: '#9a9690',
  });
  const m = h.m;
  const dz = (x: number) => h.deckZ(x);
  // midships castle: bridge, boat deck, funnel
  deckhouse(m, -8, 10, 6.5, dz(0), dz(0) + 3, '#d8d0bc', '#6a5a46', { color: '#22282c', z: dz(0) + 2, every: 2 });
  deckhouse(m, -4, 8, 5.2, dz(0) + 3, dz(0) + 5.6, '#d8d0bc', '#5a4c3c', { color: '#22282c', z: dz(0) + 4.6, every: 2, front: true });
  deckhouse(m, 2, 7, 4.2, dz(0) + 5.6, dz(0) + 7.6, '#e2dccb', '#4a4038', { color: '#22282c', z: dz(0) + 7.0, every: 2, front: true });
  funnel(m, -4, 2.6, 2.3, dz(0) + 3, dz(0) + 11, ['#2a2a2a', '#7a2a20', '#2c3a52'][variant % 3], '#c8b070', 0.06);
  lifeboat(m, -2, -5.6, dz(0) + 5.8, 7.5, 2.2, '#e0d8c4');
  lifeboat(m, -2, 5.6, dz(0) + 5.8, 7.5, 2.2, '#e0d8c4');
  // holds, hatches, kingposts and booms
  for (const [x0, x1] of [[16, 26], [30, 42], [-22, -12], [-38, -27], [46, 54]] as [number, number][]) {
    if (x1 > L / 2 - 8) continue;
    hatch(m, x0, x1, 3.6, dz((x0 + x1) / 2), '#55606a', '#3c3c38');
  }
  kingpost(m, 28, dz(28), 9, 9, 1); kingpost(m, -25, dz(-25), 9, 9, -1); kingpost(m, 44, dz(44), 7, 7, 1);
  mast(m, 50, dz(50), dz(50) + 14, '#3a3634', [{ z: dz(50) + 10, half: 2.5 }]);
  mast(m, -44, dz(-44), dz(-44) + 12, '#3a3634');
  // deck cargo: crates, a few vehicles under canvas
  if (variant % 2 === 0) { crate(m, 21, -2, dz(21) + 1.0, 4, 2.4, 1.8, '#6a5e40'); crate(m, 35, 3, dz(35) + 1.0, 5, 2.6, 2.0, '#4e5a3a'); }
  else { crate(m, -17, 0, dz(-17) + 1.0, 6, 3, 2.2, '#5a6248'); crate(m, 36, -3, dz(36) + 1.0, 3, 2, 1.6, '#6a5e40'); }
  // stern gun tub (DEMS 4-inch)
  m.cyl(-L / 2 + 6, 0, 2.2, dz(-L / 2 + 6), dz(-L / 2 + 6) + 1.0, '#6a6e70');
  return { hull: m, mounts: [], funnels: [[-4.4, 0, dz(0) + 11]], lamps: [] };
}

export function tankerArt(): ShipArt {
  const L = 140, B = 19;
  const h = buildHull({
    name: 'tanker', length: L, beam: B, draft: 8.4, fbAft: 3.0, fbMid: 2.4, fbFwd: 4.2,
    forecastle: { from: 0.82, height: 2.2 }, poop: { to: -0.7, height: 2.6 }, bowStart: 0.55, bowPow: 1.5, rake: 0.05, stern: 'counter', sternStart: -0.8, vee: 0.08,
    topHeight: 22, side: (i, _j, k) => weather('#5c6266', i, k), deck: plating('#6a5a4a'), boot: '#262626', bottom: '#70302a', rail: '#9a9690',
  });
  const m = h.m;
  const dz = (x: number) => h.deckZ(x);
  // midships bridge island
  deckhouse(m, 18, 30, 6.5, dz(24), dz(24) + 3, '#d8d0bc', '#5a4c3c', { color: '#22282c', z: dz(24) + 2, every: 2 });
  deckhouse(m, 21, 29, 5, dz(24) + 3, dz(24) + 5.6, '#e2dccb', '#4a4038', { color: '#22282c', z: dz(24) + 4.8, every: 2, front: true });
  // engine house aft with funnel
  deckhouse(m, -66, -48, 7.5, dz(-56), dz(-56) + 3.4, '#d8d0bc', '#5a4c3c', { color: '#22282c', z: dz(-56) + 2.4, every: 2 });
  funnel(m, -58, 3.0, 2.6, dz(-56) + 3.4, dz(-56) + 10, '#2a2a2a', '#b84030', 0.05);
  lifeboat(m, -56, -6.2, dz(-56) + 3.6, 7.5, 2.2, '#e0d8c4');
  lifeboat(m, -56, 6.2, dz(-56) + 3.6, 7.5, 2.2, '#e0d8c4');
  // flying catwalk and pipes along the deck
  m.box(-48, 18, -0.6, 0.6, dz(0) + 2.6, dz(0) + 3.0, '#8a8680');
  for (let x = -46; x < 18; x += 6) m.line([x, 0, dz(x)], [x, 0, dz(x) + 2.6], '#6a6662');
  for (const y of [-3, -1.6, 1.6, 3]) m.line([-47, y, dz(0) + 0.6], [60, y, dz(0) + 0.6], '#4a4644');
  for (let x = -44; x < 60; x += 9) { m.cyl(x, -5, 0.6, dz(x), dz(x) + 0.8, '#7a6e60'); m.cyl(x, 5, 0.6, dz(x), dz(x) + 0.8, '#7a6e60'); }
  mast(m, 52, dz(52), dz(52) + 13, '#3a3634', [{ z: dz(52) + 9, half: 2 }]);
  return { hull: m, mounts: [], funnels: [[-58.4, 0, dz(-56) + 10]], lamps: [] };
}

// ------------------------------------------------------------------ U-boats

export function type7Art(): ShipArt {
  const m = buildSub({
    name: 'type7', length: 67, beam: 6.2, hullR: 2.35, draftSurf: 4.7, casingH: 3.0, saddle: 1.0,
    towerX: 4, towerLen: 7, towerW: 2.6, towerH: 3.4, colorTop: '#8c9396', colorBottom: '#5e6468', deck: '#55595a', tower: '#98a0a2',
    topHeight: 12,
  });
  // jumping wire, net cutter, deck gun, wintergarten flak
  const deck = -4.7 + 2.35 + 3.0;
  m.line([33, 0, deck + 0.4], [8, 0, deck + 3.8], '#2c2c2c');
  m.line([0, 0, deck + 3.8], [-30, 0, deck + 0.4], '#2c2c2c');
  m.box(1, 2.6, -1.0, 1.0, deck + 3.4, deck + 3.9, '#8a9294');     // wintergarten rail
  m.cylX(-0.5, 1.5, 0, deck + 4.0, 0.15, '#2a2c2e');                  // 20mm barrel
  const gun = gunMount('ub_gun', '#8c9396', 1, 4.0, 1.6, 1.4, 1.3);
  return {
    hull: m,
    mounts: [
      { id: 'gunA', model: gun, x: 11, y: 0, z: deck, yaw: 0 },
      { id: 'periscope', model: periscopeModel('peri'), x: 5.3, y: 0, z: deck + 3.4, yaw: 0 },
    ],
    funnels: [[-1, 0, deck + 2.4]],
    lamps: [],
  };
}

export function type9Art(): ShipArt {
  const m = buildSub({
    name: 'type9', length: 76.8, beam: 6.8, hullR: 2.45, draftSurf: 4.7, casingH: 3.1, saddle: 1.1,
    towerX: 5, towerLen: 8, towerW: 2.8, towerH: 3.5, colorTop: '#7e868a', colorBottom: '#545a5e', deck: '#4d5152', tower: '#8c9496',
    topHeight: 12,
  });
  const deck = -4.7 + 2.45 + 3.1;
  m.line([38, 0, deck + 0.4], [9, 0, deck + 3.9], '#2c2c2c');
  m.line([1, 0, deck + 3.9], [-34, 0, deck + 0.4], '#2c2c2c');
  const gun = gunMount('ub9_gun', '#7e868a', 1, 4.8, 1.8, 1.5, 1.4);
  return {
    hull: m,
    mounts: [
      { id: 'gunA', model: gun, x: 14, y: 0, z: deck, yaw: 0 },
      { id: 'periscope', model: periscopeModel('peri9'), x: 6.4, y: 0, z: deck + 3.5, yaw: 0 },
    ],
    funnels: [[0, 0, deck + 2.5]],
    lamps: [],
  };
}

export function type21Art(): ShipArt {
  const m = buildSub({
    name: 'type21', length: 76.7, beam: 8.0, hullR: 2.9, draftSurf: 6.3, casingH: 2.4, saddle: 0.6,
    towerX: 3, towerLen: 11, towerW: 2.4, towerH: 4.2, colorTop: '#6e777c', colorBottom: '#4a5054', deck: '#5c6264', tower: '#7a8488',
    topHeight: 13, streamlined: true,
  });
  return {
    hull: m,
    mounts: [{ id: 'periscope', model: periscopeModel('peri21'), x: 4.5, y: 0, z: -6.3 + 2.9 + 2.4 + 4.2, yaw: 0 }],
    funnels: [[-1, 0, 2]],
    lamps: [],
  };
}

// ------------------------------------------------------------------ small craft

export function lifeboatArt(): VoxelModel {
  const m = new VoxelModel('lifeboat', 18, 7, 4, 0.5, 0.5, -4.5, -1.75, -0.5);
  lifeboat(m, 0, 0, 0, 8, 2.6, '#c8a060');
  m.set(m.vx(1), m.vy(0), m.vz(1.0), '#ff8020', VM.LAMP);
  return m;
}

export function crateArt(color: string, name: string): VoxelModel {
  const m = new VoxelModel(name, 6, 6, 4, 0.5, 0.5, -1.5, -1.5, -0.6);
  m.box(-1.2, 1.2, -1.2, 1.2, -0.5, 0.8, (i, j, k) => ((i + j + k) % 3 === 0 ? shade(color, -0.25) : color), VM.WOOD);
  m.paintTop(-1.2, 1.2, -1.2, 1.2, shade(color, 0.2));
  return m;
}

export function depthChargeArt(): VoxelModel {
  const m = new VoxelModel('dcharge', 3, 3, 3, 0.5, 0.5, -0.75, -0.75, -0.75);
  m.cyl(0, 0, 0.5, -0.5, 0.5, '#2a2c2e');
  return m;
}

export function torpedoArt(): VoxelModel {
  const m = new VoxelModel('torpedo', 16, 3, 3, 0.5, 0.5, -4, -0.75, -0.75);
  m.cylX(-3.5, 3.5, 0, 0, 0.3, (i) => (i > 12 ? '#9a9070' : '#3c4044'));
  return m;
}

export function islandArt(seed: number, radius: number): VoxelModel {
  const R = radius, res = 1, zres = 1;
  const n = Math.ceil((R * 2) / res) + 4;
  const m = new VoxelModel('island' + seed, n, n, 26, res, zres, -R - 2, -R - 2, -6);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = m.mx(i), y = m.my(j);
    const d = Math.hypot(x, y) / R;
    const nn = hash2((x / 9 + seed * 7) | 0, (y / 9) | 0) * 0.3 + hash2((x / 23) | 0, (y / 23 + seed) | 0) * 0.5;
    const hgt = (1 - d * d) * 18 * (0.6 + nn) - 2;
    if (hgt < -5.5) continue;
    for (let k = 0; k < m.nz; k++) {
      const z = m.mz(k);
      if (z > hgt) break;
      const c = z > hgt - 1 ? (z > 8 ? '#6a7258' : z > 2 ? '#4f5a3c' : '#8a8064') : z < 0.5 ? '#3a3a36' : '#5a5650';
      m.set(i, j, k, weather(c, i + j, k), VM.METAL);
    }
  }
  return m;
}
