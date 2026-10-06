// Midway, Thursday 4 June 1942, 08:10-10:35 (Midway local time), the morning of the carrier battle.
// The Kido Butai (four carriers, two fast battleships, two heavy cruisers, Nagara and eleven destroyers)
// steams at 24 knots, turning to evade, while Nautilus (SS-168) works in on it and Arashi hunts her.
// The US torpedo squadrons die against the combat air patrol; Arashi, racing back after her hunt, leaves
// the wake the Enterprise dive bombers follow to the carriers at 10:22.
// Escort side: Arashi. U-boat side: Nautilus. The IJN takes the mechanical surface side here.
// Distances are true scale; the formation's evasive turns keep it within reach of the submarine
// (its real track wandered just as much while recovering and evading aircraft).

import type { Mission } from '../mission';
import type { Vessel } from '../vessel';
import type { RenderScene } from '../../render/scene';
import { Scenario, brg } from './scenario';
import type { Element } from './airRaid';
import { Convoy } from '../convoy';
import { EscortAI } from '../ai/escort';
import { intercept } from '../ai/uboat';
import { VESSELS } from '../vesselClasses';
import { angleDiff, clamp, KNOT } from '../../core/math';

/** formation slots in km: [ahead, starboard], cruising box until the torpedo attacks scatter it */
const BOX: Record<string, [string, number, number]> = {
  Akagi: ['cv_akagi', 1.5, -2], Soryu: ['cv_soryu', 1.5, 2], Hiryu: ['cv_hiryu', -2.5, -2], Kaga: ['cv_kaga', -2.5, 2],
  Kirishima: ['bb_kongo', 4, -5], Haruna: ['bb_kongo', 4, 5], Tone: ['ca_tone', -4, -6], Chikuma: ['ca_tone', -4, 6], Nagara: ['cl_nagara', 7, 0],
};
/** where the carriers stood at 10:20 (relative to the course of 070): Kaga south-west-most, Akagi NNE of her,
 *  Soryu east of Akagi, Hiryu 8-10 km to the north */
const SCATTERED: Record<string, [number, number]> = { Kaga: [-2, 2], Akagi: [0.9, -1.2], Soryu: [5.2, 1.3], Hiryu: [4, -9.7] };
const DESTROYERS: [string, string][] = [
  ['Nowaki', 'dd_kagero'], ['Arashi', 'dd_kagero'], ['Hagikaze', 'dd_kagero'], ['Maikaze', 'dd_kagero'],
  ['Kazagumo', 'dd_yugumo'], ['Yugumo', 'dd_yugumo'], ['Makigumo', 'dd_yugumo'],
  ['Isokaze', 'dd_kagero'], ['Urakaze', 'dd_kagero'], ['Tanikaze', 'dd_kagero'], ['Hamakaze', 'dd_kagero'],
];
/** the formation's legs (clock, course deg true, knots): recovering the Midway strike, then 070 at 09:17
 *  toward the American carriers, with the evasive turns of the torpedo attacks */
const LEGS: [string, number, number][] = [
  ['08:10', 340, 20], ['08:24', 20, 20], ['08:38', 300, 20], ['08:52', 350, 20], ['09:05', 30, 22], ['09:17', 70, 24],
  ['09:24', 120, 26], ['09:34', 40, 26], ['09:44', 330, 26], ['09:56', 70, 24], ['10:06', 150, 26], ['10:14', 70, 24],
];

export class Midway extends Scenario {
  readonly title = 'Midway, 4 June 1942';
  readonly brief: string;
  kb: Convoy;
  nautilus: Vessel;
  arashi: Vessel;
  private legIdx = 0;
  private oHold; private oHunt; private oRejoin; private oHit; private oSurvive;
  private naHits = 0;
  private brokeOff = false;

  constructor(m: Mission, scene: RenderScene) {
    super(m, scene, 8 + 10 / 60);
    const w = this.world;
    this.brief = m.side === 'allied'
      ? 'Destroyer Arashi in the screen of the carrier striking force. An American submarine has been sighted. Keep her away from the carriers and battleships.'
      : 'USS Nautilus, periscope depth. Masts on the horizon: the Japanese carrier striking force is coming down on you at 20 knots. Get in and attack.';
    // ---- the Kido Butai: capital ships keep their stations on the formation guide
    const kb = new Convoy(w, 20);
    this.kb = kb;
    kb.columns = 1; kb.colSpacing = kb.rowSpacing = 1000; kb.zigzag = false;
    kb.heading = kb.baseHeading = brg(340);
    kb.x = 0; kb.y = 0;
    for (const [name, [cls, ahead, stbd]] of Object.entries(BOX)) {
      const sp = kb.slotPos(stbd, -ahead);
      const v = this.spawn(cls, name, sp.x, sp.y, kb.heading, { side: 'allied' });
      v.slot = { col: stbd, row: -ahead };
      v.ai = new StationAI(v, kb);
      v.thrust = 0.6;
      kb.merchants.push(v);
    }
    // ---- the destroyer screen on a ring about 4.5 km out
    let arashi: Vessel | null = null;
    DESTROYERS.forEach(([name, cls], i) => {
      const a = (i / DESTROYERS.length) * Math.PI * 2, st = { ahead: Math.cos(a) * 4500, side: Math.sin(a) * 4500 };
      const c = Math.cos(kb.heading), s = Math.sin(kb.heading);
      const v = this.spawn(cls, name, kb.x + st.ahead * c - st.side * s, kb.y + st.ahead * s + st.side * c, kb.heading, { side: 'allied' });
      v.setTelegraph(4);
      if (name === 'Arashi') arashi = v;
      if (name === 'Arashi' && m.side === 'allied') return;
      v.ai = new EscortAI(w, v, kb, st);
    });
    this.arashi = arashi!;
    // ---- Nautilus, ahead and to port of the formation's track, at periscope depth
    const ncls = VESSELS.ss_narwhal, keel = ncls.sub!.periscopeDepth;
    const fwd = kb.slotPos(-3.5, -11);
    const n = w.spawn(ncls, fwd.x, fwd.y, kb.heading + Math.PI - 0.5, { name: 'USS Nautilus', side: 'axis', submerged: keel - ncls.draft });
    n.sub!.orderedDepth = keel; n.sub!.periscopeUp = true; n.sub!.periscope = 1;
    this.nautilus = n;
    for (const v of w.vessels) this.raid.aaReady.set(v, 0);

    if (m.side === 'allied') {
      const p = this.arashi;
      p.isPlayer = true; w.player = p; p.setTelegraph(4);
      n.ai = new NautilusAI(this, n);
      this.oHold = this.objective('No torpedo hits on the carriers or battleships');
      this.oHunt = this.objective('Hunt the submarine until 09:55');
      this.oRejoin = this.objective('Rejoin the carriers');
    } else {
      n.isPlayer = true; w.player = n; n.setTelegraph(3);
      this.oHit = this.objective('Torpedo a carrier or battleship');
      this.oSurvive = this.objective('Survive the counterattack (09:55)');
    }
    w.bus.on('torpedoHit', (e) => {
      if (!e.by || e.by !== this.nautilus || e.dud) return;
      if (e.target.cls.role !== 'capital' && e.target.cls.role !== 'carrier') return;
      this.naHits++;
      if (this.oHit) this.oHit.state = 'done';
      if (this.oHold) this.oHold.state = 'failed';
    });
    w.bus.on('torpedoHit', (e) => { if (e.by === this.nautilus && e.dud) this.say(`A torpedo strikes ${e.target.name}... and fails to explode.`, 'info'); });
    w.bus.on('sunk', (e) => {
      if (e.v === this.nautilus && this.oHunt) { this.oHunt.state = 'done'; this.say('The American submarine is destroyed.', 'info'); }
    });
    this.timeline();
  }

  private timeline() {
    const e = (o: Omit<Element, 'side' | 'at'> & { at: string }): Element => ({ side: 'axis', ...o, at: this.T(o.at) });
    for (const el of [
      e({ kind: 'tbd', role: 'torpedo', n: 15, at: '09:20', targets: ['Soryu', 'Akagi'], hits: 0, attrition: 1, from: brg(60), call: 'Enemy torpedo bombers, low on the water! The fighters are among them.' }),
      e({ kind: 'tbd', role: 'torpedo', n: 14, at: '09:45', targets: ['Kaga'], hits: 0, attrition: 10 / 14, from: brg(130), call: 'Second torpedo squadron coming in on Kaga!' }),
      e({ kind: 'tbd', role: 'torpedo', n: 12, at: '10:12', targets: ['Hiryu'], hits: 0, attrition: 10 / 12, from: brg(100), call: 'More torpedo planes, attacking Hiryu!' }),
      // the dive bombers arrive unseen while the combat air patrol is down low after the torpedo planes
      e({ kind: 'sbd', role: 'dive', n: 25, at: '10:22', targets: ['Kaga'], hits: 4, from: brg(215), call: 'Hell-divers! Dive bombers directly overhead!' }),
      e({ kind: 'sbd', role: 'dive', n: 13, at: '10:25', targets: ['Soryu'], hits: 3, from: brg(80), load: 'apbomb' }),
      e({ kind: 'sbd', role: 'dive', n: 3, at: '10:26', targets: ['Akagi'], hits: 1, from: brg(215), load: 'apbomb' }),
    ]) this.raid.add(el);
    this.at('09:17', () => this.say('Flagship: the force turns to 070 to close the American carriers.', 'radio', 'allied'));
    this.at('09:30', () => { for (const [name, s] of Object.entries(SCATTERED)) { const v = this.ship(name); if (v?.slot) v.slot = { col: s[1], row: -s[0] }; } });
    this.at('09:55', () => this.breakOff());
    this.at('10:35', () => this.finish());
  }

  /** Arashi gives up the hunt and races back to the carriers at full speed, her wake pointing the way */
  private breakOff() {
    this.brokeOff = true;
    const a = this.arashi;
    if (this.oHunt?.state === 'open' && a.alive) this.oHunt.state = 'done';
    if (this.mission.side === 'allied') {
      if (a.alive) this.say('Flagship to Arashi: break off and rejoin at best speed.', 'radio', 'allied');
    } else {
      if (a.alive && !a.isPlayer) a.ai = new RejoinAI(a, () => this.ship('Akagi'));
      if (this.nautilus.alive) this.finish();
    }
  }

  protected tick(dt: number) {
    const w = this.world, kb = this.kb;
    // the formation guide: legs on the clock, turning at a carrier's rate
    while (this.legIdx + 1 < LEGS.length && w.time >= this.T(LEGS[this.legIdx + 1][0])) this.legIdx++;
    const [, course, kn] = LEGS[this.legIdx];
    const want = brg(course);
    // a formation turn of a few minutes, so the screen 4.5 km out can swing round with it
    kb.heading += clamp(angleDiff(kb.heading, want), -0.004 * dt, 0.004 * dt);
    kb.baseHeading = kb.heading;
    kb.speed = kn * KNOT;
    kb.update(dt);
    // the arena travels with the force
    w.bounds = { x0: kb.x - 30000, y0: kb.y - 30000, x1: kb.x + 30000, y1: kb.y + 30000 };
    if (this.oRejoin && this.brokeOff && this.oRejoin.state === 'open') {
      const ak = this.ship('Akagi'), p = w.player;
      if (p?.alive && ak && Math.hypot(ak.pos.x - p.pos.x, ak.pos.y - p.pos.y) < 5000) { this.oRejoin.state = 'done'; this.say('Arashi has rejoined the screen.', 'crew', 'allied'); }
    }
    if (this.oHold && this.naHits === 0 && this.oHold.state === 'open' && this.brokeOff) this.oHold.state = 'done';
  }

  private finish() {
    if (this.mission.over) return;
    const p = this.world.player;
    if (!p?.alive) return;
    if (this.mission.side === 'allied') {
      const held = this.naHits === 0;
      this.end(held ? 'victory' : 'defeat', held
        ? 'The submarine never got a hit. But three carriers are burning: the dive bombers found the force by following a destroyer racing to rejoin it.'
        : 'The submarine torpedoed the force. And three carriers are burning after the dive-bomber attack.');
    } else {
      if (this.oSurvive) this.oSurvive.state = 'done';
      const hit = this.naHits > 0;
      const coda = this.arashi.alive
        ? 'Arashi breaks off and races away north-east; within half an hour the dive bombers following her wake set three carriers on fire.'
        : 'The hunt is over. Within half an hour the dive bombers find the carriers and set three of them on fire.';
      this.end(hit ? 'victory' : 'withdrew', (hit ? 'Your torpedo struck home. ' : '') + coda);
    }
  }
}

/**
 * Formation keeping for the capital ships: steer the guide's course with a bounded correction toward the
 * slot and trim speed along it (a convoy merchant aims straight at its slot, which at 24 knots overshoots
 * and circles whenever the formation turns). A lookout sheers off and slows for any hull close ahead of
 * the bow. Badly damaged ships drop out; a wrecked carrier lies stopped, burning.
 */
class StationAI {
  debug = '';
  constructor(private v: Vessel, private kb: Convoy) {}
  update(_dt: number) {
    const v = this.v, kb = this.kb;
    if (!v.slot) return;
    const sp = kb.slotPos(v.slot.col, v.slot.row), fxk = Math.cos(kb.heading), fyk = Math.sin(kb.heading);
    const ex = sp.x - v.pos.x, ey = sp.y - v.pos.y;
    const along = ex * fxk + ey * fyk, lat = -ex * fyk + ey * fxk;
    let course = kb.heading + clamp(lat * 0.0006, -0.5, 0.5);
    let want = kb.speed + clamp(along * 0.004, -kb.speed * 0.4, kb.speed * 0.35);
    this.debug = `station ${Math.round(along)}/${Math.round(lat)}`;
    if (v.hpFrac < 0.45 || v.engineDamage > 0.4 || v.hydro.floodTotal() > 0.25) {
      v.straggler = true;
      course = v.heading;
      want = v.hpFrac < 0.2 ? 0 : Math.min(want, v.maxSpeed * 0.5);
      this.debug = v.hpFrac < 0.2 ? 'stopped, burning' : 'straggling';
    }
    // lookout: along the bow as it points now
    const fx = Math.cos(v.heading), fy = Math.sin(v.heading);
    for (const o of v.world.vessels) {
      if (o === v || !o.alive || (o.sub && !o.sub.surfaced)) continue;
      const dx = o.pos.x - v.pos.x, dy = o.pos.y - v.pos.y;
      const ahead = dx * fx + dy * fy, side = -dx * fy + dy * fx;
      if (ahead < 0 || ahead > v.cls.length * 3 || Math.abs(side) > (v.cls.beam + o.cls.beam) / 2 + 60) continue;
      course = v.heading + (side > 0 ? -0.6 : 0.6);
      want *= 0.6;
      this.debug = 'giving way to ' + o.name;
      break;
    }
    v.course = course;
    v.speedCmd = clamp(Math.sqrt(Math.max(0, want / v.maxSpeed)), 0, 1);
  }
}

/**
 * Nautilus as her patrol report tells it: she stays down (a surfaced submarine near a carrier force in
 * daylight is spotted by the air patrol at once), creeps in at periscope depth, fires at any battleship or
 * carrier inside 2,500 m, then goes deep and runs silent while the destroyers hunt, and comes back up to
 * look again once it is quiet.
 */
class NautilusAI {
  debug = '';
  /** depth charges close aboard send her deep; pings only when nothing is worth the risk */
  private dcDeep = 0;
  private pingDeep = 0;
  private lastShot = -999;
  constructor(private s: Midway, private v: Vessel) {
    s.world.bus.on('dcDrop', (e) => { if (v.alive && Math.hypot(e.x - v.pos.x, e.y - v.pos.y) < 900) this.dcDeep = s.world.time + 420; });
    s.world.bus.on('ping', (e) => { if (v.alive && Math.hypot(e.by.pos.x - v.pos.x, e.by.pos.y - v.pos.y) < 1200) this.pingDeep = Math.max(this.pingDeep, s.world.time + 240); });
  }
  update(_dt: number) {
    const v = this.v, w = this.s.world, sub = v.sub!;
    // the nearest big ship
    let t: Vessel | null = null, bd = Infinity;
    for (const o of w.vessels) {
      if (!o.alive || o.side === v.side || (o.cls.role !== 'carrier' && o.cls.role !== 'capital')) continue;
      const d = Math.hypot(o.pos.x - v.pos.x, o.pos.y - v.pos.y);
      if (d < bd) { bd = d; t = o; }
    }
    const loaded = v.tubes.some((tb) => tb.loaded);
    const window = !!t && bd < 3500 && loaded && w.time - this.lastShot > 90;
    if (w.time < this.dcDeep || (w.time < this.pingDeep && !window)) {
      sub.orderedDepth = 70; sub.periscopeUp = false; sub.silent = 5;
      v.speedCmd = 0.2; v.course = v.heading;
      this.debug = 'deep, silent';
      return;
    }
    sub.orderedDepth = v.cls.sub!.periscopeDepth; sub.periscopeUp = true;
    if (!t) { v.speedCmd = 0.3; this.debug = 'searching'; return; }
    const lv = t.body.linvel(), spd = (v.cls.torpedoes?.speedKn ?? 46) * KNOT;
    const sol = intercept(v.pos.x, v.pos.y, t.pos.x, t.pos.y, lv.x, lv.y, spd);
    v.course = sol ? sol.heading : Math.atan2(t.pos.y - v.pos.y, t.pos.x - v.pos.x);
    v.speedCmd = bd > 3500 ? 0.7 : 0.35;
    this.debug = `closing ${t.name} ${Math.round(bd)}m`;
    if (window && bd < 2700 && sol && Math.abs(angleDiff(v.heading, sol.heading)) < 0.3) {
      // a periscope solution on a zig-zagging 24-knot carrier is a few degrees out
      const err = (w.rng.next() - 0.5) * 0.16;
      let n = 0;
      for (let i = 0; i < 2; i++) if (w.projectiles.fireTorpedo(v, sol.heading + err + (i - 0.5) * 0.03, { target: t })) n++;
      if (n) { this.lastShot = w.time; this.dcDeep = Math.max(this.dcDeep, w.time + 300); this.debug = 'fired at ' + t.name; }
    }
  }
}

/** full speed to a ship */
class RejoinAI {
  debug = 'rejoin';
  constructor(private v: Vessel, private target: () => Vessel | null) {}
  update(_dt: number) {
    const t = this.target(), v = this.v;
    if (!t) { v.speedCmd = 0.5; return; }
    v.course = Math.atan2(t.pos.y - v.pos.y, t.pos.x - v.pos.x);
    v.speedCmd = Math.hypot(t.pos.x - v.pos.x, t.pos.y - v.pos.y) > 3000 ? 1 : 0.6;
  }
}
