// Unit tests for the meta layer: node --test src/meta/meta.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Rng } from '../core/math.ts';
import { STAT_KEYS, StatBlock, type StatKey } from './stats.ts';
import { ABILITIES, ABILITY_IDS, resolveAbility } from './abilities.ts';
import { AFFIX_STATS, BASES, POWER_BY_ID, POWERS, UNIQUES, affixPool, itemStats, rerollAffix, rollItem, tierRange } from './items.ts';
import { rollDrops, RARITY_COLORS } from './loot.ts';
import { ESCORT_TREE, UBOAT_TREE, canAllocate, canRefund, treeStats } from './tree.ts';
import { COMPONENTS, componentStats, upgradeCost, xpForLevel, LEVEL_CAP } from './economy.ts';
import { ARENA_SPEC, MUTATORS, evaluateContract, generateContracts, isValidArenaValue } from './contracts.ts';
import {
  addXp, allocateNode, applyMissionResult, buyUpgrade, computeStats, equip, loadProfile, newCaptain, newProfile,
  rankUpAbility, refundNode, rerollItem, saveProfile, setLoadout, setModifier, unequip,
} from './profile.ts';
import type { Faction, MissionResult, Rarity, SkillTree } from './types.ts';

const KEYS = new Set<string>(STAT_KEYS);
const FACTIONS: Faction[] = ['escort', 'uboat'];

// ------------------------------------------------------------------ abilities
test('ability defs: params per rank and modifiers reference real params', () => {
  for (const id of ABILITY_IDS) {
    const d = ABILITIES[id];
    assert.equal(d.cooldown.length, d.maxRank, `${id} cooldown`);
    if (d.charges) assert.equal(d.charges.length, d.maxRank, `${id} charges`);
    for (const [p, arr] of Object.entries(d.params)) assert.equal(arr.length, d.maxRank, `${id}.${p}`);
    for (const m of d.modifiers) for (const p of Object.keys(m.effects)) {
      assert.ok(p in d.params || p === 'cooldown' || p === 'charges', `${id} modifier ${m.id} → ${p}`);
    }
  }
});

test('resolveAbility: rank, modifier and ability power math', () => {
  const d = ABILITIES.dc_pattern;
  const r1 = resolveAbility(d, { rank: 1 });
  const r5 = resolveAbility(d, { rank: 5 });
  assert.equal(r1.params.charges, 5);
  assert.equal(r5.params.charges, 10);
  const heavy = resolveAbility(d, { rank: 3, modifier: 'dc_heavy' });
  assert.equal(heavy.params.charges, d.params.charges[2] - 1);
  assert.ok(Math.abs(heavy.params.damage_mult - d.params.damage_mult[2] * 1.35) < 1e-9);
  const s = new StatBlock();
  s.add('ability_power_pct', 20);
  const powered = resolveAbility(d, { rank: 1 }, s);
  assert.ok(powered.params.damage_mult > r1.params.damage_mult);
});

// ------------------------------------------------------------------ items
test('every affix stat and base implicit uses a known stat key', () => {
  for (const k of Object.keys(AFFIX_STATS)) assert.ok(KEYS.has(k), k);
  for (const b of BASES) assert.ok(KEYS.has(b.implicit.stat), b.id);
  for (const f of FACTIONS) for (const b of BASES.filter((x) => x.faction === f)) assert.ok(affixPool(f, b.slot).length >= 5, `pool ${f}/${b.slot}`);
});

test('2000 random items are valid', () => {
  const rng = new Rng(7);
  const counts: Record<Rarity, [number, number]> = { common: [0, 1], magic: [1, 2], rare: [3, 4], legendary: [3, 3], unique: [1, 4] };
  for (let i = 0; i < 2000; i++) {
    const faction = FACTIONS[i % 2];
    const it = rollItem(rng, { faction, ilvl: 1 + (i % 60), lootFind: (i % 5) * 40 });
    assert.ok(it.name.trim().length > 0, 'name');
    assert.equal(it.faction, faction);
    const [lo, hi] = counts[it.rarity];
    assert.ok(it.affixes.length >= lo && it.affixes.length <= hi, `${it.rarity} affixes ${it.affixes.length}`);
    const seen = new Set<string>();
    for (const a of it.affixes) {
      assert.ok(KEYS.has(a.stat), a.stat);
      assert.ok(a.tier >= 1 && a.tier <= 5, 'tier');
      assert.ok(a.value >= a.min - 1e-9 && a.value <= a.max + 1e-9, `${a.stat} ${a.value} in [${a.min}, ${a.max}]`);
      assert.ok(!seen.has(a.stat), 'duplicate affix');
      seen.add(a.stat);
    }
    if (it.rarity === 'legendary' || it.rarity === 'unique') {
      assert.ok(it.power, 'power');
      const p = POWER_BY_ID.get(it.power!.id)!;
      assert.equal(p.faction, faction, 'power faction');
      assert.ok(!it.power!.text.includes('{'), 'power text resolved');
    } else assert.equal(it.power, undefined);
    assert.ok(it.value > 0);
    const st = itemStats(it);
    for (const k of Object.keys(st.v)) assert.ok(KEYS.has(k));
  }
});

test('affix tiers: T1 better than T5, good-down stats negative', () => {
  for (const k of Object.keys(AFFIX_STATS) as StatKey[]) {
    const t1 = tierRange(k, 1), t5 = tierRange(k, 5);
    assert.ok(Math.abs(t1[1]) >= Math.abs(t5[1]), k);
  }
  assert.ok(tierRange('noise_pct', 1)[1] < 0);
});

test('uniques and powers are well formed', () => {
  for (const u of UNIQUES) {
    const b = BASES.find((x) => x.id === u.base);
    assert.ok(b, u.id);
    assert.ok(!u.affixes.some((a) => a.stat === b!.implicit.stat), `${u.id} repeats its implicit`);
    const p = POWER_BY_ID.get(u.power.id);
    assert.ok(p && p.faction === b!.faction, `${u.id} power faction`);
  }
  assert.equal(POWERS.length, 16);
  for (const f of FACTIONS) assert.ok(UNIQUES.filter((u) => BASES.find((b) => b.id === u.base)!.faction === f).length >= 8);
});

test('rerollAffix changes one affix and counts rerolls', () => {
  const rng = new Rng(3);
  const it = rollItem(rng, { faction: 'escort', ilvl: 30, rarity: 'rare' });
  const r = rerollAffix(it, 0, rng);
  assert.equal(r.rerolls, 1);
  assert.equal(r.affixes.length, it.affixes.length);
  assert.deepEqual(r.affixes.slice(1), it.affixes.slice(1));
  assert.equal(new Set(r.affixes.map((a) => a.stat)).size, r.affixes.length);
});

test('loot: drops scale with source and colours exist', () => {
  const rng = new Rng(11);
  let merchant = 0, boss = 0;
  for (let i = 0; i < 300; i++) {
    merchant += rollDrops(rng, { faction: 'uboat', source: 'merchant', ilvl: 10 }).length;
    boss += rollDrops(rng, { faction: 'uboat', source: 'boss', ilvl: 10 }).length;
  }
  assert.ok(boss > merchant * 3);
  for (const r of ['common', 'magic', 'rare', 'legendary', 'unique'] as Rarity[]) assert.match(RARITY_COLORS[r], /^#[0-9a-f]{6}$/);
});

// ------------------------------------------------------------------ trees
function checkTree(t: SkillTree, flags: string[]) {
  const ids = new Map(t.nodes.map((n) => [n.id, n]));
  assert.equal(ids.size, t.nodes.length, 'unique ids');
  assert.ok(t.nodes.length >= 70 && t.nodes.length <= 90, `node count ${t.nodes.length}`);
  for (const n of t.nodes) {
    assert.ok(Math.abs(n.x) <= 1000 && Math.abs(n.y) <= 1000, 'bounds');
    for (const l of n.links) assert.ok(ids.get(l)?.links.includes(n.id), `symmetric ${n.id}-${l}`);
    for (const s of n.stats) assert.ok(KEYS.has(s.stat), s.stat);
  }
  for (let i = 0; i < t.nodes.length; i++) for (let j = i + 1; j < t.nodes.length; j++) {
    const a = t.nodes[i], b = t.nodes[j];
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 55, `overlap ${a.id} ${b.id}`);
  }
  // all reachable from start
  const seen = new Set([t.startId]), q = [t.startId];
  while (q.length) for (const l of ids.get(q.pop()!)!.links) if (!seen.has(l)) { seen.add(l); q.push(l); }
  assert.equal(seen.size, t.nodes.length, 'reachable');
  const have = new Set(t.nodes.filter((n) => n.flag).map((n) => n.flag));
  for (const f of flags) assert.ok(have.has(f), f);
}
test('escort tree', () => checkTree(ESCORT_TREE, ['ks_hunter_killer', 'ks_shepherd', 'ks_iron_bow', 'ks_star_gazer', 'ks_silent_listener', 'ks_gunnery_school']));
test('u-boat tree', () => checkTree(UBOAT_TREE, ['ks_silent_hunter', 'ks_iron_coffin', 'ks_night_surface', 'ks_one_torpedo', 'ks_wolf_leader', 'ks_ghost']));

test('canAllocate / canRefund keep the build connected', () => {
  const t = ESCORT_TREE;
  const first = t.nodes.find((n) => n.links.includes(t.startId))!;
  const second = t.nodes.find((n) => n.links.includes(first.id) && n.id !== t.startId)!;
  assert.ok(canAllocate(t, [], first.id));
  assert.ok(!canAllocate(t, [], second.id));
  const alloc = [first.id, second.id];
  assert.ok(!canRefund(t, alloc, first.id), 'would orphan the second node');
  assert.ok(canRefund(t, alloc, second.id));
  const s = treeStats(t, alloc);
  assert.ok(Object.keys(s.v).length > 0);
});

// ------------------------------------------------------------------ economy
test('economy curves', () => {
  for (const c of COMPONENTS) for (let t = 2; t <= 5; t++) assert.ok(upgradeCost(c, t) > upgradeCost(c, t - 1));
  for (let l = 2; l < LEVEL_CAP; l++) assert.ok(xpForLevel(l) > xpForLevel(l - 1));
  const s = componentStats({ cls: 'corvette', tiers: { hull: 3 }, hullDamage: 0 }, 'escort');
  assert.equal(s.get('hull_hp_pct'), 18);
});

// ------------------------------------------------------------------ contracts
test('arena spec mirrors src/game/arenaConfig.ts', () => {
  const src = readFileSync(new URL('../game/arenaConfig.ts', import.meta.url), 'utf8');
  const keys = [...src.matchAll(/key: '(arena\.[a-zA-Z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(keys.sort(), Object.keys(ARENA_SPEC).sort());
  for (const m of src.matchAll(/key: '(arena\.[a-zA-Z]+)'[^\n]*?type: 'range', def: ([\d.]+), min: ([\d.]+), max: ([\d.]+), step: ([\d.]+)/g)) {
    const sp = ARENA_SPEC[m[1]];
    assert.equal(sp.type, 'range', m[1]);
    if (sp.type === 'range') assert.deepEqual([sp.def, sp.min, sp.max, sp.step], [+m[2], +m[3], +m[4], +m[5]], m[1]);
  }
});

test('200 contracts per faction: valid arena configs and objectives', () => {
  const rng = new Rng(5);
  assert.ok(MUTATORS.length >= 16);
  for (const f of FACTIONS) {
    const cap = newCaptain(f, rng);
    for (let i = 0; i < 200; i++) {
      cap.level = 1 + (i % 50);
      const [c] = generateContracts(rng, cap, 1);
      assert.equal(c.faction, f);
      assert.equal(c.arena['arena.side'], f);
      assert.deepEqual(Object.keys(c.arena).sort(), Object.keys(ARENA_SPEC).sort());
      for (const [k, v] of Object.entries(c.arena)) assert.ok(isValidArenaValue(k, v), `${k}=${v}`);
      assert.ok(c.objectives.some((o) => !o.optional));
      assert.ok(c.title && c.briefing && c.baseBounty > 0);
      for (const m of c.mutators) assert.ok(!m.faction || m.faction === f);
    }
  }
});

function result(over: Partial<MissionResult>): MissionResult {
  return {
    side: 'escort', outcome: 'victory', durationSec: 900, tonnageSunk: 0, shipsSunk: [], escortsSunk: 0,
    merchantsTotal: 10, merchantsLost: 0, tonnageDelivered: 60000, tonnageLost: 0, uboatsSunk: 0, uboatsDamaged: 0,
    survivorsRescued: 0, playerHullDamage: 0.1, playerSunk: false, nightFraction: 0.5, pingsUsed: 10, torpedoesFired: 0,
    torpedoHits: 0, depthChargesDropped: 0, lootCollected: [], ...over,
  };
}

test('evaluateContract rewards better results and handles defeat', () => {
  const rng = new Rng(9);
  const esc = generateContracts(rng, newCaptain('escort', rng), 1)[0];
  const good = evaluateContract(esc, result({ merchantsLost: 0, uboatsSunk: 2 }));
  const poor = evaluateContract(esc, result({ merchantsLost: 6 }));
  const lost = evaluateContract(esc, result({ merchantsLost: 2, playerSunk: true, outcome: 'sunk' }));
  assert.ok(good.success && good.payout > poor.payout);
  assert.ok(!lost.success && lost.payout < good.payout);
  const ub = generateContracts(rng, newCaptain('uboat', rng), 1)[0];
  const sunk = [{ kind: 'freighter', grt: 7000, name: 'a' }, { kind: 'tanker', grt: 9000, name: 'b' }];
  const big = evaluateContract(ub, result({ side: 'uboat', tonnageSunk: 60000, shipsSunk: [...sunk, ...sunk, ...sunk, ...sunk], escortsSunk: 1 }));
  const small = evaluateContract(ub, result({ side: 'uboat', tonnageSunk: 7000, shipsSunk: [sunk[0]] }));
  assert.ok(big.payout > small.payout && big.success);
  assert.ok(big.xp > small.xp);
});

// ------------------------------------------------------------------ profile
test('profile: stats, missions, loadout, tree, save/load', () => {
  const rng = new Rng(21);
  const p = newProfile(4);
  const c = p.escort;
  assert.equal(c.vessel.cls, 'corvette');
  assert.ok(c.loadout.includes('dc_pattern') && c.loadout.includes('damage_control'));
  const s = computeStats(c);
  for (const k of Object.keys(s.v)) assert.ok(KEYS.has(k));
  assert.ok(Object.values(s.v).every((v) => isFinite(v!)));
  // mission → levels + loot
  const contract = c.contracts[0];
  const before = c.level;
  const sum = applyMissionResult(p, 'escort', contract, result({ uboatsSunk: 3, merchantsLost: 0 }), rng);
  addXp(c, 50000);
  assert.ok(c.level > before && sum.payout > 0);
  assert.ok(c.skillPoints > 0 && c.abilityPoints > 0);
  assert.ok(c.inventory.length > 0, 'loot added');
  assert.ok(!c.contracts.some((x) => x.id === contract.id) && c.contracts.length === 4);
  // equip / unequip
  const it = c.inventory[0];
  assert.ok(equip(c, it.uid));
  assert.equal(c.equipped[it.slot]?.uid, it.uid);
  assert.ok(unequip(c, it.slot));
  assert.ok(c.inventory.some((x) => x.uid === it.uid));
  // tree
  const first = ESCORT_TREE.nodes.find((n) => n.links.includes(ESCORT_TREE.startId))!;
  assert.ok(allocateNode(c, first.id));
  assert.ok(refundNode(c, first.id));
  // abilities
  assert.ok(rankUpAbility(c, 'dc_pattern'));
  c.abilityPoints += 5;
  rankUpAbility(c, 'dc_pattern'); rankUpAbility(c, 'dc_pattern');
  assert.ok(setModifier(c, 'dc_pattern', 'dc_heavy'));
  assert.ok(!setLoadout(c, ['hedgehog', null, null, null, null, null]), 'unlearned ability');
  assert.ok(setLoadout(c, ['dc_pattern', 'asdic_sweep', null, null, null, null]));
  // shipyard
  c.funds = 1e6;
  assert.ok(buyUpgrade(c, 'hull'));
  assert.equal(c.vessel.tiers.hull, 1);
  // save/load round trip (in-memory store)
  const mem = new Map<string, string>();
  const store = { get: (k: string) => mem.get(k) ?? null, set: (k: string, v: string) => { mem.set(k, v); } };
  saveProfile(p, store);
  const back = loadProfile(store);
  assert.deepEqual(back, JSON.parse(JSON.stringify(p)));
});

test('profile: in-mission drops, free play, shipyard re-roll', () => {
  const rng = new Rng(77);
  const p = newProfile(9);
  const c = p.uboat;
  // in-mission drops: only the collected crates arrive (no extra sinking rolls)
  const picked = rollItem(rng, { faction: 'uboat', ilvl: 10, rarity: 'rare' });
  const ships = Array.from({ length: 6 }, (_, i) => ({ kind: 'tanker', grt: 9000, name: 'S' + i }));
  const contract = { ...c.contracts[0], objectives: c.contracts[0].objectives.map((o) => ({ ...o, optional: true })) };
  const sum = applyMissionResult(p, 'uboat', contract, result({ side: 'uboat', tonnageSunk: 54000, shipsSunk: ships, lootCollected: [picked], outcome: 'defeat' }), rng, { inMissionDrops: true });
  assert.deepEqual(sum.loot.map((x) => x.uid), [picked.uid]);
  // free play: half XP, no pay, nothing else changes
  const funds = c.funds, inv = c.inventory.length, board = c.contracts.map((x) => x.id).join();
  const fp = applyMissionResult(p, 'uboat', null, result({ side: 'uboat', tonnageSunk: 20000, outcome: 'victory' }), rng, { freePlay: true });
  assert.ok(fp.xp > 0 && fp.payout === 0 && fp.loot.length === 0);
  assert.equal(c.funds, funds); assert.equal(c.inventory.length, inv); assert.equal(c.contracts.map((x) => x.id).join(), board);
  // re-roll costs funds and bumps the counter
  const it = rollItem(rng, { faction: 'uboat', ilvl: 20, rarity: 'rare' });
  c.inventory.push(it);
  c.funds = 0;
  assert.ok(!rerollItem(c, it.uid, 0, rng), 'cannot afford');
  c.funds = 1e6;
  assert.ok(rerollItem(c, it.uid, 0, rng));
  assert.equal(c.inventory.find((x) => x.uid === it.uid)!.rerolls, 1);
  assert.ok(c.funds < 1e6);
});
