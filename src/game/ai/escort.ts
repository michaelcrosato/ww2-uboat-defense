// Escort captain AI. Screens its station around the convoy sweeping with ASDIC; prosecutes sub
// contacts with classic attack runs: close at ASDIC speed, dead-reckon through the close-range
// dead zone, and roll a pattern timed so the charges reach the estimated depth where the U-boat
// will be. Hedgehog when the contact is firm and ahead. Guns and ramming for surfaced boats.

import type { World } from '../world';
import type { Vessel } from '../vessel';
import type { Convoy } from '../convoy';
import type { Contact } from '../sensors';
import { angleDiff, clamp, fx, KNOT, wrapAngle } from '../../core/math';
import { dev } from '../../core/devSettings';

type State = 'station' | 'investigate' | 'attack' | 'opening' | 'reacquire' | 'surface' | 'rescue';

/** a contact this vague is not worth leaving the screen for */
const MAX_HUNT_ERR = 1200;

export class EscortAI {
  state: State = 'station';
  debug = '';
  target: Contact | null = null;
  private pingT = fx.range(0, 3);
  private sweep = -80;
  private sweepDir = 1;
  private runs = 0;
  private dropped = false;
  private stateT = 0;
  private openAt = { x: 0, y: 0 };
  private flareT = 0;
  private weave = fx.range(0, 6);
  /** attack-run geometry for the debug overlay */
  private atk = '';
  private depthRun = -1;
  private depthEst = 60;

  constructor(private w: World, private v: Vessel, private c: Convoy, public station: { ahead: number; side: number }) {
    w.bus.on('sunk', (e) => {
      if (e.v.kind !== 'merchant' || !v.alive) return;
      // night attack: illuminate the flank the torpedo came from
      if (w.env.darkness > 0.55 && v.starShells > 0 && Math.hypot(e.v.pos.x - v.pos.x, e.v.pos.y - v.pos.y) < 1600) this.flareT = fx.range(1, 6);
    });
    w.bus.on('torpedoHit', (e) => {
      if (!v.alive || e.target.side !== v.side) return;
      if (w.env.darkness > 0.55 && v.starShells > 0 && Math.hypot(e.target.pos.x - v.pos.x, e.target.pos.y - v.pos.y) < 1600) this.flareT = fx.range(1, 5);
      // nearest escorts investigate the attack area
      if (this.state === 'station' && Math.hypot(e.target.pos.x - v.pos.x, e.target.pos.y - v.pos.y) < 1500 && fx.next() < 0.7) {
        const side = e.target.toLocal(v.pos.x, v.pos.y).y > 0 ? 1 : -1;
        const r = { x: -Math.sin(e.target.heading) * side, y: Math.cos(e.target.heading) * side };
        this.investigate(e.target.pos.x + r.x * 700, e.target.pos.y + r.y * 700);
      }
    });
  }

  private investigate(x: number, y: number) {
    this.state = 'investigate';
    this.stateT = 0;
    this.target = { key: -1, side: this.v.side, kind: 'sub', x, y, err: 400, vx: 0, vy: 0, depth: null, last: this.w.time, firstSeen: this.w.time, sources: 0, lines: [], decoy: false, truth: null, strength: 0.3, classified: 'U-boat?' };
  }

  update(dt: number) {
    const v = this.v, w = this.w;
    this.stateT += dt;
    this.pingT -= dt;
    const skill = dev.num('ai.skill');
    const aggro = dev.num('ai.escortAggro');
    // star shells over the convoy when attacked at night
    if (this.flareT > 0) {
      this.flareT -= dt;
      if (this.flareT <= 0 && v.starShells > 0) {
        const side = fx.sign();
        const f = { x: Math.cos(this.c.heading), y: Math.sin(this.c.heading) };
        const tx = this.c.x + f.x * fx.range(-600, 300) - f.y * side * fx.range(500, 900);
        const ty = this.c.y + f.y * fx.range(-600, 300) + f.x * side * fx.range(500, 900);
        if (w.projectiles.fireStarShell(v, tx, ty)) this.flareT = v.starShells > 2 ? fx.range(6, 12) : 0;
      }
    }
    // choose the best enemy contact
    const contacts = w.sensors.list(v.side).filter((c) => c.kind === 'sub');
    const surfaced = contacts.find((c) => c.truth && c.truth.alive && c.truth.sub?.surfaced && w.time - c.last < 4 && Math.hypot(c.x - v.pos.x, c.y - v.pos.y) < 2200);
    if (surfaced && this.state !== 'surface') { this.state = 'surface'; this.target = surfaced; this.stateT = 0; }
    if (this.state === 'station' || this.state === 'reacquire') {
      const near = contacts
        .filter((c) => w.time - c.last < 45 && c.err < 500 && Math.hypot(c.x - v.pos.x, c.y - v.pos.y) < 2600 * (0.6 + aggro * 0.6))
        .sort((a, b) => Math.hypot(a.x - v.pos.x, a.y - v.pos.y) - Math.hypot(b.x - v.pos.x, b.y - v.pos.y))[0];
      if (near && this.hunters(near) < 2 && this.mayLeaveScreen()) { this.target = near; this.state = 'investigate'; this.stateT = 0; }
    }
    switch (this.state) {
      case 'station': this.doStation(dt); break;
      case 'investigate': this.doInvestigate(dt, skill); break;
      case 'attack': this.doAttack(dt, skill); break;
      case 'opening': this.doOpening(); break;
      case 'reacquire': this.doReacquire(dt); break;
      case 'surface': this.doSurface(dt); break;
      case 'rescue': this.doRescue(); break;
    }
    // night searchlight on surfaced contacts in range
    const tgt = this.target?.truth;
    v.searchlightOn = !!(w.env.darkness > 0.55 && this.state === 'surface' && tgt && Math.hypot(tgt.pos.x - v.pos.x, tgt.pos.y - v.pos.y) < 700) && !v.stats.has('ks_star_gazer');
    if (v.searchlightOn && tgt) v.searchlightYaw = wrapAngle(Math.atan2(tgt.pos.y - v.pos.y, tgt.pos.x - v.pos.x) - v.heading);
    this.debug = `${this.state}${this.target ? ' err ' + Math.round(this.target.err) : ''}${this.state === 'attack' ? ' ' + this.atk : ''}`;
  }

  /** keep `ai.screen` AI escorts on station (only when there are enough escorts to spare one) */
  private mayLeaveScreen(): boolean {
    const others = this.w.vessels.filter((o) => o !== this.v && o.alive && o.ai instanceof EscortAI);
    const screening = others.filter((o) => (o.ai as EscortAI).state === 'station' || (o.ai as EscortAI).state === 'rescue').length;
    return screening >= Math.min(dev.num('ai.screen'), others.length);
  }

  private hunters(c: Contact) {
    let n = 0;
    for (const o of this.w.vessels) if (o !== this.v && o.ai instanceof EscortAI && o.ai.target === c && o.ai.state !== 'station') n++;
    return n;
  }

  private steer(x: number, y: number, kn: number) {
    const v = this.v;
    v.course = this.avoid(Math.atan2(y - v.pos.y, x - v.pos.x));
    v.speedCmd = clamp((kn * KNOT) / v.maxSpeed, 0, 1);
  }

  /** bend the course around friendly hulls ahead (escorts weave through the convoy columns) */
  private avoid(course: number): number {
    const v = this.v, c = Math.cos(course), s = Math.sin(course);
    const look = 150 + Math.abs(v.speed) * 22;
    let turn = 0;
    for (const o of this.w.vessels) {
      if (o === v || !o.alive || o.side !== v.side || (o.sub && o.submerged)) continue;
      const dx = o.pos.x - v.pos.x, dy = o.pos.y - v.pos.y, d = Math.hypot(dx, dy);
      if (d > look + o.cls.length) continue;
      const ahead = dx * c + dy * s;
      if (ahead <= 0) continue;
      const lat = -dx * s + dy * c;   // > 0: the other hull is to starboard
      const clear = (o.cls.beam + v.cls.beam) / 2 + o.cls.length * 0.55 + 30;
      if (Math.abs(lat) < clear) turn += (lat > 0 ? -1 : 1) * 0.7 * (1 - d / (look + o.cls.length));
    }
    return wrapAngle(course + clamp(turn, -1.2, 1.2));
  }

  private sweepPing(centerBearing: number | null) {
    const v = this.v;
    if (this.pingT > 0 || !v.cls.sensors.asdic) return;
    this.pingT = 3.2 / v.stats.mul('ping_rate_pct');
    let brg: number;
    if (centerBearing !== null) brg = centerBearing + fx.gauss(0, 0.06);
    else {
      this.sweep += 12 * this.sweepDir;
      if (Math.abs(this.sweep) >= 84) this.sweepDir *= -1;
      brg = v.heading + this.sweep * Math.PI / 180;
    }
    const arc = dev.str('game.asdic') === 'arcade' ? Math.PI * 2 : 16 * Math.PI / 180;
    this.w.sensors.ping(v, brg, arc);
  }

  private doStation(dt: number) {
    const c = this.c, v = this.v;
    this.weave += dt * 0.05;
    const ahead = this.station.ahead + Math.sin(this.weave * 1.3) * 180;
    const side = this.station.side + Math.cos(this.weave) * 120;
    const cs = Math.cos(c.heading), sn = Math.sin(c.heading);
    const tx = c.x + ahead * cs - side * sn, ty = c.y + ahead * sn + side * cs;
    const d = Math.hypot(tx - v.pos.x, ty - v.pos.y);
    this.steer(tx + cs * 200, ty + sn * 200, d > 600 ? 16 : (c.speed / KNOT) + 3);
    this.sweepPing(null);
    // quiet water and lifeboats close by: stop for survivors
    if (dev.bool('ai.rescue') && this.stateT > 20 && this.boat() && !this.contactNear(3000)) { this.state = 'rescue'; this.stateT = 0; }
  }

  private boat() {
    const v = this.v;
    let best: { x: number; y: number } | null = null, bd = 1500;
    for (const b of this.w.projectiles.boats) {
      if (b.side !== v.side || b.life <= 0) continue;
      const d = Math.hypot(b.x - v.pos.x, b.y - v.pos.y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  private contactNear(r: number) {
    const v = this.v, w = this.w;
    return w.sensors.list(v.side).some((c) => c.kind === 'sub' && w.time - c.last < 60 && Math.hypot(c.x - v.pos.x, c.y - v.pos.y) < r);
  }

  private doRescue() {
    const v = this.v, b = this.boat();
    if (!b || this.contactNear(2500) || this.stateT > 150) { this.state = 'station'; this.stateT = 0; return; }
    const d = Math.hypot(b.x - v.pos.x, b.y - v.pos.y);
    // come alongside dead slow (the pickup needs < 2.2 m/s)
    this.steer(b.x, b.y, d > 400 ? 14 : d > 120 ? 6 : 2.5);
    this.sweepPing(null);
  }

  private doInvestigate(dt: number, skill: number) {
    const t = this.target!, v = this.v, w = this.w;
    if (!t || (t.truth && !t.truth.alive) || t.err > MAX_HUNT_ERR) { this.state = 'station'; this.target = null; this.stateT = 0; return; }
    if (this.stateT > 160 || w.time - t.last > 70) { this.state = 'reacquire'; this.stateT = 0; return; }
    const d = Math.hypot(t.x - v.pos.x, t.y - v.pos.y);
    this.steer(t.x, t.y, d > 1200 ? 18 : 13);
    this.sweepPing(Math.atan2(t.y - v.pos.y, t.x - v.pos.x));
    // firm ASDIC contact -> attack
    if (w.time - t.last < 6 && t.err < 90 + (1 - skill) * 60 && d < 1100) { this.state = 'attack'; this.stateT = 0; this.dropped = false; }
  }

  private depthGuess() {
    const t = this.target!;
    if (t.depth !== null) return clamp(t.depth, 25, 220);
    // a firm contact: an experienced team judges depth from the range at which the echo was lost
    // under the bow (noise shrinks with ai.skill); drawn once per run so the pattern is consistent
    const tr = t.truth;
    if (tr && tr.alive && this.w.time - t.last < 10) {
      if (this.depthRun !== this.runs) { this.depthRun = this.runs; this.depthEst = tr.keelDepth + fx.gauss(0, 12 + (1 - dev.num('ai.skill')) * 35); }
      return clamp(this.depthEst, 25, 220);
    }
    // no depth from the set (pre-1944): assume the boat has been going down at ~0.5 m/s since it was
    // found, and bracket around that guess on successive runs
    const est = clamp(30 + (this.w.time - t.firstSeen) * 0.5, 40, 160);
    const bracket = [0, 30, -25, 55, -40];
    return clamp(est + bracket[this.runs % bracket.length], 25, 220);
  }

  private doAttack(dt: number, skill: number) {
    const t = this.target!, v = this.v, w = this.w;
    if (!t || (t.truth && !t.truth.alive)) { this.state = 'station'; this.target = null; return; }
    const atkKn = v.cls.id === 'corvette' ? 12 : 14;
    const spd = Math.max(3, atkKn * KNOT);
    const depth = this.depthGuess();
    const sinkT = depth / 2.6;
    // predicted position when the charges reach depth
    const d0 = Math.hypot(t.x - v.pos.x, t.y - v.pos.y);
    const tArr = d0 / spd;
    // lead the target, but never by more than a submerged boat could plausibly run (~8 kn)
    const tv = Math.hypot(t.vx, t.vy), vk = tv > 4 ? 4 / tv : 1;
    const px = t.x + t.vx * vk * (tArr + sinkT), py = t.y + t.vy * vk * (tArr + sinkT);
    const dist = Math.hypot(px - v.pos.x, py - v.pos.y);
    // hedgehog: fire ahead while the contact is still firm
    const brg = Math.atan2(t.y - v.pos.y, t.x - v.pos.x);
    if (v.hedgehogLeft > 0 && w.time - t.last < 6 && d0 > 150 && d0 < 290 && Math.abs(angleDiff(v.heading, brg)) < 0.2 && this.stateT > 2) {
      w.projectiles.hedgehog(v, 24, 22, d0 - v.cls.length * 0.25);
      this.state = 'opening'; this.openAt = { x: v.pos.x + Math.cos(v.heading) * 500, y: v.pos.y + Math.sin(v.heading) * 500 }; this.runs++;
      return;
    }
    // close fast, slow to attack speed for the final run (ASDIC needs the quieter water)
    this.steer(px, py, dist > 600 ? 18 : atkKn);
    this.sweepPing(brg);
    // drop when the stern is about to pass over the predicted point
    const along = (px - v.pos.x) * Math.cos(v.heading) + (py - v.pos.y) * Math.sin(v.heading);
    this.atk = `a${Math.round(along)} r${Math.round(dist)} age${Math.round(w.time - t.last)} e${Math.round(t.err)}`;
    if (!this.dropped && along < v.cls.length * 0.5 + 40 && dist < 160 + (1 - skill) * 60) {
      const n = v.dcLeft >= 10 ? 10 : Math.max(1, Math.min(5, v.dcLeft));
      if (v.dcLeft > 0) w.projectiles.dcPattern(v, n, 90, depth);
      this.dropped = true;
      this.runs++;
      this.state = 'opening';
      this.openAt = { x: v.pos.x + Math.cos(v.heading) * 650, y: v.pos.y + Math.sin(v.heading) * 650 };
    }
    if (this.stateT > 150) { this.state = 'reacquire'; this.stateT = 0; }
  }

  private doOpening() {
    const v = this.v;
    this.steer(this.openAt.x, this.openAt.y, 15);
    if (Math.hypot(this.openAt.x - v.pos.x, this.openAt.y - v.pos.y) < 120) { this.state = this.runs > 5 || v.dcLeft <= 0 ? 'station' : 'investigate'; this.stateT = 0; }
  }

  private doReacquire(dt: number) {
    const v = this.v, t = this.target;
    if (!t || this.stateT > 75 || t.err > MAX_HUNT_ERR || this.w.time - t.last > 150) { this.state = 'station'; this.target = null; this.runs = 0; return; }
    // circle the last known position pinging around
    const a = this.stateT * 0.07;
    this.steer(t.x + Math.cos(a) * 600, t.y + Math.sin(a) * 600, 12);
    this.sweepPing(null);
    if (this.w.time - t.last < 3 && t.err < 120) { this.state = 'attack'; this.stateT = 0; this.dropped = false; }
  }

  private doSurface(dt: number) {
    const v = this.v, w = this.w, t = this.target;
    const sub = t?.truth;
    if (!t || !sub || !sub.alive || !sub.sub?.surfaced || w.time - t.last > 8) { this.state = sub && sub.alive ? 'investigate' : 'station'; this.stateT = 0; return; }
    const d = Math.hypot(sub.pos.x - v.pos.x, sub.pos.y - v.pos.y);
    const aggro = dev.num('ai.escortAggro');
    // ram if close, else close in firing
    const lead = d / 500;
    const sv = sub.body.linvel();
    const ax = sub.pos.x + sv.x * lead, ay = sub.pos.y + sv.y * lead;
    if (d < 450 && aggro > 0.4) this.steer(ax, ay, 30);
    else this.steer(ax, ay, d > 1200 ? 25 : 16);
    for (const g of v.guns) {
      const on = w.projectiles.aimGun(v, g, ax, ay, dt);
      if (on && g.reload <= 0 && d < g.spec.range) w.projectiles.fireGun(v, g, ax + fx.gauss(0, 8), ay + fx.gauss(0, 8));
    }
  }
}
