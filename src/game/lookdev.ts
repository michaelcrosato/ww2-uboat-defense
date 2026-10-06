// Test scenes. `?scene=fleet`: every vessel class side by side for art review.
// Deterministic look-dev scene (`?scene=lookdev`) for renderer comparisons: a fixed set of vessels,
// fires, a searchlight, a star-shell flare, lifeboats, loot crates and an aircraft around the player,
// placed relative to the player's spawn so it works in every theater. The App then runs a fixed number
// of fixed-dt frames (identical on every backend) and freezes.

import type { World } from './world';
import { VESSELS } from './vesselClasses';
import { Aircraft } from './aircraft';
import { fx } from '../core/math';
import type { Item } from '../meta/types';

export function buildLookdev(w: World) {
  const p = w.player;
  if (!p) return;
  fx.reseed(1);
  const x = p.pos.x, y = p.pos.y, h = p.heading;
  p.searchlightOn = true;
  p.searchlightYaw = 0.5;
  const burning = w.spawn(VESSELS.freighter, x + 130, y - 70, h, { name: 'SS Lookdev' });
  burning.ignite(4, 0, 1.2);
  burning.ignite(-12, 1, 0.8);
  w.spawn(VESSELS.tanker, x - 160, y + 95, h, { name: 'MV Lookdev' });
  const scope = w.spawn(VESSELS.type7, x + 70, y + 75, h + 0.4, { name: 'U-1', submerged: 12 });
  if (scope.sub) { scope.sub.orderedDepth = 12; scope.sub.periscopeUp = true; }
  w.spawn(VESSELS.type7, x - 90, y - 80, h - 0.3, { name: 'U-2' });
  const pr = w.projectiles;
  pr.flares.push({ x: x + 40, y: y - 40, z: 90, life: 1e9, max: 1e9, radius: 330, intensity: 3.4 });
  pr.launchBoats(x + 35, y + 55, 1, 'allied');
  const crate = (rarity: Item['rarity']) => ({ rarity, name: 'lookdev', uid: 'lookdev-' + rarity }) as unknown as Item;
  pr.layLoot(x - 30, y + 40, crate('common'));
  pr.layLoot(x + 5, y + 45, crate('legendary'));
  pr.aircraft.push(new Aircraft(w, 'catalina', x - 220, y - 120, x, y, 1e9, 0));
}

/** the 1941-42 Pacific fleets (`?scene=pacific`): US Navy on the left, Imperial Japanese Navy on the right */
export const PACIFIC_FLEET = [
  ['cv_yorktown', 'bb_colorado', 'bb_tennessee', 'bb_pennsylvania', 'bb_nevada', 'ag_utah', 'ca_neworleans', 'cl_brooklyn', 'cl_omaha', 'av_curtiss', 'ao_neosho', 'ar_vestal', 'cm_oglala', 'dd_farragut', 'dd_mahan', 'dd_wickes', 'ss_narwhal', 'ss_kohyoteki'],
  ['cv_akagi', 'cv_kaga', 'cv_soryu', 'cv_hiryu', 'bb_kongo', 'ca_tone', 'cl_nagara', 'dd_kagero', 'dd_yugumo'],
];

/** merchants on the left, warships and U-boats on the right, packed by beam; returns the grid centre */
export function buildFleet(w: World, x0 = 0, y0 = 0, pacific = false): { x: number; y: number } {
  const cols: string[][] = pacific ? PACIFIC_FLEET : [
    ['freighter', 'freighter2', 'freighter3', 'tanker', 'liberty', 'orecarrier', 'rescue'],
    ['escortcarrier', 'destroyer', 'sloop', 'frigate', 'corvette', 'trawler', 'type9', 'type7', 'type21'],
  ];
  const off = pacific ? 150 : 85;
  let maxY = 0;
  cols.forEach((col, c) => {
    let y = y0;
    for (const id of col) {
      const cls = VESSELS[id];
      y += cls.beam / 2 + 14;
      w.spawn(cls, x0 + (c === 0 ? -off : off), y, 0, { name: cls.name });
      y += cls.beam / 2 + 14;
    }
    maxY = Math.max(maxY, y);
  });
  // the three patrol aircraft, frozen in flight between the columns (drawn up-screen by their altitude)
  if (!pacific) (['swordfish', 'catalina', 'liberator'] as const).forEach((k, i) => {
    const y = y0 + 60 + i * 70;
    w.projectiles.aircraft.push(new Aircraft(w, k, x0, y, x0 + 100, y, 1e9, 0));
  });
  return { x: x0, y: y0 + maxY / 2 };
}
