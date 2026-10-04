// Money and experience: purchasable vessel classes (ids match src/game/vesselClasses.ts), vessel
// components with Mk I–V / Kriegsmarine refit tiers, repair and upgrade costs, and the XP curve.

import type { CaptainState, Faction, VesselState } from './types.ts';
import { StatBlock, type StatKey } from './stats.ts';

// ------------------------------------------------------------------ vessels
export interface VesselOffer { id: string; faction: Faction; name: string; price: number; minLevel: number; starter?: boolean; desc: string }
export const VESSEL_OFFERS: VesselOffer[] = [
  { id: 'corvette', faction: 'escort', name: 'Flower-class corvette', price: 0, minLevel: 1, starter: true, desc: 'Rolls on wet grass, but tough and nimble. Every escort captain starts here.' },
  { id: 'destroyer', faction: 'escort', name: 'V&W-class destroyer', price: 14000, minLevel: 6, desc: 'Old fleet destroyer refitted for convoy work: fast, gun-heavy, Hedgehog.' },
  { id: 'frigate', faction: 'escort', name: 'River-class frigate', price: 32000, minLevel: 14, desc: 'Purpose-built hunter with long legs, the best ASDIC and Squid.' },
  { id: 'type7', faction: 'uboat', name: 'Type VIIC', price: 0, minLevel: 1, starter: true, desc: 'The workhorse of the wolfpacks: cramped, wet, dependable.' },
  { id: 'type9', faction: 'uboat', name: 'Type IXC', price: 16000, minLevel: 6, desc: 'Long-range boat with six tubes and room for more eels.' },
  { id: 'type21', faction: 'uboat', name: 'Type XXI Elektroboot', price: 42000, minLevel: 16, desc: 'Streamlined, enormous batteries, fast and silent submerged.' },
];
export function starterVessel(faction: Faction): string { return VESSEL_OFFERS.find((v) => v.faction === faction && v.starter)!.id; }
export function vesselOffer(id: string): VesselOffer | undefined { return VESSEL_OFFERS.find((v) => v.id === id); }

// ------------------------------------------------------------------ components
export const MAX_TIER = 5;
type Bonus = Partial<Record<StatKey, number>>;
export interface Component {
  id: string; faction: Faction; name: string;
  /** tier names 0..5 */
  tiers: string[];
  /** bonus per tier (index 0 = stock, no bonus) */
  bonus: Bonus[];
  /** cost of the first upgrade; later tiers grow along COST_CURVE */
  baseCost: number;
}
/** bonus at tier t = per-tier value × t (linear, readable on the shipyard screen) */
const lin = (per: Bonus): Bonus[] => Array.from({ length: MAX_TIER + 1 }, (_, t) => {
  const o: Bonus = {};
  for (const k in per) o[k as StatKey] = Math.round((per[k as StatKey] ?? 0) * t * 10) / 10;
  return o;
});
const MK = ['Stock', 'Mk I', 'Mk II', 'Mk III', 'Mk IV', 'Mk V'];
export const COMPONENTS: Component[] = [
  { id: 'hull', faction: 'escort', name: 'Hull', tiers: MK, bonus: lin({ hull_hp_pct: 6, flooding_pct: -4 }), baseCost: 900 },
  { id: 'engine', faction: 'escort', name: 'Engine', tiers: MK, bonus: lin({ max_speed_pct: 2, accel_pct: 5 }), baseCost: 800 },
  { id: 'sonar', faction: 'escort', name: 'ASDIC', tiers: ['Type 123', 'Type 127', 'Type 128', 'Type 144', 'Type 145', 'Type 147'], bonus: lin({ sonar_range_pct: 5, sonar_accuracy_pct: 5 }), baseCost: 1000 },
  { id: 'guns', faction: 'escort', name: 'Guns', tiers: MK, bonus: lin({ gun_damage_pct: 5, gun_reload_pct: 3 }), baseCost: 800 },
  { id: 'asw', faction: 'escort', name: 'ASW weapons', tiers: MK, bonus: lin({ dc_damage_pct: 5, dc_capacity: 2 }), baseCost: 1000 },
  { id: 'electronics', faction: 'escort', name: 'Electronics', tiers: ['None', 'Type 286', 'Type 271', 'Type 272', 'Type 277', 'HF/DF + 277'], bonus: lin({ radar_range_pct: 8, lookout_range_pct: 3 }), baseCost: 900 },
  { id: 'hull', faction: 'uboat', name: 'Pressure hull', tiers: ['Stock', 'Werft I', 'Werft II', 'Werft III', 'Werft IV', 'Werft V'], bonus: lin({ hull_hp_pct: 5, test_depth_pct: 3 }), baseCost: 1000 },
  { id: 'diesels', faction: 'uboat', name: 'Diesels', tiers: ['Stock', 'Stufe 1', 'Stufe 2', 'Stufe 3', 'Stufe 4', 'Stufe 5'], bonus: lin({ surfaced_speed_pct: 2, recharge_pct: 6 }), baseCost: 800 },
  { id: 'battery', faction: 'uboat', name: 'Battery', tiers: ['Stock', 'AFA 1', 'AFA 2', 'AFA 3', 'AFA 4', 'AFA 5'], bonus: lin({ battery_pct: 6, battery_drain_pct: -2 }), baseCost: 900 },
  { id: 'hydrophones', faction: 'uboat', name: 'Hydrophones', tiers: ['GHG', 'GHG verb.', 'KDB', 'KDB verb.', 'Balkon', 'Balkon II'], bonus: lin({ sonar_range_pct: 5, sonar_accuracy_pct: 4 }), baseCost: 1000 },
  { id: 'torpedoes', faction: 'uboat', name: 'Torpedoes', tiers: ['G7a', 'G7a (TI)', 'G7e (TII)', 'G7e (TIII)', 'FAT', 'LUT'], bonus: lin({ torpedo_damage_pct: 5, torpedo_dud_reduction: 2 }), baseCost: 1100 },
  { id: 'deckgun', faction: 'uboat', name: 'Deck gun', tiers: ['Stock', 'Stufe 1', 'Stufe 2', 'Stufe 3', 'Stufe 4', 'Stufe 5'], bonus: lin({ gun_damage_pct: 5, gun_accuracy_pct: 3 }), baseCost: 700 },
];
export function componentsFor(faction: Faction): Component[] { return COMPONENTS.filter((c) => c.faction === faction); }
export function component(faction: Faction, id: string): Component | undefined { return COMPONENTS.find((c) => c.faction === faction && c.id === id); }

/** price of upgrading `comp` from tier-1 to `tier` */
export function upgradeCost(comp: Component, tier: number): number {
  if (tier < 1 || tier > MAX_TIER) return Infinity;
  return Math.round((comp.baseCost * Math.pow(tier, 1.7)) / 10) * 10;
}

export function componentStats(vessel: VesselState, faction: Faction): StatBlock {
  const out = new StatBlock();
  for (const c of componentsFor(faction)) {
    const t = Math.max(0, Math.min(MAX_TIER, vessel.tiers[c.id] ?? 0));
    const b = c.bonus[t];
    for (const k in b) out.add(k as StatKey, b[k as StatKey] ?? 0);
  }
  return out;
}

/** cost to repair the carried hull damage (scales with the vessel's price class) */
export function repairCost(captain: CaptainState): number {
  const offer = vesselOffer(captain.vessel.cls);
  const scale = 1500 + (offer?.price ?? 0) * 0.12;
  return Math.round((captain.vessel.hullDamage * scale) / 10) * 10;
}

// ------------------------------------------------------------------ experience
export const LEVEL_CAP = 50;
/** XP needed to go from `level` to `level + 1` */
export function xpForLevel(level: number): number {
  if (level >= LEVEL_CAP) return Infinity;
  return Math.round(300 * Math.pow(level, 1.55) / 10) * 10;
}
/** points granted when reaching `level` */
export function levelGrants(level: number): { skill: number; ability: number } {
  return { skill: 1 + (level % 5 === 0 ? 1 : 0), ability: 1 + (level % 5 === 0 ? 1 : 0) };
}
/** small stat growth from experience alone */
export function levelStats(level: number): StatBlock {
  const s = new StatBlock();
  s.add('hull_hp_pct', (level - 1) * 0.6);
  s.add('repair_pct', (level - 1) * 0.5);
  return s;
}
