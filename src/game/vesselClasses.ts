// Vessel classes: real dimensions and displacements, period speeds and armament. Ranges are
// compressed for gameplay (ASDIC ~1.2 km instead of ~2.3 km, torpedoes ~3.5 km instead of 5-7 km)
// so a convoy battle fits a few kilometres of ocean.

import { KNOT } from '../core/math';
import * as art from '../art/ships';
import type { ShipArt } from '../art/ships';

export type VesselKind = 'escort' | 'merchant' | 'uboat';
export type Side = 'allied' | 'axis';

export interface GunSpec {
  mount: string;          // art mount id ('gunA'...)
  caliber: number;        // mm
  arc: [number, number];  // allowed bearing relative to the bow (rad, -PI..PI)
  traverse: number;       // rad/s
  reload: number;         // s
  velocity: number;       // m/s muzzle
  range: number;          // m
  damage: number;
  spread: number;         // rad dispersion
}

export interface VesselClass {
  id: string;
  name: string;
  kind: VesselKind;
  /** special duties: an escort carrier launches the convoy's air patrols, a rescue ship picks up survivors */
  role?: 'carrier' | 'rescue';
  side: Side;
  art: () => ShipArt;
  length: number; beam: number; draft: number; freeboard: number;
  displacement: number;   // tonnes
  grt?: number;           // merchants: gross register tonnage (scoring)
  maxSpeedKn: number;
  accelTime: number;
  turnRadius: number;     // m at full rudder & speed (authentic handling)
  hp: number;
  noise: number;          // base acoustic source level (arbitrary dB)
  sensors: { asdic?: number; hydrophone: number; radar?: number; lookout: number; hfdf?: boolean };
  guns: GunSpec[];
  dc?: { capacity: number; rails: number; kguns: number; reload: number };
  hedgehog?: { salvos: number; minYear: number };
  torpedoes?: { bow: number; stern: number; reloads: number; reloadTime: number; speedKn: number; range: number; damage: number; wake: boolean };
  sub?: {
    surfacedKn: number; submergedKn: number; silentKn: number;
    periscopeDepth: number; testDepth: number; crushDepth: number;
    battery: number;      // capacity in "minutes at 1/3 speed" units
    diveTime: number;     // s to periscope depth in a normal dive
    hullHeight: number;   // keel to casing deck (m)
    snorkel: boolean;
  };
}

const deg = Math.PI / 180;

const g47 = (mount: string, arc: [number, number]): GunSpec => ({ mount, caliber: 120, arc, traverse: 22 * deg, reload: 4.2, velocity: 520, range: 2600, damage: 85, spread: 0.008 });
const g4 = (mount: string, arc: [number, number]): GunSpec => ({ mount, caliber: 102, arc, traverse: 26 * deg, reload: 3.6, velocity: 480, range: 2200, damage: 70, spread: 0.009 });
/** twin 4-inch high-angle mount: two barrels, so half the interval between rounds */
const g4t = (mount: string, arc: [number, number]): GunSpec => ({ ...g4(mount, arc), reload: 2.1 });
const pom = (mount: string, arc: [number, number]): GunSpec => ({ mount, caliber: 40, arc, traverse: 50 * deg, reload: 0.55, velocity: 420, range: 1100, damage: 16, spread: 0.02 });

export const VESSELS: Record<string, VesselClass> = {
  corvette: {
    id: 'corvette', name: 'Flower-class corvette', kind: 'escort', side: 'allied', art: art.corvetteArt,
    length: 62, beam: 10.1, draft: 3.5, freeboard: 3.4, displacement: 1000, maxSpeedKn: 16, accelTime: 45, turnRadius: 190,
    hp: 950, noise: 128, sensors: { asdic: 1150, hydrophone: 900, radar: 2600, lookout: 2400 },
    guns: [g4('gunA', [-150 * deg, 150 * deg]), pom('gunX', [30 * deg, 330 * deg])],
    dc: { capacity: 44, rails: 2, kguns: 2, reload: 2.5 }, hedgehog: { salvos: 6, minYear: 1943 },
  },
  destroyer: {
    id: 'destroyer', name: 'V&W-class destroyer', kind: 'escort', side: 'allied', art: art.destroyerArt,
    length: 98, beam: 10.4, draft: 3.5, freeboard: 4.0, displacement: 1800, maxSpeedKn: 32, accelTime: 55, turnRadius: 420,
    hp: 1150, noise: 134, sensors: { asdic: 1250, hydrophone: 950, radar: 3000, lookout: 2600, hfdf: true },
    guns: [g47('gunA', [-150 * deg, 150 * deg]), g47('gunB', [-140 * deg, 140 * deg]), g47('gunX', [40 * deg, 320 * deg]), g47('gunY', [30 * deg, 330 * deg])],
    dc: { capacity: 34, rails: 2, kguns: 2, reload: 2.2 }, hedgehog: { salvos: 8, minYear: 1942 },
  },
  frigate: {
    id: 'frigate', name: 'River-class frigate', kind: 'escort', side: 'allied', art: art.frigateArt,
    length: 91, beam: 11.1, draft: 3.9, freeboard: 3.8, displacement: 1400, maxSpeedKn: 20, accelTime: 50, turnRadius: 300,
    hp: 1050, noise: 130, sensors: { asdic: 1450, hydrophone: 1000, radar: 3200, lookout: 2600, hfdf: true },
    guns: [g4('gunA', [-150 * deg, 150 * deg]), g4('gunX', [30 * deg, 330 * deg])],
    dc: { capacity: 60, rails: 2, kguns: 4, reload: 2.0 }, hedgehog: { salvos: 10, minYear: 1942 },
  },
  sloop: {
    id: 'sloop', name: 'Black Swan-class sloop', kind: 'escort', side: 'allied', art: art.sloopArt,
    length: 91, beam: 11.4, draft: 3.4, freeboard: 3.8, displacement: 1300, maxSpeedKn: 19.75, accelTime: 48, turnRadius: 290,
    hp: 1100, noise: 129, sensors: { asdic: 1400, hydrophone: 1000, radar: 3000, lookout: 2600, hfdf: true },
    guns: [g4t('gunA', [-150 * deg, 150 * deg]), g4t('gunB', [-140 * deg, 140 * deg]), g4t('gunX', [30 * deg, 330 * deg])],
    dc: { capacity: 110, rails: 2, kguns: 8, reload: 1.8 }, hedgehog: { salvos: 10, minYear: 1942 },
  },
  trawler: {
    id: 'trawler', name: 'Armed trawler', kind: 'escort', side: 'allied', art: art.trawlerArt,
    length: 50, beam: 8.5, draft: 3.6, freeboard: 2.8, displacement: 545, maxSpeedKn: 12, accelTime: 35, turnRadius: 150,
    hp: 620, noise: 126, sensors: { asdic: 1000, hydrophone: 850, lookout: 2000 },
    guns: [g4('gunA', [-150 * deg, 150 * deg])],
    dc: { capacity: 30, rails: 1, kguns: 2, reload: 2.8 },
  },
  escortcarrier: {
    id: 'escortcarrier', name: 'Escort carrier', kind: 'escort', side: 'allied', art: art.escortCarrierArt, role: 'carrier',
    length: 150, beam: 21, draft: 7.6, freeboard: 13, displacement: 11400, grt: 10000, maxSpeedKn: 18, accelTime: 110, turnRadius: 620,
    hp: 2100, noise: 138, sensors: { hydrophone: 0, radar: 3200, lookout: 2800 },
    guns: [pom('gunA', [-170 * deg, -10 * deg])],
  },
  freighter: {
    id: 'freighter', name: 'Freighter', kind: 'merchant', side: 'allied', art: () => art.freighterArt(0),
    length: 128, beam: 17.3, draft: 7.6, freeboard: 3.4, displacement: 9800, grt: 5600, maxSpeedKn: 10, accelTime: 120, turnRadius: 520,
    hp: 1500, noise: 140, sensors: { hydrophone: 0, lookout: 1800 }, guns: [],
  },
  freighter2: {
    id: 'freighter2', name: 'Cargo liner', kind: 'merchant', side: 'allied', art: () => art.freighterArt(1),
    length: 134, beam: 17.3, draft: 7.8, freeboard: 3.5, displacement: 10600, grt: 7100, maxSpeedKn: 11, accelTime: 120, turnRadius: 540,
    hp: 1600, noise: 141, sensors: { hydrophone: 0, lookout: 1800 }, guns: [],
  },
  freighter3: {
    id: 'freighter3', name: 'Tramp steamer', kind: 'merchant', side: 'allied', art: () => art.freighterArt(2),
    length: 140, beam: 17.3, draft: 7.9, freeboard: 3.2, displacement: 11000, grt: 4800, maxSpeedKn: 9, accelTime: 130, turnRadius: 560,
    hp: 1450, noise: 143, sensors: { hydrophone: 0, lookout: 1600 }, guns: [],
  },
  tanker: {
    id: 'tanker', name: 'Tanker', kind: 'merchant', side: 'allied', art: art.tankerArt,
    length: 140, beam: 19, draft: 8.4, freeboard: 2.6, displacement: 14000, grt: 8900, maxSpeedKn: 11, accelTime: 130, turnRadius: 600,
    hp: 1400, noise: 140, sensors: { hydrophone: 0, lookout: 1800 }, guns: [],
  },
  liberty: {
    id: 'liberty', name: 'Liberty ship', kind: 'merchant', side: 'allied', art: art.libertyArt,
    length: 135, beam: 17.4, draft: 8.4, freeboard: 3.6, displacement: 14245, grt: 7176, maxSpeedKn: 11, accelTime: 130, turnRadius: 560,
    hp: 1650, noise: 141, sensors: { hydrophone: 0, lookout: 1800 }, guns: [],
  },
  orecarrier: {
    id: 'orecarrier', name: 'Ore carrier', kind: 'merchant', side: 'allied', art: art.oreCarrierArt,
    length: 128, beam: 17, draft: 8.2, freeboard: 2.4, displacement: 12500, grt: 6100, maxSpeedKn: 9.5, accelTime: 140, turnRadius: 580,
    hp: 1150, noise: 142, sensors: { hydrophone: 0, lookout: 1700 }, guns: [],
  },
  rescue: {
    id: 'rescue', name: 'Convoy rescue ship', kind: 'merchant', side: 'allied', art: art.rescueShipArt, role: 'rescue',
    length: 80, beam: 12, draft: 4.5, freeboard: 3.4, displacement: 2400, grt: 1600, maxSpeedKn: 14, accelTime: 70, turnRadius: 300,
    hp: 900, noise: 134, sensors: { hydrophone: 0, lookout: 2000 }, guns: [],
  },
  type7: {
    id: 'type7', name: 'Type VIIC', kind: 'uboat', side: 'axis', art: art.type7Art,
    length: 67, beam: 6.2, draft: 4.7, freeboard: 1.0, displacement: 769, maxSpeedKn: 17.7, accelTime: 40, turnRadius: 260,
    hp: 620, noise: 118, sensors: { hydrophone: 2600, lookout: 2200, radar: 0 },
    guns: [{ mount: 'gunA', caliber: 88, arc: [-150 * deg, 150 * deg], traverse: 30 * deg, reload: 3.2, velocity: 420, range: 1800, damage: 60, spread: 0.012 }],
    torpedoes: { bow: 4, stern: 1, reloads: 9, reloadTime: 28, speedKn: 40, range: 3600, damage: 1050, wake: true },
    sub: { surfacedKn: 17.7, submergedKn: 7.6, silentKn: 3, periscopeDepth: 13, testDepth: 200, crushDepth: 270, battery: 100, diveTime: 30, hullHeight: 7.5, snorkel: false },
  },
  type9: {
    id: 'type9', name: 'Type IXC', kind: 'uboat', side: 'axis', art: art.type9Art,
    length: 76.8, beam: 6.8, draft: 4.7, freeboard: 1.1, displacement: 1120, maxSpeedKn: 18.2, accelTime: 48, turnRadius: 320,
    hp: 720, noise: 120, sensors: { hydrophone: 2700, lookout: 2200 },
    guns: [{ mount: 'gunA', caliber: 105, arc: [-150 * deg, 150 * deg], traverse: 26 * deg, reload: 3.8, velocity: 440, range: 2000, damage: 72, spread: 0.012 }],
    torpedoes: { bow: 4, stern: 2, reloads: 16, reloadTime: 30, speedKn: 40, range: 3600, damage: 1050, wake: true },
    sub: { surfacedKn: 18.2, submergedKn: 7.3, silentKn: 3, periscopeDepth: 13, testDepth: 200, crushDepth: 260, battery: 120, diveTime: 38, hullHeight: 7.8, snorkel: false },
  },
  type21: {
    id: 'type21', name: 'Type XXI Elektroboot', kind: 'uboat', side: 'axis', art: art.type21Art,
    length: 76.7, beam: 8.0, draft: 6.3, freeboard: 1.0, displacement: 1621, maxSpeedKn: 15.6, accelTime: 45, turnRadius: 300,
    hp: 780, noise: 110, sensors: { hydrophone: 3200, lookout: 2200, radar: 2000 },
    guns: [],
    torpedoes: { bow: 6, stern: 0, reloads: 17, reloadTime: 14, speedKn: 30, range: 3600, damage: 1050, wake: false },
    sub: { surfacedKn: 15.6, submergedKn: 17.2, silentKn: 6, periscopeDepth: 13, testDepth: 240, crushDepth: 320, battery: 260, diveTime: 26, hullHeight: 8.6, snorkel: true },
  },
};

export const knots = (kn: number) => kn * KNOT;
export const MERCHANT_CLASSES = ['freighter', 'freighter2', 'freighter3', 'tanker', 'orecarrier', 'liberty'];

/** convoy merchants by year: Liberty ships join the convoys from 1942 */
export function merchantPool(year: number): string[] {
  return ['freighter', 'freighter2', 'freighter3', 'tanker', 'orecarrier', ...(year >= 1942 ? ['liberty', 'liberty'] : [])];
}
/** AI escort classes by year, in assignment order (armed trawlers early, sloops and frigates later) */
export function escortPool(year: number): string[] {
  const p = ['corvette', 'destroyer', 'corvette'];
  if (year <= 1941) p.push('trawler');
  if (year >= 1942) p.push('sloop');
  if (year >= 1943) p.push('frigate');
  return p;
}

/** fictional merchant names in period style */
export const MERCHANT_NAMES = [
  'Empire Heron', 'Clan Mactavish', 'Port Hardy', 'San Arcadio', 'Fort Cedar Lake', 'Baron Kinnaird', 'Glenmoor', 'City of Ravenna',
  'Athelduke', 'Silver Laurel', 'Harbury', 'Ocean Freedom', 'Daleby', 'Elin K', 'Norse Princess', 'Manchester Merchant', 'Pacific Grove',
  'Empire Lytton', 'Kingsbury', 'Tuscan Star', 'Lady Glanely', 'Stanmore', 'Bornholm Bay', 'Coultarn', 'Hatimura', 'Selvistan',
];
export const ESCORT_NAMES = ['Hesperus', 'Vanoc', 'Walker', 'Starling', 'Kite', 'Wren', 'Pimpernel', 'Clematis', 'Snowflake', 'Sunflower', 'Loosestrife', 'Itchen', 'Jed', 'Tay', 'Spey', 'Rother'];
export const UBOAT_NAMES = ['U-213', 'U-334', 'U-407', 'U-411', 'U-436', 'U-519', 'U-571', 'U-594', 'U-618', 'U-642', 'U-709', 'U-731', 'U-762', 'U-814', 'U-861', 'U-927'];
