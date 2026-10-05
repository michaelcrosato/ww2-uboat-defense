// The customizable arena: one open-ocean battlefield where a convoy runs a gauntlet. Every
// parameter here appears in the Arena setup screen and can be changed live from the dev menu.

import { ConfigStore, opts, type SettingDef } from '../core/config';
import { THEATERS } from './theaters';

export const ARENA_DEFS: SettingDef[] = [
  { key: 'arena.side', group: 'Mission', label: 'Play as', type: 'select', def: 'escort', options: opts(['escort', 'The Escort (Allies)'], ['uboat', 'The U-Boat (Kriegsmarine)']) },
  { key: 'arena.escortClass', group: 'Mission', label: 'Escort vessel', type: 'select', def: 'destroyer',
    options: opts(['destroyer', 'Destroyer (fast, guns, Hedgehog)'], ['corvette', 'Flower-class corvette (nimble, tough)'], ['frigate', 'River-class frigate (sensors, Squid)'],
      ['sloop', 'Black Swan sloop (hunter, twin 4-inch)'], ['trawler', 'Armed trawler (slow, few charges)']) },
  { key: 'arena.uboatClass', group: 'Mission', label: 'U-boat type', type: 'select', def: 'type7',
    options: opts(['type7', 'Type VIIC (balanced)'], ['type9', 'Type IXC (long range, 6 tubes)'], ['type21', 'Type XXI Elektroboot (fast submerged)']) },
  { key: 'arena.year', group: 'Mission', label: 'Year (technology)', type: 'range', def: 1942, min: 1939, max: 1945, step: 1,
    help: 'Gates radar, Hedgehog, HF/DF, acoustic torpedoes, Pillenwerfer decoys and snorkels.' },
  { key: 'arena.difficulty', group: 'Mission', label: 'Difficulty', type: 'range', def: 1, min: 0.5, max: 2, step: 0.1, fmt: (v) => v.toFixed(1) + 'x' },
  { key: 'arena.seed', group: 'Mission', label: 'Seed', type: 'range', def: 1941, min: 1, max: 99999, step: 1 },

  { key: 'arena.theater', group: 'Environment', label: 'Theater', type: 'select', def: 'north_atlantic', options: THEATERS.map((t) => ({ value: t.id, label: t.name })) },
  { key: 'arena.hour', group: 'Environment', label: 'Time of day', type: 'range', def: 23, min: 0, max: 24, step: 0.25,
    fmt: (v) => `${String(Math.floor(v) % 24).padStart(2, '0')}:${String(Math.round((v % 1) * 60)).padStart(2, '0')}` },
  { key: 'arena.timeFlow', group: 'Environment', label: 'Clock speed', type: 'range', def: 0, min: 0, max: 240, step: 5, fmt: (v) => (v === 0 ? 'Frozen' : v + 'x') },
  { key: 'arena.moon', group: 'Environment', label: 'Moon phase', type: 'range', def: 0.5, min: 0, max: 1, step: 0.05,
    fmt: (v) => (v < 0.06 || v > 0.94 ? 'New' : Math.abs(v - 0.5) < 0.06 ? 'Full' : v < 0.5 ? 'Waxing' : 'Waning') },
  { key: 'arena.season', group: 'Environment', label: 'Season', type: 'select', def: '0', options: opts(['-1', 'Winter'], ['0', 'Spring / Autumn'], ['1', 'Summer']) },
  { key: 'arena.weather', group: 'Environment', label: 'Weather', type: 'select', def: 'clear', options: opts(['clear', 'Clear'], ['overcast', 'Overcast'], ['rain', 'Rain'], ['storm', 'Storm'], ['fog', 'Fog'], ['snow', 'Snow']) },
  { key: 'arena.seaState', group: 'Environment', label: 'Sea state (Beaufort)', type: 'range', def: 4, min: 0, max: 10, step: 0.5 },
  { key: 'arena.windDir', group: 'Environment', label: 'Wind from', type: 'range', def: 250, min: 0, max: 359, step: 5, unit: '°' },
  { key: 'arena.swell', group: 'Environment', label: 'Background swell', type: 'range', def: 1.6, min: 0, max: 6, step: 0.1, unit: 'm' },
  { key: 'arena.layer', group: 'Environment', label: 'Thermal layer depth', type: 'range', def: 70, min: 0, max: 200, step: 5, unit: 'm',
    help: 'A U-boat below the layer is much harder to hear or ping. 0 = no layer.' },

  { key: 'arena.convoy', group: 'Forces', label: 'Merchant ships', type: 'range', def: 9, min: 0, max: 24, step: 1 },
  { key: 'arena.columns', group: 'Forces', label: 'Convoy columns', type: 'range', def: 3, min: 1, max: 6, step: 1 },
  { key: 'arena.convoySpeed', group: 'Forces', label: 'Convoy speed', type: 'range', def: 8, min: 5, max: 14, step: 0.5, unit: 'kn' },
  { key: 'arena.zigzag', group: 'Forces', label: 'Convoy zig-zag', type: 'bool', def: true },
  { key: 'arena.escorts', group: 'Forces', label: 'AI escorts', type: 'range', def: 3, min: 0, max: 8, step: 1 },
  { key: 'arena.uboats', group: 'Forces', label: 'AI U-boats (wolfpack)', type: 'range', def: 3, min: 0, max: 8, step: 1 },
  { key: 'arena.aircraft', group: 'Forces', label: 'Air patrols', type: 'select', def: 'gap', options: opts(['none', 'None (air gap)'], ['gap', 'Occasional'], ['carrier', 'Escort carrier'], ['heavy', 'Constant cover']) },
  { key: 'arena.survivors', group: 'Forces', label: 'Survivors & lifeboats', type: 'bool', def: true },
  { key: 'arena.size', group: 'Forces', label: 'Arena length', type: 'range', def: 7, min: 3, max: 16, step: 0.5, unit: 'km' },
  { key: 'arena.islands', group: 'Forces', label: 'Rocks & islands', type: 'range', def: 0, min: 0, max: 8, step: 1 },
  { key: 'arena.lighthouse', group: 'Forces', label: 'Lighthouse', type: 'bool', def: false },
];

export const arena = new ConfigStore('wolfpack.arena.v1', ARENA_DEFS);
