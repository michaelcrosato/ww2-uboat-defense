// Maritime patrol aircraft: Swordfish from escort carriers, Catalinas and very-long-range
// Liberators closing the air gap. They orbit the convoy, spot surfaced boats, periscope feathers
// and (in clear water) shallow submerged boats, report them and attack with shallow-set depth
// charges. From 1942 a Leigh Light searchlight hunts surfaced U-boats at night.

import type { World } from './world';
import type { Vessel } from './vessel';
import type { StackModel } from '../art/voxel';
import { aircraftArt } from '../art/ships';
import { angleDiff, clamp, fx, quatFromEuler, wrapAngle } from '../core/math';
import { SRC } from './sensors';
import { underwaterBlast, splashColumn, surfaceExplosion } from './effects';
import { PK } from '../render/materials';

type Kind = 'swordfish' | 'catalina' | 'liberator';
const SPEC: Record<Kind, { speed: number; alt: number; bombs: number; hp: number }> = {
  swordfish: { speed: 48, alt: 110, bombs: 2, hp: 3 },
  catalina: { speed: 62, alt: 160, bombs: 4, hp: 6 },
  liberator: { speed: 85, alt: 180, bombs: 6, hp: 8 },
};

export class Aircraft {
  x: number; y: number; z: number;
  heading: number;
  bank = 0;
  mode: 'patrol' | 'attack' | 'leave' = 'patrol';
  target: Vessel | null = null;
  bombs: number;
  hp: number;
  alive = true;
  private runT = 0;
  private dropped = 0;
  private orbitA = fx.next() * 6.28;
  model: StackModel;
  constructor(private w: World, public kind: Kind, x: number, y: number, public cx: number, public cy: number, public life: number, bombs?: number) {
    this.x = x; this.y = y;
    const s = SPEC[kind];
    this.z = s.alt;
    this.heading = Math.atan2(cy - y, cx - x);
    this.bombs = bombs ?? s.bombs;
    this.hp = s.hp;
    this.model = w.scene.atlas.add(aircraftArt(kind));
  }
  get leighLight() { return this.w.year >= 1942 && this.w.env.darkness > 0.55 && this.kind !== 'swordfish'; }

  update(dt: number) {
    const w = this.w, s = SPEC[this.kind];
    this.life -= dt;
    if (this.life <= 0 && this.mode !== 'leave') this.mode = 'leave';
    let tx = this.cx, ty = this.cy;
    if (this.mode === 'patrol') {
      this.orbitA += dt * s.speed / 700;
      tx = this.cx + Math.cos(this.orbitA) * 700; ty = this.cy + Math.sin(this.orbitA) * 700;
      this.scan();
      this.z += (s.alt - this.z) * dt * 0.5;
    } else if (this.mode === 'attack') {
      const t = this.target;
      if (!t || !t.alive || (t.submerged && t.keelDepth > 25) || this.bombs <= 0) { this.mode = this.bombs > 0 && this.life > 0 ? 'patrol' : 'leave'; this.target = null; }
      else {
        this.runT += dt;
        tx = t.pos.x; ty = t.pos.y;
        const d = Math.hypot(tx - this.x, ty - this.y);
        this.z += ((d < 900 ? 35 : s.alt) - this.z) * dt * 0.8;
        if (d < 40 && Math.abs(angleDiff(this.heading, Math.atan2(ty - this.y, tx - this.x))) < 0.5 && this.dropped < 2) {
          this.drop(t);
        }
        if (d > 600 && this.dropped >= 2) this.dropped = 0;
        // the boat's flak fights back
        if (t.sub?.surfaced && d < 650 && fx.next() < dt * 0.35) this.hit();
      }
    } else {
      tx = this.x + Math.cos(this.heading) * 1000; ty = this.y + Math.sin(this.heading) * 1000;
      this.z += 40 * dt;
      if (this.x < w.bounds.x0 - 800 || this.x > w.bounds.x1 + 800 || this.y < w.bounds.y0 - 800 || this.y > w.bounds.y1 + 800) this.alive = false;
    }
    const want = Math.atan2(ty - this.y, tx - this.x);
    const turn = clamp(angleDiff(this.heading, want), -0.5 * dt, 0.5 * dt);
    this.heading = wrapAngle(this.heading + turn);
    this.bank += (clamp(turn / dt * 1.2, -0.6, 0.6) - this.bank) * dt * 3;
    this.x += Math.cos(this.heading) * s.speed * dt;
    this.y += Math.sin(this.heading) * s.speed * dt;
  }

  private scan() {
    const w = this.w;
    for (const v of w.vessels) {
      if (!v.alive || !v.sub || v.side === 'allied') continue;
      const d = Math.hypot(v.pos.x - this.x, v.pos.y - this.y);
      const vis = w.env.visibility * 1.6;
      let range = 0;
      if (v.sub.surfaced) range = this.leighLight ? 1100 : vis * 0.8;
      else if (v.atPeriscopeDepth && v.sub.periscope > 0.6 && Math.abs(v.hydro.fwdSpeed) > 1.2) range = Math.min(900, vis * 0.3);
      else if (v.submerged && v.keelDepth < w.theater.clarity * 0.9 && w.env.darkness < 0.4) range = 500 * (1 - v.keelDepth / (w.theater.clarity * 0.9));
      if (range > 0 && d < range && fx.next() < 0.3) {
        w.sensors.markSeen(v, 'allied');
        w.sensors.fix('allied', v, v.pos.x + fx.gauss(0, 10), v.pos.y + fx.gauss(0, 10), 25, SRC.AIR, v.submerged ? v.keelDepth : 0);
        if (this.bombs > 0) { this.mode = 'attack'; this.target = v; this.runT = 0; }
        w.emit('message', { text: `${this.kind === 'swordfish' ? 'Swordfish' : this.kind === 'catalina' ? 'Catalina' : 'Liberator'}: U-boat sighted, attacking!`, side: 'allied', kind: 'radio' });
        if (v.isPlayer) w.emit('message', { text: 'AIRCRAFT! Alarm — dive, dive!', side: 'axis', kind: 'alert', important: true });
        return;
      }
    }
  }

  private drop(t: Vessel) {
    const w = this.w;
    this.bombs--; this.dropped++;
    const p = { x: this.x, y: this.y };
    w.projectiles.charges.push({ x: p.x, y: p.y, z: this.z, vx: Math.cos(this.heading) * SPEC[this.kind].speed * 0.6, vy: Math.sin(this.heading) * SPEC[this.kind].speed * 0.6, vz: -5, from: t, fuse: 8, kind: 'dc', damage: 420, radius: 10, wet: false, sink: 4, alive: true, t: 0 });
    // aerial depth charges belong to the allied side: attribute damage to no vessel
    const c = w.projectiles.charges[w.projectiles.charges.length - 1];
    c.from = w.vessels.find((v) => v.side === 'allied' && v.alive) ?? t;
    void underwaterBlast; void splashColumn;
  }

  hit() {
    this.hp--;
    if (this.hp <= 0 && this.alive) {
      this.alive = false;
      surfaceExplosion(this.w, this.x, this.y, 0, 0.6, { fire: true });
      this.w.emit('message', { text: 'Aircraft shot down!', kind: 'alert' });
    }
  }

  submit() {
    const w = this.w, R = w.scene;
    const q = quatFromEuler(this.bank, 0, this.heading);
    R.stacks.push({ model: this.model, x: this.x, y: this.y, z: this.z, q, flags: 1 });
    // ground shadow
    const sx = this.x - w.env.sunDir.x * 0, sy = this.y;
    R.stacks.push({ model: this.model, x: sx, y: sy, z: w.ocean.height(sx, sy) + 0.1, q: quatFromEuler(0, 0, this.heading), flags: 4 | 8 });
    if (this.leighLight) {
      const dx = Math.cos(this.heading), dy = Math.sin(this.heading);
      w.lights.add({ x: this.x + dx * 4, y: this.y + dy * 4, z: this.z - 1, reach: Math.max(400, this.z * 3.5), r: 0.95, g: 0.97, b: 1, intensity: 3, dx: dx * 0.6, dy: dy * 0.6, dz: -0.8, cosOuter: Math.cos(0.12), shadow: true, beam: 1.2, size: 0.8, priority: 3 });
    }
    if (fx.next() < 0.3) R.particles.spawn(PK.MIST, this.x - Math.cos(this.heading) * 8, this.y - Math.sin(this.heading) * 8, this.z, 0, 0, 0, 0.6, 0.8, [0.6, 0.6, 0.6]);
  }
}
