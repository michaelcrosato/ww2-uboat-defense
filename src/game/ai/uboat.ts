// U-boat commander AI and the wolfpack blackboard.
// Transit to an attack position ahead and abeam of the convoy (surfaced when dark and far from
// escorts), set up at periscope depth, fire spreads with a proper intercept solution, then go deep
// below the layer, run silent, drop Bold decoys when pinged, wait out the hunt, reload, re-attack.

import type { World } from '../world';
import type { Vessel } from '../vessel';
import type { Contact } from '../sensors';
import { angleDiff, clamp, fx, KNOT, wrapAngle } from '../../core/math';
import { dev } from '../../core/devSettings';

type State = 'transit' | 'setup' | 'attack' | 'evade' | 'reload' | 'flee';

export interface ConvoyEstimate { x: number; y: number; vx: number; vy: number; err: number; t: number }

export class Wolfpack {
  boats: UboatAI[] = [];
  convoy: ConvoyEstimate | null = null;
  report(e: ConvoyEstimate) { if (!this.convoy || e.err < this.convoy.err || e.t - this.convoy.t > 30) this.convoy = e; }
  /** wolfpack call: everyone converges aggressively for a while */
  rally = 0;
}

/** intercept heading for a projectile of speed s from (x,y) to a target moving at (vx,vy) */
export function intercept(x: number, y: number, tx: number, ty: number, vx: number, vy: number, s: number): { heading: number; t: number } | null {
  const dx = tx - x, dy = ty - y;
  const a = vx * vx + vy * vy - s * s, b = 2 * (dx * vx + dy * vy), c = dx * dx + dy * dy;
  let t: number;
  if (Math.abs(a) < 1e-6) t = -c / b;
  else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const r = Math.sqrt(disc);
    const t1 = (-b - r) / (2 * a), t2 = (-b + r) / (2 * a);
    t = Math.min(t1, t2) > 0 ? Math.min(t1, t2) : Math.max(t1, t2);
  }
  if (!(t > 0)) return null;
  return { heading: Math.atan2(dy + vy * t, dx + vx * t), t };
}

export class UboatAI {
  state: State = 'transit';
  debug = '';
  private side = fx.sign();
  private stateT = 0;
  private lastReport = -999;
  private lastDecoy = -999;
  private quietT = 0;
  private evadeHeading = 0;
  private fired = 0;
  private reacq = 0;

  constructor(private w: World, private v: Vessel, private pack: Wolfpack) { pack.boats.push(this); }

  private convoyContacts(): Contact[] {
    return this.w.sensors.list(this.v.side).filter((c) => c.kind === 'surface' && c.truth && c.truth.kind === 'merchant' && this.w.time - c.last < 120);
  }
  private escortContacts(): Contact[] {
    return this.w.sensors.list(this.v.side).filter((c) => c.kind === 'surface' && c.truth && c.truth.kind === 'escort' && this.w.time - c.last < 60);
  }

  update(dt: number) {
    const v = this.v, w = this.w;
    const s = v.sub!;
    this.stateT += dt;
    const aggro = dev.num('ai.uboatAggro');
    // ---- update the shared convoy estimate from our own contacts
    const merch = this.convoyContacts();
    if (merch.length) {
      let x = 0, y = 0, vx = 0, vy = 0, e = 0;
      for (const c of merch) { x += c.x; y += c.y; vx += c.vx; vy += c.vy; e += c.err; }
      const n = merch.length;
      this.pack.report({ x: x / n, y: y / n, vx: vx / n, vy: vy / n, err: e / n, t: w.time });
      // contact reports go out by radio (and can be DF'd)
      if (w.time - this.lastReport > 150 && aggro > 0.2) { this.lastReport = w.time; w.sensors.transmit(v); }
    }
    const conv = this.pack.convoy;
    const heard = w.sensors.pingsHeard.filter((p) => p.target === v);
    const danger = heard.length > 0 || this.nearestEscort() < 700;
    if (danger) this.quietT = 0; else this.quietT += dt;
    // ---- damage response
    if ((v.hpFrac < 0.3 || v.hydro.floodTotal() > 0.35) && this.state !== 'flee') { this.state = 'flee'; this.stateT = 0; }
    switch (this.state) {
      case 'transit': this.doTransit(conv, danger, aggro); break;
      case 'setup': this.doSetup(conv, danger); break;
      case 'attack': this.doAttack(dt, conv); break;
      case 'evade': this.doEvade(heard); break;
      case 'reload': this.doReload(danger); break;
      case 'flee': this.doFlee(conv); break;
    }
    if (s.battery < 0.12 && this.state !== 'evade' && this.state !== 'flee' && this.nearestEscort() > 2500) s.orderedDepth = 0;
    this.debug = `${this.state} d${Math.round(v.keelDepth)}→${Math.round(s.orderedDepth)} bat ${Math.round(s.battery * 100)}%`;
  }

  private nearestEscort(): number {
    let best = 1e9;
    for (const c of this.escortContacts()) best = Math.min(best, Math.hypot(c.x - this.v.pos.x, c.y - this.v.pos.y));
    return best;
  }

  private steer(x: number, y: number, kn: number) {
    const v = this.v;
    v.course = Math.atan2(y - v.pos.y, x - v.pos.x);
    v.speedCmd = clamp((kn * KNOT) / Math.max(0.5, v.maxSpeed), 0, 1);
  }

  private doTransit(conv: ConvoyEstimate | null, danger: boolean, aggro: number) {
    const v = this.v, s = v.sub!, w = this.w;
    if (!conv) { v.speedCmd = 0.3; s.orderedDepth = 13; return; }
    const sp = Math.max(0.5, Math.hypot(conv.vx, conv.vy));
    const fx_ = conv.vx / sp, fy_ = conv.vy / sp;
    // attack position: ahead and abeam of the convoy's track
    const lead = 1500, abeam = 900 * this.side;
    const tx = conv.x + fx_ * lead - fy_ * abeam, ty = conv.y + fy_ * lead + fx_ * abeam;
    const d = Math.hypot(tx - v.pos.x, ty - v.pos.y);
    const escortD = this.nearestEscort();
    const dark = w.env.darkness > 0.6;
    const surface = !danger && escortD > (dark ? 1200 : 3200) && (dark || d > 4000) && s.battery > 0.05;
    s.orderedDepth = surface ? 0 : 13;
    const knots = surface ? 16 : d > 1500 ? 6.5 : 4;
    this.steer(tx, ty, knots);
    s.periscopeUp = !surface && d < 2500;
    // night surface attack: penetrate on the surface if it is very dark
    if (dark && aggro > 0.55 && w.env.moonIntensity < 0.15 && escortD > 900 && d < 900) { this.state = 'attack'; this.stateT = 0; return; }
    if (d < 500 || (this.targetInRange() && d < 1500)) { this.state = 'setup'; this.stateT = 0; }
  }

  private targetInRange(): Contact | null {
    const v = this.v;
    const spec = v.cls.torpedoes!;
    let best: Contact | null = null, score = 0;
    for (const c of this.convoyContacts()) {
      const d = Math.hypot(c.x - v.pos.x, c.y - v.pos.y);
      if (d < 350 || d > Math.min(1900, spec.range * 0.6)) continue;
      const grt = c.truth?.grt ?? 5000;
      const sc = grt / (d + 300) * (c.truth?.cls.id === 'tanker' ? 1.4 : 1) * (c.truth?.straggler ? 1.5 : 1);
      if (sc > score) { score = sc; best = c; }
    }
    return best;
  }

  private doSetup(conv: ConvoyEstimate | null, danger: boolean) {
    const v = this.v, s = v.sub!;
    s.orderedDepth = s.orderedDepth < 1 && this.w.env.darkness > 0.6 && !danger ? 0 : 13;
    s.periscopeUp = true;
    const t = this.targetInRange();
    if (t) {
      // turn to bring the bow onto the firing bearing
      const sol = intercept(v.pos.x, v.pos.y, t.x, t.y, t.vx, t.vy, v.cls.torpedoes!.speedKn * KNOT);
      if (sol) {
        v.course = sol.heading;
        v.speedCmd = 0.25;
        if (Math.abs(angleDiff(v.heading, sol.heading)) < 0.7) { this.state = 'attack'; this.stateT = 0; }
      }
    } else if (conv) this.steer(conv.x, conv.y, 3);
    if (this.stateT > 120) { this.state = 'transit'; this.stateT = 0; }
  }

  private doAttack(dt: number, conv: ConvoyEstimate | null) {
    const v = this.v, w = this.w, s = v.sub!;
    const spec = v.cls.torpedoes!;
    const t = this.targetInRange();
    if (!t) { if (this.stateT > 30) { this.state = this.fired ? 'evade' : 'transit'; this.stateT = 0; } if (conv) this.steer(conv.x, conv.y, s.orderedDepth < 1 ? 10 : 4); return; }
    const spd = spec.speedKn * KNOT;
    const sol = intercept(v.pos.x, v.pos.y, t.x, t.y, t.vx, t.vy, spd);
    if (!sol) return;
    const rel = angleDiff(v.heading, sol.heading);
    const bowOk = Math.abs(rel) < 1.4, sternOk = Math.abs(angleDiff(v.heading + Math.PI, sol.heading)) < 0.7;
    const skill = dev.num('ai.skill');
    if (this.stateT > 2.5 - skill * 1.5) {
      const err = fx.gauss(0, (1 - skill) * 0.05 + t.err / 4000);
      const n = Math.min(3, v.tubes.filter((tb) => tb.loaded && !tb.stern).length);
      let shot = 0;
      if (bowOk && n > 0) {
        for (let i = 0; i < n; i++) if (w.projectiles.fireTorpedo(v, sol.heading + err + (i - (n - 1) / 2) * 0.035, { target: t.truth })) shot++;
      } else if (sternOk) {
        if (w.projectiles.fireTorpedo(v, sol.heading + err, { stern: true, target: t.truth })) shot++;
      }
      if (shot) {
        this.fired += shot;
        this.state = 'evade';
        this.stateT = 0;
        this.evadeHeading = wrapAngle(v.heading + Math.PI * 0.6 * this.side);
        return;
      }
    }
    v.course = sol.heading;
    v.speedCmd = s.orderedDepth < 1 ? 0.35 : 0.25;
    if (this.stateT > 50) { this.state = 'evade'; this.stateT = 0; }
  }

  private doEvade(heard: { by: Vessel; bearingFrom: number }[]) {
    const v = this.v, s = v.sub!, w = this.w;
    const test = v.cls.sub!.testDepth;
    const deep = Math.min(test * 0.82, Math.max(w.layerDepth + 30, 90));
    s.orderedDepth = deep;
    s.periscopeUp = false;
    if (this.stateT < 4 && v.keelDepth < 20) s.crash = Math.max(s.crash, 6);
    // turn away from the pinging escort, run silent when hunted
    if (heard.length) {
      const away = heard[0].bearingFrom + Math.PI + (this.side * 0.9);
      this.evadeHeading = wrapAngle(away);
      if (s.silent <= 0) s.silent = 40;
      const dEsc = Math.hypot(heard[0].by.pos.x - v.pos.x, heard[0].by.pos.y - v.pos.y);
      if (v.decoys > 0 && dEsc < 800 && w.time - this.lastDecoy > 45) {
        this.lastDecoy = w.time;
        v.decoys--;
        w.projectiles.releaseDecoy(v, 'bold', 90 * v.stats.mul('decoy_duration_pct'));
        this.evadeHeading = wrapAngle(this.evadeHeading + this.side * 1.2);
      }
    }
    v.course = this.evadeHeading;
    v.speedCmd = s.silent > 0 ? 0.35 : 0.6;
    if (this.quietT > 70 && this.stateT > 40) { this.state = 'reload'; this.stateT = 0; }
  }

  private doReload(danger: boolean) {
    const v = this.v, s = v.sub!;
    s.orderedDepth = danger ? Math.max(s.orderedDepth, 60) : 13;
    v.speedCmd = 0.35;
    const loaded = v.tubes.filter((t) => t.loaded).length;
    if (danger) { this.state = 'evade'; this.stateT = 0; return; }
    if (loaded >= Math.min(2, v.tubes.length) || (v.torpedoReloads <= 0 && loaded > 0)) { this.state = 'transit'; this.stateT = 0; this.reacq++; }
    if (loaded === 0 && v.torpedoReloads <= 0) { this.state = 'flee'; this.stateT = 0; }
  }

  private doFlee(conv: ConvoyEstimate | null) {
    const v = this.v, s = v.sub!;
    // a badly holed boat blows ballast and runs on the surface
    if (v.hydro.floodTotal() > 0.3 || v.hpFrac < 0.2) { s.orderedDepth = 0; if (v.submerged && s.blow <= 0) s.blow = 12; }
    else s.orderedDepth = 60;
    const away = conv ? Math.atan2(v.pos.y - conv.y, v.pos.x - conv.x) : v.heading;
    v.course = away;
    v.speedCmd = 1;
  }
}
