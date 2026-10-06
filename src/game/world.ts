// The battlefield: physics, ocean, weather, every entity and the event bus. Mission rules,
// sensors, AI and weapons are separate modules operating on the world.

import { LAND, Physics } from '../physics/physics';
import { Ocean } from '../water/ocean';
import { Environment } from './environment';
import type { Theater } from './theaters';
import { Bus } from '../core/events';
import type { StackModel } from '../art/voxel';
import type { VesselClass, Side } from './vesselClasses';
import { Vessel, type SpawnOpts } from './vessel';
import type { Light } from '../render/lights';
import type { RenderScene } from '../render/scene';
import { dev } from '../core/devSettings';
import { clamp, Rng, smoothstep } from '../core/math';
import type { Projectiles } from './weapons';
import type { Sensors } from './sensors';
import type { Item } from '../meta/types';

export interface ArtModels {
  hull: StackModel;
  mounts: { id: string; model: StackModel; x: number; y: number; z: number; yaw: number }[];
  funnels: [number, number, number][];
  lamps: [number, number, number][];
}

export interface WorldEvents extends Record<string, unknown> {
  sunk: { v: Vessel; reason: string; by: Vessel | null };
  damaged: { v: Vessel; amount: number; kind: string; from: Vessel | null; crit: boolean; x: number; y: number };
  hullCreak: { v: Vessel; severity: number };
  subFlooding: { v: Vessel; leak: number };
  greenWater: { v: Vessel; amount: number };
  explosion: { x: number; y: number; z: number; power: number; kind: string };
  torpedoFired: { by: Vessel; x: number; y: number };
  torpedoHit: { by: Vessel | null; target: Vessel; dud: boolean };
  ping: { by: Vessel; bearing: number; arc: number };
  echo: { by: Vessel; x: number; y: number; doppler: number; strength: number };
  message: { text: string; side?: Side; kind?: 'radio' | 'crew' | 'alert' | 'loot' | 'info'; important?: boolean; color?: string };
  lootPicked: { item: Item; by: Vessel };
  starShell: { x: number; y: number };
  gunFired: { by: Vessel; caliber: number; x: number; y: number };
  dcDrop: { by: Vessel; x: number; y: number };
  splash: { x: number; y: number; size: number };
  reinforce: { n: number };
}

export class World {
  physics = new Physics();
  ocean = new Ocean();
  env = new Environment();
  theater!: Theater;
  bus = new Bus<WorldEvents>();
  vessels: Vessel[] = [];
  time = 0;
  year = 1942;
  rng = new Rng(1);
  playerSide: Side = 'allied';
  player: Vessel | null = null;
  /** attract mode: nobody to hide contacts from */
  spectator = false;
  projectiles!: Projectiles;
  sensors!: Sensors;
  lights: { add: (l: Light) => void };
  private artCache = new Map<string, ArtModels>();
  /** screen flash (explosions near the camera, lightning) */
  flash = 0;
  flashCol: [number, number, number] = [1, 0.9, 0.7];
  /** arena bounds (m) */
  bounds = { x0: -4000, y0: -2500, x1: 4000, y1: 2500 };
  layerDepth = 70;
  /** AI U-boats loiter at periscope depth and hold their fire (escort tutorial, until the attack lesson) */
  holdFire = false;
  islands: { x: number; y: number; r: number; model: StackModel }[] = [];
  /** static scenery stacks (coastline chunks, lighthouse tower) */
  scenery: { x: number; y: number; z: number; model: StackModel }[] = [];
  /** shore lights (town windows, harbour lamps): drawn at night only */
  shoreLights: Light[] = [];
  /** rotating lighthouse beam origin */
  lighthouse: { x: number; y: number; z: number } | null = null;
  /** shallow water (historical harbors): sunk ships settle on the bottom here (m) and their wrecks stay */
  seabed: number | null = null;
  /**
   * Extra simulation systems (historical battles: air raids, scripted timelines): stepped after the
   * projectiles each fixed step, drawn after the vessels each frame.
   */
  systems: { update(dt: number): void; submit(frameDt: number): void }[] = [];
  /** short-lived lights (muzzle flashes, explosions) that outlive the physics step that made them */
  transient: { l: Light; t: number; dur: number; i0: number }[] = [];
  flashLight(l: Light, dur: number) { this.transient.push({ l, t: 0, dur, i0: l.intensity }); }

  /** render collections (stacks, lights, particles, water-sim inputs) gathered by `submit` */
  /** unsubscribe from live physics settings */
  private offDev: () => void;

  constructor(readonly scene: RenderScene) {
    this.lights = { add: (l: Light) => this.scene.lights.add(l) };
    const live = new Set(['phys.waveForces', 'phys.handling', 'phys.heel']);
    this.offDev = dev.onChange((k) => { if (live.has(k)) for (const v of this.vessels) v.retuneHydro(); });
  }

  emit<K extends keyof WorldEvents>(k: K, p: WorldEvents[K]) { this.bus.emit(k, p); }

  artFor(cls: VesselClass): ArtModels {
    let a = this.artCache.get(cls.id);
    if (a) return a;
    const art = cls.art();
    const atlas = this.scene.atlas;
    a = {
      hull: atlas.add(art.hull),
      mounts: art.mounts.map((m) => ({ id: m.id, model: atlas.add(m.model), x: m.x, y: m.y, z: m.z, yaw: m.yaw })),
      funnels: art.funnels, lamps: art.lamps,
    };
    this.artCache.set(cls.id, a);
    return a;
  }

  spawn(cls: VesselClass, x: number, y: number, heading: number, opts: SpawnOpts = {}): Vessel {
    const v = new Vessel(this, cls, x, y, heading, opts);
    this.vessels.push(v);
    return v;
  }

  enemiesOf(side: Side) { return this.vessels.filter((v) => v.alive && v.side !== side); }

  /** fog of war for rendering enemy vessels */
  isVisibleToPlayer(v: Vessel): boolean {
    if (this.spectator) return true;
    if (v.side === this.playerSide || v.isPlayer) return true;
    if (!dev.bool('game.fogOfWar') || dev.bool('debug.reveal')) return true;
    if (!v.alive) return true;
    return this.sensors ? this.sensors.seenByPlayer(v) : true;
  }

  /** fixed simulation step */
  step(dt: number) {
    this.time += dt;
    this.ocean.update(dt);
    this.env.update(dt);
    const aiOn = !dev.bool('ai.freeze');
    for (const v of this.vessels) {
      if (v.alive && v.ai && aiOn) v.ai.update(dt);
      v.preStep(dt);
    }
    this.projectiles?.preStep(dt);
    this.physics.step();
    this.projectiles?.postStep(dt);
    for (const s of this.systems) s.update(dt);
    this.sensors?.update(dt);
    // ramming and collisions
    for (const im of this.physics.impacts) {
      const a = this.physics.owner<Vessel>(im.a), b = this.physics.owner<Vessel>(im.b);
      // running aground
      const ground = a instanceof Vessel && (b as unknown) === LAND ? a : b instanceof Vessel && (a as unknown) === LAND ? b : null;
      if (ground) {
        const lv = ground.body.linvel(), sp = Math.hypot(lv.x, lv.y);
        if (sp > 1.2 && ground.collisionCooldown <= 0) {
          ground.damage(sp * sp * 10, im.x, im.y, im.z, 'ram', null);
          ground.collisionCooldown = 2;
          if (ground.isPlayer) this.emit('message', { text: 'We have run aground!', kind: 'alert', important: true });
        }
        continue;
      }
      if (!(a instanceof Vessel) || !(b instanceof Vessel)) continue;
      const rel = Math.hypot(a.body.linvel().x - b.body.linvel().x, a.body.linvel().y - b.body.linvel().y);
      if (rel < 1.2) continue;
      // friendly bumps in close formation are glancing blows, rams on the enemy are not
      const base = rel * rel * 9 * dev.num('phys.ramming') * (a.side === b.side ? 0.1 : 1);
      const aDmg = base * (b.cls.displacement / (a.cls.displacement + b.cls.displacement)) * 2;
      const bDmg = base * (a.cls.displacement / (a.cls.displacement + b.cls.displacement)) * 2;
      const ramMul = (v: Vessel) => v.stats.mul('ram_damage_pct') * (v.stats.has('ks_iron_bow') ? 3 : 1) * (v.ramBrace > 0 ? v.ramBraceMult : 1);
      const takeMul = (v: Vessel) => (v.stats.has('ks_iron_bow') ? 0.5 : 1) * (v.ramBrace > 0 ? 1 - v.ramBraceReduction : 1);
      if (a.collisionCooldown <= 0 || b.collisionCooldown <= 0) {
        a.damage(aDmg * ramMul(b) * takeMul(a), im.x, im.y, im.z, 'ram', b);
        b.damage(bDmg * ramMul(a) * takeMul(b), im.x, im.y, im.z, 'ram', a);
        a.collisionCooldown = b.collisionCooldown = 1.5;
        for (const v of [a, b]) if (v.stats.power('pow_ram_shield')) v.ramShieldT = 10;
        this.emit('explosion', { x: im.x, y: im.y, z: 0, power: 0.2, kind: 'ram' });
      }
    }
    for (const v of this.vessels) {
      if (v.collisionCooldown > 0) v.collisionCooldown -= dt;
      if (v.ramBrace > 0) v.ramBrace -= dt;
    }
    // remove long-sunk wrecks
    for (let i = this.vessels.length - 1; i >= 0; i--) {
      const v = this.vessels[i];
      // only once under water (a wreck still showing a bow must not vanish), with a hard cap
      if (!v.alive && this.seabed === null && this.time > v.removeAt && (v.hydro.submergedAll || this.time > v.removeAt + 120)) {
        this.physics.remove(v.body);
        this.vessels.splice(i, 1);
      }
    }
  }

  /** gather render data for this frame */
  submit(frameDt: number) {
    const R = this.scene;
    R.beginFrame();
    // beam haze needs darkness to scatter in; by day searchlights and flares light only what they hit
    // fog scatters light: beams show even at dusk and halos grow
    const fog = clamp(this.env.fogDensity, 0, 1);
    R.lights.beamScale = Math.max(smoothstep(0.15, 0.6, this.env.darkness), fog * 0.5) * (1 + fog);
    R.lights.sizeScale = 1 + fog * 1.5;
    R.lights.reachScale = 1 + fog * 0.6;
    for (const v of this.vessels) v.submit(frameDt);
    for (const isl of this.islands) R.stacks.push({ model: isl.model, x: isl.x, y: isl.y, z: 0, q: { x: 0, y: 0, z: 0, w: 1 } });
    for (const s of this.scenery) R.stacks.push({ model: s.model, x: s.x, y: s.y, z: s.z, q: { x: 0, y: 0, z: 0, w: 1 } });
    const night = smoothstep(0.25, 0.7, this.env.darkness);
    if (night > 0.01) for (const l of this.shoreLights) R.lights.add({ ...l, intensity: l.intensity * night });
    if (this.lighthouse && night > 0.01) {
      // one beam sweeping the horizon every ~10 s, plus the lamp room glow
      const L = this.lighthouse, a = this.time * 0.6;
      R.lights.add({ x: L.x, y: L.y, z: L.z, reach: 2600, r: 1, g: 0.95, b: 0.8, intensity: 4 * night, dx: Math.cos(a), dy: Math.sin(a), dz: -0.06, cosOuter: Math.cos(4 * Math.PI / 180), shadow: false, beam: 1.6, size: 0.8, priority: 3 });
      R.lights.add({ x: L.x, y: L.y, z: L.z, reach: 60, r: 1, g: 0.9, b: 0.7, intensity: 1.5 * night, priority: 3 });
    }
    this.projectiles?.submit(frameDt);
    for (const s of this.systems) s.submit(frameDt);
    for (let i = this.transient.length - 1; i >= 0; i--) {
      const tl = this.transient[i];
      tl.t += frameDt;
      if (tl.t >= tl.dur) { this.transient.splice(i, 1); continue; }
      const k = 1 - tl.t / tl.dur;
      tl.l.intensity = tl.i0 * k * k;
      R.lights.add(tl.l);
    }
    // lightning
    if (this.env.lightning > 0.3) this.flash = Math.max(this.flash, this.env.lightning * 0.15);
  }

  dispose() {
    this.offDev();
    this.physics.dispose();
    this.bus.clear();
  }
}
