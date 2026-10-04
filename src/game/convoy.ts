// The convoy: a guide point (the commodore's ordered track) runs the route at convoy speed with
// zig-zag legs; merchants keep station on their slots in columns. Damaged ships straggle, and a
// scatter order sends everyone off independently.

import type { World } from './world';
import type { Vessel } from './vessel';
import { angleDiff, clamp, fx, KNOT } from '../core/math';

export class Convoy {
  x = 0; y = 0;
  heading = 0;
  baseHeading = 0;
  speed: number;           // m/s
  merchants: Vessel[] = [];
  colSpacing = 260;
  rowSpacing = 340;
  columns = 3;
  zigzag = true;
  private legTimer = 0;
  private leg = 0;
  scattered = false;
  /** end of the route (x coordinate along base heading) */
  exitX = 3000;
  startX = -3000;

  constructor(private w: World, speedKn: number) { this.speed = speedKn * KNOT; }

  slotPos(col: number, row: number) {
    const lx = -row * this.rowSpacing, ly = (col - (this.columns - 1) / 2) * this.colSpacing;
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    return { x: this.x + lx * c - ly * s, y: this.y + lx * s + ly * c };
  }

  update(dt: number) {
    // zig-zag plan: alternating legs off the base course
    if (this.zigzag) {
      this.legTimer -= dt;
      if (this.legTimer <= 0) {
        const plan = [0, 0.38, 0, -0.38, 0.2, -0.2];
        this.leg = (this.leg + 1) % plan.length;
        this.legTimer = 70 + fx.range(0, 40);
        this.targetHeading = this.baseHeading + plan[this.leg];
      }
      this.heading += clamp(angleDiff(this.heading, this.targetHeading), -0.004 * dt * 10, 0.004 * dt * 10);
    }
    // the guide slows if the convoy is strung out
    let lag = 0;
    for (const m of this.merchants) {
      if (!m.alive || !m.slot || m.straggler) continue;
      const sp = this.slotPos(m.slot.col, m.slot.row);
      const f = { x: Math.cos(this.heading), y: Math.sin(this.heading) };
      lag = Math.min(lag, (m.pos.x - sp.x) * f.x + (m.pos.y - sp.y) * f.y);
    }
    const k = clamp(1 + lag / 600, 0.55, 1);
    this.x += Math.cos(this.heading) * this.speed * k * dt;
    this.y += Math.sin(this.heading) * this.speed * k * dt;
  }
  private targetHeading = 0;

  get alive() { return this.merchants.filter((m) => m.alive); }
  get progress() { return clamp((this.x - this.startX) / (this.exitX - this.startX), 0, 1); }

  scatter() {
    if (this.scattered) return;
    this.scattered = true;
    this.w.emit('message', { text: 'Commodore: "Convoy is to scatter!"', side: 'allied', kind: 'radio', important: true });
  }
}

/**
 * Convoy rescue ship: keeps station astern like a merchant, but turns back for lifeboats in the water
 * (dropping out of the convoy's station-keeping while away) and comes alongside dead slow.
 */
export class RescueAI {
  debug = '';
  private station: MerchantAI;
  constructor(private w: World, private v: Vessel, c: Convoy) { this.station = new MerchantAI(v, c); }
  update(dt: number) {
    const v = this.v;
    let best: { x: number; y: number } | null = null, bd = 2500;
    for (const b of this.w.projectiles.boats) {
      if (b.side !== v.side || b.life <= 0) continue;
      const d = Math.hypot(b.x - v.pos.x, b.y - v.pos.y);
      if (d < bd) { bd = d; best = b; }
    }
    if (!best || v.hpFrac < 0.45) { v.straggler = v.hpFrac < 0.45; this.station.update(dt); this.debug = 'station'; return; }
    v.straggler = true;
    v.course = Math.atan2(best.y - v.pos.y, best.x - v.pos.x);
    v.speedCmd = clamp((bd > 400 ? 12 : bd > 120 ? 5 : 2) * KNOT / Math.max(0.5, v.maxSpeed), 0, 1);
    this.debug = `rescue ${Math.round(bd)}m`;
  }
}

/** station keeping AI for a merchant */
export class MerchantAI {
  debug = '';
  private scatterHeading = 0;
  constructor(private v: Vessel, private c: Convoy) { this.scatterHeading = c.baseHeading + fx.range(-1.2, 1.2); }
  update(dt: number) {
    const v = this.v, c = this.c;
    if (!v.slot) return;
    const maxV = v.maxSpeed;
    if (v.hpFrac < 0.45 || v.engineDamage > 0.4 || v.hydro.floodTotal() > 0.25) v.straggler = true;
    if (c.scattered) {
      v.course = this.scatterHeading;
      v.speedCmd = 1;
      this.debug = 'scatter';
      return;
    }
    const sp = c.slotPos(v.slot.col, v.slot.row);
    // aim at a point ahead of the slot so ships converge smoothly
    const ahead = 220;
    const tx = sp.x + Math.cos(c.heading) * ahead, ty = sp.y + Math.sin(c.heading) * ahead;
    const dx = tx - v.pos.x, dy = ty - v.pos.y;
    v.course = Math.atan2(dy, dx);
    // speed: convoy speed plus along-track correction
    const f = { x: Math.cos(c.heading), y: Math.sin(c.heading) };
    const along = (sp.x - v.pos.x) * f.x + (sp.y - v.pos.y) * f.y;
    let want = c.speed + clamp(along * 0.01, -c.speed * 0.4, c.speed * 0.35);
    if (v.straggler) want = Math.min(want, maxV * 0.7);
    v.speedCmd = clamp(Math.sqrt(Math.max(0, want / maxV)), 0, 1);
    this.debug = v.straggler ? 'straggling' : 'station';
  }
}

