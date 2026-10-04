// A ship or submarine: Rapier body + hull hydrodynamics + damage/flooding + weapons state.
// Controllers (player or AI) set orders; the vessel turns them into thrust/rudder/ballast and
// the physics does the rest.

import type RAPIER from '@dimforge/rapier3d-compat';
import { RAPIER as R, GROUPS } from '../physics/physics';
import { HullHydro, type HydroControls } from '../physics/hydro';
import { angleDiff, approach, clamp, fx, qrot, quatFromYaw, rollPitchOf, v3, yawOf, KNOT, type Quat } from '../core/math';
import type { VesselClass, Side, VesselKind, GunSpec } from './vesselClasses';
import type { StackModel } from '../art/voxel';
import type { World } from './world';
import type { HullInput } from '../water/simInputs';
import { StatBlock } from '../meta/stats';
import { PK } from '../render/materials';
import { dev } from '../core/devSettings';

/** `phys.buoyancy` → buoyancy columns along × across the hull */
const BUOYANCY_COLUMNS: Record<string, { columnsX: number; columnsY: number }> = {
  coarse: { columnsX: 6, columnsY: 2 }, normal: { columnsX: 8, columnsY: 3 }, fine: { columnsX: 12, columnsY: 4 },
};
/** `phys.handling` → acceleration / turn multipliers */
const HANDLING: Record<string, { accel: number; turn: number }> = {
  authentic: { accel: 1, turn: 1 }, arcade: { accel: 2, turn: 1.8 }, twitchy: { accel: 3, turn: 3 },
};

export const TELEGRAPH = [
  { name: 'Full astern', frac: -0.55 }, { name: 'Half astern', frac: -0.3 }, { name: 'Stop', frac: 0 },
  { name: 'Slow ahead', frac: 0.28 }, { name: 'Half ahead', frac: 0.52 }, { name: 'Full ahead', frac: 0.78 }, { name: 'Flank', frac: 1 },
];
export const TEL_STOP = 2;

export interface MountState { id: string; model: StackModel; x: number; y: number; z: number; restYaw: number; yaw: number; raise: number }
export interface GunState { spec: GunSpec; mount: MountState; reload: number; aimYaw: number; ready: boolean }
export interface Tube { stern: boolean; loaded: boolean; reload: number }
export interface Fire { lx: number; ly: number; lz: number; power: number; t: number }

export interface SubState {
  orderedDepth: number;
  ballast: number;          // main ballast fill 0..1.15
  planes: number;
  trim: number;
  battery: number;          // 0..1
  periscope: number;        // 0 down .. 1 raised (animated)
  periscopeUp: boolean;
  silent: number;           // seconds remaining
  crash: number;            // seconds of crash-dive boost remaining
  blow: number;             // emergency blow remaining
  snorkel: boolean;
  hullStress: number;       // 0..1 accumulated pressure damage
  surfaced: boolean;
  lastDepth: number;
  vz: number;
}

let nextId = 1;

export class Vessel {
  readonly id = nextId++;
  name: string;
  readonly cls: VesselClass;
  readonly side: Side;
  readonly kind: VesselKind;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  hydro: HullHydro;
  hullModel: StackModel;
  mounts: MountState[] = [];
  funnels: [number, number, number][];
  lamps: [number, number, number][];
  // orders
  telegraph = TEL_STOP;
  thrust = 0;
  rudderCmd = 0;
  rudder = 0;
  /** course to steer (rad) or null for manual rudder */
  course: number | null = null;
  /** direct-mode desired speed fraction (-1..1) or null to use the telegraph */
  speedCmd: number | null = null;
  // condition
  maxHp: number;
  hp: number;
  ingress: Float32Array;
  fires: Fire[] = [];
  alive = true;
  sinking = false;
  sunkTime = -1;
  removeAt = -1;
  damageLook = 0;
  lastAttacker: Vessel | null = null;
  engineDamage = 0;          // 0..1 reduces top speed
  stats = new StatBlock();
  isPlayer = false;
  // weapons
  guns: GunState[] = [];
  dcLeft = 0; dcReload = 0;
  hedgehogLeft = 0; hedgehogReload = 0;
  tubes: Tube[] = [];
  torpedoReloads = 0;
  starShells = 0;
  decoys = 0;
  searchlightOn = false;
  searchlightYaw = 0;        // relative to bow
  // sensors / signatures (updated by sensors)
  noise = 0;
  visualSig = 1;
  muzzleFlash = 0;
  /** last ping time / ASDIC beam bearing for display */
  asdicBearing = 0;
  pinging = 0;
  sub?: SubState;
  /** AI controller or null for the player */
  ai: { update(dt: number): void; debug?: string } | null = null;
  /** convoy slot for merchants */
  slot?: { col: number; row: number };
  grt = 0;
  tag = '';
  // fx bookkeeping
  private smokeAcc = 0;
  private sprayAcc = 0;
  private lastBowSub = 0;
  readonly controls: HydroControls = { thrust: 0, rudder: 0, ballast: 0, planes: 0, trim: 0 };

  constructor(readonly world: World, cls: VesselClass, x: number, y: number, heading: number, opts: { name?: string; submerged?: number } = {}) {
    this.cls = cls; this.side = cls.side; this.kind = cls.kind;
    this.name = opts.name ?? cls.name;
    const art = world.artFor(cls);
    this.hullModel = art.hull;
    this.mounts = art.mounts.map((m) => ({ id: m.id, model: m.model, x: m.x, y: m.y, z: m.z, restYaw: m.yaw, yaw: m.yaw, raise: m.id === 'periscope' ? 0 : 1 }));
    this.funnels = art.funnels; this.lamps = art.lamps;
    const isSub = cls.kind === 'uboat';
    this.hydro = new HullHydro({
      length: cls.length, beam: cls.beam, draft: cls.draft, freeboard: cls.freeboard,
      mass: cls.displacement * 1000,
      comZ: isSub ? -cls.draft + (cls.sub!.hullHeight * 0.42) : -cls.draft * 0.28,
      maxSpeed: cls.maxSpeedKn * KNOT, reverseFrac: 0.45, accelTime: cls.accelTime, turnRadius: cls.turnRadius,
      bowTaper: cls.kind === 'merchant' ? 0.55 : 0.35,
      ...BUOYANCY_COLUMNS[dev.str('phys.buoyancy')] ?? BUOYANCY_COLUMNS.normal, compartments: 5,
      sub: isSub ? { reserveFrac: 0.13, hullHeight: cls.sub!.hullHeight } : undefined,
    });
    this.retuneHydro();
    const mp = this.hydro.massProps();
    const depth = opts.submerged ?? 0;
    const desc = R.RigidBodyDesc.dynamic()
      .setTranslation(x, y, -depth)
      .setRotation(quatFromYaw(heading))
      .setAdditionalMassProperties(mp.mass, mp.com, mp.inertia, { x: 0, y: 0, z: 0, w: 1 })
      .setCanSleep(false)
      .setLinearDamping(0).setAngularDamping(0);
    this.body = world.physics.world.createRigidBody(desc);
    const pts = hullPoints(cls.length, cls.beam, -cls.draft, isSub ? cls.sub!.hullHeight - cls.draft : cls.freeboard);
    const cd = (R.ColliderDesc.convexHull(pts) ?? R.ColliderDesc.cuboid(cls.length / 2, cls.beam / 2, cls.draft))
      .setDensity(0).setFriction(0.3).setRestitution(0.05)
      .setCollisionGroups(isSub ? GROUPS.sub : GROUPS.ship)
      .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(cls.displacement * 1000 * 0.6);
    this.collider = world.physics.world.createCollider(cd, this.body);
    world.physics.owners.set(this.collider.handle, this);
    this.maxHp = cls.hp; this.hp = cls.hp;
    this.ingress = new Float32Array(this.hydro.flood.length);
    // weapons
    for (const g of cls.guns) {
      const mount = this.mounts.find((m) => m.id === g.mount);
      if (mount) this.guns.push({ spec: g, mount, reload: fx.range(0, g.reload), aimYaw: mount.restYaw, ready: true });
    }
    if (cls.dc) this.dcLeft = cls.dc.capacity;
    if (cls.hedgehog && world.year >= cls.hedgehog.minYear) this.hedgehogLeft = cls.hedgehog.salvos;
    if (cls.torpedoes) {
      const t = cls.torpedoes;
      for (let i = 0; i < t.bow; i++) this.tubes.push({ stern: false, loaded: true, reload: 0 });
      for (let i = 0; i < t.stern; i++) this.tubes.push({ stern: true, loaded: true, reload: 0 });
      this.torpedoReloads = t.reloads;
    }
    if (cls.kind === 'escort') { this.starShells = 6; this.decoys = 2; }
    if (isSub) {
      this.decoys = world.year >= 1942 ? 4 : 0;
      this.sub = {
        orderedDepth: depth, ballast: depth > 1 ? 1 : 0, planes: 0, trim: 0, battery: 1, periscope: 0, periscopeUp: false,
        silent: 0, crash: 0, blow: 0, snorkel: false, hullStress: 0, surfaced: depth < 1, lastDepth: depth, vz: 0,
      };
    }
    if (cls.grt) this.grt = cls.grt;
  }

  /** refine buoyancy for subs: casing/tower add little volume */
  /** live physics settings: wave forces, handling preset and heel (column count is fixed at spawn) */
  retuneHydro() {
    const h = HANDLING[dev.str('phys.handling')] ?? HANDLING.arcade;
    this.hydro.retune({ waves: dev.bool('phys.waveForces'), accelMul: h.accel, turnMul: h.turn, heelMul: dev.num('phys.heel'), speedMul: 1 });
  }

  // ------------------------------------------------------------------ state accessors
  get pos() { return this.body.translation(); }
  get rot() { return this.body.rotation() as Quat; }
  get heading() { return yawOf(this.rot); }
  get speed() { return this.hydro.speed; }
  get speedKn() { return this.hydro.fwdSpeed / KNOT; }
  /** depth of the hull top below the surface (subs), 0 if surfaced */
  get depth() {
    if (!this.sub) return 0;
    const p = this.pos;
    return Math.max(0, -(p.z + this.cls.sub!.hullHeight - this.cls.draft) + this.hydro.centerEta);
  }
  /** keel depth (what a U-boat captain reads on the depth gauge) */
  get keelDepth() {
    const p = this.pos;
    return Math.max(0, this.hydro.centerEta - (p.z - this.cls.draft));
  }
  get submerged() { return !!this.sub && this.depth > 1.0; }
  get atPeriscopeDepth() { return !!this.sub && this.keelDepth > 9 && this.keelDepth < this.cls.sub!.periscopeDepth + 4; }
  get hpFrac() { return this.hp / this.maxHp; }
  get maxSpeed() {
    let v = this.cls.maxSpeedKn * KNOT * this.stats.mul('max_speed_pct') * (1 - this.engineDamage * 0.6);
    if (this.sub && this.submerged) v = this.cls.sub!.submergedKn * KNOT * this.stats.mul('submerged_speed_pct') * (1 - this.engineDamage * 0.6);
    return v;
  }
  fwd() { const h = this.heading; return { x: Math.cos(h), y: Math.sin(h) }; }
  local(lx: number, ly: number, lz: number) { const p = this.pos, r = qrot(this.rot, lx, ly, lz); return { x: p.x + r.x, y: p.y + r.y, z: p.z + r.z }; }
  toLocal(x: number, y: number) {
    const p = this.pos, h = this.heading, c = Math.cos(h), s = Math.sin(h);
    const dx = x - p.x, dy = y - p.y;
    return { x: dx * c + dy * s, y: -dx * s + dy * c };
  }

  setTelegraph(i: number) { this.telegraph = clamp(i, 0, TELEGRAPH.length - 1); this.speedCmd = null; }

  // ------------------------------------------------------------------ simulation step (before physics)
  preStep(dt: number) {
    const w = this.world;
    if (!this.alive) { this.controls.thrust = 0; this.controls.rudder = 0; this.hydro.apply(this.body, w.ocean, this.controls, dt); return; }
    // steering
    if (this.course !== null) {
      const err = angleDiff(this.heading, this.course);
      const yawRate = this.hydro.yawRate;
      this.rudderCmd = clamp(err * 2.2 - yawRate * 6, -1, 1);
    }
    const turnRate = 0.55 * (this.stats.mul('turn_pct'));
    this.rudder = approach(this.rudder, this.rudderCmd, turnRate * dt);
    // engine
    let frac = this.speedCmd !== null ? this.speedCmd : TELEGRAPH[this.telegraph].frac;
    if (this.sub) frac = this.subPreStep(dt, frac);
    const speedMul = this.maxSpeed / (this.cls.maxSpeedKn * KNOT);
    let target = Math.sign(frac) * frac * frac * speedMul * speedMul;
    if (this.flankBoost > 0) { target *= 1.35; this.flankBoost -= dt; }
    const accel = 0.25 * this.stats.mul('accel_pct');
    this.thrust = approach(this.thrust, target, accel * dt);
    this.controls.thrust = this.thrust;
    this.controls.rudder = this.rudder;
    this.hydro.apply(this.body, w.ocean, this.controls, dt);
    this.updateDamage(dt);
    this.updateWeapons(dt);
  }

  /** reload timers for guns, tubes and racks */
  private updateWeapons(dt: number) {
    for (const g of this.guns) if (g.reload > 0) g.reload -= dt;
    if (this.ramShieldT > 0) this.ramShieldT -= dt;
    const spec = this.cls.torpedoes;
    if (spec) {
      // one tube reloads at a time (torpedo crews), only while submerged or on the surface at low speed
      const tube = this.tubes.find((t) => !t.loaded);
      const unlimited = dev.bool('game.infiniteAmmo') && this.isPlayer;
      if (tube && (this.torpedoReloads > 0 || unlimited)) {
        tube.reload -= dt;
        if (tube.reload <= 0) { tube.loaded = true; if (!unlimited) this.torpedoReloads--; tube.reload = 0; }
      }
    }
    if (this.pinned > 0) this.pinned -= dt;
    if (this.wolfHowl > 0) this.wolfHowl -= dt;
    if (this.deckGunBoost > 0) this.deckGunBoost -= dt;
    if (this.pinging > 0) this.pinging -= dt;
    if (this.creeping > 0) this.creeping -= dt;
    if (this.snorkelT > 0) { this.snorkelT -= dt; if (this.snorkelT <= 0 || !this.atPeriscopeDepth) { this.snorkelT = 0; if (this.sub) this.sub.snorkel = false; } }
    if (this.smokeT > 0) {
      this.smokeT -= dt;
      const st = this.local(-this.cls.length * 0.5, 0, this.cls.freeboard + 1);
      this.world.projectiles.smoke.push({ x: st.x, y: st.y, r: 18 * this.smokeDensity, life: 70 });
      if (this.world.projectiles.smoke.length > 400) this.world.projectiles.smoke.shift();
    }
  }
  flankBoost = 0;
  collisionCooldown = 0;
  ramBrace = 0;
  /** pow_ram_shield seconds left after a ram */
  ramShieldT = 0;
  ramBraceMult = 1;
  ramBraceReduction = 0;
  /** deck gun barrage ability */
  deckGunBoost = 0; deckGunRate = 1;
  /** gun hits counted for pow_auto_ping */
  gunHits = 0;
  /** marked by ASDIC echo marks: takes extra damage */
  pinned = 0; pinnedBonus = 0;
  rescued = 0;
  starShellLife = 1; starShellRadius = 1;
  /** wolf howl legendary timer */
  wolfHowl = 0;
  /** extra visual signature multiplier (abilities, keystones) */
  visualBoost = 1;
  /** merchant fell out of formation */
  straggler = false;
  // ability state
  revealUntil = -1;
  smokeT = 0; smokeDensity = 1;
  creeping = 0; creepBonus = 0;
  scanUntil = -1; scanQuality = 0;
  snorkelT = 0; snorkelMul = 1;

  /** submarine depth keeping, ballast, battery. returns the effective speed fraction */
  private subPreStep(dt: number, frac: number): number {
    const s = this.sub!, sc = this.cls.sub!;
    const keel = this.keelDepth;
    s.vz = (keel - s.lastDepth) / Math.max(dt, 1e-4);
    s.lastDepth = keel;
    const want = s.orderedDepth;
    const surfacing = want < 1;
    const diveMul = this.stats.mul('dive_rate_pct') * (s.crash > 0 ? 2.2 : 1);
    if (s.crash > 0) s.crash -= dt;
    if (s.blow > 0) { s.blow -= dt; s.ballast = approach(s.ballast, 0, dt * 0.35); }
    else if (surfacing) s.ballast = approach(s.ballast, 0, dt * (1 / 14));
    else {
      // flood main ballast to dive; then fine trim around neutral to hold depth
      const err = want - keel;
      const assist = dev.bool('game.autoDepth') || !this.isPlayer;
      if (keel < 3 && err > 0) s.ballast = approach(s.ballast, s.crash > 0 ? 1.12 : 1.04, dt * (1 / sc.diveTime) * 1.4 * diveMul);
      else if (assist) {
        const vzWant = clamp(err * 0.12, -2.2 * diveMul, 2.2 * diveMul);
        const vzErr = vzWant - s.vz;
        const sp = Math.abs(this.hydro.fwdSpeed);
        // planes do the work at speed; trim tanks at low speed
        s.planes = clamp(-vzErr * 0.9, -1, 1) * (sp > 0.8 ? 1 : 0.3);
        // trim tanks: enough authority to make ~1 m/s at creep speed (a hunted boat must be able to go deep)
        const trimTarget = 1.0 + clamp(vzErr * 0.12, -0.12, 0.2) * (sp > 1.5 ? 0.6 : 1) + (s.crash > 0 ? 0.08 : 0);
        s.ballast = approach(s.ballast, trimTarget, dt * 0.12);
      }
    }
    // hull stress below test depth
    const test = sc.testDepth * this.stats.mul('test_depth_pct') * (this.stats.has('ks_iron_coffin') ? 1.4 : 1);
    const crush = test * (sc.crushDepth / sc.testDepth);
    if (keel > test) {
      const over = (keel - test) / (crush - test);
      s.hullStress += dt * over * 0.012;
      if (fx.next() < dt * over * 0.4) this.world.emit('hullCreak', { v: this, severity: over });
      if (keel > crush || s.hullStress >= 1) this.destroy('crushed');
    }
    // periscope animation
    const canScope = this.atPeriscopeDepth || keel < 9;
    if (!canScope) s.periscopeUp = false;
    s.periscope = approach(s.periscope, s.periscopeUp ? 1 : 0, dt * 0.6);
    const scope = this.mounts.find((m) => m.id === 'periscope');
    if (scope) scope.raise = s.periscope;
    // silent running caps speed
    let eff = frac;
    if (s.silent > 0) { s.silent -= dt; eff = clamp(eff, -0.35, (sc.silentKn / sc.submergedKn)); }
    s.surfaced = keel < this.cls.draft + 1.5 && s.ballast < 0.3;
    // battery: electric drive when submerged, diesels recharge on the surface or snorkel
    if (this.submerged && !s.snorkel) {
      const drain = Math.pow(Math.abs(eff), 1.6) * 0.0021 * this.stats.mul('battery_drain_pct') / this.stats.mul('battery_pct') * (100 / sc.battery);
      s.battery = Math.max(0, s.battery - drain * dt - 0.000015 * dt);
      if (s.battery <= 0) eff = clamp(eff, -0.05, 0.05);
    } else if (s.surfaced || s.snorkel) {
      s.battery = Math.min(1, s.battery + dt * 0.0012 * this.stats.mul('recharge_pct') * (s.snorkel ? 0.7 : 1));
    }
    this.controls.ballast = s.ballast;
    this.controls.planes = s.planes;
    this.controls.trim = s.trim;
    return eff;
  }

  // ------------------------------------------------------------------ damage
  /** damage at a world point. kind decides flooding/fire behaviour */
  /**
   * Escort-player auras on merchants: convoy_aura_pct (Shepherd keystone and gear) within 600 m of
   * the player, pow_flare_aura while a star shell burns within 900 m.
   */
  private protection(): number {
    const p = this.world.player;
    if (this.kind !== 'merchant' || !p || !p.alive || p.side !== this.side) return 1;
    let k = 1;
    const aura = p.stats.get('convoy_aura_pct');
    if (aura && Math.hypot(p.pos.x - this.pos.x, p.pos.y - this.pos.y) < 600) k *= 1 - clamp(aura, 0, 60) / 100;
    const fa = p.stats.power('pow_flare_aura');
    if (fa && this.world.projectiles.flares.some((f) => Math.hypot(f.x - this.pos.x, f.y - this.pos.y) < 900)) k *= 1 - clamp(fa, 0, 60) / 100;
    return k;
  }

  damage(amount: number, wx: number, wy: number, wz: number, kind: 'torpedo' | 'shell' | 'dc' | 'hedgehog' | 'ram' | 'fire' | 'crush' | 'explosion', from: Vessel | null) {
    if (!this.alive) return 0;
    if (this.isPlayer && dev.bool('game.god')) return 0;
    let mult = this.stats.mul('damage_taken_pct') * (this.isPlayer ? dev.num('game.playerDamage') : 1);
    if (from?.isPlayer) mult *= dev.num('game.enemyDamage');
    mult *= this.protection();
    // pow_ram_shield: braced after a ram
    if (this.ramShieldT > 0) mult *= 1 - clamp(this.stats.power('pow_ram_shield'), 0, 80) / 100;
    let crit = false;
    if (from && (kind === 'shell' || kind === 'torpedo' || kind === 'hedgehog')) {
      // pow_silent_crit: a silent-running boat picks its moment
      const silentCrit = from.sub && from.sub.silent > 0 ? from.stats.power('pow_silent_crit') : 0;
      const cc = (5 + from.stats.get('crit_chance') + silentCrit) / 100;
      if (fx.next() < cc) { crit = true; mult *= 2 * from.stats.mul('crit_damage_pct'); }
    }
    const dmg = amount * mult;
    this.hp -= dmg;
    this.lastAttacker = from ?? this.lastAttacker;
    this.damageLook = Math.min(1, this.damageLook + dmg / this.maxHp * 0.9);
    const loc = this.toLocal(wx, wy);
    const along = clamp((loc.x / this.cls.length + 0.5), 0, 0.999);
    const ci = Math.floor(along * 5) * 2 + (loc.y < 0 ? 0 : 1);
    const flood = this.stats.mul('flooding_pct');
    const below = wz < this.pos.z + 0.5;
    if (kind === 'torpedo') {
      this.ingress[ci] += 0.05 * flood * (dmg / 1000);
      const n1 = ci - 2, n2 = ci + 2;
      if (n1 >= 0) this.ingress[n1] += 0.02 * flood;
      if (n2 < this.ingress.length) this.ingress[n2] += 0.02 * flood;
      this.ingress[ci ^ 1] += 0.025 * flood;
      if (this.kind !== 'uboat') this.ignite(loc.x, loc.y, 0.9);
    } else if (kind === 'shell') {
      if (below || this.submerged) this.ingress[ci] += 0.004 * flood * (dmg / 80);
      if (fx.next() < 0.18 && this.kind !== 'uboat') this.ignite(loc.x, loc.y, 0.4);
    } else if (kind === 'dc' || kind === 'hedgehog' || kind === 'explosion') {
      this.ingress[ci] += 0.012 * flood * (dmg / 300);
      if (this.sub) this.sub.hullStress += dmg / this.maxHp * 0.12;
      if (this.sub && fx.next() < 0.35) this.engineDamage = Math.min(1, this.engineDamage + 0.15);
    } else if (kind === 'ram') {
      this.ingress[ci] += 0.03 * flood * (dmg / 500);
    }
    if (crit && fx.next() < 0.5) this.engineDamage = Math.min(1, this.engineDamage + 0.3);
    this.world.emit('damaged', { v: this, amount: dmg, kind, from, crit, x: wx, y: wy });
    if (this.hp <= 0) {
      // structural failure: the hull opens up everywhere
      for (let i = 0; i < this.ingress.length; i++) this.ingress[i] += 0.06;
      if (this.sub) this.destroy('destroyed');
    }
    return dmg;
  }

  ignite(lx: number, ly: number, power: number) {
    if (this.fires.length >= 5) { this.fires[(fx.next() * this.fires.length) | 0].power += power * 0.5; return; }
    const lz = this.cls.freeboard + 1;
    this.fires.push({ lx, ly: clamp(ly, -this.cls.beam * 0.3, this.cls.beam * 0.3), lz, power, t: 0 });
  }

  private updateDamage(dt: number) {
    const h = this.hydro;
    const repair = this.stats.mul('repair_pct');
    for (let i = 0; i < this.ingress.length; i++) {
      // damage control slowly stems leaks and pumps water out
      this.ingress[i] = Math.max(0, this.ingress[i] - dt * 0.0012 * repair * (this.hp > 0 ? 1 : 0.1));
      h.flood[i] = clamp(h.flood[i] + this.ingress[i] * dt - (this.ingress[i] < 0.002 ? dt * 0.002 * repair : 0), 0, 1);
      // progressive flooding into neighbours
      if (h.flood[i] > 0.92) {
        const j = i + 2 < h.flood.length ? i + 2 : i - 2;
        if (j >= 0) h.flood[j] = Math.min(1, h.flood[j] + dt * 0.004);
      }
    }
    // fires burn, spread smoke and damage, and die down
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t += dt;
      this.hp -= f.power * dt * 2.5 / this.stats.mul('fire_resist_pct');
      f.power -= dt * 0.012 * repair * (this.hp > 0 ? 1 : 0.2);
      if (f.power <= 0 || (this.hydro.submergedAll && this.sinking)) this.fires.splice(i, 1);
    }
    // sinking: deck under water and still going down
    if (this.alive && !this.sub) {
      const p = this.pos;
      const deckUnder = h.centerEta - (p.z + this.cls.freeboard);
      if (deckUnder > 0.6 || (this.hp <= -this.maxHp * 0.6)) {
        this.sinkTimer += dt;
        if (this.sinkTimer > 2.5) this.destroy('sunk');
      } else this.sinkTimer = Math.max(0, this.sinkTimer - dt);
    }
    if (this.alive && this.sub && this.hp <= 0) this.destroy('destroyed');
    if (this.sub && this.alive) {
      // a holed U-boat takes on water: forced deeper unless it blows ballast
      const leak = this.hydro.floodTotal();
      if (leak > 0.45 && this.submerged) this.world.emit('subFlooding', { v: this, leak });
    }
  }
  private sinkTimer = 0;

  destroy(reason: 'sunk' | 'crushed' | 'destroyed' | 'scuttled') {
    if (!this.alive) return;
    this.alive = false;
    this.sinking = true;
    this.sunkTime = this.world.time;
    this.removeAt = this.world.time + (this.kind === 'uboat' ? 40 : 90);
    for (let i = 0; i < this.ingress.length; i++) this.ingress[i] = Math.max(this.ingress[i], 0.02);
    this.searchlightOn = false;
    this.course = null; this.speedCmd = 0; this.telegraph = TEL_STOP;
    this.world.emit('sunk', { v: this, reason, by: this.lastAttacker });
  }

  // ------------------------------------------------------------------ cosmetic + render submission
  submit(dt: number) {
    const w = this.world, R = w.scene;
    const p = this.pos, q = this.rot;
    const removedSoon = !this.alive && w.time > this.removeAt - 3;
    if (removedSoon) return;
    const visible = w.isVisibleToPlayer(this);
    const flags = (this.searchlightOn ? 1 : 0) | (this.isPlayer && this.sub ? 2 : 0);
    if (visible) {
      R.stacks.push({ model: this.hullModel, x: p.x, y: p.y, z: p.z, q, damage: this.damageLook, flags });
      for (const m of this.mounts) {
        if (m.raise <= 0.02) continue;
        const lz = m.z - (1 - m.raise) * 5.5;
        const mp = qrot(q, m.x, m.y, lz);
        const mq = quatMul(q, quatFromYaw(m.yaw));
        R.stacks.push({ model: m.model, x: p.x + mp.x, y: p.y + mp.y, z: p.z + mp.z, q: mq, damage: this.damageLook * 0.7, flags });
      }
    }
    // water interaction
    const f = this.fwd();
    const v = this.body.linvel();
    const isSub = !!this.sub;
    const depth = this.depth;
    const hull: HullInput = {
      x: p.x, y: p.y, fx: f.x, fy: f.y, halfLen: this.cls.length / 2, halfBeam: this.cls.beam / 2,
      vx: v.x, vy: v.y, angVel: this.body.angvel().z, thrust: this.thrust, draft: this.cls.draft,
      depth, foam: this.alive ? 1 : 0.4, oil: this.oilLeak(), fire: this.fires.length ? Math.min(1, this.fires.reduce((a, b) => a + b.power, 0)) : 0,
      kind: isSub && depth > 1.5 ? 3 : 0,
    };
    if (!(isSub && depth > 25)) w.scene.hulls.push(hull);
    // periscope feather
    if (isSub && this.sub!.periscope > 0.6 && this.atPeriscopeDepth) {
      const sp = this.mounts.find((m) => m.id === 'periscope');
      if (sp) {
        const wp = this.local(sp.x, 0, 0);
        w.scene.hulls.push({ ...hull, x: wp.x, y: wp.y, halfLen: 1.5, halfBeam: 0.4, draft: 0, depth: 0, kind: 2 });
      }
    }
    if (!visible && !this.isPlayer) return;
    // funnel smoke
    if (this.alive && (!isSub || this.sub!.surfaced || this.sub!.snorkel)) {
      const rate = isSub ? 3 + Math.abs(this.thrust) * 10 : 4 + Math.abs(this.thrust) * 18 + this.fires.length * 6;
      this.smokeAcc += rate * dt;
      const dark = this.kind === 'merchant' ? 0.1 : isSub ? 0.35 : 0.22;
      while (this.smokeAcc > 1) {
        this.smokeAcc -= 1;
        for (const fn of this.funnels) {
          const wp = this.local(fn[0], fn[1], fn[2]);
          const g = dark + fx.next() * 0.08;
          R.particles.spawn(PK.SMOKE, wp.x + fx.range(-0.5, 0.5), wp.y + fx.range(-0.5, 0.5), wp.z, v.x * 0.6, v.y * 0.6, 2.2, fx.range(5, 9), isSub ? 1.4 : 2.2, [g, g, g + 0.01]);
        }
      }
    }
    // fires
    for (const fr of this.fires) {
      const wp = this.local(fr.lx, fr.ly, fr.lz);
      if (fx.next() < fr.power * 0.9) R.particles.spawn(PK.FIRE, wp.x + fx.range(-1.5, 1.5), wp.y + fx.range(-1.5, 1.5), wp.z, v.x, v.y, fx.range(2, 5), fx.range(0.5, 1.0), fx.range(1, 2.2), [1, 0.6, 0.2]);
      if (fx.next() < fr.power * 0.6) R.particles.spawn(PK.SMOKE, wp.x, wp.y, wp.z + 2, v.x * 0.5, v.y * 0.5, 3, fx.range(6, 12), 3, [0.06, 0.06, 0.07]);
      w.lights.add({ x: wp.x, y: wp.y, z: wp.z + 3, reach: 40 + fr.power * 50, r: 1, g: 0.5, b: 0.18, intensity: (1.4 + fr.power) * (0.8 + 0.2 * Math.sin(w.time * 17 + fr.lx)), shadow: true });
    }
    // bow spray and green water when the bow digs into a wave
    if (dev.bool('water.splashes') && (!isSub || this.sub!.surfaced) && this.alive) {
      const bow = this.hydro.cols[this.hydro.cols.length - 2];
      const bowSub = bow ? bow.sub : 0;
      const slam = (bowSub - this.lastBowSub) / Math.max(dt, 1e-3);
      this.lastBowSub = bowSub;
      const spd = Math.abs(this.hydro.fwdSpeed);
      this.sprayAcc += dt * (spd > 3 ? (spd - 3) * 2.5 + Math.max(0, slam) * 12 : 0);
      const bowP = this.local(this.cls.length * 0.42, 0, 0.6);
      while (this.sprayAcc > 1) {
        this.sprayAcc -= 1;
        const side = fx.sign();
        const r = { x: -f.y * side, y: f.x * side };
        const out = fx.range(1.5, 4) + spd * 0.25;
        R.particles.spawn(PK.SPRAY, bowP.x + r.x * this.cls.beam * 0.3, bowP.y + r.y * this.cls.beam * 0.3, bowP.z, v.x * 0.7 + r.x * out, v.y * 0.7 + r.y * out, fx.range(2, 5) + Math.max(0, slam) * 0.8, fx.range(0.8, 1.6), fx.range(0.4, 0.8), [0.85, 0.92, 0.95]);
        if (fx.next() < 0.4) R.particles.spawn(PK.MIST, bowP.x, bowP.y, bowP.z + 1, v.x * 0.8 + r.x * out * 0.5, v.y * 0.8 + r.y * out * 0.5, 1.5, fx.range(0.8, 1.6), 1.2, [0.85, 0.9, 0.95]);
      }
      // green water: the bow is buried past the deck edge -> a sheet of water runs aft along the deck
      if (dev.bool('water.deckWash') && bow && bowSub > -bow.z0 + this.cls.freeboard * 0.85 && slam > 0.2) {
        const n = Math.min(30, Math.floor(slam * 6));
        for (let i = 0; i < n; i++) {
          const lx = this.cls.length * fx.range(0.25, 0.42), ly = fx.range(-0.4, 0.4) * this.cls.beam;
          const wp = this.local(lx, ly, this.cls.freeboard + 1.2);
          R.particles.spawn(PK.SHEET, wp.x, wp.y, wp.z + fx.range(0, 1.2), v.x - f.x * fx.range(3, 7), v.y - f.y * fx.range(3, 7), fx.range(0.5, 2), fx.range(0.6, 1.3), fx.range(0.6, 1.1), [0.9, 0.96, 1], { grav: 3 });
        }
        if (this.isPlayer) w.emit('greenWater', { v: this, amount: slam });
      }
    }
    // searchlight
    if (this.searchlightOn && this.alive) {
      const sl = this.mounts.find((m) => m.id === 'searchlight');
      if (sl) {
        sl.yaw = this.searchlightYaw;
        const lp = this.local(sl.x, sl.y, sl.z + 1.0);
        const dir = qrot(quatMul(q, quatFromYaw(this.searchlightYaw)), 1, 0, -0.035);
        const reach = 420 * this.stats.mul('searchlight_pct');
        w.lights.add({ x: lp.x, y: lp.y, z: lp.z, reach, r: 0.92, g: 0.96, b: 1, intensity: 3.2, dx: dir.x, dy: dir.y, dz: dir.z, cosOuter: Math.cos(5.5 * Math.PI / 180), shadow: true, beam: 1, size: 0.7, priority: 2 });
      }
    }
    if (this.muzzleFlash > 0) this.muzzleFlash -= dt;
  }

  oilLeak() {
    if (this.kind === 'escort') return this.alive ? 0 : 0.4;
    const f = this.hydro.floodTotal();
    return this.kind === 'merchant' ? (this.cls.id === 'tanker' ? f * 2.5 : f * 0.8) + (this.alive ? 0 : 0.8) : this.alive ? f * 0.6 : 1;
  }

  /** roll/pitch for HUD */
  attitude() { return rollPitchOf(this.rot); }
  get pos3() { const p = this.pos; return v3(p.x, p.y, p.z); }
}

export function quatMul(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

/** convex hull points of a ship-shaped prism from keel to deck */
export function hullPoints(L: number, B: number, z0: number, z1: number): Float32Array {
  const pts: number[] = [];
  const outline: [number, number][] = [];
  for (let i = 0; i <= 10; i++) {
    const u = i / 10 * 2 - 1;
    const w = u > 0.35 ? Math.max(0.05, 1 - Math.pow((u - 0.35) / 0.65, 1.6)) : u < -0.8 ? 0.6 + 0.4 * (1 - (-u - 0.8) / 0.2) : 1;
    outline.push([u * L / 2, w * B / 2]);
  }
  for (const [x, y] of outline) {
    pts.push(x, y, z1, x, -y, z1);
    pts.push(x * 0.97, y * 0.7, z0, x * 0.97, -y * 0.7, z0);
  }
  return new Float32Array(pts);
}
