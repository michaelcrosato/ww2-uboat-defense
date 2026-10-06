// U-boat commander AI and the wolfpack blackboard.
// Transit to an attack position ahead and abeam of the convoy (surfaced when dark and far from
// escorts), set up at periscope depth, fire spreads with a proper intercept solution, then go deep
// below the layer, run silent, drop Bold decoys when pinged, wait out the hunt, reload, re-attack.

import type { World } from '../world';
import type { Vessel } from '../vessel';
import type { Contact } from '../sensors';
import { angleDiff, clamp, KNOT, wrapAngle } from '../../core/math';
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
  private side: 1 | -1;
  private stateT = 0;
  private lastReport = -999;
  private lastDecoy = -999;
  private quietT = 0;
  private evadeHeading = 0;
  private fired = 0;
  private reacq = 0;
  /** transit sub-mode (debug overlay) */
  private mode = '';

  constructor(private w: World, private v: Vessel, private pack: Wolfpack) { this.side = w.rng.sign() as 1 | -1; pack.boats.push(this); }

  private convoyContacts(): Contact[] {
    // merchants, and the escort carrier sailing with them (a prize worth any risk); capital ships in the
    // historical battles
    return this.w.sensors.list(this.v.side).filter((c) => c.kind === 'surface' && c.truth && (c.truth.kind === 'merchant' || c.truth.cls.role === 'carrier' || c.truth.cls.role === 'capital') && this.w.time - c.last < 120);
  }
  private escortContacts(): Contact[] {
    return this.w.sensors.list(this.v.side).filter((c) => c.kind === 'surface' && c.truth && c.truth.kind === 'escort' && !c.truth.cls.role && this.w.time - c.last < 60);
  }

  update(dt: number) {
    const v = this.v, w = this.w;
    const s = v.sub!;
    // the escort tutorial's boat waits quietly at periscope depth until the lesson reaches the attack
    if (w.holdFire) { s.orderedDepth = 13; s.periscopeUp = false; v.course = v.heading; v.speedCmd = 0.15; this.debug = 'lesson hold'; return; }
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
    // pings carry for kilometres; only an escort pinging from close by is hunting *us*
    const heard = w.sensors.pingsHeard.filter((p) => p.target === v && Math.hypot(p.by.pos.x - v.pos.x, p.by.pos.y - v.pos.y) < 1600);
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
    this.debug = `${this.state}${this.state === 'transit' ? ':' + this.mode : ''} q${Math.round(this.quietT)} t${Math.round(this.stateT)} e${Math.round(this.nearestEscort())} h${heard.length} d${Math.round(v.keelDepth)}→${Math.round(s.orderedDepth)} bat ${Math.round(s.battery * 100)}%`;
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

  /** the shared convoy estimate dead-reckoned to now */
  private convoyNow(conv: ConvoyEstimate) {
    const dt = Math.min(600, this.w.time - conv.t);
    return { x: conv.x + conv.vx * dt, y: conv.y + conv.vy * dt, err: conv.err + dt * 0.5 };
  }

  /**
   * Get into the convoy's path. Ahead of it (along-track a > 300 m) the boat creeps to a flank station
   * (|cross-track| ≈ 850 m) at periscope depth and lets the convoy come to it. Abeam or astern it runs an
   * "end-around" on the surface when dark or unescorted, otherwise it waits submerged and takes what
   * passes. A low battery is recharged on the surface whenever no escort is near.
   */
  private doTransit(conv: ConvoyEstimate | null, danger: boolean, aggro: number) {
    const v = this.v, s = v.sub!, w = this.w;
    if (!conv) { v.speedCmd = 0.3; s.orderedDepth = 13; return; }
    const now = this.convoyNow(conv);
    const sp = Math.max(0.5, Math.hypot(conv.vx, conv.vy));
    const fx_ = conv.vx / sp, fy_ = conv.vy / sp, nx = -fy_, ny = fx_;
    const rx = v.pos.x - now.x, ry = v.pos.y - now.y;
    const a = rx * fx_ + ry * fy_, c = rx * nx + ry * ny;
    const escortD = this.nearestEscort();
    const dark = w.env.darkness > 0.6;
    const at = (along: number, cross: number) => ({ x: now.x + fx_ * along + nx * cross, y: now.y + fy_ * along + ny * cross });
    // pick the flank we are already on (cheaper than crossing the convoy's bow)
    if (Math.abs(c) > 400) this.side = Math.sign(c) as 1 | -1;
    const recharge = s.battery < 0.35 && escortD > 3000 && !danger;
    let surface = false, target: { x: number; y: number }, kn: number;
    if (a > 300) {
      // ahead: flank station, slow and quiet; the convoy closes on its own
      target = at(Math.min(a, 2600), 850 * this.side);
      const d = Math.hypot(target.x - v.pos.x, target.y - v.pos.y);
      surface = recharge || (!danger && escortD > (dark ? 1500 : 3500) && d > 1500 && s.battery > 0.05);
      kn = surface ? 12 : d > 600 ? 4 : 1.5;
      this.mode = 'station';
    } else {
      const endAround = !danger && (dark || escortD > 2500) && s.battery > 0.05;
      if (endAround) {
        // overtake well out on the flank, then cut in ahead
        target = at(Math.max(a + 900, 2200), 1500 * this.side);
        surface = true;
        kn = 18;
        this.mode = 'end-around';
      } else {
        // pinned abeam/astern: wait at periscope depth for whatever passes
        target = at(a, Math.max(700, Math.abs(c)) * this.side);
        kn = 2;
        surface = recharge;
        this.mode = 'wait';
      }
    }
    s.orderedDepth = surface ? 0 : 13;
    s.periscopeUp = !surface;
    this.steer(target.x, target.y, kn);
    // night surface attack: penetrate on the surface if it is very dark
    const dc = Math.hypot(now.x - v.pos.x, now.y - v.pos.y);
    if (dark && aggro > 0.55 && w.env.moonIntensity < 0.15 && escortD > 900 && dc < 1300) { this.state = 'attack'; this.stateT = 0; return; }
    if (this.targetInRange() && !recharge) { this.state = 'setup'; this.stateT = 0; }
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
    // boats spawn inside torpedo range: hold fire through the opening grace so the escort can react first
    const grace = w.time < dev.num('ai.openingGrace');
    if (!grace && this.stateT > 2.5 - skill * 1.5 && !this.escortInLine(sol.heading, Math.hypot(t.x - v.pos.x, t.y - v.pos.y))) {
      const err = this.w.rng.gauss(0, (1 - skill) * 0.05 + t.err / 4000);
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

  /** an escort between us and the target on the firing bearing would take the fish instead */
  private escortInLine(heading: number, range: number): boolean {
    const v = this.v, c = Math.cos(heading), s = Math.sin(heading);
    for (const e of this.escortContacts()) {
      const dx = e.x - v.pos.x, dy = e.y - v.pos.y;
      const along = dx * c + dy * s, lat = Math.abs(-dx * s + dy * c);
      if (along > 0 && along < range && lat < 60 + along * 0.05) return true;
    }
    return false;
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
