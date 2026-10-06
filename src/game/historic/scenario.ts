// Historical battle scenarios (M17): a fixed order of battle on real geography, a timeline of scripted
// events on the historical clock, the carrier air strikes (airRaid.ts) and objectives for whichever side
// the player takes. The player's actions are free; everything they do not touch happens as it did.

import type { World } from '../world';
import type { Mission } from '../mission';
import type { Vessel } from '../vessel';
import type { Side } from '../vesselClasses';
import type { RenderScene } from '../../render/scene';
import type { TutorialView } from '../tutorial';
import type { MissionResult } from '../../meta/types';
import { VESSELS } from '../vesselClasses';
import { TELEGRAPH } from '../vessel';
import { AirRaid } from './airRaid';
import { angleDiff, clamp, DEG, KNOT } from '../../core/math';

export interface Objective { text: string; state: 'open' | 'done' | 'failed' }

/** "08:06" -> hours */
export const hhmm = (s: string) => { const [h, m] = s.split(':').map(Number); return h + m / 60; };
/** compass bearing (degrees true) to world heading */
export const brg = (deg: number) => (deg - 90) * DEG;

export abstract class Scenario {
  readonly world: World;
  raid: AirRaid;
  objectives: Objective[] = [];
  private events: { t: number; fn: () => void }[] = [];
  /** the briefing stays up for the first moments, then the panel shows the objectives */
  abstract readonly title: string;
  abstract readonly brief: string;
  constructor(readonly mission: Mission, readonly scene: RenderScene, readonly startHour: number) {
    this.world = mission.world;
    this.raid = new AirRaid(this.world);
  }

  /** world seconds of a clock time ("08:06") */
  T(clock: string) { return (hhmm(clock) - this.startHour) * 3600; }
  get clock() { return this.startHour + this.world.time / 3600; }
  clockText(h = this.clock) { const m = Math.floor(h * 60 + 1e-6); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
  at(clock: string, fn: () => void) { this.events.push({ t: this.T(clock), fn }); this.events.sort((a, b) => a.t - b.t); }
  say(text: string, kind: 'radio' | 'alert' | 'info' | 'crew' = 'radio', side?: Side) {
    this.world.emit('message', { text, kind, side, important: kind === 'alert' });
  }
  ship(name: string) { return this.world.vessels.find((v) => v.name === name) ?? null; }
  spawn(cls: string, name: string, x: number, y: number, h: number, opts: { side?: Side; moored?: boolean; submerged?: number } = {}) {
    const v = this.world.spawn(VESSELS[cls], x, y, h, { name, side: opts.side, submerged: opts.submerged });
    if (opts.moored) v.moored = { x, y, h };
    v.setTelegraph(2);
    return v;
  }
  /**
   * Roll a flooded hull over onto its side (Oklahoma, Utah, Oglala): the flood model weighs each side's
   * compartments, but a hull already resting on the harbour bottom will not roll far on its own.
   */
  capsize(v: Vessel | null, side: 'port' | 'starboard', minutes: number) {
    if (!v) return;
    v.capsize = { sign: side === 'port' ? 1 : -1, dur: minutes * 60, t: 0 };
    this.wentOver.add(v);
  }
  /**
   * Counterflooding: a listing ship's crew floods compartments on the high side to bring her upright
   * (it kept West Virginia from capsizing). Not for the ships that went over.
   */
  private counterflood(dt: number) {
    for (const v of this.world.vessels) {
      if (!v.cls.role || v.sub || this.wentOver.has(v)) continue;
      const fl = v.hydro.flood;
      for (let i = 0; i + 1 < fl.length; i += 2) {
        const d = fl[i] - fl[i + 1];
        if (Math.abs(d) < 0.05) continue;
        const k = Math.min(Math.abs(d) - 0.05, dt * 0.002);
        if (d > 0) fl[i + 1] += k; else fl[i] += k;
      }
    }
  }
  private wentOver = new Set<Vessel>();
  /**
   * Walk a moored ship to a new spot on her lines and engines over `seconds` (moving the mooring point
   * the spring pulls her toward), then call `then`: how a big ship gets clear of a crowded berth.
   */
  warp(v: Vessel, x: number, y: number, h: number, seconds: number, then: () => void) {
    const m0 = v.moored ?? { x: v.pos.x, y: v.pos.y, h: v.heading };
    v.moored = { ...m0 };
    this.warps.push({ v, x0: m0.x, y0: m0.y, h0: m0.h, x, y, h, t: 0, dur: seconds, then });
  }
  private warps: { v: Vessel; x0: number; y0: number; h0: number; x: number; y: number; h: number; t: number; dur: number; then: () => void }[] = [];
  objective(text: string) { const o: Objective = { text, state: 'open' }; this.objectives.push(o); return o; }

  /** land test for AI pilotage (a harbour scenario sets it); AI ships then steer clear of the shore */
  isLand: ((x: number, y: number) => boolean) | null = null;
  private piloted = new WeakSet<object>();
  /**
   * Wrap an AI ship's controller so that after it orders a course, a pilot checks the water ahead and sheers
   * off from the shore (the escort AI was written for open ocean). Patches the instance, so type checks on
   * the AI (EscortAI's own hunter counting) still hold.
   */
  private pilot(v: Vessel) {
    const ai = v.ai, land = this.isLand;
    if (!ai || !land || this.piloted.has(ai)) return;
    this.piloted.add(ai);
    const inner = ai.update.bind(ai);
    ai.update = (dt: number) => {
      inner(dt);
      if (!v.alive || v.moored || (ai as { beaching?: boolean }).beaching) return;
      const look = Math.max(150, v.cls.length * 1.5 + Math.abs(v.hydro.fwdSpeed) * 20), h = v.course ?? v.heading;
      const blocked = (a: number) => { for (const k of [0.35, 0.7, 1]) if (land(v.pos.x + Math.cos(a) * look * k, v.pos.y + Math.sin(a) * look * k)) return true; return false; };
      if (!blocked(h)) {
        // a shore alongside (the hull grinding along a bank): edge away from it
        const hh = v.heading, sx = -Math.sin(hh), sy = Math.cos(hh), r = v.cls.beam / 2 + 30;
        for (const a of [-0.35, 0, 0.35]) {
          const bx = v.pos.x + Math.cos(hh) * v.cls.length * a, by = v.pos.y + Math.sin(hh) * v.cls.length * a;
          const stbd = land(bx + sx * r, by + sy * r), port = land(bx - sx * r, by - sy * r);
          if (stbd !== port) { v.course = hh + (stbd ? -0.5 : 0.5); v.speedCmd = Math.min(v.speedCmd ?? 0.3, 0.3); return; }
        }
        return;
      }
      for (const off of [0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.7, -1.7]) {
        if (blocked(h + off)) continue;
        v.course = h + off; v.speedCmd = Math.min(v.speedCmd ?? 0.4, 0.45);
        return;
      }
      v.course = h + Math.PI / 2; v.speedCmd = 0.15;
    };
  }

  update(dt: number) {
    const w = this.world;
    if (this.isLand) for (const v of w.vessels) if (v.ai && !v.isPlayer) this.pilot(v);
    while (this.events.length && this.events[0].t <= w.time) this.events.shift()!.fn();
    // a moored player casts off by ringing down for speed (once the scenario allows it)
    const p = w.player;
    if (p?.moored && p.alive) {
      const ahead = p.speedCmd !== null ? p.speedCmd !== 0 : TELEGRAPH[p.telegraph].frac !== 0;
      if (ahead) {
        const why = this.canCastOff(p);
        if (why === true) { p.moored = null; this.say('Single up... all lines cast off. Under way.', 'crew', p.side); }
        else if (why && w.time - this.lastRefusal > 45) { this.lastRefusal = w.time; this.say(why, 'crew', p.side); }
      }
    }
    this.counterflood(dt);
    for (const wp of this.warps) {
      wp.t = Math.min(wp.dur, wp.t + dt);
      const k = wp.t / wp.dur, e = k * k * (3 - 2 * k);
      if (!wp.v.alive || !wp.v.moored) { wp.t = wp.dur; continue; }
      wp.v.moored = { x: wp.x0 + (wp.x - wp.x0) * e, y: wp.y0 + (wp.y - wp.y0) * e, h: wp.h0 + angleDiff(wp.h0, wp.h) * e };
      if (wp.t >= wp.dur) wp.then();
    }
    this.warps = this.warps.filter((wp) => wp.t < wp.dur);
    this.tick(dt);
  }
  private lastRefusal = -99;
  /** true when the player may cast off now, or a crew line saying why not */
  protected canCastOff(_p: Vessel): true | string { return true; }
  protected abstract tick(dt: number): void;

  /** the HUD's coach panel: the clock, the briefing, then the objectives */
  view(): TutorialView | null {
    const w = this.world;
    const brief = w.time < 25;
    const body = brief ? this.brief : this.objectives.map((o) => `${o.state === 'done' ? '[x]' : o.state === 'failed' ? '[-]' : '[ ]'} ${o.text}`).join('  ');
    return { title: this.title, body, n: 0, total: 0, done: false, alpha: 1, footer: '', tag: this.clockText() };
  }

  /** the HUD's top-left panel: losses on both sides and the time since the start */
  tally(): [string, 'good' | 'bad' | 'dim'][] {
    const w = this.world, mine = this.mission.side;
    const lost = (side: Side) => w.vessels.filter((v) => v.side === side && !v.alive && !v.fragment && (v.cls.role || v.kind === 'escort')).length;
    const ours = lost(mine), theirs = lost(mine === 'allied' ? 'axis' : 'allied');
    const down = this.raid.shotDown.allied + this.raid.shotDown.axis;
    const m = Math.floor(w.time / 60);
    return [[`Own ships lost ${ours}`, ours ? 'bad' : 'dim'], [`Enemy ships sunk ${theirs}`, theirs ? 'good' : 'dim'], [`Aircraft down ${down}`, 'dim'], [`${this.clockText()}  (+${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')})`, 'dim']];
  }

  end(outcome: MissionResult['outcome'], reason: string) { this.mission.end(outcome, reason); }
}

/** steams a ship along waypoints, slowing for turns; stops (or calls `arrive`) at the last one */
export class RouteAI {
  debug = '';
  i = 0;
  /** beach: the last leg runs her aground on purpose (the shore pilot stands down for it) */
  constructor(private v: Vessel, public pts: [number, number][], public kn: number, public arrive?: () => void, private beach = false) {}
  get beaching() { return this.beach && this.i >= this.pts.length - 1; }
  update(_dt: number) {
    const v = this.v;
    if (this.i >= this.pts.length) { v.course = v.heading; v.speedCmd = 0; this.debug = 'arrived'; return; }
    const [x, y] = this.pts[this.i], d = Math.hypot(x - v.pos.x, y - v.pos.y);
    // reached, or already abeam/astern within a turning circle (a big ship cannot turn onto a close point)
    const behind = (x - v.pos.x) * Math.cos(v.heading) + (y - v.pos.y) * Math.sin(v.heading) < 0;
    if (d < Math.max(80, v.cls.length * 0.6) || (behind && d < v.cls.turnRadius * 1.2)) {
      this.i++;
      if (this.i >= this.pts.length) this.arrive?.();
      return;
    }
    v.course = Math.atan2(y - v.pos.y, x - v.pos.x);
    const turn = Math.abs(angleDiff(v.heading, v.course));
    const kn = this.kn * clamp(1.2 - turn, 0.3, 1) * (this.i === this.pts.length - 1 ? clamp(d / 600, 0.25, 1) : 1);
    v.speedCmd = clamp(kn * KNOT / v.maxSpeed, 0, 1);
    this.debug = `route ${this.i + 1}/${this.pts.length}`;
  }
}
