// Touch-play assists (controls.autoAttack): what a fingertip can't do precisely, the crew does. The
// torpedo button picks a target, the ASDIC trains on the freshest contact, the guns engage a surfaced
// U-boat, charge depths come from the plot, and one context action is offered when it matters: crash
// dive under attack, fire a spread, drop a pattern over the contact, a star shell at night.

import type { Mission } from './mission';
import type { PlayerControl } from './player';
import type { Vessel } from './vessel';
import type { Contact } from './sensors';
import type { AbilityId } from '../meta/types';
import { intercept } from './ai/uboat';
import { angleDiff, clamp, DEG, KNOT } from '../core/math';
import { dev } from '../core/devSettings';

/** one big button's worth of advice: what it says, which icon, what it does */
export interface ContextAction { id: string; label: string; icon: string; run(): void }

export class Assist {
  /** guns fire by themselves (escort: at surfaced U-boats; U-boat deck gun: at the locked target) */
  gunsAuto = true;
  /** next bow-sweep step for a ping with no contact to train on */
  private sweep = 0;
  /** world time of the last enemy depth charge near the player (U-boat) */
  private chargedT = -99;

  constructor(private m: Mission, private pc: PlayerControl) {
    const w = m.world;
    w.bus.on('dcDrop', (e) => {
      const p = w.player;
      if (p?.sub && e.by.side !== p.side && Math.hypot(e.x - p.pos.x, e.y - p.pos.y) < 900) this.chargedT = w.time;
    });
  }

  get enabled(): boolean {
    const mode = dev.str('controls.autoAttack');
    return mode === 'always' || (mode === 'touch' && this.pc.mobile);
  }

  /** where the player's side believes an enemy is: exact when seen, else the contact estimate */
  posOf(o: Vessel): { x: number; y: number; vx: number; vy: number } | null {
    const w = this.m.world;
    if (w.isVisibleToPlayer(o) && !o.submerged) { const lv = o.body.linvel(); return { x: o.pos.x, y: o.pos.y, vx: lv.x, vy: lv.y }; }
    const c = w.sensors.contacts[w.playerSide].get(o.id);
    return c ? { x: c.x, y: c.y, vx: c.vx, vy: c.vy } : null;
  }

  /** torpedo target: the nearest merchant (then escort) the torpedoes can reach, else the nearest known ship */
  bestTorpedoTarget(): Vessel | null {
    const w = this.m.world, v = w.player, spec = v?.cls.torpedoes;
    if (!v || !spec) return null;
    const spd = spec.speedKn * KNOT * v.stats.mul('torpedo_speed_pct'), reach = spec.range * v.stats.mul('torpedo_range_pct') * 0.95;
    let best: Vessel | null = null, bs = Infinity;
    for (const o of w.vessels) {
      if (!o.alive || o.side === v.side || o.sub) continue;
      const p = this.posOf(o);
      if (!p) continue;
      const sol = intercept(v.pos.x, v.pos.y, p.x, p.y, p.vx, p.vy, spd);
      const score = Math.hypot(p.x - v.pos.x, p.y - v.pos.y) * (o.kind === 'merchant' ? 1 : 1.6) + (sol && sol.t * spd < reach ? 0 : 1e6);
      if (score < bs) { bs = score; best = o; }
    }
    return best;
  }

  /** the U-boat contact to work on: the locked one, else the freshest firm one in reach */
  subContact(maxRange = 2600): Contact | null {
    const w = this.m.world, v = w.player;
    if (!v) return null;
    const side = w.playerSide, locked = this.pc.target;
    if (locked?.sub) { const c = w.sensors.contacts[side].get(locked.id); if (c) return c; }
    let best: Contact | null = null, bs = Infinity;
    for (const c of w.sensors.list(side)) {
      const age = w.time - c.last, d = Math.hypot(c.x - v.pos.x, c.y - v.pos.y);
      if (c.kind !== 'sub' || age > 30 || d > maxRange) continue;
      const s = d + age * 40 + c.err;
      if (s < bs) { bs = s; best = c; }
    }
    return best;
  }

  private nearestEscort(): number {
    const w = this.m.world, v = w.player!;
    let d = Infinity;
    for (const c of w.sensors.list(w.playerSide)) if (c.truth?.kind === 'escort' && w.time - c.last < 60) d = Math.min(d, Math.hypot(c.x - v.pos.x, c.y - v.pos.y));
    return d;
  }

  /** bearing for a ping: on the contact, else sweeping the bow in 20° steps either side */
  pingBearing(): number {
    const v = this.m.world.player!, c = this.subContact();
    if (c) return Math.atan2(c.y - v.pos.y, c.x - v.pos.x);
    const steps = [0, 1, -1, 2, -2, 3, -3, 4, -4];
    return v.heading + steps[this.sweep++ % steps.length] * 20 * DEG;
  }

  /** escort auto attack: a fresh contact inside ASDIC reach to ping, else null */
  autoPingBearing(): number | null {
    const v = this.m.world.player!, R = (v.cls.sensors.asdic ?? 0) * v.stats.mul('sonar_range_pct');
    const c = R > 0 ? this.subContact(R * 1.15) : null;
    return c ? Math.atan2(c.y - v.pos.y, c.x - v.pos.x) : null;
  }

  /** charge depth from the plot: the set's depth reading (1944+), else a guess that grows as the hunt goes on */
  chargeDepth(): number {
    const c = this.subContact();
    if (!c) return 45;
    if (c.depth !== null) return clamp(c.depth, 25, 220);
    // a hunted boat goes down at about half a metre a second once it knows it has been found
    return clamp(30 + (this.m.world.time - c.firstSeen) * 0.5, 25, 160);
  }

  /** escort: a visible surfaced U-boat in gun range (the locked one first); U-boat deck gun: the locked target */
  gunTarget(): Vessel | null {
    const w = this.m.world, v = w.player;
    if (!v || !v.guns.length) return null;
    const range = v.guns[0].spec.range * v.stats.mul('gun_range_pct');
    const ok = (o: Vessel | null): o is Vessel => !!o && o.alive && o.side !== v.side && w.isVisibleToPlayer(o) && (!o.sub || o.sub.surfaced)
      && Math.hypot(o.pos.x - v.pos.x, o.pos.y - v.pos.y) < range;
    if (ok(this.pc.target)) return this.pc.target;
    if (v.sub) return null;
    let best: Vessel | null = null, bd = Infinity;
    for (const o of w.vessels) if (o.sub && ok(o)) { const d = Math.hypot(o.pos.x - v.pos.x, o.pos.y - v.pos.y); if (d < bd) { bd = d; best = o; } }
    return best;
  }

  /** the one action worth a big button right now, or null */
  context(): ContextAction | null {
    const w = this.m.world, v = w.player, pc = this.pc;
    if (!v || !v.alive) return null;
    const ready = (id: AbilityId) => { const i = pc.abilities.slots.findIndex((s) => s?.id === id); return i >= 0 && pc.abilities.ready(i) ? i : -1; };
    const use = (i: number) => pc.abilities.trigger(i, pc.ctx());
    if (v.sub) {
      const s = v.sub, layer = w.layerDepth > 0 ? w.layerDepth : 60;
      const hunted = w.time - this.chargedT < 10 || w.sensors.pingsHeard.some((p) => p.target === v && Math.hypot(p.by.pos.x - v.pos.x, p.by.pos.y - v.pos.y) < 2000);
      if ((hunted || this.nearestEscort() < 900) && v.keelDepth < layer && s.orderedDepth < layer + 10) {
        const deep = Math.min(v.cls.sub!.testDepth * 0.8, layer + 25);
        const crash = ready('crash_dive');
        if (crash >= 0 && v.keelDepth < 30) return { id: 'crash', label: 'CRASH DIVE', icon: 'dive', run: () => { use(crash); s.orderedDepth = Math.max(s.orderedDepth, deep); } };
        return { id: 'deep', label: 'GO DEEP', icon: 'dive', run: () => { s.orderedDepth = deep; } };
      }
      const spread = ready('torpedo_spread'), sol = pc.solution, spec = v.cls.torpedoes;
      if (spread >= 0 && sol && spec && pc.target?.alive && sol.t * spec.speedKn * KNOT < 1600 && v.tubes.filter((t) => t.loaded && !t.stern).length >= 2) {
        return { id: 'spread', label: 'FIRE SPREAD', icon: 'torpedo', run: () => use(spread) };
      }
      if (s.battery < 0.15 && v.submerged && this.nearestEscort() > 2500) return { id: 'surface', label: 'SURFACE', icon: 'surface', run: () => { s.orderedDepth = 0; } };
      return null;
    }
    const c = this.subContact(1200);
    if (c && w.time - c.last < 8) {
      const dx = c.x - v.pos.x, dy = c.y - v.pos.y, d = Math.hypot(dx, dy), h = v.heading;
      const hh = ready('hedgehog');
      if (hh >= 0 && v.hedgehogLeft > 0 && d > 140 && d < 300 && Math.abs(angleDiff(h, Math.atan2(dy, dx))) < 0.25) return { id: 'hedgehog', label: 'HEDGEHOG', icon: 'hedgehog', run: () => use(hh) };
      // over the contact: the stern is about to pass the estimate, like the AI escorts' drop point
      const along = dx * Math.cos(h) + dy * Math.sin(h);
      if (d < 150 && along < v.cls.length * 0.5 + 40 && v.dcLeft > 0) {
        const dp = ready('dc_pattern');
        return { id: 'pattern', label: 'DROP PATTERN', icon: 'charge', run: () => { if (dp >= 0) use(dp); else pc.dropSalvo(); } };
      }
    }
    if (w.env.darkness > 0.5) {
      const sc = this.subContact(1500), ss = ready('star_shell');
      if (sc && ss >= 0 && !w.projectiles.flares.length) return { id: 'star', label: 'STAR SHELL', icon: 'star', run: () => use(ss) };
      if (sc && Math.hypot(sc.x - v.pos.x, sc.y - v.pos.y) < 600 && !v.searchlightOn && !v.stats.has('ks_star_gazer')) {
        return { id: 'light', label: 'SEARCHLIGHT', icon: 'light', run: () => { v.searchlightOn = true; } };
      }
    }
    return null;
  }
}
