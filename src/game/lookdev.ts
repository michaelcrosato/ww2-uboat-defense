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
