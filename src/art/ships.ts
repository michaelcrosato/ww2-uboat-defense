// Voxel art for every vessel class. Hull + fixed superstructure in one model; gun mounts,
// periscopes and searchlights that move are separate small models placed by `mounts`.

import { hash2 } from '../core/math';
import { VoxelModel, VM } from './voxel';
import {
  buildHull, buildSub, camo, carley, crate, dcRack, deckhouse, funnel, hatch, hullNumber, kingpost, lifeboat, mast, parkedBiplane, planks,
  plating, scramblingNets, shade, vent, weather,
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
  vent(m, 12, -2.4, dz(12)); vent(m, 12, 2.4, dz(12)); vent(m, -3, -3.2, dz(-3)); vent(m, -3, 3.2, dz(-3));
  carley(m, -13, -2, dz(-13) + 2.4); carley(m, -13, 2, dz(-13) + 2.4);
  hullNumber(h, 'D27', 9);
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
  vent(m, 5, -2.6, dz(5)); vent(m, 5, 2.6, dz(5));
  carley(m, -11, -1.4, dz(-11) + 2.0); carley(m, 12, 0, dz(12) + 2.6, 2.2, 1.3);
  hullNumber(h, 'K19', 5);
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
  vent(m, 8, -2.8, dz(8)); vent(m, 8, 2.8, dz(8)); vent(m, -12, 0, dz(-15) + 2.2, '#9aa2a4', 1.2);
  carley(m, -17, -1.8, dz(-15) + 2.2); carley(m, -17, 1.8, dz(-15) + 2.2);
  hullNumber(h, 'K95', 9);
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

export function sloopArt(): ShipArt {
  const L = 91, B = 11.4;
  const h = buildHull({
    name: 'sloop', length: L, beam: B, draft: 3.4, fbAft: 2.8, fbMid: 3.3, fbFwd: 4.8,
    forecastle: { from: 0.05, height: 1.9 }, bowStart: 0.3, bowPow: 1.5, rake: 0.08, stern: 'cruiser', sternStart: -0.72, vee: 0.3,
    topHeight: 21, side: camo(ADM_CAMO, 9, 17, 0.5), deck: plating('#565a5b'), rail: '#d0d4d0',
  });
  const m = h.m;
  const dz = (x: number) => h.deckZ(x);
  // bridge in three tiers with the HA director on top
  deckhouse(m, 12, 21, 3.4, dz(16), dz(16) + 2.6, camo(ADM_CAMO, 6, 18), '#404446', { color: '#1a2228', z: dz(16) + 1.9, every: 2, front: true });
  deckhouse(m, 13.5, 20, 2.8, dz(16) + 2.6, dz(16) + 4.6, '#a7b3b6', '#383b3c', { color: '#1a2228', z: dz(16) + 4.0, every: 2, front: true });
  m.cyl(17.5, 0, 1.2, dz(16) + 4.6, dz(16) + 6.0, '#c9d0d0');
  // tripod foremast with the radar lantern
  mast(m, 9.5, dz(9), dz(9) + 16, '#2e2e2c', [{ z: dz(9) + 11, half: 3 }], dz(9) + 8);
  m.line([8, -2, dz(8)], [9.5, 0, dz(9) + 10], '#2e2e2c');
  m.line([8, 2, dz(8)], [9.5, 0, dz(9) + 10], '#2e2e2c');
  m.cyl(9.5, 0, 0.9, dz(9) + 16, dz(9) + 17.4, '#cfd6d8');
  funnel(m, -1, 2.2, 1.7, dz(-1), dz(-1) + 5.4, '#a7b3b6', '#2a2a2a', 0.08);
  // aft deckhouse with the pom-pom bandstand
  deckhouse(m, -16, -8, 2.8, dz(-12), dz(-12) + 2.2, camo(ADM_CAMO, 6, 19), '#404446');
  m.cyl(-12, 0, 1.8, dz(-12) + 2.2, dz(-12) + 2.8, '#7c8b92');
  lifeboat(m, -4, -4.6, dz(-4) + 1.1, 6.5, 1.8);
  lifeboat(m, -4, 4.6, dz(-4) + 1.1, 6.5, 1.8);
  vent(m, 4, -2.6, dz(4)); vent(m, 4, 2.6, dz(4)); vent(m, -19, 0, dz(-19), '#9aa2a4', 1.2);
  carley(m, -13, -2, dz(-12) + 2.2); carley(m, 6, 0, dz(6) + 0.1, 2.2, 1.3);
  // a hunter's depth-charge outfit: two rails and eight K-guns
  dcRack(m, -45, -37, -1.8, dz(-41));
  dcRack(m, -45, -37, 1.8, dz(-41));
  for (const x of [-34, -30, -26, -22]) for (const y of [-4.4, 4.4]) m.box(x - 0.5, x + 0.5, y - 0.5, y + 0.5, dz(x), dz(x) + 1.1, '#30343a');
  // superfiring platform for B mount
  m.box(24.5, 28.5, -1.8, 1.8, dz(26.5), dz(26.5) + 1.2, '#4a5052');
  hullNumber(h, 'U45', 9);
  const gun = gunMount('sl_gun', '#c9d0d0', 2, 4.6, 3.0, 3.0, 2.0);
  return {
    hull: m,
    mounts: [
      { id: 'gunA', model: gun, x: 33, y: 0, z: dz(33), yaw: 0 },
      { id: 'gunB', model: gun, x: 26.5, y: 0, z: dz(26.5) + 1.2, yaw: 0 },
      { id: 'gunX', model: gun, x: -24, y: 0, z: dz(-24), yaw: Math.PI },
      { id: 'searchlight', model: searchlightModel('sl'), x: 17.5, y: 0, z: dz(16) + 6.0, yaw: 0 },
    ],
    funnels: [[-1.6, 0, dz(-1) + 5.4]],
    lamps: [[17.5, 0, dz(16) + 6.8]],
  };
}

export function trawlerArt(): ShipArt {
  const L = 50, B = 8.5;
  const h = buildHull({
    name: 'trawler', length: L, beam: B, draft: 3.6, fbAft: 2.0, fbMid: 2.2, fbFwd: 4.6,
    forecastle: { from: 0.45, height: 1.4 }, bowStart: 0.3, bowPow: 1.5, rake: 0.06, stern: 'counter', sternStart: -0.6, vee: 0.35,
    topHeight: 17, side: camo(WA_CAMO, 7, 23, 0.4), deck: planks('#7a6a52', '#4a3e30'), rail: '#d8dcd8',
  });
  const m = h.m;
  const dz = (x: number) => h.deckZ(x);
  // wheelhouse aft of midships over the galley; tall coal-burner funnel behind it
  deckhouse(m, -6, 3, 2.8, dz(-1), dz(-1) + 2.4, camo(WA_CAMO, 5, 24), '#3e4244', { color: '#1a2228', z: dz(-1) + 1.8, every: 2 });
  deckhouse(m, -3, 2.5, 2.2, dz(-1) + 2.4, dz(-1) + 4.4, '#e4e8e6', '#3a3d3e', { color: '#1a2228', z: dz(-1) + 3.8, every: 2, front: true });
  funnel(m, -9, 1.5, 1.3, dz(-9), dz(-9) + 6.0, '#e4e8e6', '#7fa2ad', 0.12);
  mast(m, 10, dz(10), dz(10) + 12, '#2e2e2c', [{ z: dz(10) + 8, half: 2 }], dz(10) + 6);
  // trawl gallows on both sides and the old fish-hold hatch
  for (const y of [-B / 2 + 0.6, B / 2 - 0.6]) {
    m.line([6, y, dz(6)], [6, y, dz(6) + 2.6], '#3a3a38');
    m.line([4, y, dz(4)], [4, y, dz(4) + 2.6], '#3a3a38');
    m.line([4, y, dz(4) + 2.6], [6, y, dz(6) + 2.6], '#3a3a38');
  }
  hatch(m, 5, 9, 1.6, dz(7), '#4a4032');
  // gun platform on the forecastle; one DC rail and two throwers aft
  m.box(15, 19.5, -1.6, 1.6, dz(17), dz(17) + 0.8, '#5a6062');
  dcRack(m, -24, -20, 0, dz(-22));
  for (const y of [-3.2, 3.2]) m.box(-17.5, -16.5, y - 0.5, y + 0.5, dz(-17), dz(-17) + 1.0, '#30343a');
  lifeboat(m, -14, 0, dz(-14) + 0.9, 5, 1.6);
  carley(m, -4, -2.2, dz(-1) + 2.4, 2, 1.2);
  hullNumber(h, 'T27', 4);
  const gun = gunMount('tr_gun', '#cfd6d8', 1, 4.2, 2.6, 2.4, 1.9);
  return {
    hull: m,
    mounts: [
      { id: 'gunA', model: gun, x: 17.2, y: 0, z: dz(17) + 0.8, yaw: 0 },
      { id: 'searchlight', model: searchlightModel('sl'), x: -0.5, y: 0, z: dz(-1) + 4.4, yaw: 0 },
    ],
    funnels: [[-9.7, 0, dz(-9) + 6]],
    lamps: [[-0.5, 0, dz(-1) + 5.4]],
  };
}

/** escort carrier: merchant-type hull, enclosed hangar, wooden flight deck, starboard island */
export function escortCarrierArt(): ShipArt {
  const L = 150, B = 21, FD = 13.4;
  const h = buildHull({
    name: 'escortcarrier', length: L, beam: B, draft: 7.6, fbAft: 4.0, fbMid: 4.0, fbFwd: 6.0,
    bowStart: 0.5, bowPow: 1.4, rake: 0.05, stern: 'counter', sternStart: -0.78, vee: 0.1,
    topHeight: FD + 11, side: camo(ADM_CAMO, 16, 29, 0.4), deck: plating('#565a5b'), rails: false,
  });
  const m = h.m;
  const wall = camo(ADM_CAMO, 12, 31, 0.4);
  // hangar: follows the hull planform, with dark openings along the sides
  for (let i = 0; i < m.nx; i++) {
    const x = m.mx(i);
    if (x < -60 || x > 58) continue;
    const hw = Math.min(B / 2 - 0.4, h.halfBeam(x, 3.8) - 0.3);
    if (hw < 1.5) continue;
    for (let k = m.vz(4.0); k < m.vz(FD - 0.5); k++) for (let j = m.vy(-hw); j <= m.vy(hw); j++) {
      const edge = Math.abs(m.my(j)) > hw - 0.6;
      const kk = k - m.vz(4.0);
      const opening = edge && kk % 10 > 2 && kk % 10 < 7 && i % 16 > 3 && i % 16 < 12;
      const c = opening ? '#1a1e22' : wall(i, j, k, m);
      if (c) m.set(i, j, k, c, VM.METAL);
    }
  }
  // flight deck overhanging bow and stern on pillars
  const fdW = 12;
  m.box(-70, 68, -fdW, fdW, FD - 0.5, FD, (i, j) => {
    const x = m.mx(i), y = m.my(j);
    if (Math.abs(y) > fdW - 0.6) return '#cfcfc6';
    if (Math.abs(y) < 0.3 && i % 8 < 4) return '#e2e2da';
    if (x < -64 && i % 4 < 2) return '#c8c4b8';
    // two aircraft lifts, outlined
    for (const ex of [-28, 40]) if (Math.abs(x - ex) < 5.5 && Math.abs(y) < 5.5) return Math.abs(x - ex) > 4.9 || Math.abs(y) > 4.9 ? '#2e2c28' : '#686458';
    return j % 3 === 0 ? '#4a4640' : hash2(i >> 3, j) > 0.85 ? '#56524a' : '#5e5a52';
  }, VM.WOOD);
  for (const x of [-68, -63, 61, 66]) for (const y of [-7, 7]) m.line([x, y, h.deckZ(Math.max(-L / 2 + 2, Math.min(L / 2 - 2, x)))], [x, y, FD - 0.5], '#3e4244');
  // island on the starboard edge: bridge, mast and radar
  m.box(18, 30, fdW - 3.2, fdW - 0.2, FD, FD + 4.5, wall, VM.METAL);
  m.paintTop(18, 30, fdW - 3.2, fdW - 0.2, '#383b3c');
  for (let i = m.vx(18.5); i < m.vx(29.5); i += 2) m.set(i, m.vy(fdW - 3.2), m.vz(FD + 3.6), '#1a2228', VM.GLASS);
  m.line([24, fdW - 1.6, FD + 4.5], [24, fdW - 1.6, FD + 9.5], '#2e2e2c');
  m.line([24, fdW - 3.2, FD + 7.5], [24, fdW, FD + 7.5], '#2e2e2c');
  m.cyl(24, fdW - 1.6, 0.8, FD + 9.5, FD + 10.5, '#cfd6d8');
  // exhaust stacks under the starboard deck edge, gun sponson to port
  m.box(-12, -9, B / 2 - 0.5, B / 2 + 1.0, FD - 3, FD - 1, '#2a2a2a');
  m.box(-2, 2, -B / 2 - 1.8, -B / 2 + 0.2, FD - 2.5, FD - 2.0, '#6a7276');
  // the ship's Swordfish ranged aft, ready to fly off
  parkedBiplane(m, -50, -4, FD);
  parkedBiplane(m, -63, 4, FD);
  hullNumber(h, 'D12', 30);
  return {
    hull: m,
    mounts: [{ id: 'gunA', model: gunMount('cve_pom', '#aab4b6', 2, 2.4, 2.2, 2.2, 1.4), x: 0, y: -B / 2 - 0.8, z: FD - 2.0, yaw: -Math.PI / 2 }],
    funnels: [[-10.5, B / 2 + 0.6, FD - 1]],
    lamps: [[24, fdW - 1.6, FD + 5.5]],
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

/** a Liberty ship: three masts with booms, midships house, deck cargo of tanks */
export function libertyArt(): ShipArt {
  const L = 135, B = 17.4;
  const h = buildHull({
    name: 'liberty', length: L, beam: B, draft: 8.4, fbAft: 3.6, fbMid: 3.2, fbFwd: 5.2,
    forecastle: { from: 0.8, height: 2.4 }, poop: { to: -0.84, height: 2.4 }, bowStart: 0.5, bowPow: 1.5, rake: 0.05, stern: 'cruiser', sternStart: -0.78, vee: 0.1,
    topHeight: 26, side: (i, _j, k) => weather(hash2(i >> 5, 17) > 0.5 ? '#767c80' : '#70767a', i, k), deck: plating('#6c6660'), boot: '#262626', bottom: '#6e2e28', rail: '#9a9690',
  });
  const m = h.m;
  const dz = (x: number) => h.deckZ(x);
  deckhouse(m, -10, 8, 7, dz(0), dz(0) + 3.0, '#8a9094', '#55504a', { color: '#22282c', z: dz(0) + 2.0, every: 2 });
  deckhouse(m, -6, 6, 6, dz(0) + 3.0, dz(0) + 5.6, '#949a9e', '#4c4842', { color: '#22282c', z: dz(0) + 4.6, every: 2, front: true });
  deckhouse(m, 1, 5.5, 4.6, dz(0) + 5.6, dz(0) + 7.8, '#9ea4a8', '#3e3a36', { color: '#22282c', z: dz(0) + 7.0, every: 2, front: true });
  funnel(m, -4, 2.2, 2.0, dz(0) + 3, dz(0) + 12, '#55585a', '#2a2a2a', 0.04);
  lifeboat(m, -3, -6.2, dz(0) + 3.2, 7, 2.1, '#d0ccc0');
  lifeboat(m, -3, 6.2, dz(0) + 3.2, 7, 2.1, '#d0ccc0');
  for (const [x0, x1] of [[44, 54], [30, 40], [13, 24], [-26, -15], [-47, -35]] as [number, number][]) hatch(m, x0, x1, 4.2, dz((x0 + x1) / 2), '#55606a', '#3c3c38');
  for (const [x, dir] of [[42, 1], [27, -1], [-31, 1]] as [number, number][]) {
    mast(m, x, dz(x), dz(x) + 17, '#4a4642', [{ z: dz(x) + 12, half: 3 }], dz(x) + 13);
    kingpost(m, x, dz(x), 8, 9, dir);
  }
  // deck cargo: tanks on the hatch covers, and a crated aircraft aft
  for (const [x, y] of [[49, -2], [35, 2], [19, -1]] as [number, number][]) {
    const z = dz(x) + 1.0;
    m.box(x - 3, x + 3, y - 1.5, y + 1.5, z, z + 1.5, (i, _j, k) => (k === m.vz(z) ? '#3c4630' : '#4e5a3a'), VM.METAL);
    m.cyl(x + 0.4, y, 1.1, z + 1.5, z + 2.3, '#56623e');
    m.line([x + 1.4, y, z + 1.9], [x + 4.4, y, z + 1.9], '#2a3020');
  }
  crate(m, -20, 0, dz(-20) + 1.0, 9, 3.4, 2.4, '#7a6a4a');
  m.cyl(-L / 2 + 6, 0, 2.4, dz(-L / 2 + 6), dz(-L / 2 + 6) + 1.2, '#6a6e70');
  m.cyl(L / 2 - 9, 0, 2.0, dz(L / 2 - 9), dz(L / 2 - 9) + 1.0, '#6a6e70');
  return { hull: m, mounts: [], funnels: [[-4.4, 0, dz(0) + 12]], lamps: [] };
}

/** an ore carrier: bridge right forward, engines aft, a long low deck of small hatches */
export function oreCarrierArt(): ShipArt {
  const L = 128, B = 17;
  const h = buildHull({
    name: 'orecarrier', length: L, beam: B, draft: 8.2, fbAft: 3.0, fbMid: 2.4, fbFwd: 4.4,
    forecastle: { from: 0.86, height: 2.0 }, poop: { to: -0.78, height: 2.6 }, bowStart: 0.6, bowPow: 1.4, rake: 0.04, stern: 'counter', sternStart: -0.82, vee: 0.06,
    topHeight: 22, side: (i, _j, k) => weather(hash2(i >> 3, k >> 2) > 0.8 ? '#5a3a2e' : '#3e3c3a', i, k), deck: plating('#6e4c3c'), boot: '#2a2420', bottom: '#5e2a24', rail: '#8a8680',
  });
  const m = h.m;
  const dz = (x: number) => h.deckZ(x);
  deckhouse(m, 44, 54, 6.0, dz(49), dz(49) + 3, '#c8c0ac', '#5a4c3c', { color: '#22282c', z: dz(49) + 2, every: 2 });
  deckhouse(m, 46, 53, 4.8, dz(49) + 3, dz(49) + 5.4, '#d8d0bc', '#4a4038', { color: '#22282c', z: dz(49) + 4.6, every: 2, front: true });
  mast(m, 57, dz(57), dz(57) + 12, '#3a3634', [{ z: dz(57) + 8, half: 2 }]);
  deckhouse(m, -62, -48, 7.0, dz(-55), dz(-55) + 3.2, '#c8c0ac', '#5a4c3c', { color: '#22282c', z: dz(-55) + 2.2, every: 2 });
  funnel(m, -56, 2.4, 2.2, dz(-55) + 3.2, dz(-55) + 10, '#2a2a2a', '#9a3a2a', 0.04);
  lifeboat(m, -55, -6, dz(-55) + 3.4, 7, 2.1, '#d8d0bc');
  lifeboat(m, -55, 6, dz(-55) + 3.4, 7, 2.1, '#d8d0bc');
  mast(m, -46, dz(-46), dz(-46) + 10, '#3a3634');
  for (let x = -44; x < 40; x += 7) hatch(m, x, x + 4, 2.6, dz(x + 2), '#5a3a2c', '#3c3430');
  // ore dust staining the deck and hatch tops
  m.paintTop(-46, 42, -B / 2, B / 2, (i, j) => (hash2(i >> 2, j >> 2) > 0.8 ? '#7a4a34' : null));
  return { hull: m, mounts: [], funnels: [[-56.4, 0, dz(-55) + 10]], lamps: [] };
}

/** convoy rescue ship: a small coastal liner with boats along both sides and scrambling nets */
export function rescueShipArt(): ShipArt {
  const L = 80, B = 12;
  const h = buildHull({
    name: 'rescue', length: L, beam: B, draft: 4.5, fbAft: 3.4, fbMid: 3.2, fbFwd: 4.6,
    forecastle: { from: 0.6, height: 1.8 }, bowStart: 0.4, bowPow: 1.5, rake: 0.07, stern: 'cruiser', sternStart: -0.7, vee: 0.2,
    topHeight: 20, side: (i, _j, k) => weather('#6a7276', i, k), deck: planks('#9a8462', '#5a4a38'), rail: '#c8c4bc',
  });
  const m = h.m;
  const dz = (x: number) => h.deckZ(x);
  // teak promenade and boat decks: light, so the liner reads apart from the grey cargo ships
  deckhouse(m, -20, 18, 5.0, dz(0), dz(0) + 2.6, '#c8c4b8', '#a08a64', { color: '#22282c', z: dz(0) + 1.8, every: 2 });
  deckhouse(m, -14, 14, 4.0, dz(0) + 2.6, dz(0) + 5.0, '#d8d4c8', '#94805e', { color: '#22282c', z: dz(0) + 4.2, every: 2 });
  deckhouse(m, 8, 14, 3.0, dz(0) + 5.0, dz(0) + 7.0, '#e2ddd0', '#5a5450', { color: '#22282c', z: dz(0) + 6.4, every: 2, front: true });
  funnel(m, -2, 1.8, 1.6, dz(0) + 5.0, dz(0) + 11.5, '#5a6266', '#2a2a2a', 0.1);
  for (const x of [-11, 5]) for (const y of [-4.8, 4.8]) lifeboat(m, x, y, dz(0) + 5.2, 6, 1.8, '#e0d8c4');
  for (const y of [-5.4, 5.4]) lifeboat(m, -17, y, dz(0) + 2.8, 5, 1.6, '#e0d8c4');
  mast(m, 26, dz(26), dz(26) + 13, '#3a3634', [{ z: dz(26) + 9, half: 2 }]);
  mast(m, -28, dz(-28), dz(-28) + 11, '#3a3634');
  hatch(m, 22, 30, 3, dz(26), '#55606a', '#3c3c38');
  carley(m, -24, -2, dz(-24)); carley(m, -24, 2, dz(-24));
  scramblingNets(h, -24, 22);
  return { hull: m, mounts: [], funnels: [[-2.6, 0, dz(0) + 11.5]], lamps: [[11, 0, dz(0) + 7.5]] };
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
      m.set(i, j, k, weather(c, i + j, k), VM.LAND);
    }
  }
  return m;
}

// ------------------------------------------------------------------ aircraft

/** type B roundel (red centre, blue ring) as seen from above on an upper wing */
function roundel(m: VoxelModel, x: number, y: number, z: number, r: number) {
  m.cyl(x, y, r, z, z + 0.5, (i, j) => (Math.hypot(m.mx(i) - x, m.my(j) - y) < r * 0.45 ? '#a8302a' : '#2c3a6a'), VM.CANVAS);
}
/** two-bladed propeller as a cross in the y-z plane at x */
function prop(m: VoxelModel, x: number, y: number, z: number, r: number) {
  m.line([x, y - r, z], [x, y + r, z], '#22221e');
  m.line([x, y, z - r * 0.6], [x, y, z + r * 0.6], '#22221e');
  m.set(m.vx(x), m.vy(y), m.vz(z), '#5a5a52');
}
/** upper surfaces in a two-tone disruptive scheme, light undersides */
const seaScheme = (dark: string, light: string, under: string, zSplit: number) => (i: number, j: number, k: number, m: VoxelModel) =>
  m.mz(k) < zSplit ? under : hash2(i >> 2, j >> 2) > 0.5 ? dark : light;

export function aircraftArt(kind: 'swordfish' | 'catalina' | 'liberator'): VoxelModel {
  if (kind === 'swordfish') {
    // Fairey Swordfish: fabric biplane, torpedo slung under the fuselage
    const m = new VoxelModel('ac_swordfish', 28, 32, 10, 0.5, 0.5, -7, -8, -2);
    const camo = seaScheme('#46524a', '#5c6858', '#a8b4b4', -0.3);
    m.cylX(-5.5, 4.6, 0, 0, 0.6, camo, VM.CANVAS);
    m.box(-1.2, 1.4, -0.4, 0.4, 0.5, 1.0, '#26302a');                                   // open cockpits
    m.cylX(4.6, 5.4, 0, 0, 0.7, '#3a3e3a');                                              // engine cowling
    prop(m, 5.6, 0, 0, 1.6);
    m.box(0.2, 2.0, -6.9, 6.9, 0.0, 0.5, camo, VM.CANVAS);                               // lower wing
    m.box(0.6, 2.4, -6.9, 6.9, 2.0, 2.5, camo, VM.CANVAS);                               // upper wing (staggered)
    roundel(m, 1.5, -4.8, 2.5, 0.85); roundel(m, 1.5, 4.8, 2.5, 0.85);
    for (const y of [-4.5, -1.8, 1.8, 4.5]) m.line([1.0, y, 0.5], [1.4, y, 2.0], '#2e322e');
    m.box(-5.6, -4.6, -2.2, 2.2, 0.0, 0.5, camo, VM.CANVAS);                            // tailplane
    m.box(-5.7, -4.7, -0.25, 0.25, 0.5, 2.0, camo, VM.CANVAS);                          // fin
    m.cylX(-0.8, 3.4, 0, -0.9, 0.3, '#2a2c2e');                                          // torpedo
    m.set(m.vx(-5.4), m.vy(0), m.vz(1.8), '#ffe8a0', VM.LAMP);
    return m;
  }
  if (kind === 'catalina') {
    // Consolidated Catalina: boat hull, parasol wing on a pylon, retractable wingtip floats
    const m = new VoxelModel('ac_catalina', 44, 68, 12, 0.5, 0.5, -10.5, -17, -1.5);
    const top = seaScheme('#5e6a70', '#7a868c', '#dfe4e6', 0.0);
    for (let i = m.vx(-10); i < m.vx(9.6); i++) {
      const x = m.mx(i), t = (x + 10) / 19.6;
      const r = 1.15 * Math.min(1, Math.sqrt(Math.max(0.05, (1 - t) * 6)) , 0.5 + t * 1.4);
      m.cylX(x, x + 0.5, 0, x < -4 ? (x + 4) * -0.08 : 0, Math.max(0.35, r), top, VM.METAL);
    }
    m.box(5.0, 7.2, -0.7, 0.7, 0.9, 1.3, '#26303a', VM.GLASS);                          // cockpit glazing
    for (const y of [-1.1, 1.1]) m.cyl(-4.6, y, 0.6, 0.1, 1.0, '#9ab0c0', VM.GLASS);    // waist blisters
    m.box(-1.0, 1.0, -0.6, 0.6, 1.0, 3.0, '#7a868c');                                   // pylon
    for (let j = m.vy(-15.8); j <= m.vy(15.8); j++) {
      const y = m.my(j), c = 1.6 - Math.abs(y) / 15.8 * 0.5;
      m.box(-c, c, y - 0.25, y + 0.25, 3.0, 3.5, top, VM.METAL);
    }
    roundel(m, 0, -10.5, 3.5, 1.1); roundel(m, 0, 10.5, 3.5, 1.1);
    for (const y of [-3.3, 3.3]) { m.cylX(0.4, 3.6, y, 3.1, 0.75, '#4a5054'); prop(m, 3.9, y, 3.1, 1.8); }
    for (const y of [-14.6, 14.6]) m.box(-0.8, 0.8, y - 0.5, y + 0.5, 2.0, 3.0, '#dfe4e6');   // floats
    m.box(-10, -8.6, -3.6, 3.6, 3.2, 3.7, top, VM.METAL);                               // tailplane
    m.box(-10.2, -8.8, -0.25, 0.25, 0.5, 4.2, top, VM.METAL);                           // fin
    m.set(m.vx(1.2), m.vy(-8), m.vz(2.9), '#ffffff', VM.LAMP);
    return m;
  }
  // Consolidated Liberator (VLR): long slim wing, four engines, twin oval fins, glazed nose
  const m = new VoxelModel('ac_liberator', 46, 70, 10, 0.5, 0.5, -11, -17.5, -1.5);
  const top = seaScheme('#5a6268', '#727a80', '#e2e6e8', -0.2);
  m.cylX(-10, 9.4, 0, 0, 1.3, top, VM.METAL);
  m.cylX(9.4, 10.6, 0, 0, 1.0, '#9ab0c0', VM.GLASS);                                    // glazed nose
  m.box(6.0, 7.6, -0.8, 0.8, 0.9, 1.4, '#26303a', VM.GLASS);                            // cockpit
  for (let j = m.vy(-16.7); j <= m.vy(16.7); j++) {
    const y = m.my(j), c = 3.0 - Math.abs(y) / 16.7 * 1.8;
    m.box(1.8 - c, 1.8, y - 0.25, y + 0.25, 0.2, 0.7, top, VM.METAL);
  }
  roundel(m, 0.6, -11, 0.7, 1.1); roundel(m, 0.6, 11, 0.7, 1.1);
  for (const y of [-9, -4.5, 4.5, 9]) { m.cylX(1.2, 4.2, y, 0.3, 0.6, '#3a3e40'); prop(m, 4.5, y, 0.3, 1.6); }
  m.box(-10, -8.6, -4.2, 4.2, 0.4, 0.9, top, VM.METAL);                                 // tailplane
  for (const y of [-4.2, 4.2]) m.box(-10.2, -8.4, y - 0.25, y + 0.25, -0.6, 3.0, '#727a80', VM.METAL);   // twin fins
  m.set(m.vx(0.6), m.vy(9), m.vz(0.0), '#ffffff', VM.LAMP);                            // Leigh light pod
  return m;
}

// ------------------------------------------------------------------ coast & lighthouse

/**
 * One chunk of a low coastline (US East Coast theater): beach, dunes and a town strip with lit
 * windows facing the sea (the sea is on the +y side). Coarse 3 m voxels: it is scenery seen from afar.
 */
export function coastArt(seed: number, length: number, depth: number): VoxelModel {
  const res = 3, zres = 1.5;
  const nx = Math.ceil(length / res), ny = Math.ceil(depth / res);
  const m = new VoxelModel('coast' + seed, nx, ny, 12, res, zres, -length / 2, -depth / 2, -3);
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const x = m.mx(i), y = m.my(j);
    const shore = (y + depth / 2) / depth;            // 0 inland … 1 waterline
    const n = hash2((x / 21 + seed * 13) | 0, (y / 21) | 0);
    // ragged waterline: coves and spits rather than a ruler-straight edge
    const cove = Math.sin(x / 97 + seed) * 0.08 + Math.sin(x / 31 + seed * 3) * 0.04 + (n - 0.5) * 0.06;
    if (shore > 0.9 + cove) continue;
    const ground = (1 - shore) * 3 + n * 1.2 - 0.8;
    for (let k = 0; k < m.nz; k++) {
      const z = m.mz(k);
      if (z > ground) break;
      const c = z < 0.5 && shore > 0.72 + cove ? '#8a8060' : z > 2 ? '#3e4a32' : '#5a5a44';
      // plain ground colour (hull weathering would paint rust streaks down the dunes)
      m.set(i, j, k, c, VM.LAND);
    }
    // town blocks behind the dunes, windows lit on the seaward face
    if (shore < 0.5 && shore > 0.15 && hash2(i >> 2, (j >> 1) + seed) > 0.72) {
      const h = 2 + Math.floor(hash2(i, j * 3 + seed) * 4);
      for (let k = Math.max(0, m.vz(ground)); k < Math.min(m.nz, m.vz(ground) + h); k++) {
        const lit = k === Math.max(0, m.vz(ground)) + 1 && hash2(i * 7 + k, j + seed) > 0.7;
        m.set(i, j, k, lit ? '#ffd890' : '#4a4640', lit ? VM.LAMP : VM.LAND);
      }
    }
  }
  return m;
}

/** a white-and-red lighthouse tower with a lamp room (stands on a rock island) */
export function lighthouseArt(): VoxelModel {
  const m = new VoxelModel('lighthouse', 16, 16, 80, 0.5, 0.5, -4, -4, 0);
  m.cyl(0, 0, 2.6, 0, 30, (_i, _j, k) => (Math.floor(k / 10) % 2 ? '#c8c4bc' : '#a83a2a'), VM.LAND);
  m.cyl(0, 0, 3.2, 30, 31, '#2a2a2a');
  m.cyl(0, 0, 2, 31, 34, '#fff2c0', VM.LAMP);
  m.cyl(0, 0, 2.4, 34, 36, '#2a2a2a');
  return m;
}
