// Career glue between the meta layer and missions: owns the saved profile, turns a contract into
// mission overrides + hooks (captain stats, abilities, mutators), drops loot crates on sinkings during
// the mission, and settles the result (payout, XP, loot) afterwards. Autosaves after every change.

import type { MissionHooks } from '../app';
import type { Mission } from './mission';
import { dev } from '../core/devSettings';
import { Rng } from '../core/math';
import {
  applyMissionResult, computeStats, contractIlvl, loadProfile, newProfile, rollDrops, saveProfile, RARITY_COLORS, StatBlock,
  type CaptainState, type Contract, type DropSource, type Faction, type MissionSummary, type Mutator, type Profile, type StatKey,
} from '../meta/index.ts';

/** mutator stat changes for one side as a StatBlock */
export function mutatorStats(mutators: Mutator[], who: 'enemy' | 'player'): StatBlock {
  const s = new StatBlock();
  for (const m of mutators) for (const k in m[who] ?? {}) s.add(k as StatKey, m[who]![k as StatKey] ?? 0);
  return s;
}

export interface Debrief {
  contract: Contract | null;
  freePlay: boolean;
  faction: Faction;
  summary: MissionSummary;
  /** captain before the result was applied (XP bar animation) */
  before: { level: number; xp: number; funds: number };
  outcome: string;
  reason: string;
}

export class Career {
  profile: Profile;
  readonly rng = new Rng(Date.now() % 1e9);
  /** contract being flown (null in arena free play) */
  active: Contract | null = null;

  constructor() {
    this.profile = loadProfile() ?? newProfile();
    this.save();
  }

  get faction(): Faction | null { return (this.profile.settings?.faction as Faction | undefined) ?? null; }
  set faction(f: Faction | null) { this.profile.settings = { ...this.profile.settings, faction: f }; this.save(); }
  captain(f: Faction | null = this.faction): CaptainState { return this.profile[f ?? 'escort']; }
  save() { saveProfile(this.profile); }
  /** wipe both captains (Records tab) */
  reset() { this.profile = newProfile(); this.save(); }

  /** overrides + hooks for flying a contract with the active captain */
  contractMission(contract: Contract): { overrides: Record<string, number | string | boolean>; hooks: MissionHooks } {
    const c = this.captain(contract.faction);
    const overrides: Record<string, number | string | boolean> = { ...contract.arena };
    // the captain's current hull, whatever the contract was generated with
    overrides[contract.faction === 'escort' ? 'arena.escortClass' : 'arena.uboatClass'] = c.vessel.cls;
    overrides['arena.side'] = contract.faction;
    for (const m of contract.mutators) Object.assign(overrides, m.arena ?? {});
    this.active = contract;
    const enemy = mutatorStats(contract.mutators, 'enemy');
    return {
      overrides,
      hooks: {
        stats: computeStats(c, mutatorStats(contract.mutators, 'player')),
        enemyStats: Object.keys(enemy.v).length ? enemy : undefined,
        loadout: c.loadout,
        abilities: c.abilities,
        hullDamage: c.vessel.hullDamage,
        onStart: (m) => this.attachLoot(m, c, contractIlvl(contract), contract.mutators.reduce((a, x) => a * x.lootMult, 1)),
      },
    };
  }

  /** loot crates on enemy sinkings (merchants count as enemies for U-boat captains); pickup messages */
  attachLoot(m: Mission, c: CaptainState, ilvl: number, lootMult: number) {
    const w = m.world, rng = new Rng(Number(m.cfg['arena.seed']) * 7 + 3);
    const stats = w.player?.stats ?? computeStats(c);
    w.bus.on('sunk', (e) => {
      const v = e.v;
      if (v.side === w.playerSide || v.isPlayer) return;
      const source: DropSource = v.kind === 'uboat' ? 'uboat' : v.kind === 'escort' ? 'escort' : v.cls.id === 'tanker' ? 'tanker' : 'merchant';
      const items = rollDrops(rng, { faction: c.faction, source, ilvl, lootFind: stats.get('loot_find_pct'), mult: lootMult * dev.num('game.lootRate') });
      items.forEach((it, i) => {
        // fan several drops out around the wreck so their beams read separately
        const a = (i / Math.max(1, items.length)) * Math.PI * 2 + rng.next(), r = items.length > 1 ? 12 + rng.next() * 14 : 0;
        w.projectiles.layLoot(v.pos.x + Math.cos(a) * r, v.pos.y + Math.sin(a) * r, it);
        if (it.rarity === 'legendary' || it.rarity === 'unique') {
          w.flash = Math.max(w.flash, 0.5);
          w.flashCol = it.rarity === 'unique' ? [0.85, 0.7, 0.45] : [1, 0.55, 0.15];
          w.emit('message', { text: `${it.rarity === 'unique' ? 'Unique' : 'Legendary'} salvage surfaced near ${v.name}!`, kind: 'loot', important: true, color: RARITY_COLORS[it.rarity] });
        }
      });
    });
    w.bus.on('lootPicked', (e) => {
      if (e.by !== w.player) return;
      w.emit('message', { text: `Recovered: ${e.item.name}`, kind: 'loot', color: RARITY_COLORS[e.item.rarity] });
    });
  }

  /** settle a finished mission; crates still afloat are recovered if the ship survived */
  finish(m: Mission, freePlay: boolean): Debrief {
    const faction: Faction = m.side === 'axis' ? 'uboat' : 'escort';
    const c = this.captain(faction);
    const before = { level: c.level, xp: c.xp, funds: c.funds };
    const contract = freePlay ? null : this.active;
    const r = m.result(contract?.id);
    if (!freePlay && !r.playerSunk) for (const cr of m.world.projectiles.crates) r.lootCollected.push(cr.item);
    const summary = applyMissionResult(this.profile, faction, contract, r, this.rng, { inMissionDrops: !freePlay, freePlay });
    this.active = null;
    this.save();
    return { contract, freePlay, faction, summary, before, outcome: r.outcome, reason: m.overReason };
  }
}
