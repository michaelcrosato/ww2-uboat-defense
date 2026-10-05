// Activated abilities: cooldowns, charges and the gameplay handler for every AbilityId.
// Definitions (names, ranks, params, modifiers) come from the meta layer; handlers read the
// resolved params by name.

import type { World } from './world';
import type { Vessel } from './vessel';
import type { AbilityId, AbilityState } from '../meta/types';
import { ABILITIES, resolveAbility } from '../meta/abilities';
import { clamp, KNOT, DEG } from '../core/math';
import { dev } from '../core/devSettings';
import type { Wolfpack } from './ai/uboat';
import { intercept } from './ai/uboat';
import { SRC } from './sensors';

export interface AbilitySlot {
  id: AbilityId;
  state: AbilityState;
  cooldown: number;       // remaining
  maxCooldown: number;
  charges: number | null; // remaining uses this mission
  active: number;         // remaining active duration (for HUD)
}

export interface AbilityCtx {
  world: World;
  v: Vessel;
  aimX: number; aimY: number;
  /** escort depth-charge setting (m) */
  chargeDepth: number;
  pack: Wolfpack | null;
  target: Vessel | null;
}

export class AbilityRunner {
  slots: (AbilitySlot | null)[] = [];
  constructor(private v: Vessel) {}

  setLoadout(loadout: (AbilityId | null)[], states: Partial<Record<AbilityId, AbilityState>>) {
    this.slots = loadout.map((id) => {
      if (!id || !ABILITIES[id]) return null;
      const st = states[id] ?? { rank: 1 };
      const r = resolveAbility(ABILITIES[id], st, this.v.stats);
      return { id, state: st, cooldown: 0, maxCooldown: r.cooldown, charges: r.charges ?? null, active: 0 };
    });
  }

  update(dt: number) {
    for (const s of this.slots) {
      if (!s) continue;
      if (s.cooldown > 0) s.cooldown -= dt;
      if (s.active > 0) s.active -= dt;
    }
  }

  ready(i: number): boolean {
    const s = this.slots[i];
    return !!s && (s.cooldown <= 0 || dev.bool('game.noCooldowns')) && (s.charges === null || s.charges > 0);
  }

  trigger(i: number, ctx: AbilityCtx): boolean {
    const s = this.slots[i];
    if (!s || !this.ready(i)) return false;
    const def = ABILITIES[s.id];
    const minYear = def.minYear ?? 0;
    if (ctx.world.year < minYear) { ctx.world.emit('message', { text: `${def.name} is not available until ${minYear}.`, kind: 'info' }); return false; }
    const r = resolveAbility(def, s.state, ctx.v.stats);
    const ok = HANDLERS[s.id]?.(ctx, r.params, s.state.modifier) ?? false;
    if (!ok) return false;
    s.cooldown = r.cooldown;
    s.maxCooldown = r.cooldown;
    if (s.charges !== null) s.charges--;
    s.active = r.params.duration_s ?? 0;
    ctx.world.emit('message', { text: def.name + '!', side: ctx.v.side, kind: 'crew' });
    return true;
  }
}

type Handler = (c: AbilityCtx, p: Record<string, number>, mod?: string) => boolean;

const HANDLERS: Partial<Record<AbilityId, Handler>> = {
  // ------------------------------------------------------------ escort
  asdic_sweep: (c, p) => {
    const brg = Math.atan2(c.aimY - c.v.pos.y, c.aimX - c.v.pos.x);
    const arc = clamp(p.arc ?? 120, 10, 360) * DEG;
    const echoes = c.world.sensors.ping(c.v, brg, arc, p.range_mult ?? 1.3);
    // reveal: keep the found contacts firm for a while
    const until = c.world.time + (p.reveal_s ?? 8);
    for (const e of echoes) if (e.target) e.target.revealUntil = until;
    return true;
  },
  dc_pattern: (c, p) => {
    if (c.v.dcLeft <= 0 && !dev.bool('game.infiniteAmmo')) return false;
    c.world.projectiles.dcPattern(c.v, Math.round(p.charges ?? 5), p.spread_m ?? 80, c.chargeDepth, p.damage_mult ?? 1);
    return true;
  },
  hedgehog: (c, p) => c.world.projectiles.hedgehog(c.v, Math.round(p.bombs ?? 24), p.ring_m ?? 22, p.range_m ?? 200, p.damage_mult ?? 1),
  star_shell: (c, p) => {
    c.v.starShellLife = (p.duration_s ?? 26) / 26;
    c.v.starShellRadius = (p.radius_m ?? 330) / 330;
    c.v.starShells = Math.max(c.v.starShells, 1);
    return c.world.projectiles.fireStarShell(c.v, c.aimX, c.aimY);
  },
  flank_speed: (c, p) => { c.v.flankBoost = p.duration_s ?? 15; return true; },
  smoke_screen: (c, p) => { c.v.smokeT = p.duration_s ?? 20; c.v.smokeDensity = p.density ?? 1; return true; },
  snowflake: (c, p) => {
    const n = Math.round(p.rockets ?? 4), R = p.radius_m ?? 700;
    c.v.starShellLife = (p.duration_s ?? 30) / 26;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + c.world.rng.range(-0.3, 0.3);
      c.world.projectiles.flares.push({ x: c.v.pos.x + Math.cos(a) * R * c.world.rng.range(0.4, 1), y: c.v.pos.y + Math.sin(a) * R * c.world.rng.range(0.4, 1), z: 140, life: p.duration_s ?? 30, max: p.duration_s ?? 30, radius: 340, intensity: 3.2 });
    }
    c.world.emit('starShell', { x: c.v.pos.x, y: c.v.pos.y });
    return true;
  },
  creeping_attack: (c, p) => { c.v.creeping = p.duration_s ?? 25; c.v.creepBonus = p.accuracy_bonus ?? 0.3; return true; },
  huff_duff: (c, p) => {
    let n = 0;
    for (const u of c.world.vessels) {
      if (!u.alive || u.side === c.v.side || !u.sub) continue;
      const d = Math.hypot(u.pos.x - c.v.pos.x, u.pos.y - c.v.pos.y);
      if (d > 7000) continue;
      const brg = Math.atan2(u.pos.y - c.v.pos.y, u.pos.x - c.v.pos.x) + c.world.rng.gauss(0, (p.accuracy_deg ?? 4) * DEG);
      c.world.sensors.bearing(c.v.side, u, c.v.pos.x, c.v.pos.y, brg, (p.accuracy_deg ?? 4) * DEG, SRC.HFDF, d);
      n++;
    }
    c.world.emit('message', { text: n ? `HF/DF: ${n} transmitter bearing${n > 1 ? 's' : ''} plotted.` : 'HF/DF: no transmissions intercepted.', side: c.v.side, kind: 'radio' });
    return true;
  },
  ram: (c, p) => { c.v.ramBrace = p.brace_s ?? 12; c.v.ramBraceMult = p.damage_mult ?? 2; c.v.ramBraceReduction = p.damage_reduction ?? 0.4; c.v.flankBoost = Math.max(c.v.flankBoost, (p.brace_s ?? 12) * 0.6); return true; },
  air_support: (c, p) => { c.world.projectiles.callAircraft(c.v, p.duration_s ?? 45, Math.round(p.bombs ?? 4), Math.round(p.sorties ?? 1)); return true; },
  foxer: (c, p) => { c.world.projectiles.releaseDecoy(c.v, 'foxer', (p.duration_s ?? 60) * c.v.stats.mul('decoy_duration_pct')); return true; },
  damage_control: (c, p) => {
    const v = c.v;
    v.hp = Math.min(v.maxHp, v.hp + v.maxHp * (p.repair_frac ?? 0.2));
    for (let i = 0; i < v.ingress.length; i++) { v.ingress[i] *= 0.3; v.hydro.flood[i] *= 0.6; }
    if ((p.extinguish ?? 1) > 0) v.fires.length = 0;
    v.damageLook *= 0.7;
    v.engineDamage *= 0.5;
    if (v.sub) v.sub.hullStress *= 0.6;
    return true;
  },
  // ------------------------------------------------------------ u-boat
  crash_dive: (c, p) => {
    const s = c.v.sub;
    if (!s) return false;
    s.crash = (p.duration_s ?? 12) * (p.dive_mult ?? 1);
    s.orderedDepth = Math.max(s.orderedDepth, 50);
    s.periscopeUp = false;
    c.v.setTelegraph(6);
    return true;
  },
  torpedo_spread: (c, p, mod) => {
    const v = c.v;
    const n = Math.round(p.torpedoes ?? 3);
    const loaded = v.tubes.filter((t) => t.loaded && !t.stern).length;
    if (loaded <= 0 && !dev.bool('game.infiniteAmmo')) return false;
    const course = aimCourse(c);
    const spread = (p.spread_deg ?? 6) * DEG;
    let shot = 0;
    for (let i = 0; i < n; i++) {
      const off = n > 1 ? (i / (n - 1) - 0.5) * spread : 0;
      if (c.world.projectiles.fireTorpedo(v, course + off, { damageMul: (p.damage_mult ?? 1) * (v.stats.has('ks_one_torpedo') ? 0.5 : 1), target: c.target })) shot++;
    }
    void mod;
    return shot > 0;
  },
  silent_running: (c, p) => { if (!c.v.sub) return false; c.v.sub.silent = p.duration_s ?? 45; return true; },
  bold_decoy: (c, p) => {
    if (!c.v.sub || !c.v.submerged) return false;
    const n = Math.max(1, Math.round(p.decoys ?? 1));
    for (let i = 0; i < n; i++) c.world.projectiles.releaseDecoy(c.v, 'bold', (p.duration_s ?? 80) * c.v.stats.mul('decoy_duration_pct') * (c.v.stats.has('ks_ghost') ? 2 : 1));
    return true;
  },
  wolfpack_call: (c, p) => {
    if (!c.pack) return false;
    c.pack.rally = p.duration_s ?? 60;
    c.world.sensors.transmit(c.v);
    if (c.v.stats.power('pow_wolf_howl')) c.v.wolfHowl = 20;
    c.world.projectiles.reinforce(Math.round(p.boats ?? 1));
    c.world.emit('message', { text: 'Contact report sent. The pack is closing in.', side: c.v.side, kind: 'radio' });
    return true;
  },
  deck_gun: (c, p) => {
    if (!c.v.sub || !c.v.sub.surfaced || c.v.guns.length === 0 || c.v.stats.has('ks_silent_hunter')) return false;
    c.v.deckGunBoost = p.duration_s ?? 15;
    c.v.deckGunRate = p.rate_mult ?? 1.8;
    return true;
  },
  emergency_blow: (c, p) => { if (!c.v.sub) return false; c.v.sub.blow = 10 / Math.max(0.3, p.rise_mult ?? 1); c.v.sub.orderedDepth = 0; return true; },
  deep_dive: (c, p) => {
    const s = c.v.sub;
    if (!s) return false;
    s.orderedDepth = p.depth_m ?? 160;
    s.crash = Math.max(s.crash, 6);
    return true;
  },
  periscope_scan: (c, p) => {
    const s = c.v.sub;
    if (!s || !(c.v.atPeriscopeDepth || s.surfaced)) return false;
    s.periscopeUp = true;
    c.v.scanUntil = c.world.time + (p.duration_s ?? 12);
    c.v.scanQuality = p.solution_quality ?? 0.9;
    return true;
  },
  zaunkoenig: (c, p) => {
    const n = Math.round(p.torpedoes ?? 1);
    let shot = 0;
    for (let i = 0; i < n; i++) if (c.world.projectiles.fireTorpedo(c.v, aimCourse(c) + (i - (n - 1) / 2) * 0.1, { kind: 'acoustic', damageMul: p.damage_mult ?? 1 })) shot++;
    const t = c.world.projectiles.torpedoes;
    for (let i = t.length - shot; i < t.length; i++) if (t[i]) t[i].seek = p.seek_range_m ?? 600;
    return shot > 0;
  },
  snorkel: (c, p) => {
    const s = c.v.sub;
    if (!s || !c.v.atPeriscopeDepth) return false;
    s.snorkel = true;
    c.v.snorkelT = p.duration_s ?? 40;
    c.v.snorkelMul = p.recharge_mult ?? 1;
    return true;
  },
  aphrodite: (c, p) => {
    for (let i = 0; i < Math.round(p.decoys ?? 3); i++) {
      c.world.projectiles.decoys.push({ x: c.v.pos.x + c.world.rng.range(-400, 400), y: c.v.pos.y + c.world.rng.range(-400, 400), depth: 0, life: p.duration_s ?? 60, kind: 'aphrodite', owner: c.v, strength: 1 });
    }
    return true;
  },
};

/** torpedo course toward the aim point, solving the intercept when a target is locked */
export function aimCourse(c: AbilityCtx): number {
  const v = c.v;
  const spec = v.cls.torpedoes;
  if (c.target && spec) {
    const contact = c.world.sensors.contacts[v.side].get(c.target.id);
    const tx = contact ? contact.x : c.target.pos.x, ty = contact ? contact.y : c.target.pos.y;
    const vel = contact ? { x: contact.vx, y: contact.vy } : c.target.body.linvel();
    const sol = intercept(v.pos.x, v.pos.y, tx, ty, vel.x, vel.y, spec.speedKn * KNOT);
    if (sol) return sol.heading;
  }
  return Math.atan2(c.aimY - v.pos.y, c.aimX - v.pos.x);
}
