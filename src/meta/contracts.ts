// Contracts: the mission board. Each contract is a fully specified arena (every arena key valid),
// a theater, objectives with rewards and Path-of-Exile style mutators that make the patrol harder
// in exchange for bigger bounties and better loot. `evaluateContract` turns a MissionResult into
// pay, XP and an itemised breakdown.

import type { CaptainState, Contract, Faction, MissionResult, Mutator, Objective, ObjectiveType } from './types.ts';
import type { StatBlock } from './stats.ts';
import { THEATERS } from '../game/theaters.ts';
import type { Rng } from '../core/math.ts';

// ------------------------------------------------------------------ arena spec
/**
 * Mirror of src/game/arenaConfig.ts (keys, ranges, options, defaults) so contracts can be built and
 * validated without the DOM-side config store. meta.test.ts checks it against arenaConfig.ts.
 */
type Spec =
  | { type: 'range'; def: number; min: number; max: number; step: number }
  | { type: 'select'; def: string; options: string[] }
  | { type: 'bool'; def: boolean };
const R = (def: number, min: number, max: number, step: number): Spec => ({ type: 'range', def, min, max, step });
const Sel = (def: string, options: string[]): Spec => ({ type: 'select', def, options });
const Bo = (def: boolean): Spec => ({ type: 'bool', def });
export const ARENA_SPEC: Record<string, Spec> = {
  'arena.side': Sel('escort', ['escort', 'uboat']),
  'arena.escortClass': Sel('destroyer', ['destroyer', 'corvette', 'frigate', 'sloop', 'trawler']),
  'arena.uboatClass': Sel('type7', ['type7', 'type9', 'type21']),
  'arena.uboatStart': Sel('auto', ['auto', 'submerged', 'surfaced']),
  'arena.year': R(1942, 1939, 1945, 1),
  'arena.difficulty': R(1, 0.5, 2, 0.1),
  'arena.seed': R(1941, 1, 99999, 1),
  'arena.theater': Sel('north_atlantic', THEATERS.map((t) => t.id)),
  'arena.hour': R(23, 0, 24, 0.25),
  'arena.timeFlow': R(0, 0, 240, 5),
  'arena.moon': R(0.5, 0, 1, 0.05),
  'arena.season': Sel('0', ['-1', '0', '1']),
  'arena.weather': Sel('clear', ['clear', 'overcast', 'rain', 'storm', 'fog', 'snow']),
  'arena.seaState': R(4, 0, 10, 0.5),
  'arena.windDir': R(250, 0, 359, 5),
  'arena.swell': R(1.6, 0, 6, 0.1),
  'arena.layer': R(70, 0, 200, 5),
  'arena.convoy': R(9, 0, 24, 1),
  'arena.columns': R(3, 1, 6, 1),
  'arena.convoySpeed': R(8, 5, 14, 0.5),
  'arena.zigzag': Bo(true),
  'arena.escorts': R(3, 0, 8, 1),
  'arena.uboats': R(3, 0, 8, 1),
  'arena.aircraft': Sel('gap', ['none', 'gap', 'carrier', 'heavy']),
  'arena.survivors': Bo(true),
  'arena.size': R(7, 3, 16, 0.5),
  'arena.islands': R(0, 0, 8, 1),
  'arena.lighthouse': Bo(false),
};

/** clamp + snap a value to the spec; returns the spec default for unusable values */
export function sanitizeArenaValue(key: string, v: number | string | boolean): number | string | boolean {
  const sp = ARENA_SPEC[key];
  if (!sp) throw new Error('unknown arena key ' + key);
  if (sp.type === 'bool') return typeof v === 'boolean' ? v : sp.def;
  if (sp.type === 'select') return sp.options.includes(String(v)) ? String(v) : sp.def;
  const n = Number(v);
  if (!isFinite(n)) return sp.def;
  const snapped = Math.round((Math.min(sp.max, Math.max(sp.min, n)) - sp.min) / sp.step) * sp.step + sp.min;
  return Math.round(Math.min(sp.max, snapped) * 1000) / 1000;
}
export function isValidArenaValue(key: string, v: unknown): boolean {
  const sp = ARENA_SPEC[key];
  if (!sp) return false;
  if (sp.type === 'bool') return typeof v === 'boolean';
  if (sp.type === 'select') return typeof v === 'string' && sp.options.includes(v);
  if (typeof v !== 'number' || v < sp.min - 1e-9 || v > sp.max + 1e-9) return false;
  const k = (v - sp.min) / sp.step;
  return Math.abs(k - Math.round(k)) < 1e-6;
}
export function defaultArena(): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  for (const k in ARENA_SPEC) out[k] = ARENA_SPEC[k].def;
  return out;
}

// ------------------------------------------------------------------ mutators
export const MUTATORS: Mutator[] = [
  { id: 'experienced_escorts', faction: 'uboat', name: 'Experienced Escorts', desc: 'A veteran escort group: +25% enemy sonar range, +15% sonar accuracy.', enemy: { sonar_range_pct: 25, sonar_accuracy_pct: 15 }, bountyMult: 1.3, lootMult: 1.2 },
  { id: 'strong_escort', faction: 'uboat', name: 'Close Escort Reinforced', desc: 'Six escorts screen the convoy.', arena: { 'arena.escorts': 6 }, bountyMult: 1.35, lootMult: 1.25 },
  { id: 'escort_carrier', faction: 'uboat', name: 'Escort Carrier Present', desc: 'Swordfish patrol overhead all day.', arena: { 'arena.aircraft': 'carrier' }, bountyMult: 1.35, lootMult: 1.25 },
  { id: 'torpedo_crisis', faction: 'uboat', name: 'Torpedo Crisis', desc: 'Faulty pistols: +15% dud chance.', player: { torpedo_dud_reduction: -15 }, bountyMult: 1.25, lootMult: 1.15 },
  { id: 'fast_convoy', faction: 'uboat', name: 'Fast Convoy', desc: 'The convoy makes 11 knots.', arena: { 'arena.convoySpeed': 11 }, bountyMult: 1.2, lootMult: 1.1 },
  { id: 'radar_era', faction: 'uboat', name: 'Centimetric Radar', desc: 'Late-war escorts carry radar that sees periscopes.', arena: { 'arena.year': 1944 }, enemy: { radar_range_pct: 30 }, bountyMult: 1.25, lootMult: 1.2 },
  { id: 'short_eels', faction: 'uboat', name: 'Short of Eels', desc: 'Sailed with two fewer reloads.', player: { torpedo_capacity: -2 }, bountyMult: 1.2, lootMult: 1.1 },
  { id: 'veteran_wolves', faction: 'escort', name: 'Veteran Wolves', desc: 'Ace commanders: U-boats run 15% quieter and hit 20% harder.', enemy: { noise_pct: -15, torpedo_damage_pct: 20 }, bountyMult: 1.3, lootMult: 1.2 },
  { id: 'wolfpack_six', faction: 'escort', name: 'Wolfpack of Six', desc: 'Six U-boats are gathering ahead of the convoy.', arena: { 'arena.uboats': 6 }, bountyMult: 1.4, lootMult: 1.3 },
  { id: 'air_gap', faction: 'escort', name: 'The Air Gap', desc: 'Beyond the reach of shore-based aircraft.', arena: { 'arena.aircraft': 'none' }, bountyMult: 1.2, lootMult: 1.1 },
  { id: 'thin_escort', faction: 'escort', name: 'Thin Escort', desc: 'Only one other escort is available.', arena: { 'arena.escorts': 1 }, bountyMult: 1.3, lootMult: 1.2 },
  { id: 'thermal_layer', faction: 'escort', name: 'Sharp Thermal Layer', desc: 'A strong layer at 45 m hides deep boats from ASDIC.', arena: { 'arena.layer': 45 }, bountyMult: 1.15, lootMult: 1.1 },
  { id: 'short_charges', faction: 'escort', name: 'Short of Depth Charges', desc: 'Sailed with eight fewer charges.', player: { dc_capacity: -8 }, bountyMult: 1.2, lootMult: 1.1 },
  { id: 'heavy_weather', name: 'Heavy Weather', desc: 'Gale force 8 and a storm: green water over the bow.', arena: { 'arena.weather': 'storm', 'arena.seaState': 8 }, bountyMult: 1.25, lootMult: 1.15 },
  { id: 'moonless', name: 'Moonless Night', desc: 'New moon, no stars: lookouts see almost nothing.', arena: { 'arena.moon': 0, 'arena.hour': 1 }, bountyMult: 1.15, lootMult: 1.1 },
  { id: 'fog_bank', name: 'Fog Bank', desc: 'Thick fog rolls over the convoy route.', arena: { 'arena.weather': 'fog' }, bountyMult: 1.2, lootMult: 1.1 },
  { id: 'stragglers', name: 'Stragglers', desc: 'A large, loose convoy that does not zig-zag.', arena: { 'arena.convoy': 16, 'arena.columns': 5, 'arena.zigzag': false }, bountyMult: 1.1, lootMult: 1.25 },
  { id: 'green_crew', name: 'Green Crew', desc: 'Half the hands are on their first patrol: -25% repair speed, +15% cooldowns.', player: { repair_pct: -25, ability_cooldown_pct: 15 }, bountyMult: 1.3, lootMult: 1.2 },
  { id: 'big_convoy', name: 'Big Convoy', desc: 'Twenty merchants in five columns.', arena: { 'arena.convoy': 20, 'arena.columns': 5 }, bountyMult: 1.1, lootMult: 1.3 },
  { id: 'night_action', name: 'Night Action', desc: 'Contact is expected in the middle watch.', arena: { 'arena.hour': 2 }, bountyMult: 1.15, lootMult: 1.1 },
];
export const MUTATOR_BY_ID = new Map(MUTATORS.map((m) => [m.id, m]));
export function mutatorsFor(faction: Faction): Mutator[] { return MUTATORS.filter((m) => !m.faction || m.faction === faction); }

// ------------------------------------------------------------------ generation
const GROUPS = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'C1', 'C2', 'C3', 'C4', 'C5'];
const GRIDS = ['AK', 'AL', 'BC', 'BD', 'BE', 'CF', 'CG', 'DH', 'DT', 'ED', 'EE'];
const WEATHER_W: [string, number][] = [['clear', 4], ['overcast', 3], ['rain', 2], ['storm', 1], ['fog', 1], ['snow', 0.6]];

export function contractTier(level: number): number { return Math.max(1, Math.min(12, 1 + Math.floor(level / 4))); }
export function contractIlvl(c: Contract): number { return Math.min(60, c.tier * 4 + 2); }

let contractCounter = 0;

export function generateContracts(rng: Rng, captain: CaptainState, count = 4): Contract[] {
  const out: Contract[] = [];
  for (let i = 0; i < count; i++) out.push(generateContract(rng, captain));
  return out;
}

export function generateContract(rng: Rng, captain: CaptainState): Contract {
  const faction = captain.faction, level = captain.level;
  const tier = Math.max(1, Math.min(12, contractTier(level) + rng.int(-1, 1)));
  const th = rng.pick(THEATERS);
  const a = defaultArena();
  a['arena.side'] = faction;
  if (faction === 'escort') a['arena.escortClass'] = captain.vessel.cls;
  else a['arena.uboatClass'] = captain.vessel.cls;
  a['arena.year'] = 1940 + Math.min(5, Math.floor(level / 8) + rng.int(0, 1));
  a['arena.difficulty'] = 0.8 + tier * 0.08 + rng.range(-0.05, 0.05);
  a['arena.seed'] = rng.int(1, 99999);
  a['arena.theater'] = th.id;
  a['arena.hour'] = rng.pick([22, 23, 0, 1, 2, 3, 4, 5, 6, 7, 12, 14, 17, 19, 20, 21]);
  a['arena.moon'] = rng.range(0, 1);
  a['arena.season'] = th.id === 'arctic' ? '-1' : rng.pick(['-1', '0', '1']);
  a['arena.weather'] = th.id === 'arctic' && rng.chance(0.4) ? 'snow' : rng.weighted(WEATHER_W, (w) => w[1])[0];
  a['arena.seaState'] = a['arena.weather'] === 'storm' ? rng.range(7, 9) : rng.range(1.5, 6);
  a['arena.windDir'] = rng.range(0, 355);
  a['arena.swell'] = rng.range(0.6, 3);
  a['arena.layer'] = rng.chance(0.75) ? rng.range(40, 140) : 0;
  a['arena.convoy'] = rng.int(6, 10 + Math.min(8, tier));
  a['arena.columns'] = Math.max(2, Math.min(6, Math.round(Number(a['arena.convoy']) / 3.5)));
  a['arena.convoySpeed'] = rng.range(6.5, 9.5);
  a['arena.zigzag'] = rng.chance(0.7);
  a['arena.escorts'] = faction === 'uboat' ? Math.min(8, 2 + Math.floor(tier / 3) + rng.int(0, 1)) : rng.int(2, 4);
  a['arena.uboats'] = faction === 'escort' ? Math.min(8, 1 + Math.floor(tier / 3) + rng.int(0, 1)) : rng.int(0, 2);
  const air: Record<string, number> = { none: 3, gap: 4, carrier: tier > 4 ? 2 : 0.5, heavy: tier > 8 ? 1 : 0.2 };
  a['arena.aircraft'] = rng.weighted(Object.keys(air), (x) => air[x]);
  a['arena.survivors'] = true;
  a['arena.size'] = rng.range(6, 9);
  a['arena.islands'] = th.id === 'mediterranean' || th.id === 'caribbean' ? rng.int(0, 3) : 0;
  a['arena.lighthouse'] = false;
  a['arena.timeFlow'] = 0;

  // mutators: more of them on higher tiers
  const pool = [...mutatorsFor(faction)];
  const nMut = rng.int(0, Math.min(3, 1 + Math.floor(tier / 3)));
  const mutators: Mutator[] = [];
  for (let i = 0; i < nMut && pool.length; i++) {
    const m = pool.splice(Math.floor(rng.next() * pool.length), 1)[0];
    // never stack two mutators that set the same arena key
    if (m.arena && mutators.some((o) => o.arena && Object.keys(m.arena!).some((k) => k in o.arena!))) continue;
    mutators.push(m);
  }
  for (const m of mutators) for (const k in m.arena ?? {}) a[k] = m.arena![k];
  for (const k in a) a[k] = sanitizeArenaValue(k, a[k]);
  a['arena.side'] = faction;

  const bounty = mutators.reduce((b, m) => b * m.bountyMult, 1);
  const baseBounty = Math.round((1200 + tier * 450) * bounty / 10) * 10;
  const objectives = makeObjectives(rng, faction, tier, a);
  const id = `c${tier}-${(contractCounter++).toString(36)}-${rng.int(0, 1e6).toString(36)}`;
  let title: string, briefing: string;
  if (faction === 'escort') {
    const num = rng.int(70, 240);
    title = `Convoy ${th.convoyPrefix}-${num} — Escort Group ${rng.pick(GROUPS)}`;
    briefing = `${a['arena.convoy']} merchants bound through the ${th.region}. Admiralty expects ${a['arena.uboats']} U-boats on the route. ` +
      `Bring them through: ${lcFirst(objectives[0].label)}.`;
  } else {
    title = `Patrol ${rng.pick(GRIDS)} ${rng.int(10, 99)} — ${th.name}`;
    briefing = `BdU reports a convoy of ${a['arena.convoy']} ships with ${a['arena.escorts']} escorts in the ${th.region}. ` +
      `Attack at your discretion: ${lcFirst(objectives[0].label)}.`;
  }
  if (mutators.length) briefing += ' Intelligence: ' + mutators.map((m) => m.name).join(', ') + '.';
  return { id, faction, title, briefing, theater: th.id, tier, arena: a, objectives, mutators, baseBounty, expiresAfter: rng.int(2, 4) };
}

const lcFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

function obj(type: ObjectiveType, target: number, label: string, reward: number, optional: boolean): Objective {
  return { type, target, label, reward: Math.round(reward / 10) * 10, optional };
}

function makeObjectives(rng: Rng, faction: Faction, tier: number, a: Record<string, number | string | boolean>): Objective[] {
  const pay = 300 + tier * 120;
  const out: Objective[] = [];
  if (faction === 'escort') {
    const pct = Math.min(95, 55 + tier * 3 + rng.int(0, 10));
    out.push(obj('deliver_pct', pct, `Deliver ${pct}% of the convoy`, 0, false));
    const opts: Objective[] = [
      obj('sink_uboats', Math.max(1, Math.round(Number(a['arena.uboats']) / 3)), `Sink ${Math.max(1, Math.round(Number(a['arena.uboats']) / 3))} U-boat(s)`, pay * 1.4, true),
      obj('no_losses', 0, 'Lose no merchant ships', pay * 1.6, true),
      obj('rescue', 10 + tier * 2, `Rescue ${10 + tier * 2} survivors`, pay, true),
      obj('no_ping', 20 + tier * 2, `Use at most ${20 + tier * 2} ASDIC pings`, pay * 0.8, true),
      obj('survive', 0, 'Bring your ship home', pay * 0.6, true),
    ];
    for (let n = rng.int(1, 2); n > 0 && opts.length; n--) out.push(opts.splice(Math.floor(rng.next() * opts.length), 1)[0]);
  } else {
    const grt = Math.round((5000 + tier * 3500 + rng.int(0, 4000)) / 500) * 500;
    out.push(obj('sink_tonnage', grt, `Sink ${grt.toLocaleString('en-GB')} GRT`, 0, false));
    const opts: Objective[] = [
      obj('sink_tanker', 1, 'Sink a tanker', pay * 1.2, true),
      obj('sink_escort', 1, 'Sink an escort', pay * 1.8, true),
      obj('escape', 0, 'Escape the hunt', pay * 0.6, true),
      obj('sink_ships', 3 + Math.floor(tier / 3), `Sink ${3 + Math.floor(tier / 3)} ships`, pay * 1.2, true),
      obj('night_only', 70, 'Attack under cover of darkness (70% of the time)', pay * 0.8, true),
    ];
    for (let n = rng.int(1, 2); n > 0 && opts.length; n--) out.push(opts.splice(Math.floor(rng.next() * opts.length), 1)[0]);
  }
  return out;
}

// ------------------------------------------------------------------ evaluation
export interface ObjectiveResult { objective: Objective; achieved: boolean; value: number }
export interface ContractEvaluation {
  success: boolean;
  payout: number;
  xp: number;
  breakdown: { label: string; amount: number }[];
  objectives: ObjectiveResult[];
}

export function deliveredPct(r: MissionResult): number {
  if (r.merchantsTotal <= 0) return 100;
  return ((r.merchantsTotal - r.merchantsLost) / r.merchantsTotal) * 100;
}

export function objectiveValue(type: ObjectiveType, r: MissionResult): number {
  switch (type) {
    case 'sink_tonnage': return r.tonnageSunk;
    case 'sink_ships': return r.shipsSunk.length;
    case 'sink_escort': return r.escortsSunk;
    case 'sink_tanker': return r.shipsSunk.filter((s) => s.kind === 'tanker').length;
    case 'escape': return r.playerSunk || r.outcome === 'sunk' ? 0 : 1;
    case 'deliver_pct': return deliveredPct(r);
    case 'sink_uboats': return r.uboatsSunk;
    case 'no_losses': case 'protect_ship': return r.merchantsLost;
    case 'rescue': return r.survivorsRescued;
    case 'survive': return r.playerSunk ? 0 : 1;
    case 'night_only': return r.nightFraction * 100;
    case 'no_ping': return r.pingsUsed;
    case 'time_limit': return r.durationSec;
  }
}

/** "at most" objectives; everything else is "at least" */
const AT_MOST = new Set<ObjectiveType>(['no_losses', 'protect_ship', 'no_ping', 'time_limit']);
function achieved(o: Objective, v: number): boolean {
  if (o.type === 'escape' || o.type === 'survive') return v >= 1;
  return AT_MOST.has(o.type) ? v <= o.target : v >= o.target;
}

export function evaluateContract(c: Contract, r: MissionResult, stats?: StatBlock): ContractEvaluation {
  const objectives = c.objectives.map((o) => { const v = objectiveValue(o.type, r); return { objective: o, value: v, achieved: achieved(o, v) }; });
  const defeat = r.outcome === 'defeat' || r.outcome === 'sunk' || r.playerSunk;
  const main = objectives.filter((o) => !o.objective.optional);
  const success = !defeat && main.every((o) => o.achieved);
  const bd: { label: string; amount: number }[] = [];
  const tierMul = 1 + c.tier * 0.12;
  if (c.faction === 'escort') {
    const d = deliveredPct(r);
    const share = main.length ? Math.min(1, d / Math.max(1, main[0].objective.target)) : d / 100;
    bd.push({ label: `Convoy delivered (${Math.round(d)}%)`, amount: Math.round(c.baseBounty * share * (success ? 1 : 0.5)) });
    if (r.uboatsSunk) bd.push({ label: `U-boats sunk ×${r.uboatsSunk}`, amount: Math.round(r.uboatsSunk * 700 * tierMul) });
    if (r.uboatsDamaged) bd.push({ label: `U-boats damaged ×${r.uboatsDamaged}`, amount: Math.round(r.uboatsDamaged * 150 * tierMul) });
    if (r.survivorsRescued) bd.push({ label: `Survivors rescued ×${r.survivorsRescued}`, amount: Math.round(r.survivorsRescued * 25 * tierMul) });
  } else {
    let tankers = 0, merchants = 0;
    for (const s of r.shipsSunk) { if (s.kind === 'tanker') tankers += s.grt; else if (s.kind !== 'escort') merchants += s.grt; }
    if (merchants) bd.push({ label: `Merchant tonnage (${merchants.toLocaleString('en-GB')} GRT)`, amount: Math.round(merchants * 0.12 * tierMul) });
    if (tankers) bd.push({ label: `Tanker tonnage (${tankers.toLocaleString('en-GB')} GRT, +50%)`, amount: Math.round(tankers * 0.18 * tierMul) });
    if (r.escortsSunk) bd.push({ label: `Escorts sunk ×${r.escortsSunk}`, amount: Math.round(r.escortsSunk * 900 * tierMul) });
    if (success) bd.push({ label: 'Patrol objective met', amount: c.baseBounty });
  }
  for (const o of objectives) if (o.objective.optional && o.achieved && !defeat) bd.push({ label: o.objective.label, amount: o.objective.reward });
  let total = bd.reduce((a, b) => a + b.amount, 0);
  if (defeat) {
    const kept = Math.round(total * 0.25);
    bd.push({ label: r.playerSunk ? 'Ship lost — salvage rights only (25%)' : 'Mission failed — partial pay (25%)', amount: kept - total });
    total = kept;
  }
  const fundsMul = stats ? stats.mul('funds_pct') : 1;
  if (fundsMul !== 1 && total > 0) {
    const bonus = Math.round(total * (fundsMul - 1));
    bd.push({ label: 'Bounty bonus', amount: bonus });
    total += bonus;
  }
  const xpMul = stats ? stats.mul('xp_pct') : 1;
  const xp = Math.round((150 + c.tier * 60 + total * 0.25) * (defeat ? 0.4 : 1) * xpMul);
  return { success, payout: Math.max(0, total), xp, breakdown: bd, objectives };
}
