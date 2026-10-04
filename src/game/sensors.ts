// Detection and the contact picture. Each side keeps its own estimates; AI and the HUD read only
// those, never ground truth (unless fog of war is off).
//  * Noise: speed, cavitation (shallow + fast), silent running, machinery, the noise stat.
//  * Hydrophones: bearing-only contacts; range scales with target noise, listener self-noise,
//    sea state and the thermal layer.
//  * ASDIC: a narrow beam (or an arcade pulse). Echoes give range + bearing. Deep targets drop out
//    of the beam at close range (the "dead zone" that made blind depth-charge runs necessary),
//    targets below the layer are faint, recent explosions quench returns, Bold decoys echo too.
//  * Lookouts: visibility from the environment, target size/illumination/smoke/searchlights.
//  * Radar (from 1941/42) for surfaced targets; HF/DF bearings when a U-boat transmits.

import type { World } from './world';
import type { Vessel } from './vessel';
import type { Side } from './vesselClasses';
import { angleDiff, clamp, fx, KNOT } from '../core/math';
import { dev } from '../core/devSettings';

export const SRC = { VISUAL: 1, ASDIC: 2, HYDRO: 4, RADAR: 8, HFDF: 16, AIR: 32, PERISCOPE: 64 } as const;

export interface BearingLine { x: number; y: number; bearing: number; err: number; t: number; src: number }

export interface Contact {
  key: number;                 // target vessel id (or decoy key)
  side: Side;                  // owner
  kind: 'sub' | 'surface' | 'unknown';
  x: number; y: number;        // estimated position
  err: number;                 // uncertainty radius (m)
  vx: number; vy: number;      // estimated velocity
  depth: number | null;
  last: number;                // time of last fix
  firstSeen: number;
  sources: number;             // SRC bits of the latest updates
  lines: BearingLine[];
  decoy: boolean;              // ground truth (for debug only)
  truth: Vessel | null;
  strength: number;
  classified: string;          // e.g. 'U-boat', 'Tanker', 'Escort'
}

export class Sensors {
  contacts: Record<Side, Map<number, Contact>> = { allied: new Map(), axis: new Map() };
  private seen = new Map<number, Record<Side, number>>();
  private acc = 0;
  /** recent explosions (quench ASDIC) */
  private blasts: { x: number; y: number; t: number }[] = [];
  /** pings heard by subs: for HUD warnings */
  pingsHeard: { by: Vessel; t: number; bearingFrom: number; target: Vessel }[] = [];
  /** U-boat radio transmissions (HF/DF) */
  private transmissions: { v: Vessel; t: number }[] = [];

  constructor(private w: World) {
    w.bus.on('explosion', (e) => { if (e.kind !== 'surface' || e.z < 0) this.blasts.push({ x: e.x, y: e.y, t: w.time }); });
  }

  // ------------------------------------------------------------------ noise
  noiseOf(v: Vessel): number {
    if (!v.alive) return 0;
    const kn = Math.abs(v.hydro.fwdSpeed) / KNOT;
    let n = v.cls.noise + 18 * Math.log10(Math.max(0.6, kn) / 5);
    if (v.sub) {
      if (v.submerged) {
        n = v.cls.noise - 14 + 16 * Math.log10(Math.max(0.5, kn) / 3);
        const cav = 4 + v.keelDepth / 22;
        if (kn > cav) n += 7 + (kn - cav) * 1.5;
        if (v.sub.silent > 0) n -= 7;
        if (v.sub.blow > 0 || v.sub.crash > 0) n += 12;
        if (v.sub.snorkel) n += 10;
      } else n = v.cls.noise + 4 + 14 * Math.log10(Math.max(0.6, kn) / 6);
      if (v.stats.has('ks_silent_hunter')) n -= 4;
    }
    if (v.muzzleFlash > 0) n += 10;
    if (v.wolfHowl > 0) n -= 10 * Math.log10(1 + v.stats.power('pow_wolf_howl') / 25);
    n += 10 * Math.log10(v.stats.mul('noise_pct'));
    return n;
  }

  /** listener self-noise penalty factor (0..1) — fast escorts are deaf */
  private hearing(v: Vessel): number {
    const kn = Math.abs(v.hydro.fwdSpeed) / KNOT;
    if (v.sub) return v.submerged ? clamp(1.25 - kn / 14, 0.2, 1) : 0.45;
    return clamp(1.2 - Math.max(0, kn - 8) / 11, 0, 1);
  }

  private layerFactor(a: Vessel, depthB: number): number {
    const L = this.w.layerDepth;
    if (L <= 0) return 1;
    const da = a.sub ? a.keelDepth : 2;
    return (da > L) !== (depthB > L) ? 0.42 : 1;
  }

  // ------------------------------------------------------------------ update
  update(dt: number) {
    const w = this.w;
    this.acc += dt;
    for (const v of w.vessels) v.noise = this.noiseOf(v);
    if (this.acc < 0.2) return;
    const step = this.acc;
    this.acc = 0;
    this.blasts = this.blasts.filter((b) => w.time - b.t < 9);
    this.pingsHeard = this.pingsHeard.filter((p) => w.time - p.t < 6);
    this.transmissions = this.transmissions.filter((t) => w.time - t.t < 30);
    const env = w.env;
    for (const obs of w.vessels) {
      if (!obs.alive) continue;
      const hear = this.hearing(obs);
      const look = obs.cls.sensors.lookout * obs.stats.mul('lookout_range_pct');
      for (const tgt of w.vessels) {
        if (!tgt.alive || tgt.side === obs.side) continue;
        const dx = tgt.pos.x - obs.pos.x, dy = tgt.pos.y - obs.pos.y;
        const d = Math.hypot(dx, dy);
        // ---- visual
        if (d < look * 1.6) {
          let size = tgt.sub ? (tgt.sub.surfaced ? 0.55 : tgt.atPeriscopeDepth && tgt.sub.periscope > 0.5 ? 0.12 + (Math.abs(tgt.hydro.fwdSpeed) > 1.5 ? 0.12 : 0) : 0) : tgt.kind === 'merchant' ? 1.25 : 1;
          if (tgt.sub && tgt.submerged && tgt.depth < w.theater.clarity * 0.5 && env.darkness < 0.4) size = Math.max(size, 0.05 * (1 - tgt.depth / (w.theater.clarity * 0.5)));
          if (obs.sub && obs.submerged && !(obs.atPeriscopeDepth && obs.sub.periscope > 0.7)) size = 0;   // blind below periscope depth
          if (size > 0) {
            const lit = this.illumination(tgt);
            let vis = env.visibility * (1 + lit * 4) * tgt.stats.mul('visual_sig_pct') * (tgt.visualBoost ?? 1);
            if (tgt.searchlightOn) vis *= 3;
            if (tgt.fires.length) vis *= 1 + tgt.fires.length * 0.8;
            if (tgt.muzzleFlash > 0) vis *= 3;
            if (!tgt.sub && env.darkness < 0.4) vis *= 1.4;  // funnel smoke by day
            if (obs.sub && obs.atPeriscopeDepth) vis *= 0.7 * obs.stats.mul('periscope_pct');
            if (tgt.stats.has('ks_night_surface') && env.darkness < 0.4 && tgt.sub?.surfaced) vis *= 1.3;
            const smoke = w.projectiles ? w.projectiles.smokeBetween(obs.pos.x, obs.pos.y, tgt.pos.x, tgt.pos.y) : 0;
            const range = Math.min(look * 1.6, vis * size) * (1 - smoke);
            if (d < range || (d < range * 1.3 && fx.next() < 0.3)) {
              this.markSeen(tgt, obs.side);
              this.fix(obs.side, tgt, tgt.pos.x + fx.gauss(0, d * 0.01), tgt.pos.y + fx.gauss(0, d * 0.01), 4 + d * 0.015, obs.sub && obs.submerged ? SRC.PERISCOPE : SRC.VISUAL, tgt.sub ? (tgt.submerged ? tgt.depth : 0) : null);
            }
          }
        }
        // ---- radar (surfaced targets)
        const radar = obs.cls.sensors.radar ?? 0;
        if (radar > 0 && w.year >= (obs.side === 'allied' ? 1941 : 1944) && (!obs.sub || obs.sub.surfaced)) {
          const R = radar * obs.stats.mul('radar_range_pct') * (1 - w.ocean.params.seaState * 0.045);
          const surfaced = !tgt.sub || tgt.sub.surfaced;
          const scope = tgt.sub && tgt.atPeriscopeDepth && tgt.sub.periscope > 0.7;
          const r = surfaced ? R * (tgt.sub ? 0.6 : 1) : scope ? R * 0.18 : 0;
          if (r > 0 && d < r && fx.next() < 0.85) this.fix(obs.side, tgt, tgt.pos.x + fx.gauss(0, 8 + d * 0.01), tgt.pos.y + fx.gauss(0, 8 + d * 0.01), 10 + d * 0.012, SRC.RADAR, tgt.sub ? 0 : null);
        }
        // ---- hydrophones (bearing only)
        const H = obs.cls.sensors.hydrophone;
        if (H > 0 && hear > 0) {
          const nf = Math.pow(10, (tgt.noise - 125) / 20);
          let R = H * obs.stats.mul('sonar_range_pct') * nf * hear * this.layerFactor(obs, tgt.sub ? tgt.keelDepth : 2) * (1 - w.ocean.params.seaState * 0.05);
          if (obs.stats.has('ks_silent_listener')) R *= 2;
          if (obs.sub && !obs.submerged) R *= 0.5;
          if (d < R && fx.next() < 0.7) {
            const errDeg = (2 + (d / R) * 7) / obs.stats.mul('sonar_accuracy_pct');
            const brg = Math.atan2(dy, dx) + fx.gauss(0, errDeg * Math.PI / 180);
            this.bearing(obs.side, tgt, obs.pos.x, obs.pos.y, brg, errDeg * Math.PI / 180, SRC.HYDRO, d);
          }
        }
      }
    }
    // HF/DF bearings on transmissions
    for (const tr of this.transmissions) {
      if (w.time - tr.t > step + 0.01) continue;
      for (const obs of w.vessels) {
        if (!obs.alive || obs.side === tr.v.side || !obs.cls.sensors.hfdf || w.year < 1941) continue;
        const brg = Math.atan2(tr.v.pos.y - obs.pos.y, tr.v.pos.x - obs.pos.x) + fx.gauss(0, 0.03);
        this.bearing(obs.side, tr.v, obs.pos.x, obs.pos.y, brg, 0.035, SRC.HFDF, Math.hypot(tr.v.pos.x - obs.pos.x, tr.v.pos.y - obs.pos.y));
      }
    }
    // age contacts
    for (const side of ['allied', 'axis'] as Side[]) {
      for (const [k, c] of this.contacts[side]) {
        const age = w.time - c.last;
        c.x += c.vx * step; c.y += c.vy * step;
        c.err += step * (2 + Math.hypot(c.vx, c.vy) * 0.6);
        c.lines = c.lines.filter((l) => w.time - l.t < 25);
        if (age > 110 || (c.truth && !c.truth.alive && age > 4)) this.contacts[side].delete(k);
      }
    }
  }

  /** light falling on a vessel from flares, searchlights and fires (0..~2) */
  illumination(v: Vessel): number {
    const w = this.w;
    let lit = 0;
    if (!w.projectiles) return 0;
    for (const f of w.projectiles.flares) {
      const d = Math.hypot(f.x - v.pos.x, f.y - v.pos.y, f.z);
      if (d < f.radius) lit += (1 - d / f.radius) * 1.4;
    }
    for (const o of w.vessels) {
      if (!o.searchlightOn || !o.alive) continue;
      const dx = v.pos.x - o.pos.x, dy = v.pos.y - o.pos.y, d = Math.hypot(dx, dy);
      const beam = o.heading + o.searchlightYaw;
      if (d < 420 * o.stats.mul('searchlight_pct') && Math.abs(angleDiff(beam, Math.atan2(dy, dx))) < 0.12) lit += 1.5;
    }
    if (v.fires.length) lit += 0.6;
    return lit;
  }

  markSeen(v: Vessel, side: Side) {
    let s = this.seen.get(v.id);
    if (!s) { s = { allied: -99, axis: -99 }; this.seen.set(v.id, s); }
    s[side] = this.w.time;
  }
  seenBy(v: Vessel, side: Side, within = 1.5) { const s = this.seen.get(v.id); return !!s && this.w.time - s[side] < within; }
  seenByPlayer(v: Vessel) { return this.seenBy(v, this.w.playerSide, 1.6); }

  private classify(t: Vessel) { return t.kind === 'uboat' ? 'U-boat' : t.kind === 'escort' ? 'Escort' : t.cls.id === 'tanker' ? 'Tanker' : 'Merchant'; }

  /** register a position fix */
  fix(side: Side, t: Vessel | null, x: number, y: number, err: number, src: number, depth: number | null, key?: number, decoy = false) {
    const k = key ?? t!.id;
    const map = this.contacts[side];
    let c = map.get(k);
    const now = this.w.time;
    if (!c) {
      c = { key: k, side, kind: t ? (t.kind === 'uboat' ? 'sub' : 'surface') : 'sub', x, y, err, vx: 0, vy: 0, depth, last: now, firstSeen: now, sources: src, lines: [], decoy, truth: t, strength: 1, classified: t ? this.classify(t) : 'U-boat?' };
      map.set(k, c);
      if (side === this.w.playerSide && (src & (SRC.ASDIC | SRC.VISUAL | SRC.RADAR | SRC.PERISCOPE))) this.w.emit('message', { text: this.contactCall(c, src), side, kind: 'crew' });
      return c;
    }
    const dt = Math.max(0.2, now - c.last);
    // blend: trust the new fix according to relative errors
    const k1 = clamp(c.err / (c.err + err), 0.3, 1);
    const nx = c.x + (x - c.x) * k1, ny = c.y + (y - c.y) * k1;
    if (dt < 40 && src !== SRC.HYDRO) {
      const kv = 0.35;
      c.vx += ((nx - c.x) / dt - c.vx) * kv;
      c.vy += ((ny - c.y) / dt - c.vy) * kv;
      const sp = Math.hypot(c.vx, c.vy);
      if (sp > 25) { c.vx *= 25 / sp; c.vy *= 25 / sp; }
    }
    c.x = nx; c.y = ny;
    c.err = Math.min(c.err, err) * 0.7 + err * 0.3;
    c.last = now;
    c.sources = src;
    if (depth !== null) c.depth = depth;
    if (t) c.kind = t.kind === 'uboat' ? 'sub' : 'surface';
    return c;
  }

  private contactCall(c: Contact, src: number) {
    const brg = (Math.round(((Math.atan2(c.y - (this.w.player?.pos.y ?? 0), c.x - (this.w.player?.pos.x ?? 0)) / Math.PI * 180 + 90) + 360) % 360)).toString().padStart(3, '0');
    if (src & SRC.ASDIC) return `Asdic contact, bearing ${brg}!`;
    if (src & SRC.RADAR) return `Radar: small contact bearing ${brg}.`;
    if (src & SRC.PERISCOPE) return `Target in sight, bearing ${brg}: ${c.classified}.`;
    return `Lookout: ${c.classified} bearing ${brg}!`;
  }

  /** passive bearing: refine a contact from intersecting bearing lines */
  bearing(side: Side, t: Vessel, ox: number, oy: number, brg: number, err: number, src: number, trueDist: number) {
    const map = this.contacts[side];
    let c = map.get(t.id);
    const now = this.w.time;
    const line: BearingLine = { x: ox, y: oy, bearing: brg, err, t: now, src };
    if (!c) {
      // place the estimate along the bearing at a guessed range
      const guess = clamp(trueDist * fx.range(0.6, 1.5), 300, 4000);
      c = this.fix(side, t, ox + Math.cos(brg) * guess, oy + Math.sin(brg) * guess, Math.max(250, guess * 0.5), src, null);
      c.lines.push(line);
      return;
    }
    c.lines.push(line);
    if (c.lines.length > 6) c.lines.shift();
    // cross-fix: intersect with an older line from a different position
    for (const l of c.lines) {
      if (l === line) continue;
      const sep = Math.hypot(l.x - ox, l.y - oy);
      if (sep < 120 || Math.abs(angleDiff(l.bearing, brg)) < 0.08) continue;
      const p = intersect(l.x, l.y, l.bearing, ox, oy, brg);
      if (p) {
        const e = Math.max(30, Math.hypot(p.x - ox, p.y - oy) * err * 2);
        if (e < c.err) this.fix(side, t, p.x, p.y, e, src, null);
        break;
      }
    }
    // otherwise slide the estimate onto the new bearing
    const d = Math.hypot(c.x - ox, c.y - oy);
    const ex = ox + Math.cos(brg) * d, ey = oy + Math.sin(brg) * d;
    c.x += (ex - c.x) * 0.4; c.y += (ey - c.y) * 0.4;
    c.last = Math.max(c.last, now - 5);
  }

  // ------------------------------------------------------------------ active sonar
  /** an ASDIC ping. arc in radians (full width); returns echoes */
  ping(v: Vessel, bearing: number, arc: number, rangeMul = 1): { x: number; y: number; doppler: number; target: Vessel | null; decoy: boolean }[] {
    const w = this.w;
    const out: { x: number; y: number; doppler: number; target: Vessel | null; decoy: boolean }[] = [];
    if (!v.cls.sensors.asdic || v.stats.has('ks_silent_listener')) return out;
    v.asdicBearing = bearing; v.pinging = 1.2;
    w.emit('ping', { by: v, bearing, arc });
    const hear = this.hearing(v);
    const R = v.cls.sensors.asdic * v.stats.mul('sonar_range_pct') * rangeMul * (1 - w.ocean.params.seaState * 0.05) * Math.max(0.05, hear);
    const quench = (x: number, y: number) => this.blasts.some((b) => Math.hypot(b.x - x, b.y - y) < 500) ? 0.3 : 1;
    const consider = (tx: number, ty: number, depth: number, target: Vessel | null, decoy: boolean, aspect: number) => {
      const dx = tx - v.pos.x, dy = ty - v.pos.y, d = Math.hypot(dx, dy);
      if (d > R || d < 25) return;
      if (Math.abs(angleDiff(bearing, Math.atan2(dy, dx))) > arc / 2) return;
      // beam depression limit: deep targets vanish at close range
      if (Math.atan2(depth, d) > 0.42 && dev.str('game.asdic') !== 'arcade') return;
      const layer = this.layerFactor(v, depth);
      const p = 0.92 * (1 - Math.pow(d / (R * layer), 3)) * quench(tx, ty) * (0.55 + 0.45 * aspect);
      if (fx.next() > p) return;
      const errR = (6 + d * 0.025) / v.stats.mul('sonar_accuracy_pct');
      const ex = tx + fx.gauss(0, errR), ey = ty + fx.gauss(0, errR);
      let dop = 0;
      if (target) {
        const tv = target.body.linvel(), ov = v.body.linvel();
        dop = -(((tv.x - ov.x) * dx + (tv.y - ov.y) * dy) / d);
      }
      out.push({ x: ex, y: ey, doppler: dop, target, decoy });
      const depthKnown = w.year >= 1944 ? depth + fx.gauss(0, 8) : null;
      if (target) this.fix(v.side, target, ex, ey, errR * 1.5, SRC.ASDIC, depthKnown);
      else this.fix(v.side, null, ex, ey, errR * 1.5, SRC.ASDIC, depthKnown, 900000 + Math.round(tx * 7 + ty), true);
      w.emit('echo', { by: v, x: ex, y: ey, doppler: dop, strength: p });
    };
    for (const t of w.vessels) {
      if (!t.alive || t.side === v.side || !t.sub) continue;
      const rel = Math.abs(Math.sin(angleDiff(t.heading, Math.atan2(t.pos.y - v.pos.y, t.pos.x - v.pos.x))));
      consider(t.pos.x, t.pos.y, t.keelDepth, t, false, rel);
      // the target hears the ping
      const dd = Math.hypot(t.pos.x - v.pos.x, t.pos.y - v.pos.y);
      if (dd < R * 2.6) this.pingsHeard.push({ by: v, t: w.time, bearingFrom: Math.atan2(v.pos.y - t.pos.y, v.pos.x - t.pos.x), target: t });
    }
    for (const d of w.projectiles?.decoys ?? []) if (d.kind === 'bold' && d.owner.side !== v.side) consider(d.x, d.y, d.depth, null, true, 1);
    // auto-marking legendary: pinged targets take extra damage
    const mark = v.stats.power('pow_echo_marks');
    if (mark) for (const e of out) if (e.target) { e.target.pinned = 6; e.target.pinnedBonus = mark / 100; }
    return out;
  }

  /** a U-boat transmits (contact report / wolfpack call): HF/DF can take a bearing */
  transmit(v: Vessel) { this.transmissions.push({ v, t: this.w.time }); }

  /** best (lowest error) contact on enemy subs for a side */
  list(side: Side): Contact[] { return [...this.contacts[side].values()]; }
}

function intersect(x1: number, y1: number, b1: number, x2: number, y2: number, b2: number): { x: number; y: number } | null {
  const d1x = Math.cos(b1), d1y = Math.sin(b1), d2x = Math.cos(b2), d2y = Math.sin(b2);
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-4) return null;
  const t = ((x2 - x1) * d2y - (y2 - y1) * d2x) / den;
  if (t < 0 || t > 6000) return null;
  return { x: x1 + d1x * t, y: y1 + d1y * t };
}
