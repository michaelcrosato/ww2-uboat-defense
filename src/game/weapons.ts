// Projectiles and deployables. Hit detection uses Rapier queries against vessel colliders.
//  * Shells: drag-free ballistic arcs with dispersion; star shells burst into parachute flares.
//  * Depth charges: rolled from stern rails or thrown by K-guns, sink at a fixed rate and fire at
//    their hydrostatic depth. Hedgehog bombs are contact-fused: no hit, no bang.
//  * Torpedoes: straight run then gyro turn onto the set course, depth keeping, contact or
//    magnetic (under-keel) pistol, duds, steam-wake bubble trails, acoustic homing (T5).
//  * Flares, decoys (Bold / Foxer / Aphrodite), smoke screens, loot crates, lifeboats.

import type { World } from './world';
import type { Vessel, GunState } from './vessel';
import { quatMul } from './vessel';
import { GROUPS } from '../physics/physics';
import { angleDiff, clamp, fx, qrot, quatFromYaw, wrapAngle, KNOT } from '../core/math';
import { PK } from '../render/materials';
import { splashColumn, surfaceExplosion, underwaterBlast, muzzleFlash } from './effects';
import { dev } from '../core/devSettings';
import type { StackModel } from '../art/voxel';
import { crateArt, depthChargeArt, lifeboatArt, torpedoArt } from '../art/ships';
import type { Item, Rarity } from '../meta/types';
import { Aircraft } from './aircraft';

export interface Shell { x: number; y: number; z: number; vx: number; vy: number; vz: number; from: Vessel; damage: number; caliber: number; t: number; burst: number; alive: boolean }
export interface Charge { x: number; y: number; z: number; vx: number; vy: number; vz: number; from: Vessel; fuse: number; kind: 'dc' | 'hedgehog'; damage: number; radius: number; wet: boolean; sink: number; alive: boolean; t: number }
export interface Torpedo {
  id: number; x: number; y: number; z: number; heading: number; course: number; speed: number; from: Vessel; left: number; run: number;
  kind: 'steam' | 'electric' | 'acoustic'; damage: number; dud: boolean; depth: number; magnetic: boolean; seek: number; alive: boolean; target: Vessel | null; split: boolean;
}
export interface Flare { x: number; y: number; z: number; life: number; max: number; radius: number; intensity: number }
export interface Decoy { x: number; y: number; depth: number; life: number; kind: 'bold' | 'foxer' | 'aphrodite'; owner: Vessel; strength: number }
export interface SmokeBlob { x: number; y: number; r: number; life: number }
export interface Crate { x: number; y: number; vx: number; vy: number; item: Item; life: number; phase: number }
export interface Lifeboat { x: number; y: number; h: number; count: number; life: number; side: 'allied' | 'axis' }

export const RARITY_BEAM: Record<Rarity, [number, number, number]> = {
  common: [0.8, 0.8, 0.8], magic: [0.45, 0.6, 1], rare: [1, 0.85, 0.3], legendary: [1, 0.55, 0.15], unique: [0.85, 0.7, 0.45],
};

let torpedoIds = 1;

export class Projectiles {
  shells: Shell[] = [];
  charges: Charge[] = [];
  torpedoes: Torpedo[] = [];
  flares: Flare[] = [];
  decoys: Decoy[] = [];
  smoke: SmokeBlob[] = [];
  crates: Crate[] = [];
  boats: Lifeboat[] = [];
  /** queued pattern drops: time, vessel, launcher, depth */
  queue: { t: number; v: Vessel; side: 'rail' | 'port' | 'stbd'; depth: number; dmg: number }[] = [];
  aircraft: Aircraft[] = [];
  private dcModel: StackModel; private torpModel: StackModel; private boatModel: StackModel;
  private crateModels: Record<Rarity, StackModel>;

  constructor(private w: World) {
    const A = w.scene.atlas;
    this.dcModel = A.add(depthChargeArt());
    this.torpModel = A.add(torpedoArt());
    this.boatModel = A.add(lifeboatArt());
    this.crateModels = {
      common: A.add(crateArt('#8a7a5a', 'crate_c')), magic: A.add(crateArt('#5a6a8a', 'crate_m')), rare: A.add(crateArt('#9a8a3a', 'crate_r')),
      legendary: A.add(crateArt('#9a5a2a', 'crate_l')), unique: A.add(crateArt('#7a6a4a', 'crate_u')),
    };
  }

  // ------------------------------------------------------------------ guns
  /** rotate a turret toward a world point; returns true when on target and inside its arc */
  aimGun(v: Vessel, g: GunState, tx: number, ty: number, dt: number): boolean {
    const mp = v.local(g.mount.x, g.mount.y, g.mount.z);
    const want = wrapAngle(Math.atan2(ty - mp.y, tx - mp.x) - v.heading);
    const [a0, a1] = g.spec.arc;
    const inArc = arcContains(a0, a1, want);
    const goal = inArc ? want : g.mount.restYaw;
    const d = angleDiff(g.aimYaw, goal);
    const step = g.spec.traverse * dt;
    g.aimYaw = wrapAngle(g.aimYaw + clamp(d, -step, step));
    g.mount.yaw = g.aimYaw;
    return inArc && Math.abs(angleDiff(g.aimYaw, want)) < 0.04;
  }

  fireGun(v: Vessel, g: GunState, tx: number, ty: number, star = false): boolean {
    if (g.reload > 0 || !v.alive) return false;
    if (v.sub && !v.sub.surfaced) return false;
    const mp = v.local(g.mount.x, g.mount.y, g.mount.z + 1.2);
    const dx = tx - mp.x, dy = ty - mp.y;
    const dist = Math.min(Math.hypot(dx, dy), g.spec.range * v.stats.mul('gun_range_pct'));
    const spd = g.spec.velocity;
    // elevation for range on flat water (low angle solution); star shells lob higher
    const s = clamp((9.81 * dist) / (spd * spd), 0, 0.999);
    let el = 0.5 * Math.asin(s);
    if (star) el = Math.max(el, 0.5);
    const yaw = v.heading + g.aimYaw;
    const acc = g.spec.spread / v.stats.mul('gun_accuracy_pct');
    const yawE = yaw + fx.gauss(0, acc), elE = el * (1 + fx.gauss(0, acc * 3));
    const vel = v.body.linvel();
    const cvx = Math.cos(yawE) * Math.cos(elE) * spd, cvy = Math.sin(yawE) * Math.cos(elE) * spd, cvz = Math.sin(elE) * spd;
    const flight = star ? Math.max(1.2, dist / (spd * Math.cos(elE))) : 0;
    const dmg = g.spec.damage * v.stats.mul('gun_damage_pct') * (v.stats.has('ks_gunnery_school') ? 1.4 : 1);
    this.shells.push({ x: mp.x, y: mp.y, z: mp.z, vx: cvx + vel.x, vy: cvy + vel.y, vz: cvz, from: v, damage: dmg, caliber: g.spec.caliber, t: 0, burst: flight, alive: true });
    let reload = g.spec.reload / v.stats.mul('gun_reload_pct');
    if (this.w.env.darkness > 0.5 && v.stats.power('pow_night_guns')) reload /= 1 + v.stats.power('pow_night_guns') / 100;
    if (v.deckGunBoost > 0) reload /= v.deckGunRate;
    g.reload = reload;
    v.muzzleFlash = 0.1;
    muzzleFlash(this.w, mp.x, mp.y, mp.z, Math.cos(yaw), Math.sin(yaw), g.spec.caliber);
    // recoil nudge
    v.body.applyImpulseAtPoint({ x: -Math.cos(yaw) * g.spec.caliber * 12, y: -Math.sin(yaw) * g.spec.caliber * 12, z: 0 }, mp, true);
    this.w.emit('gunFired', { by: v, caliber: g.spec.caliber, x: mp.x, y: mp.y });
    return true;
  }

  // ------------------------------------------------------------------ depth charges and hedgehog
  dropCharge(v: Vessel, side: 'rail' | 'port' | 'stbd', depth: number, dmgMul = 1): boolean {
    if (v.dcLeft <= 0 && !dev.bool('game.infiniteAmmo')) return false;
    if (!dev.bool('game.infiniteAmmo')) v.dcLeft--;
    const vel = v.body.linvel();
    const L = v.cls.length;
    const sink = 2.6 * v.stats.mul('dc_sink_pct');
    const dmg = 500 * v.stats.mul('dc_damage_pct') * dmgMul * (v.stats.has('ks_hunter_killer') ? 1.3 : 1);
    const radius = 9 * v.stats.mul('dc_radius_pct');
    if (side === 'rail') {
      const p = v.local(-L * 0.48, fx.range(-1.5, 1.5), v.cls.freeboard);
      this.charges.push({ x: p.x, y: p.y, z: p.z, vx: vel.x * 0.9, vy: vel.y * 0.9, vz: 0.5, from: v, fuse: depth, kind: 'dc', damage: dmg, radius, wet: false, sink, alive: true, t: 0 });
    } else {
      const s = side === 'port' ? -1 : 1;
      const p = v.local(-L * 0.36, s * v.cls.beam * 0.4, v.cls.freeboard + 1);
      const f = v.fwd();
      const r = { x: -f.y * s, y: f.x * s };
      this.charges.push({ x: p.x, y: p.y, z: p.z, vx: vel.x + r.x * 17, vy: vel.y + r.y * 17, vz: 11, from: v, fuse: depth, kind: 'dc', damage: dmg, radius, wet: false, sink, alive: true, t: 0 });
      muzzleFlash(this.w, p.x, p.y, p.z, r.x, r.y, 40);
    }
    this.w.emit('dcDrop', { by: v, x: v.pos.x, y: v.pos.y });
    return true;
  }

  /** a diamond pattern: rails roll charges along the track, K-guns throw pairs to the beams */
  dcPattern(v: Vessel, charges: number, spread: number, depth: number, dmgMul = 1) {
    const spd = Math.max(2, Math.abs(v.hydro.fwdSpeed));
    const dtRail = clamp(spread / spd / 3, 0.6, 3.5);
    let t = this.w.time;
    let n = 0;
    const kpairs = Math.min(v.cls.dc?.kguns ?? 2, Math.floor(charges / 3));
    while (n < charges) {
      this.queue.push({ t, v, side: 'rail', depth, dmg: dmgMul }); n++;
      if (n < charges && kpairs > 0 && n % 3 === 1) { this.queue.push({ t: t + 0.1, v, side: 'port', depth: depth * 1.25, dmg: dmgMul }); this.queue.push({ t: t + 0.15, v, side: 'stbd', depth: depth * 1.25, dmg: dmgMul }); n += 2; }
      t += dtRail;
    }
  }

  hedgehog(v: Vessel, bombs: number, ring: number, range: number, dmgMul = 1): boolean {
    if (v.hedgehogLeft <= 0 && !dev.bool('game.infiniteAmmo')) return false;
    if (!dev.bool('game.infiniteAmmo')) v.hedgehogLeft--;
    const f = v.fwd();
    const L = v.cls.length;
    const launch = v.local(L * 0.28, 0, v.cls.freeboard + 1.5);
    const cx = launch.x + f.x * range, cy = launch.y + f.y * range;
    const vel = v.body.linvel();
    const flight = 3.2;
    const dmg = 260 * v.stats.mul('hedgehog_damage_pct') * dmgMul * (v.stats.has('ks_hunter_killer') ? 1.3 : 1);
    for (let i = 0; i < bombs; i++) {
      const a = (i / bombs) * Math.PI * 2;
      // elliptical pattern, slightly elongated across the track
      const ox = Math.cos(a) * ring * 0.85, oy = Math.sin(a) * ring * 1.1;
      const tx = cx + f.x * ox - f.y * oy + vel.x * flight, ty = cy + f.y * ox + f.x * oy + vel.y * flight;
      const delay = (i % 4) * 0.12;
      this.charges.push({
        x: launch.x, y: launch.y, z: launch.z, vx: (tx - launch.x) / flight, vy: (ty - launch.y) / flight, vz: (9.81 * flight) / 2 + delay,
        from: v, fuse: 999, kind: 'hedgehog', damage: dmg, radius: 1.2, wet: false, sink: 7, alive: true, t: -delay,
      });
    }
    muzzleFlash(this.w, launch.x, launch.y, launch.z, f.x, f.y, 60);
    this.w.emit('gunFired', { by: v, caliber: 30, x: launch.x, y: launch.y });
    return true;
  }

  // ------------------------------------------------------------------ torpedoes
  fireTorpedo(v: Vessel, course: number, opts: { stern?: boolean; kind?: Torpedo['kind']; depth?: number; damageMul?: number; target?: Vessel | null } = {}): boolean {
    const spec = v.cls.torpedoes;
    if (!spec) return false;
    const tube = v.tubes.find((t) => t.loaded && !!t.stern === !!opts.stern);
    if (!tube && !dev.bool('game.infiniteAmmo')) return false;
    if (tube) { tube.loaded = false; tube.reload = spec.reloadTime / v.stats.mul('torpedo_reload_pct'); }
    const L = v.cls.length;
    const h = v.heading + (opts.stern ? Math.PI : 0);
    const p = v.local((opts.stern ? -1 : 1) * L * 0.47, 0, -v.cls.draft * 0.55);
    const kind = opts.kind ?? (spec.wake ? (this.w.year < 1942 || fx.next() < 0.5 ? 'steam' : 'electric') : 'electric');
    const spd = spec.speedKn * KNOT * v.stats.mul('torpedo_speed_pct') * (kind === 'steam' ? 1.1 : kind === 'acoustic' ? 0.62 : 1);
    const dudChance = Math.max(0, dev.num('game.duds') - v.stats.get('torpedo_dud_reduction') / 100);
    this.torpedoes.push({
      id: torpedoIds++, x: p.x, y: p.y, z: Math.min(p.z, -2), heading: h, course, speed: spd, from: v,
      left: spec.range * v.stats.mul('torpedo_range_pct'), run: 0, kind,
      damage: spec.damage * v.stats.mul('torpedo_damage_pct') * (opts.damageMul ?? 1),
      dud: fx.next() < dudChance, depth: opts.depth ?? 4, magnetic: this.w.year >= 1941, seek: kind === 'acoustic' ? 600 : 0,
      alive: true, target: opts.target ?? null, split: false,
    });
    // compressed-air bubble burst at the tube
    for (let i = 0; i < 12; i++) this.w.scene.particles.spawn(PK.FOAMBIT, p.x + fx.range(-1, 1), p.y + fx.range(-1, 1), 0, fx.range(-1, 1), fx.range(-1, 1), fx.range(1, 3), 1.2, 0.5, [0.9, 0.95, 1]);
    this.w.scene.splats.push({ x: p.x, y: p.y, radius: 4, wave: -0.6, foam: 1.2, bio: 0.8, oil: 0, fire: 0, push: 1 });
    this.w.emit('torpedoFired', { by: v, x: p.x, y: p.y });
    return true;
  }

  fireStarShell(v: Vessel, tx: number, ty: number): boolean {
    if (v.starShells <= 0 && !dev.bool('game.infiniteAmmo')) return false;
    const g = v.guns[0];
    if (!g) return false;
    g.reload = 0;
    const ok = this.fireGun(v, g, tx, ty, true);
    if (ok && !dev.bool('game.infiniteAmmo')) v.starShells--;
    return ok;
  }

  releaseDecoy(v: Vessel, kind: Decoy['kind'], life: number) {
    const p = v.pos;
    const back = v.fwd();
    const off = kind === 'foxer' ? -v.cls.length * 1.6 : -v.cls.length * 0.5;
    this.decoys.push({ x: p.x + back.x * off, y: p.y + back.y * off, depth: kind === 'bold' ? Math.max(5, v.keelDepth) : 0, life, kind, owner: v, strength: 1 });
  }

  /** an air patrol arrives from the nearest map edge to orbit around a vessel */
  callAircraft(v: Vessel, duration: number, bombs: number, sorties = 1, kind?: 'swordfish' | 'catalina' | 'liberator') {
    const w = this.w;
    for (let i = 0; i < Math.max(1, sorties); i++) {
      const k = kind ?? (w.year >= 1943 && fx.next() < 0.4 ? 'liberator' : fx.next() < 0.5 ? 'catalina' : 'swordfish');
      const a = fx.next() * Math.PI * 2;
      const x = v.pos.x + Math.cos(a) * 2500, y = v.pos.y + Math.sin(a) * 2500;
      this.aircraft.push(new Aircraft(w, k, x, y, v.pos.x + fx.range(-300, 300), v.pos.y + fx.range(-300, 300), duration, bombs));
    }
  }
  /** a scheduled maritime patrol orbiting a moving point (the convoy) */
  airPatrol(kind: 'swordfish' | 'catalina' | 'liberator', duration: number, anchor: () => { x: number; y: number }) {
    const c = anchor(), a = fx.next() * Math.PI * 2;
    const ac = new Aircraft(this.w, kind, c.x + Math.cos(a) * 3000, c.y + Math.sin(a) * 3000, c.x, c.y, duration);
    ac.anchor = anchor;
    this.aircraft.push(ac);
    return ac;
  }
  /** wolfpack reinforcements requested by the player's signal */
  reinforce(n: number) { this.w.emit('reinforce', { n }); }

  layLoot(x: number, y: number, item: Item) {
    this.crates.push({ x: x + fx.range(-8, 8), y: y + fx.range(-8, 8), vx: fx.range(-0.4, 0.4), vy: fx.range(-0.4, 0.4), item, life: 600, phase: fx.next() * 6 });
  }
  launchBoats(x: number, y: number, n: number, side: 'allied' | 'axis') {
    for (let i = 0; i < n; i++) this.boats.push({ x: x + fx.range(-30, 30), y: y + fx.range(-30, 30), h: fx.range(0, 6.28), count: fx.int(6, 18), life: 900, side });
  }

  // ------------------------------------------------------------------ simulation
  preStep(dt: number) {
    const w = this.w;
    // pattern queue
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i];
      if (w.time >= q.t) { if (q.v.alive) this.dropCharge(q.v, q.side, q.depth, q.dmg); this.queue.splice(i, 1); }
    }
  }

  postStep(dt: number) {
    const w = this.w;
    // ---- shells
    for (const s of this.shells) {
      if (!s.alive) continue;
      s.t += dt;
      const nx = s.x + s.vx * dt, ny = s.y + s.vy * dt, nz = s.z + s.vz * dt - 4.905 * dt * dt;
      s.vz -= 9.81 * dt;
      if (s.burst > 0 && s.t >= s.burst) {
        s.alive = false;
        const life = 26 * (s.from.stats.has('ks_star_gazer') ? 2 : 1) * (s.from.starShellLife || 1);
        this.flares.push({ x: nx, y: ny, z: Math.max(60, nz), life, max: life, radius: 330 * (s.from.starShellRadius || 1), intensity: 3.4 });
        w.emit('starShell', { x: nx, y: ny });
        continue;
      }
      const hit = s.burst > 0 ? null : w.physics.castSegment(s.x, s.y, s.z, nx, ny, nz, GROUPS.querySurface, s.from.body);
      if (hit) {
        const target = w.physics.owner<Vessel>(hit.collider.handle);
        s.alive = false;
        if (target && 'damage' in target) {
          target.damage(s.damage, hit.x, hit.y, hit.z, 'shell', s.from);
          surfaceExplosion(w, hit.x, hit.y, hit.z, 0.12 + s.caliber / 900, { debris: true });
          if (s.from.stats.power('pow_auto_ping')) s.from.gunHits++;
        } else surfaceExplosion(w, hit.x, hit.y, hit.z, 0.15, { debris: false });
        continue;
      }
      s.x = nx; s.y = ny; s.z = nz;
      if (s.z < 0) {
        s.alive = false;
        splashColumn(w, s.x, s.y, s.caliber / 110);
        // near-misses on surfaced U-boats still hurt
        this.blastNear(s.x, s.y, 0, 8, s.damage * 0.35, 'shell', s.from, true);
      }
      if (s.t > 30) s.alive = false;
    }
    this.shells = this.shells.filter((s) => s.alive);

    // ---- charges & hedgehog bombs
    for (const c of this.charges) {
      if (!c.alive) continue;
      c.t += dt;
      if (c.t < 0) continue;
      if (!c.wet) {
        c.vz -= 9.81 * dt;
        c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
        const eta = w.ocean.height(c.x, c.y);
        if (c.z <= eta) {
          c.wet = true;
          c.z = eta;
          splashColumn(w, c.x, c.y, c.kind === 'dc' ? 0.35 : 0.12);
          if (c.kind === 'dc') w.emit('splash', { x: c.x, y: c.y, size: 0.6 });
        }
        continue;
      }
      // sinking: drift a little, keep speed constant (terminal velocity)
      c.vx *= Math.exp(-2 * dt); c.vy *= Math.exp(-2 * dt);
      c.x += c.vx * dt; c.y += c.vy * dt;
      c.z -= c.sink * dt;
      const depth = -c.z;
      if (c.kind === 'dc') {
        if (depth >= c.fuse) { c.alive = false; this.detonateCharge(c, depth); }
      } else {
        let hitSub: Vessel | null = null;
        w.physics.sphere(c.x, c.y, c.z, 0.8, GROUPS.querySubs, (col) => { const o = w.physics.owner<Vessel>(col.handle); if (o && o.alive) hitSub = o; });
        if (hitSub) {
          c.alive = false;
          const sub = hitSub as Vessel;
          sub.damage(c.damage, c.x, c.y, c.z, 'hedgehog', c.from);
          underwaterBlast(w, c.x, c.y, depth, 0.55);
          w.emit('explosion', { x: c.x, y: c.y, z: c.z, power: 0.6, kind: 'hedgehog' });
        } else if (depth > 300) {
          c.alive = false;
          const prox = c.from.stats.power('pow_proximity_hedgehog');
          if (prox) this.blastNear(c.x, c.y, -40, 14, c.damage * prox / 100, 'hedgehog', c.from, false);
        }
      }
    }
    this.charges = this.charges.filter((c) => c.alive);

    // ---- torpedoes
    for (const t of this.torpedoes) {
      if (!t.alive) continue;
      const ox = t.x, oy = t.y, oz = t.z;
      t.run += t.speed * dt;
      // acoustic homing toward the loudest vessel ahead (decoys and Foxers attract it)
      if (t.kind === 'acoustic' && t.run > 300) {
        let best: { x: number; y: number } | null = null, bestScore = 0;
        for (const v of w.vessels) {
          if (!v.alive || v.side === t.from.side || v.sub) continue;
          const d = Math.hypot(v.pos.x - t.x, v.pos.y - t.y);
          const ang = Math.abs(angleDiff(t.heading, Math.atan2(v.pos.y - t.y, v.pos.x - t.x)));
          if (d > t.seek || ang > 1.2) continue;
          const score = v.noise / (d + 50);
          if (score > bestScore) { bestScore = score; best = v.pos; }
        }
        for (const d of this.decoys) {
          if (d.kind !== 'foxer' || d.owner.side === t.from.side) continue;
          const dist = Math.hypot(d.x - t.x, d.y - t.y);
          if (dist < t.seek * 1.2) { const score = 3 / (dist + 50); if (score > bestScore) { bestScore = score; best = d; } }
        }
        if (best) t.course = Math.atan2(best.y - t.y, best.x - t.x);
      }
      // gyro steering after a short straight run
      if (t.run > 15) {
        const d = angleDiff(t.heading, t.course);
        t.heading = wrapAngle(t.heading + clamp(d, -0.35 * dt, 0.35 * dt));
      }
      t.x += Math.cos(t.heading) * t.speed * dt;
      t.y += Math.sin(t.heading) * t.speed * dt;
      t.z += (-t.depth - t.z) * Math.min(1, dt * 1.5);
      t.left -= t.speed * dt;
      // contact pistol
      const armed = t.run > 120;
      let hit = w.physics.castSegment(ox, oy, oz, t.x, t.y, t.z, GROUPS.queryVessels, t.from.body);
      if (!hit && armed) {
        // magnetic pistol: passing under a keel
        if (t.magnetic) for (const v of w.vessels) {
          if (!v.alive || v.side === t.from.side || v.sub) continue;
          const loc = v.toLocal(t.x, t.y);
          if (Math.abs(loc.x) < v.cls.length * 0.45 && Math.abs(loc.y) < v.cls.beam * 0.5 && t.depth > v.cls.draft - 0.5 && t.depth < v.cls.draft + 3) {
            hit = { collider: v.collider, x: t.x, y: t.y, z: -v.cls.draft, t: 0 };
            break;
          }
        }
      }
      if (hit) {
        const target = w.physics.owner<Vessel>(hit.collider.handle);
        t.alive = false;
        if (!target || !armed) { if (target && !armed) w.emit('torpedoHit', { by: t.from, target, dud: true }); continue; }
        const underKeel = hit.z <= -target.cls.draft + 0.3;
        const magBonus = underKeel ? 1.45 + t.from.stats.power('pow_magnetic_master') / 100 : 1;
        const dud = t.dud && !(underKeel && t.from.stats.power('pow_magnetic_master'));
        w.emit('torpedoHit', { by: t.from, target, dud });
        if (dud) continue;
        let dmg = t.damage * magBonus;
        if (target.pinned > 0) dmg *= 1 + target.pinnedBonus;
        target.damage(dmg, hit.x, hit.y, hit.z, 'torpedo', t.from);
        surfaceExplosion(w, hit.x, hit.y, 0, 1.1, { fire: target.cls.id === 'tanker' });
        underwaterBlast(w, hit.x, hit.y, 3, 1);
        if (t.from.stats.power('pow_battery_vamp') && t.from.sub) t.from.sub.battery = Math.min(1, t.from.sub.battery + t.from.stats.power('pow_battery_vamp') / 100);
        const split = t.from.stats.power('pow_split_torpedo');
        if (split && !t.split && fx.next() < split / 100) {
          this.torpedoes.push({ ...t, id: torpedoIds++, x: t.x + Math.cos(t.heading) * 60, y: t.y + Math.sin(t.heading) * 60, alive: true, run: 121, left: 900, split: true, damage: t.damage * 0.6 });
        }
        continue;
      }
      if (t.left <= 0) t.alive = false;
    }
    this.torpedoes = this.torpedoes.filter((t) => t.alive);

    // ---- flares, decoys, smoke
    for (const f of this.flares) { f.life -= dt; f.z = Math.max(4, f.z - 3.2 * dt); }
    this.flares = this.flares.filter((f) => f.life > 0);
    for (const d of this.decoys) {
      d.life -= dt;
      if (d.kind === 'foxer') {
        const o = d.owner, b = o.fwd();
        d.x = o.pos.x - b.x * o.cls.length * 1.6; d.y = o.pos.y - b.y * o.cls.length * 1.6;
      }
    }
    this.decoys = this.decoys.filter((d) => d.life > 0 && d.owner.alive);
    for (const s of this.smoke) { s.life -= dt; s.r += dt * 1.2; }
    this.smoke = this.smoke.filter((s) => s.life > 0);

    // ---- aircraft
    for (const a of this.aircraft) a.update(dt);
    this.aircraft = this.aircraft.filter((a) => a.alive);
    // ---- loot crates drift and are collected
    for (const c of this.crates) {
      c.life -= dt;
      c.x += c.vx * dt; c.y += c.vy * dt;
      const p = w.player;
      if (p && p.alive && (!p.sub || p.sub.surfaced)) {
        const d = Math.hypot(p.pos.x - c.x, p.pos.y - c.y);
        if (d < Math.max(14, p.cls.length * 0.35)) { c.life = -1; w.emit('lootPicked', { item: c.item, by: p }); }
      }
    }
    this.crates = this.crates.filter((c) => c.life > 0);
    // ---- lifeboats: rescued by a slow friendly escort alongside
    for (const b of this.boats) {
      b.life -= dt;
      for (const v of w.vessels) {
        if (!v.alive || v.kind !== 'escort' || v.side !== b.side) continue;
        const d = Math.hypot(v.pos.x - b.x, v.pos.y - b.y);
        if (d < v.cls.length * 0.6 && Math.abs(v.hydro.fwdSpeed) < 2.2) {
          b.life = -1;
          v.rescued += b.count;
          w.emit('message', { text: `${b.count} survivors picked up by ${v.name}`, side: v.side, kind: 'info' });
          break;
        }
      }
    }
    this.boats = this.boats.filter((b) => b.life > 0);
  }

  detonateCharge(c: Charge, depth: number) {
    const w = this.w;
    underwaterBlast(w, c.x, c.y, depth, 1);
    this.blastNear(c.x, c.y, -depth, c.radius * 4, c.damage, 'dc', c.from, false, c.radius);
    const chain = c.from.stats.power('pow_chain_charges');
    if (chain && fx.next() < chain / 100) {
      const a = fx.next() * Math.PI * 2;
      this.charges.push({ ...c, x: c.x + Math.cos(a) * 14, y: c.y + Math.sin(a) * 14, z: c.z, fuse: depth + fx.range(-10, 15), alive: true, wet: true, t: 0, vx: 0, vy: 0, vz: 0 });
    }
  }

  /** damage everything near a point with falloff; lethal radius r0 */
  blastNear(x: number, y: number, z: number, radius: number, base: number, kind: 'dc' | 'shell' | 'hedgehog', from: Vessel, surfaceOnly: boolean, r0 = radius * 0.3) {
    const w = this.w;
    for (const v of w.vessels) {
      if (!v.alive || v === from && kind === 'shell') continue;
      if (surfaceOnly && v.submerged) continue;
      const p = v.pos;
      // distance to the hull's centre line segment
      const loc = v.toLocal(x, y);
      const along = clamp(loc.x, -v.cls.length / 2, v.cls.length / 2);
      const hz = v.sub ? p.z : p.z - v.cls.draft * 0.5;
      const d = Math.hypot(loc.x - along, loc.y, z - hz);
      if (d > radius) continue;
      let k = d < r0 ? 1 : Math.pow(1 - (d - r0) / (radius - r0), 1.6);
      if (!v.sub && kind === 'dc') k *= 0.35;
      if (v.pinned > 0) k *= 1 + v.pinnedBonus;
      if (v.sub && v.stats.has('ks_ghost')) k *= 1.2;
      if (v.sub && v.keelDepth > w.layerDepth && v.stats.power('pow_deep_armor')) k *= 1 - v.stats.power('pow_deep_armor') / 100;
      const dmg = base * k;
      if (dmg < 2) continue;
      v.damage(dmg, x, y, z, kind, from);
      // shove the hull away from the blast
      const dx = p.x - x, dy = p.y - y, dz = p.z - z, dl = Math.hypot(dx, dy, dz) || 1;
      const imp = v.cls.displacement * 1000 * 0.35 * k;
      v.body.applyImpulse({ x: (dx / dl) * imp, y: (dy / dl) * imp, z: (dz / dl) * imp * 0.5 }, true);
      v.body.applyTorqueImpulse({ x: fx.range(-1, 1) * imp * 4, y: fx.range(-1, 1) * imp * 8, z: fx.range(-1, 1) * imp * 4 }, true);
    }
  }

  // ------------------------------------------------------------------ render submission
  submit(dt: number) {
    const w = this.w, R = w.scene, P = R.particles;
    // tracers live one frame: none while paused (zero-life particles would never be removed)
    for (const s of dt > 0 ? this.shells : []) {
      P.spawn(PK.TRACER, s.x, s.y, s.z, 0, 0, 0, dt * 1.5, s.caliber > 80 ? 0.9 : 0.6, [1, 0.8, 0.45]);
      P.spawn(PK.TRACER, s.x - s.vx * dt * 0.5, s.y - s.vy * dt * 0.5, s.z - s.vz * dt * 0.5, 0, 0, 0, dt * 1.5, 0.5, [1, 0.6, 0.3]);
    }
    for (const c of this.charges) {
      if (c.t < 0) continue;
      R.stacks.push({ model: this.dcModel, x: c.x, y: c.y, z: c.z, q: { x: 0, y: 0, z: 0, w: 1 } });
      if (c.wet && fx.next() < 0.3) P.spawn(PK.FOAMBIT, c.x, c.y, 0, 0, 0, 0.5, 0.6, 0.35, [0.8, 0.9, 1]);
    }
    for (const t of this.torpedoes) {
      R.stacks.push({ model: this.torpModel, x: t.x, y: t.y, z: t.z, q: quatFromYaw(t.heading) });
      const wakeVis = t.kind === 'steam' ? 1 * t.from.stats.mul('torpedo_wake_pct') : 0.08;
      w.scene.hulls.push({ x: t.x, y: t.y, fx: Math.cos(t.heading), fy: Math.sin(t.heading), halfLen: 3.5, halfBeam: 0.6, vx: Math.cos(t.heading) * t.speed, vy: Math.sin(t.heading) * t.speed, angVel: 0, thrust: 1, draft: 0, depth: t.depth, foam: wakeVis, oil: 0, fire: 0, kind: 1 });
    }
    for (const f of this.flares) {
      const k = Math.min(1, f.life / 3) * (0.85 + 0.15 * Math.sin(w.time * 23 + f.x));
      // one-frame flash; none while paused (a zero-life particle would never be updated or removed)
      if (dt > 0) P.spawn(PK.FLASH, f.x, f.y, f.z, 0, 0, 0, dt * 1.5, 1.2, [1, 1, 0.9]);
      if (fx.next() < 0.3) P.spawn(PK.SMOKE, f.x, f.y, f.z + 1, 0, 0, 0.5, 4, 1.2, [0.7, 0.7, 0.7]);
      w.lights.add({ x: f.x, y: f.y, z: f.z, reach: f.radius, r: 1, g: 0.98, b: 0.88, intensity: f.intensity * k, shadow: true, beam: 0.6, priority: 4 });
    }
    for (const d of this.decoys) {
      if (d.kind === 'bold' && fx.next() < 0.6) P.spawn(PK.FOAMBIT, d.x + fx.range(-3, 3), d.y + fx.range(-3, 3), 0, 0, 0, 0.6, 1.0, 0.4, [0.85, 0.95, 1]);
      if (d.kind === 'bold') w.scene.hulls.push({ x: d.x, y: d.y, fx: 1, fy: 0, halfLen: 3, halfBeam: 3, vx: 0, vy: 0, angVel: 0, thrust: 0, draft: 0, depth: d.depth, foam: 0.4, oil: 0, fire: 0, kind: 2 });
    }
    for (const c of this.crates) {
      const z = w.ocean.height(c.x, c.y) - 0.1;
      const roll = Math.sin(w.time * 1.3 + c.phase) * 0.15;
      R.stacks.push({ model: this.crateModels[c.item.rarity], x: c.x, y: c.y, z, q: quatMul(quatFromYaw(c.phase), { x: Math.sin(roll / 2), y: 0, z: 0, w: Math.cos(roll / 2) }) });
      const col = RARITY_BEAM[c.item.rarity];
      const pulse = 0.8 + 0.2 * Math.sin(w.time * 3 + c.phase);
      w.lights.add({ x: c.x, y: c.y, z: 3, reach: c.item.rarity === 'common' ? 18 : 34, r: col[0], g: col[1], b: col[2], intensity: (c.item.rarity === 'common' ? 0.6 : 1.6) * pulse, beam: c.item.rarity === 'common' ? 0 : 0.8, priority: 1 });
      if (c.item.rarity !== 'common' && fx.next() < 0.4) P.spawn(PK.SPARK, c.x, c.y, z + 1, 0, 0, 6, 0.8, 0.3, col);
    }
    for (const a of this.aircraft) a.submit();
    for (const b of this.boats) {
      b.x += Math.cos(b.h) * 0.3 * dt; b.y += Math.sin(b.h) * 0.3 * dt;
      const z = w.ocean.height(b.x, b.y);
      R.stacks.push({ model: this.boatModel, x: b.x, y: b.y, z: z - 0.3, q: quatFromYaw(b.h), flags: 1 });
      w.lights.add({ x: b.x, y: b.y, z: z + 1.5, reach: 14, r: 1, g: 0.6, b: 0.25, intensity: 0.8 + 0.3 * Math.sin(w.time * 5 + b.x) });
    }
    void qrot;
  }

  /** is the straight line between two points blocked by a smoke screen? */
  smokeBetween(ax: number, ay: number, bx: number, by: number): number {
    let block = 0;
    for (const s of this.smoke) {
      const t = clamp(((s.x - ax) * (bx - ax) + (s.y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2 + 1e-6), 0, 1);
      const px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
      const d = Math.hypot(s.x - px, s.y - py);
      if (d < s.r) block += (1 - d / s.r) * Math.min(1, s.life / 10);
    }
    return Math.min(1, block);
  }
}

export function arcContains(a0: number, a1: number, a: number): boolean {
  // arcs are given as [min, max]; values beyond PI wrap (e.g. [40deg, 320deg] = astern)
  if (a1 <= Math.PI && a0 >= -Math.PI) return a >= a0 && a <= a1;
  const t = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const lo = ((a0 % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), hi = ((a1 % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return lo <= hi ? t >= lo && t <= hi : t >= lo || t <= hi;
}
