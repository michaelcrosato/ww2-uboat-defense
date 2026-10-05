// Drop tables: how many items a sinking / contract / boss yields and at what rarity. Weights follow
// the Diablo IV feel: mostly commons and magics, rares often enough to matter, legendaries a treat.

import type { Faction, Item, Rarity } from './types.ts';
import { rollItem, rollRarity, BASE_RARITY_WEIGHTS } from './items.ts';
import type { Rng } from '../core/math.ts';

export const RARITY_COLORS: Record<Rarity, string> = {
  common: '#c8c8c8', magic: '#6f9cff', rare: '#ffd84a', legendary: '#ff8c2a', unique: '#c9a46a',
};

export type DropSource = 'merchant' | 'tanker' | 'escort' | 'uboat' | 'contract' | 'boss';

/** [min, max] item count and a rarity weight multiplier per source */
const SOURCES: Record<DropSource, { count: [number, number]; chance: number; rarity: Partial<Record<Rarity, number>> }> = {
  merchant: { count: [0, 1], chance: 0.55, rarity: {} },
  tanker: { count: [1, 2], chance: 0.8, rarity: { rare: 1.3, legendary: 1.2 } },
  escort: { count: [1, 2], chance: 0.9, rarity: { magic: 1.2, rare: 1.5, legendary: 1.5 } },
  uboat: { count: [1, 2], chance: 0.9, rarity: { magic: 1.2, rare: 1.5, legendary: 1.5 } },
  contract: { count: [1, 3], chance: 1, rarity: { rare: 1.6, legendary: 2, unique: 1.5 } },
  boss: { count: [3, 5], chance: 1, rarity: { common: 0.3, rare: 2.5, legendary: 4, unique: 3 } },
};

export interface DropOpts { faction: Faction; source: DropSource; ilvl: number; lootFind?: number; mult?: number }

/** items dropped for `faction` (the player's side) by one source */
export function rollDrops(rng: Rng, o: DropOpts): Item[] {
  const src = SOURCES[o.source];
  const mult = Math.max(0, o.mult ?? 1);
  if (!rng.chance(Math.min(1, src.chance * mult))) return [];
  let n = rng.int(src.count[0], src.count[1]);
  // multipliers above 1 add whole extra rolls with the fractional part as a chance
  const extra = Math.max(0, mult - 1) * n;
  n += Math.floor(extra) + (rng.chance(extra % 1) ? 1 : 0);
  const w = { ...BASE_RARITY_WEIGHTS };
  for (const k in src.rarity) w[k as Rarity] *= src.rarity[k as Rarity]!;
  const out: Item[] = [];
  for (let i = 0; i < n; i++) {
    const rarity = rollRarity(rng, (o.lootFind ?? 0) + (mult - 1) * 25, w);
    out.push(rollItem(rng, { faction: o.faction, ilvl: o.ilvl, rarity }));
  }
  return out;
}
