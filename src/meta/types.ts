// Contracts between the meta layer (progression, loot, contracts, economy) and the rest of the
// game. Gameplay produces a MissionResult and reads a StatBlock + ability loadout; UI renders
// these shapes. Implementations live in the other files of src/meta/.

import type { StatKey } from './stats';

export type Faction = 'escort' | 'uboat';
export type Rarity = 'common' | 'magic' | 'rare' | 'legendary' | 'unique';
export const RARITIES: Rarity[] = ['common', 'magic', 'rare', 'legendary', 'unique'];

/** equipment slots per faction */
export type EscortSlot = 'hull' | 'engine' | 'sonar' | 'guns' | 'asw' | 'countermeasures' | 'electronics' | 'officer' | 'mascot';
export type UboatSlot = 'hull' | 'diesels' | 'battery' | 'hydrophones' | 'torpedoes' | 'deckgun' | 'countermeasures' | 'electronics' | 'officer' | 'mascot';
export type Slot = EscortSlot | UboatSlot;

export interface Affix {
  stat: StatKey;
  value: number;
  tier: number;           // 1 = best
  /** min/max of this tier for roll-quality display */
  min: number; max: number;
}

export interface LegendaryPower {
  id: string;             // gameplay hook id, e.g. 'pow_split_torpedo'
  value: number;          // magnitude used by the hook
  text: string;           // resolved description
}

export interface Item {
  uid: string;
  base: string;           // base type id
  name: string;
  slot: Slot;
  faction: Faction;
  rarity: Rarity;
  ilvl: number;
  implicit?: Affix;
  affixes: Affix[];
  power?: LegendaryPower;
  uniqueId?: string;
  flavor?: string;
  /** salvage value in funds */
  value: number;
  /** crafting: how many times an affix was re-rolled at the shipyard */
  rerolls?: number;
}

export type AbilityId =
  // escort
  | 'asdic_sweep' | 'dc_pattern' | 'hedgehog' | 'star_shell' | 'flank_speed' | 'smoke_screen' | 'snowflake'
  | 'creeping_attack' | 'huff_duff' | 'ram' | 'air_support' | 'foxer'
  // u-boat
  | 'crash_dive' | 'torpedo_spread' | 'silent_running' | 'bold_decoy' | 'wolfpack_call' | 'deck_gun'
  | 'emergency_blow' | 'deep_dive' | 'periscope_scan' | 'zaunkoenig' | 'snorkel' | 'aphrodite'
  // shared
  | 'damage_control';

export interface AbilityModifier {
  id: string;
  name: string;
  desc: string;
  /** param changes: add then multiply */
  effects: Record<string, { add?: number; mul?: number }>;
  flags?: string[];
}

export interface AbilityDef {
  id: AbilityId;
  faction: Faction | 'both';
  name: string;
  /** short historical/flavor line */
  flavor: string;
  /** description template; {param} is replaced by the resolved value */
  desc: string;
  /** a single printable glyph used as an icon fallback */
  glyph: string;
  unlockLevel: number;
  minYear?: number;
  maxRank: number;        // usually 5
  cooldown: number[];     // seconds per rank (index 0 = rank 1)
  charges?: number[];     // uses per mission per rank (undefined = unlimited, cooldown only)
  params: Record<string, number[]>;
  /** params that scale with ability_power_pct */
  powerParams?: string[];
  /** two mutually exclusive upgrades chosen at rank 3 */
  modifiers: AbilityModifier[];
}

export interface AbilityState { rank: number; modifier?: string }

export interface TreeNode {
  id: string;
  kind: 'start' | 'small' | 'notable' | 'keystone' | 'ability';
  name: string;
  x: number; y: number;   // layout units (UI scales)
  stats: { stat: StatKey; value: number }[];
  flag?: string;          // keystone flag read by gameplay, e.g. 'ks_silent_hunter'
  desc?: string;          // for keystones / notables
  links: string[];        // neighbour ids (undirected)
  ability?: AbilityId;    // 'ability' nodes unlock an ability
  cluster?: string;       // branch name for UI grouping
}
export interface SkillTree { faction: Faction; nodes: TreeNode[]; startId: string }

export type MutatorId = string;
export interface Mutator {
  id: MutatorId;
  name: string;
  desc: string;
  /** arena config overrides (keys from arenaConfig, e.g. 'arena.weather') */
  arena?: Record<string, number | string | boolean>;
  /** stat modifications applied to the enemy side during the mission */
  enemy?: Partial<Record<StatKey, number>>;
  /** stat modifications applied to the player during the mission */
  player?: Partial<Record<StatKey, number>>;
  bountyMult: number;     // e.g. 1.25
  lootMult: number;       // quantity/rarity boost
  /** only offered to this side (omitted = both) */
  faction?: Faction;
}

export type ObjectiveType =
  | 'sink_tonnage' | 'sink_ships' | 'sink_escort' | 'sink_tanker' | 'escape' // u-boat
  | 'deliver_pct' | 'sink_uboats' | 'no_losses' | 'rescue' | 'protect_ship' // escort
  | 'survive' | 'night_only' | 'no_ping' | 'time_limit';

export interface Objective {
  type: ObjectiveType;
  target: number;
  label: string;
  reward: number;         // funds
  optional: boolean;
}

export interface Contract {
  id: string;
  faction: Faction;
  title: string;          // e.g. 'Convoy HX-229 — Escort Group B4'
  briefing: string;
  theater: string;        // theater id
  tier: number;           // difficulty / item level band
  arena: Record<string, number | string | boolean>;  // full arena config for the mission
  objectives: Objective[];
  mutators: Mutator[];
  baseBounty: number;
  expiresAfter?: number;  // patrols
}

export interface MissionResult {
  side: Faction;
  outcome: 'victory' | 'defeat' | 'withdrew' | 'sunk';
  durationSec: number;
  // u-boat
  tonnageSunk: number;
  shipsSunk: { kind: string; grt: number; name: string }[];
  escortsSunk: number;
  // escort
  merchantsTotal: number;
  merchantsLost: number;
  tonnageDelivered: number;
  tonnageLost: number;
  uboatsSunk: number;
  uboatsDamaged: number;
  survivorsRescued: number;
  // both
  playerHullDamage: number;       // 0..1 at mission end
  playerSunk: boolean;
  nightFraction: number;          // share of mission time in darkness
  pingsUsed: number;
  torpedoesFired: number;
  torpedoHits: number;
  depthChargesDropped: number;
  lootCollected: Item[];
  contractId?: string;
}

export interface VesselState {
  cls: string;                          // e.g. 'destroyer', 'type7'
  tiers: Record<string, number>;        // component upgrade tiers, see economy.ts COMPONENTS
  hullDamage: number;                   // 0..1 carried between patrols
}

export interface CaptainState {
  faction: Faction;
  name: string;
  level: number;
  xp: number;
  funds: number;
  skillPoints: number;        // passive tree points
  abilityPoints: number;      // ability rank points
  tree: string[];             // allocated node ids
  abilities: Partial<Record<AbilityId, AbilityState>>;
  loadout: (AbilityId | null)[];   // 6 bar slots
  inventory: Item[];
  equipped: Partial<Record<Slot, Item>>;
  vessel: VesselState;
  contracts: Contract[];      // offered
  record: { patrols: number; tonnage: number; kills: number; delivered: number; lost: number; best: number };
}

export interface Profile {
  version: number;
  created: number;
  escort: CaptainState;
  uboat: CaptainState;
  settings?: Record<string, unknown>;
}
