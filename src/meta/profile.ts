// The player's profile: one captain per side with level, funds, skill tree, abilities, equipment,
// vessel and contract board. All mutations go through these functions (the UI never edits the
// shapes directly), and the profile round-trips through localStorage with a version number.

import type { AbilityId, CaptainState, Contract, Faction, Item, MissionResult, Profile, Slot } from './types.ts';
import { StatBlock } from './stats.ts';
import { ABILITIES, MAX_RANK, MODIFIER_RANK } from './abilities.ts';
import { itemStats, rollItem, SLOTS } from './items.ts';
import { rollDrops, type DropSource } from './loot.ts';
import { TREES, canAllocate, canRefund, treeStats } from './tree.ts';
import { LEVEL_CAP, MAX_TIER, component, componentStats, levelGrants, levelStats, repairCost, starterVessel, upgradeCost, vesselOffer, xpForLevel } from './economy.ts';
import { contractIlvl, evaluateContract, generateContracts, type ContractEvaluation } from './contracts.ts';
import { Rng } from '../core/math.ts';

export const PROFILE_VERSION = 1;
export const STORAGE_KEY = 'wolfpack.profile.v1';
export const INVENTORY_CAP = 60;
export const LOADOUT_SIZE = 6;

const STARTING_ABILITIES: Record<Faction, AbilityId[]> = {
  escort: ['dc_pattern', 'asdic_sweep', 'star_shell', 'damage_control'],
  uboat: ['torpedo_spread', 'crash_dive', 'silent_running', 'damage_control'],
};
const CAPTAIN_NAMES: Record<Faction, string[]> = {
  escort: ['Cdr. A. Hargreave', 'Lt Cdr. J. Marlowe', 'Cdr. R. Tennant', 'Lt Cdr. E. Ashby'],
  uboat: ['Kptlt. H. Brenner', 'Oblt. K. Falke', 'Kptlt. W. Reinholt', 'Oblt. F. Seiler'],
};

// ------------------------------------------------------------------ creation
export function newCaptain(faction: Faction, rng = new Rng(faction === 'escort' ? 41 : 39)): CaptainState {
  const c: CaptainState = {
    faction, name: rng.pick(CAPTAIN_NAMES[faction]), level: 1, xp: 0, funds: 1500,
    skillPoints: 1, abilityPoints: 0, tree: [], abilities: {}, loadout: Array(LOADOUT_SIZE).fill(null),
    inventory: [], equipped: {},
    vessel: { cls: starterVessel(faction), tiers: {}, hullDamage: 0 },
    contracts: [],
    record: { patrols: 0, tonnage: 0, kills: 0, delivered: 0, lost: 0, best: 0 },
  };
  STARTING_ABILITIES[faction].forEach((id, i) => { c.abilities[id] = { rank: 1 }; c.loadout[i] = id; });
  // a few worn common items to start with
  const slots: Slot[] = faction === 'escort' ? ['sonar', 'asw', 'guns'] : ['torpedoes', 'hydrophones', 'battery'];
  for (const slot of slots) c.equipped[slot] = rollItem(rng, { faction, ilvl: 1, rarity: 'common', slot });
  c.contracts = generateContracts(rng, c, 4);
  return c;
}

export function newProfile(seed = Date.now() % 1e9): Profile {
  const rng = new Rng(seed);
  return { version: PROFILE_VERSION, created: Date.now(), escort: newCaptain('escort', rng), uboat: newCaptain('uboat', rng) };
}

// ------------------------------------------------------------------ stats
/** everything that feeds gameplay: level growth + vessel components + equipment + tree (+ extra, e.g. mutators) */
export function computeStats(c: CaptainState, extra?: StatBlock): StatBlock {
  const s = new StatBlock();
  s.merge(levelStats(c.level));
  s.merge(componentStats(c.vessel, c.faction));
  for (const slot in c.equipped) { const it = c.equipped[slot as Slot]; if (it) s.merge(itemStats(it)); }
  s.merge(treeStats(TREES[c.faction], c.tree));
  if (extra) s.merge(extra);
  return s;
}

// ------------------------------------------------------------------ missions
export interface MissionSummary {
  evaluation: ContractEvaluation | null;
  payout: number;
  xp: number;
  levelsGained: number;
  loot: Item[];
  salvaged: number;
}

const SOURCE_OF: Record<string, DropSource> = { merchant: 'merchant', tanker: 'tanker', escort: 'escort', uboat: 'uboat' };

/** add XP, levelling up (grants points) until the bar no longer fills */
export function addXp(c: CaptainState, xp: number): number {
  let gained = 0;
  c.xp += Math.max(0, Math.round(xp));
  while (c.level < LEVEL_CAP && c.xp >= xpForLevel(c.level)) {
    c.xp -= xpForLevel(c.level);
    c.level++;
    gained++;
    const g = levelGrants(c.level);
    c.skillPoints += g.skill;
    c.abilityPoints += g.ability;
  }
  if (c.level >= LEVEL_CAP) c.xp = 0;
  return gained;
}

/** inventory with a cap: overflow is salvaged straight into funds; returns funds gained */
export function addLoot(c: CaptainState, items: Item[]): number {
  let funds = 0;
  for (const it of items) {
    if (c.inventory.length < INVENTORY_CAP) c.inventory.push(it);
    else funds += it.value;
  }
  c.funds += funds;
  return funds;
}

export function applyMissionResult(p: Profile, faction: Faction, contract: Contract | null, r: MissionResult, rng: Rng): MissionSummary {
  const c = p[faction];
  const stats = computeStats(c);
  let payout: number, xp: number, evaluation: ContractEvaluation | null = null;
  if (contract) {
    evaluation = evaluateContract(contract, r, stats);
    payout = evaluation.payout; xp = evaluation.xp;
  } else {
    // free play: simple bounties
    const base = faction === 'escort' ? (r.merchantsTotal - r.merchantsLost) * 120 + r.uboatsSunk * 600 : r.tonnageSunk * 0.08 + r.escortsSunk * 600;
    payout = Math.round(base * stats.mul('funds_pct') * (r.playerSunk ? 0.25 : 1));
    xp = Math.round((100 + payout * 0.2) * stats.mul('xp_pct'));
  }
  c.funds += payout;
  const levelsGained = addXp(c, xp);
  // record
  c.record.patrols++;
  if (faction === 'uboat') { c.record.tonnage += r.tonnageSunk; c.record.kills += r.shipsSunk.length; c.record.best = Math.max(c.record.best, r.tonnageSunk); }
  else { c.record.kills += r.uboatsSunk; c.record.delivered += r.merchantsTotal - r.merchantsLost; c.record.lost += r.merchantsLost; c.record.best = Math.max(c.record.best, r.uboatsSunk); }
  // damage carried home (a sunk ship comes back as a write-off needing a full refit)
  c.vessel.hullDamage = r.playerSunk ? 1 : Math.max(0, Math.min(1, r.playerHullDamage));
  // loot: picked-up crates + drops for sinkings + contract reward
  const ilvl = contract ? contractIlvl(contract) : Math.min(60, 2 + c.level);
  const lootFind = stats.get('loot_find_pct');
  const mult = contract ? contract.mutators.reduce((m, x) => m * x.lootMult, 1) : 1;
  const loot: Item[] = [...r.lootCollected];
  if (faction === 'uboat') for (const s of r.shipsSunk) loot.push(...rollDrops(rng, { faction, source: SOURCE_OF[s.kind] ?? 'merchant', ilvl, lootFind, mult }));
  else for (let i = 0; i < r.uboatsSunk; i++) loot.push(...rollDrops(rng, { faction, source: 'uboat', ilvl, lootFind, mult }));
  if (contract && evaluation?.success) loot.push(...rollDrops(rng, { faction, source: 'contract', ilvl, lootFind, mult }));
  const salvaged = addLoot(c, loot);
  // the board: the flown contract leaves, the rest age, then refill to 4
  if (contract) c.contracts = c.contracts.filter((x) => x.id !== contract.id);
  c.contracts = c.contracts.filter((x) => (x.expiresAfter = (x.expiresAfter ?? 3) - 1) > 0);
  c.contracts.push(...generateContracts(rng, c, Math.max(0, 4 - c.contracts.length)));
  return { evaluation, payout, xp, levelsGained, loot, salvaged };
}

// ------------------------------------------------------------------ equipment
export function equip(c: CaptainState, uid: string): boolean {
  const i = c.inventory.findIndex((x) => x.uid === uid);
  if (i < 0) return false;
  const it = c.inventory[i];
  if (it.faction !== c.faction || !SLOTS[c.faction].includes(it.slot)) return false;
  c.inventory.splice(i, 1);
  const prev = c.equipped[it.slot];
  if (prev) c.inventory.push(prev);
  c.equipped[it.slot] = it;
  return true;
}
export function unequip(c: CaptainState, slot: Slot): boolean {
  const it = c.equipped[slot];
  if (!it || c.inventory.length >= INVENTORY_CAP) return false;
  delete c.equipped[slot];
  c.inventory.push(it);
  return true;
}
export function salvage(c: CaptainState, uid: string): number {
  const i = c.inventory.findIndex((x) => x.uid === uid);
  if (i < 0) return 0;
  const v = c.inventory[i].value;
  c.inventory.splice(i, 1);
  c.funds += v;
  return v;
}

// ------------------------------------------------------------------ skill tree
export function allocateNode(c: CaptainState, id: string): boolean {
  if (c.skillPoints <= 0 || !canAllocate(TREES[c.faction], c.tree, id)) return false;
  c.tree.push(id);
  c.skillPoints--;
  return true;
}
export function refundNode(c: CaptainState, id: string): boolean {
  if (!canRefund(TREES[c.faction], c.tree, id)) return false;
  c.tree = c.tree.filter((x) => x !== id);
  c.skillPoints++;
  return true;
}

// ------------------------------------------------------------------ abilities
export function canRankUp(c: CaptainState, id: AbilityId): boolean {
  const def = ABILITIES[id];
  if (!def || (def.faction !== c.faction && def.faction !== 'both')) return false;
  const rank = c.abilities[id]?.rank ?? 0;
  return c.abilityPoints > 0 && c.level >= def.unlockLevel && rank < Math.min(def.maxRank, MAX_RANK);
}
export function rankUpAbility(c: CaptainState, id: AbilityId): boolean {
  if (!canRankUp(c, id)) return false;
  const st = c.abilities[id] ?? { rank: 0 };
  c.abilities[id] = { ...st, rank: st.rank + 1 };
  c.abilityPoints--;
  return true;
}
export function setModifier(c: CaptainState, id: AbilityId, modifier: string | undefined): boolean {
  const st = c.abilities[id];
  if (!st || st.rank < MODIFIER_RANK) return false;
  if (modifier !== undefined && !ABILITIES[id].modifiers.some((m) => m.id === modifier)) return false;
  c.abilities[id] = { ...st, modifier };
  return true;
}
/** six bar slots; every ability must be learned (rank ≥ 1); duplicates removed */
export function setLoadout(c: CaptainState, loadout: (AbilityId | null)[]): boolean {
  const seen = new Set<AbilityId>();
  const out: (AbilityId | null)[] = [];
  for (let i = 0; i < LOADOUT_SIZE; i++) {
    const id = loadout[i] ?? null;
    if (id && ((c.abilities[id]?.rank ?? 0) < 1 || seen.has(id))) return false;
    if (id) seen.add(id);
    out.push(id);
  }
  c.loadout = out;
  return true;
}

// ------------------------------------------------------------------ shipyard
export function repair(c: CaptainState): boolean {
  const cost = repairCost(c);
  if (cost <= 0 || c.funds < cost) return false;
  c.funds -= cost;
  c.vessel.hullDamage = 0;
  return true;
}
export function buyUpgrade(c: CaptainState, compId: string): boolean {
  const comp = component(c.faction, compId);
  if (!comp) return false;
  const next = (c.vessel.tiers[compId] ?? 0) + 1;
  if (next > MAX_TIER) return false;
  const cost = upgradeCost(comp, next);
  if (c.funds < cost) return false;
  c.funds -= cost;
  c.vessel.tiers[compId] = next;
  return true;
}
/** a new hull keeps half of the component tiers (refit transfer) */
export function buyVessel(c: CaptainState, cls: string): boolean {
  const offer = vesselOffer(cls);
  if (!offer || offer.faction !== c.faction || offer.id === c.vessel.cls || c.level < offer.minLevel || c.funds < offer.price) return false;
  c.funds -= offer.price;
  const tiers: Record<string, number> = {};
  for (const k in c.vessel.tiers) tiers[k] = Math.floor(c.vessel.tiers[k] / 2);
  c.vessel = { cls, tiers, hullDamage: 0 };
  return true;
}

// ------------------------------------------------------------------ persistence
interface KV { get(k: string): string | null; set(k: string, v: string): void }
const memory = new Map<string, string>();
/** localStorage when available (browser), an in-memory map otherwise (Node tests, private mode) */
export const metaStorage: KV = {
  get(k) {
    try { if (typeof localStorage !== 'undefined') return localStorage.getItem(k); } catch { /* blocked */ }
    return memory.get(k) ?? null;
  },
  set(k, v) {
    try { if (typeof localStorage !== 'undefined') { localStorage.setItem(k, v); return; } } catch { /* blocked */ }
    memory.set(k, v);
  },
};

/** upgrade older saves in place (one step per version) */
function migrate(p: Profile): Profile {
  // v1 is the first format; future versions add steps here: if (p.version === 1) { …; p.version = 2; }
  return p;
}

export function saveProfile(p: Profile, store: KV = metaStorage): void {
  store.set(STORAGE_KEY, JSON.stringify(p));
}
export function loadProfile(store: KV = metaStorage): Profile | null {
  const raw = store.get(STORAGE_KEY);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Profile;
    if (!p || typeof p.version !== 'number' || !p.escort || !p.uboat) return null;
    if (p.version > PROFILE_VERSION) return null;
    return migrate(p);
  } catch { return null; }
}
