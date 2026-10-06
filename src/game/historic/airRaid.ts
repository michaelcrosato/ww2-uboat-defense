// Carrier air strikes for the historical battles: torpedo, dive and level bombers and fighters flying
// scheduled attack elements against named ships, anti-aircraft fire from every armed ship, bombs and
// aerial torpedoes. An element can carry the historical result (how many of its weapons hit): those hits
// are assigned to particular aircraft up front, so the battle replays as it happened, unless the plane
// that carries a hit is shot down first (the player's flak can change history).
// Altitudes are compressed for the top-down camera (a 3,500 m dive starts at 180 m on screen); bombs
// still take their real time to fall from a level bomber's 3,000 m.

import type { World } from '../world';
import type { Vessel } from '../vessel';
import type { Side } from '../vesselClasses';
import type { StackModel } from '../../art/voxel';
import { warplaneArt, type Load, type Warplane } from '../../art/navyArt';
import { VoxelModel } from '../../art/voxel';
import { torpedoArt } from '../../art/ships';
import { GROUPS, LAND } from '../../physics/physics';
import { angleDiff, clamp, fx, quatFromEuler, wrapAngle } from '../../core/math';
import { splashColumn, surfaceExplosion, underwaterBlast } from '../effects';
import { PK } from '../../render/materials';

export type Role = 'torpedo' | 'dive' | 'level' | 'fighter';

export interface Element {
  kind: Warplane; role: Role; n: number;
  /** the side the planes fly for; they attack ships of the other side and are shot at by them */
  side: Side;
  /** world time (s) of the first release */
  at: number;
  /** ship names in priority order: each plane attacks the first one still afloat */
  targets: string[];
  /** historical hits on the first target, assigned to planes up front (undefined: free accuracy) */
  hits?: number;
  /** the attack comes from this world direction (rad, pointing from the target toward the attacker) */
  from: number;
  load?: Load;
  /** radio / lookout line when the element arrives */
  call?: string;
  /** the first hit sets off the target's forward magazines (USS Arizona, 08:06) */
  magazine?: boolean;
  /** torpedo release range (m): 400-600 in Pearl Harbor's lochs, ~800 at sea */
  release?: number;
  /** interceptors flying combat air patrol over these ships (fighters only) */
  cap?: boolean;
  /** an airfield or shore target instead of a ship: each plane aims somewhere within r of (x, y) */
  ground?: { x: number; y: number; r: number };
  /** lost before release, regardless of flak (fighters of the other side we do not fly; VT-8 at Midway) */
  attrition?: number;
}

interface Plane {
  el: Element; idx: number; kind: Warplane; role: Role; side: Side;
  x: number; y: number; z: number; alt: number; heading: number; speed: number; bank: number; pitch: number;
  hp: number; alive: boolean; falling: number;
  state: 'in' | 'run' | 'dive' | 'out';
  target: Vessel | null; willHit: boolean; loaded: boolean; doomed: boolean;
  model: StackModel; empty: StackModel; t: number; passes: number;
  /** aim point for ground attacks */
  aim: { x: number; y: number; z: number };
}
interface Bomb { x0: number; y0: number; z0: number; x: number; y: number; z: number; tx: number; ty: number; t: number; T: number; target: Vessel | null; hit: boolean; damage: number; magazine: boolean; side: Side; lx: number; ly: number }
interface AirTorpedo { x: number; y: number; heading: number; speed: number; run: number; left: number; side: Side; damage: number; alive: boolean; miss: boolean }

const SPEED: Record<Role, number> = { torpedo: 72, dive: 80, level: 70, fighter: 95 };
const HP: Record<Warplane, number> = { kate: 3, val: 3, zero: 3, sbd: 4, tbd: 3, f4f: 5 };
/** compressed render altitudes (m) */
const ALT = { cruise: 150, dive: 180, level: 175, low: 22 };

export class AirRaid {
  planes: Plane[] = [];
  bombs: Bomb[] = [];
  torps: AirTorpedo[] = [];
  private queue: { el: Element; spawnAt: number }[] = [];
  private bombModel: StackModel; private torpModel: StackModel;
  /** world time each ship's AA opens fire (a harbour at Sunday breakfast takes minutes to man the guns) */
  aaReady = new Map<Vessel, number>();
  /** point-in-land test so misses explode on shore instead of splashing (set by the scenario) */
  isLand: ((x: number, y: number) => boolean) | null = null;
  shotDown: Record<Side, number> = { allied: 0, axis: 0 };
  /** fires ashore (airfields, the Navy Yard): flames and a column of black smoke */
  fires: { x: number; y: number; t: number; size: number }[] = [];
  private aaFxT = 0;

  constructor(private w: World) {
    this.bombModel = w.scene.atlas.add(bombArt());
    this.torpModel = w.scene.atlas.add(torpedoArt());
    w.systems.push(this);
  }

  /** queue an element; its planes appear far enough out to reach the release point at `el.at` */
  add(el: Element) {
    const lead = el.role === 'level' ? 7000 : 6000;
    this.queue.push({ el, spawnAt: el.at - lead / SPEED[el.role] });
    this.queue.sort((a, b) => a.spawnAt - b.spawnAt);
  }

  private findShip(name: string) { return this.w.vessels.find((v) => v.name === name && v.alive) ?? null; }
  private pickTarget(el: Element): Vessel | null {
    if (el.ground) return null;
    for (const n of el.targets) { const v = this.findShip(n); if (v) return v; }
    // anything afloat on the other side
    let best: Vessel | null = null, bd = Infinity;
    for (const v of this.w.vessels) if (v.alive && v.side !== el.side && !v.sub) { const d = v.cls.displacement; if (-d < bd) { bd = -d; best = v; } }
    return best;
  }

  private launch(el: Element) {
    const w = this.w, tgt = this.pickTarget(el);
    const cx = tgt ? tgt.pos.x : el.ground?.x ?? 0, cy = tgt ? tgt.pos.y : el.ground?.y ?? 0;
    const dist = el.role === 'level' ? 7000 : 6000;
    // the historical hits go to particular planes, chosen once (seeded)
    const hitIdx = new Set<number>();
    const order = Array.from({ length: el.n }, (_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = w.rng.int(0, i); [order[i], order[j]] = [order[j], order[i]]; }
    for (let i = 0; i < Math.min(el.hits ?? 0, el.n); i++) hitIdx.add(order[i]);
    const doomed = new Set(order.slice(el.n - Math.round((el.attrition ?? 0) * el.n)));
    const load: Load = el.load ?? (el.role === 'torpedo' ? 'torpedo' : el.role === 'fighter' ? null : 'bomb');
    const art = w.scene.atlas;
    for (let i = 0; i < el.n; i++) {
      // vics of three, staggered back along the approach
      const row = Math.floor(i / 3), col = (i % 3) - 1;
      const back = dist + row * 260, side = col * 90 + row * 30;
      const fxx = Math.cos(el.from), fyy = Math.sin(el.from);
      const p: Plane = {
        el, idx: i, kind: el.kind, role: el.role, side: el.side,
        x: cx + fxx * back - fyy * side, y: cy + fyy * back + fxx * side,
        z: el.role === 'torpedo' ? ALT.cruise * 0.6 : el.role === 'dive' ? ALT.dive : el.role === 'level' ? ALT.level : ALT.cruise,
        alt: el.role === 'level' ? 3000 : el.role === 'dive' ? 3500 : 600,
        heading: wrapAngle(el.from + Math.PI), speed: SPEED[el.role] * (0.97 + w.rng.next() * 0.06), bank: 0, pitch: 0,
        hp: HP[el.kind], alive: true, falling: 0, state: 'in', target: tgt,
        willHit: el.hits === undefined ? w.rng.next() < 0.35 : hitIdx.has(i), loaded: load !== null, doomed: doomed.has(i),
        model: art.add(warplaneArt(el.kind, load)), empty: art.add(warplaneArt(el.kind, null)), t: 0, passes: 0, aim: { x: cx, y: cy, z: 0 },
      };
      if (el.ground) { const a = w.rng.next() * Math.PI * 2, r = Math.sqrt(w.rng.next()) * el.ground.r; p.aim = { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, z: 0 }; }
      this.planes.push(p);
    }
  }
  private called = new Set<Element>();

  update(dt: number) {
    const w = this.w;
    while (this.queue.length && this.queue[0].spawnAt <= w.time) this.launch(this.queue.shift()!.el);
    for (const p of this.planes) if (p.alive) this.fly(p, dt);
    this.flak(dt);
    this.fall(dt);
    this.run(dt);
    this.planes = this.planes.filter((p) => p.alive || p.falling > 0);
    for (const f of this.fires) f.t -= dt;
    this.fires = this.fires.filter((f) => f.t > 0);
  }

  // ------------------------------------------------------------------ flight
  private fly(p: Plane, dt: number) {
    const w = this.w, el = p.el;
    p.t += dt;
    if (p.falling > 0) {
      // shot down: trailing smoke, spiralling into the sea
      p.falling -= dt; p.z -= dt * 30; p.bank += dt * 2;
      p.x += Math.cos(p.heading) * p.speed * 0.7 * dt; p.y += Math.sin(p.heading) * p.speed * 0.7 * dt;
      if (fx.next() < 0.6) w.scene.particles.spawn(PK.SMOKE, p.x, p.y, p.z, 0, 0, 1, fx.range(2, 4), 2, [0.12, 0.1, 0.1]);
      if (p.z <= 0) { p.falling = 0; p.alive = false; splashColumn(w, p.x, p.y, 0.6); }
      return;
    }
    // a sunk target's wreck may already be gone from the world (its body freed): never touch it again
    if (p.target && !p.target.alive) { p.target = p.state === 'out' ? null : this.pickTarget(el); if (!p.target) p.state = 'out'; }
    if (!p.target && !el.ground && p.state !== 'out') p.state = 'out';
    const t = p.target, tp = t ? t.pos : p.aim;
    // a plane lost to the CAP that history says never got through (VT-8, VT-6, VT-3 at Midway)
    if (p.doomed && p.state !== 'out' && Math.hypot(tp.x - p.x, tp.y - p.y) < 2600 + p.idx * 40) { this.down(p); return; }
    if (el.call && !this.called.has(el) && Math.hypot(tp.x - p.x, tp.y - p.y) < 3500) { this.called.add(el); w.emit('message', { text: el.call, kind: 'alert', important: true }); }
    let gx = p.x + Math.cos(p.heading) * 100, gy = p.y + Math.sin(p.heading) * 100, wantZ = p.z, spd = p.speed;
    if (p.state === 'in') {
      const fxx = Math.cos(el.from), fyy = Math.sin(el.from);
      if (p.role === 'torpedo') {
        // drop to the deck well out, then line up on the beam
        const rel = el.release ?? 800;
        const ax = tp.x + fxx * (rel + 900), ay = tp.y + fyy * (rel + 900);
        gx = ax; gy = ay; wantZ = Math.hypot(ax - p.x, ay - p.y) < 2500 ? ALT.low : ALT.cruise * 0.6;
        if (Math.hypot(ax - p.x, ay - p.y) < 200) p.state = 'run';
      } else if (p.role === 'dive') {
        gx = tp.x + fxx * 300; gy = tp.y + fyy * 300; wantZ = ALT.dive;
        if (Math.hypot(tp.x - p.x, tp.y - p.y) < 1300) p.state = 'dive';
      } else if (p.role === 'level') {
        // straight and level over the target, bombs away a fall-time's travel short of it
        gx = tp.x; gy = tp.y; wantZ = ALT.level;
        const fall = Math.sqrt(2 * p.alt / 9.81);
        if (p.loaded && Math.hypot(tp.x - p.x, tp.y - p.y) < p.speed * fall + 40) this.release(p);
        if (!p.loaded) p.state = 'out';
      } else {
        // fighters strafe the target ship twice, low and fast
        gx = tp.x; gy = tp.y; wantZ = Math.hypot(tp.x - p.x, tp.y - p.y) < 1200 ? 30 : ALT.cruise;
        if (t && Math.hypot(tp.x - p.x, tp.y - p.y) < 250) this.strafe(p, t, dt);
        if (Math.hypot(tp.x - p.x, tp.y - p.y) < 40) { p.passes++; if (p.passes >= 2 || el.cap) p.state = 'out'; }
      }
    } else if (p.state === 'run' && t) {
      // the torpedo run: straight and low at the target, aiming off when history says it missed
      const torpSpeed = 21.6, d = Math.hypot(tp.x - p.x, tp.y - p.y), lv = t.body.linvel();
      const tt = d / torpSpeed;
      gx = tp.x + lv.x * tt; gy = tp.y + lv.y * tt; wantZ = ALT.low;
      // release in range over a clear stretch of water (the lochs are narrow), or point-blank as a last resort
      if (p.loaded && ((d < (el.release ?? 800) && this.clearRun(p.x, p.y, t)) || d < 230)) this.dropTorpedo(p, t, gx, gy);
      if (!p.loaded && d < 300) p.state = 'out';
    } else if (p.state === 'dive') {
      gx = tp.x; gy = tp.y; spd = p.speed * 1.4;
      const d = Math.hypot(tp.x - p.x, tp.y - p.y);
      wantZ = 40 + clamp(d / 1300, 0, 1) * (ALT.dive - 40);
      p.pitch = 1.1;
      if (p.loaded && d < 160) this.release(p);
      if (!p.loaded) { p.state = 'out'; p.pitch = 0; }
    } else {
      // out: away from the target and off the map, climbing
      wantZ = Math.min(ALT.cruise, p.z + 30);
      gx = p.x + Math.cos(p.heading) * 500; gy = p.y + Math.sin(p.heading) * 500;
      const b = w.bounds;
      if (p.x < b.x0 - 3000 || p.x > b.x1 + 3000 || p.y < b.y0 - 3000 || p.y > b.y1 + 3000) p.alive = false;
      if (p.t > 900) p.alive = false;
    }
    const want = Math.atan2(gy - p.y, gx - p.x);
    const rate = p.state === 'run' ? 0.25 : p.state === 'dive' ? 0.6 : 0.45;
    const turn = clamp(angleDiff(p.heading, want), -rate * dt, rate * dt);
    p.heading = wrapAngle(p.heading + turn);
    p.bank += (clamp(turn / dt * 1.4, -0.8, 0.8) - p.bank) * Math.min(1, dt * 3);
    p.z += clamp(wantZ - p.z, -40 * dt, 25 * dt);
    p.x += Math.cos(p.heading) * spd * dt;
    p.y += Math.sin(p.heading) * spd * dt;
  }

  private release(p: Plane) {
    const t = p.target, w = this.w;
    p.loaded = false;
    const level = p.role === 'level';
    const T = level ? Math.sqrt(2 * p.alt / 9.81) : 2.2;
    if (!t) {
      // airfield attack: hangars, parked aircraft, fuel
      const s = level ? 60 : 25;
      this.bombs.push({ x0: p.x, y0: p.y, z0: p.z, x: p.x, y: p.y, z: p.z, tx: p.aim.x + (w.rng.next() - 0.5) * s, ty: p.aim.y + (w.rng.next() - 0.5) * s, t: 0, T, target: null, hit: false, damage: 500, magazine: false, side: p.side, lx: 0, ly: 0 });
      p.model = p.empty;
      return;
    }
    // where it lands: on the deck (a historical hit) or close alongside
    const L = t.cls.length, B = t.cls.beam;
    let lx = (w.rng.next() - 0.5) * L * 0.7, ly = (w.rng.next() - 0.5) * B * 0.5;
    if (p.el.magazine) { lx = L * 0.27; ly = 0; }
    const lv = t.body.linvel();
    let tx: number, ty: number;
    if (p.willHit) { const q = t.local(lx, ly, 0); tx = q.x + lv.x * T; ty = q.y + lv.y * T; }
    else {
      const a = w.rng.next() * Math.PI * 2, r = B / 2 + (level ? 25 + w.rng.next() * 90 : 8 + w.rng.next() * 40);
      tx = t.pos.x + Math.cos(a) * r + lv.x * T; ty = t.pos.y + Math.sin(a) * r + lv.y * T;
    }
    const dmg = p.kind === 'kate' ? 1300 : p.kind === 'sbd' ? (p.el.load === 'apbomb' ? 950 : 850) : 520;
    this.bombs.push({ x0: p.x, y0: p.y, z0: p.z, x: p.x, y: p.y, z: p.z, tx, ty, t: 0, T, target: t, hit: p.willHit, damage: dmg, magazine: !!p.el.magazine && p.willHit, side: p.side, lx, ly });
    if (p.el.magazine && p.willHit) p.el.magazine = false;
    p.model = p.empty;
  }

  /** water all the way from (x, y) to the target's side: a torpedo dropped there will not run ashore */
  private clearRun(x: number, y: number, t: Vessel) {
    const land = this.isLand;
    if (!land) return true;
    const d = Math.hypot(t.pos.x - x, t.pos.y - y), stop = d - t.cls.beam;
    for (let s = 0; s < stop; s += 20) if (land(x + (t.pos.x - x) * s / d, y + (t.pos.y - y) * s / d)) return false;
    return true;
  }

  private dropTorpedo(p: Plane, t: Vessel, ax: number, ay: number) {
    const w = this.w;
    p.loaded = false; p.model = p.empty;
    let course = Math.atan2(ay - p.y, ax - p.x);
    if (!p.willHit) {
      // aimed off (or ran deep / broached): misses this ship by a few lengths of its beam
      const d = Math.hypot(ax - p.x, ay - p.y);
      course += (w.rng.next() < 0.5 ? -1 : 1) * Math.atan2(t.cls.length * 0.5 + 10 + w.rng.next() * 30, d);
    }
    // a historical miss stays one: it ran deep, broached or failed to fire, whatever hull it crosses
    this.torps.push({ x: p.x, y: p.y, heading: course, speed: 21.6, run: 0, left: 2500, side: p.side, damage: 900, alive: true, miss: !p.willHit && p.el.hits !== undefined });
    splashColumn(w, p.x, p.y, 0.5);
    w.emit('splash', { x: p.x, y: p.y, size: 0.6 });
  }

  private strafe(p: Plane, t: Vessel, dt: number) {
    const w = this.w;
    if (w.rng.next() < dt * 3) t.damage(12, t.pos.x + (w.rng.next() - 0.5) * t.cls.length * 0.5, t.pos.y, t.cls.freeboard, 'shell', null);
    if (fx.next() < 0.5) w.scene.particles.spawn(PK.TRACER, p.x, p.y, p.z, Math.cos(p.heading) * 300, Math.sin(p.heading) * 300, -p.z * 2, 0.3, 0.4, [1, 0.85, 0.4]);
  }

  private down(p: Plane) {
    p.falling = 6; p.hp = 0;
    this.shotDown[p.side]++;
    surfaceExplosion(this.w, p.x, p.y, p.z, 0.3, { debris: false });
  }

  // ------------------------------------------------------------------ anti-aircraft fire
  private flak(dt: number) {
    const w = this.w;
    this.aaFxT -= dt;
    const showFx = this.aaFxT <= 0;
    if (showFx) this.aaFxT = 0.12;
    for (const v of w.vessels) {
      const aa = v.cls.aa;
      if (!aa || !v.alive || (v.sub && !v.sub.surfaced) || w.time < (this.aaReady.get(v) ?? 0)) continue;
      // crews shoot at the nearest enemy plane in reach
      let best: Plane | null = null, bd = aa.range;
      for (const p of this.planes) {
        if (!p.alive || p.falling > 0 || p.side === v.side) continue;
        const d = Math.hypot(p.x - v.pos.x, p.y - v.pos.y);
        if (d < bd) { bd = d; best = p; }
      }
      if (!best) continue;
      const k = 1 - bd / aa.range;
      const exposure = best.role === 'torpedo' && best.state === 'run' ? 1 : best.role === 'level' ? 0.15 : best.state === 'dive' ? 0.7 : 0.5;
      const rate = (aa.heavy * 0.0035 + aa.light * 0.005) * k * exposure * (v.hpFrac > 0.3 ? 1 : 0.4);
      if (w.rng.next() < rate * dt) { best.hp--; if (best.hp <= 0) this.down(best); }
      if (showFx) {
        const z0 = v.cls.freeboard + 4;
        w.scene.particles.spawn(PK.TRACER, v.pos.x + fx.range(-v.cls.length * 0.3, v.cls.length * 0.3), v.pos.y, z0,
          (best.x - v.pos.x) * 1.4 + fx.range(-30, 30), (best.y - v.pos.y) * 1.4 + fx.range(-30, 30), (best.z - z0) * 1.4, 0.7, 0.35, [1, 0.75, 0.35]);
        if (aa.heavy > 0 && fx.next() < 0.5) w.scene.particles.spawn(PK.SMOKE, best.x + fx.range(-60, 60), best.y + fx.range(-60, 60), best.z + fx.range(-10, 20), 0, 0, 0.3, fx.range(3, 6), 4, [0.1, 0.1, 0.11]);
        if (fx.next() < 0.15) w.emit('gunFired', { by: v, caliber: aa.heavy > 0 ? 127 : 25, x: v.pos.x, y: v.pos.y });
      }
    }
  }

  // ------------------------------------------------------------------ bombs and torpedoes
  private fall(dt: number) {
    const w = this.w;
    for (const b of this.bombs) {
      b.t += dt;
      const u = Math.min(1, b.t / b.T);
      b.x = b.x0 + (b.tx - b.x0) * u; b.y = b.y0 + (b.ty - b.y0) * u; b.z = b.z0 * (1 - u * u);
      if (u < 1) continue;
      const t = b.target;
      if (b.hit && t && t.alive) {
        const q = t.local(b.lx, b.ly, t.cls.freeboard);
        t.damage(b.damage, q.x, q.y, q.z, 'explosion', null);
        t.ignite(b.lx, b.ly, t.cls.role === 'carrier' ? 1.0 : 0.6);
        surfaceExplosion(w, q.x, q.y, Math.max(2, q.z), b.damage > 1000 ? 1.4 : 0.9, { fire: true });
        if (b.magazine) this.magazineExplosion(t);
      } else if (this.isLand?.(b.x, b.y)) {
        surfaceExplosion(w, b.x, b.y, 2, 0.8, { debris: true });
        // hangars, parked aircraft and fuel burn on for a long while
        if (w.rng.next() < 0.35 && this.fires.length < 40) this.fires.push({ x: b.x, y: b.y, t: 300 + w.rng.next() * 900, size: 0.6 + w.rng.next() * 0.8 });
      } else {
        splashColumn(w, b.x, b.y, 1.6);
        underwaterBlast(w, b.x, b.y, 4, 0.5);
        // near-miss shock and splinters
        if (t && t.alive && Math.hypot(b.x - t.pos.x, b.y - t.pos.y) < t.cls.length * 0.5 + 15) t.damage(b.damage * 0.12, b.x, b.y, -2, 'explosion', null);
      }
      b.T = -1;
    }
    this.bombs = this.bombs.filter((b) => b.T > 0);
  }

  /** the forward magazines go up: a fireball, the bow torn open, the ship settles in minutes */
  magazineExplosion(t: Vessel) {
    const w = this.w;
    const q = t.local(t.cls.length * 0.27, 0, t.cls.freeboard);
    for (let i = 0; i < 4; i++) surfaceExplosion(w, q.x + fx.range(-15, 15), q.y + fx.range(-8, 8), q.z + i * 6, 3);
    for (let i = 0; i < 120; i++) w.scene.particles.spawn(PK.SMOKE, q.x + fx.range(-20, 20), q.y + fx.range(-20, 20), q.z + fx.range(5, 60), fx.range(-3, 3), fx.range(-3, 3), fx.range(4, 12), fx.range(20, 40), fx.range(8, 16), [0.06, 0.05, 0.05]);
    w.flash = 1;
    t.damage(t.maxHp * 1.2, q.x, q.y, q.z, 'explosion', null);
    for (let i = 0; i < t.ingress.length; i++) t.ingress[i] += i >= 6 ? 0.25 : 0.06;
    for (let i = 0; i < 4; i++) t.ignite(t.cls.length * (0.3 - i * 0.12), 0, 1.4);
    w.emit('message', { text: `${t.name} blows up: her forward magazines have exploded!`, kind: 'alert', important: true });
  }

  private run(dt: number) {
    const w = this.w;
    for (const tp of this.torps) {
      if (!tp.alive) continue;
      const ox = tp.x, oy = tp.y;
      tp.x += Math.cos(tp.heading) * tp.speed * dt; tp.y += Math.sin(tp.heading) * tp.speed * dt;
      tp.run += tp.speed * dt; tp.left -= tp.speed * dt;
      if (tp.left <= 0) { tp.alive = false; continue; }
      const hit = w.physics.castSegment(ox, oy, -3, tp.x, tp.y, -3, GROUPS.querySurface);
      if (!hit) continue;
      tp.alive = false;
      const owner = w.physics.owner<Vessel>(hit.collider.handle);
      if ((owner as unknown) === LAND || !owner) { surfaceExplosion(w, hit.x, hit.y, 1, 0.8); continue; }
      if (owner.side === tp.side || tp.run < 150 || tp.miss) { w.emit('torpedoHit', { by: null, target: owner, dud: true }); continue; }
      owner.damage(tp.damage, hit.x, hit.y, hit.z, 'torpedo', null);
      surfaceExplosion(w, hit.x, hit.y, 0, 1.2);
      underwaterBlast(w, hit.x, hit.y, 3, 1);
      w.emit('torpedoHit', { by: null, target: owner, dud: false });
    }
    this.torps = this.torps.filter((t) => t.alive);
  }

  // ------------------------------------------------------------------ drawing
  submit(frameDt: number) {
    const w = this.w, R = w.scene;
    for (const f of this.fires) {
      if (fx.next() < frameDt * 6 * f.size) R.particles.spawn(PK.FIRE, f.x + fx.range(-6, 6), f.y + fx.range(-6, 6), 2, 0, 0, fx.range(2, 5), fx.range(0.6, 1.2), 3 * f.size, [1, 0.55, 0.2]);
      if (fx.next() < frameDt * 4 * f.size) R.particles.spawn(PK.SMOKE, f.x + fx.range(-8, 8), f.y + fx.range(-8, 8), 6, fx.range(-1, 1), fx.range(-1, 1), fx.range(3, 6), fx.range(15, 30), 6 * f.size, [0.07, 0.06, 0.06]);
    }
    for (const p of this.planes) {
      R.stacks.push({ model: p.model, x: p.x, y: p.y, z: p.z, q: quatFromEuler(p.bank, p.pitch, p.heading), flags: 1 | 16 });
      const env = w.env, L = env.sunIntensity > 0.05 ? env.sunDir : null;
      if (L && L.z > 0.15 && p.z < 120) {
        const k = p.z / L.z, sx = p.x - L.x * k, sy = p.y - L.y * k;
        R.stacks.push({ model: p.model, x: sx, y: sy, z: 0.2, q: quatFromEuler(0, 0, p.heading), flags: 4 | 8 | 16 });
      }
    }
    for (const b of this.bombs) R.stacks.push({ model: this.bombModel, x: b.x, y: b.y, z: b.z, q: quatFromEuler(0, 1.2, Math.atan2(b.ty - b.y0, b.tx - b.x0)), flags: 16 });
    for (const t of this.torps) {
      R.stacks.push({ model: this.torpModel, x: t.x, y: t.y, z: -2.5, q: quatFromEuler(0, 0, t.heading) });
      R.hulls.push({ x: t.x, y: t.y, fx: Math.cos(t.heading), fy: Math.sin(t.heading), vx: Math.cos(t.heading) * t.speed, vy: Math.sin(t.heading) * t.speed, halfLen: 3, halfBeam: 0.4, angVel: 0, thrust: 1, draft: 0.5, depth: 2.5, foam: 1, oil: 0, fire: 0, kind: 1 });
    }
  }
}

function bombArt() {
  // a 250 kg / 1,000 lb bomb: a dark finned cylinder
  const m = new VoxelModel('bomb', 8, 3, 3, 0.5, 0.5, -2, -0.75, -0.75);
  m.cylX(-1.6, 1.8, 0, 0, 0.35, '#2c2c28');
  return m;
}
