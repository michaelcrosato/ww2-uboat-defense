// Rapier 3D world wrapper. Gravity points down -z (world x east, y south, z up). Vessels are
// dynamic bodies driven by our hydrodynamics (buoyancy columns, drag, thrust, rudder); Rapier
// integrates them, resolves collisions (ramming!) and answers ray/shape queries for weapons.

import RAPIER from '@dimforge/rapier3d-compat';

export { RAPIER };

/** membership bits */
export const G = { SHIP: 1, SUB: 2, WEAPON: 4, DEBRIS: 8, LAND: 16 } as const;
export const groups = (member: number, filter: number) => ((member & 0xffff) << 16) | (filter & 0xffff);

export const GROUPS = {
  ship: groups(G.SHIP, G.SHIP | G.SUB | G.DEBRIS | G.LAND),
  sub: groups(G.SUB, G.SHIP | G.SUB | G.LAND),
  weapon: groups(G.WEAPON, G.LAND),
  debris: groups(G.DEBRIS, G.SHIP | G.DEBRIS | G.LAND),
  land: groups(G.LAND, 0xffff),
  /** query filter: vessels only */
  queryVessels: groups(0xffff, G.SHIP | G.SUB),
  querySurface: groups(0xffff, G.SHIP | G.LAND),
  querySubs: groups(0xffff, G.SUB),
};

/** collider owner tag for static land */
export const LAND = 'land';

export interface ContactImpact { a: number; b: number; force: number; x: number; y: number; z: number }

export class Physics {
  world: RAPIER.World;
  events: RAPIER.EventQueue;
  dt = 1 / 60;
  /** collider handle -> owner (vessel, debris...) */
  owners = new Map<number, unknown>();
  impacts: ContactImpact[] = [];

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: 0, z: -9.81 });
    this.world.timestep = this.dt;
    this.events = new RAPIER.EventQueue(true);
  }

  setRate(hz: number) { this.dt = 1 / hz; this.world.timestep = this.dt; }

  step() {
    this.world.step(this.events);
    this.impacts.length = 0;
    this.events.drainContactForceEvents((ev) => {
      const h1 = ev.collider1(), h2 = ev.collider2();
      const f = ev.totalForceMagnitude();
      const c1 = this.world.getCollider(h1);
      const p = c1 ? c1.translation() : { x: 0, y: 0, z: 0 };
      this.impacts.push({ a: h1, b: h2, force: f, x: p.x, y: p.y, z: p.z });
    });
  }

  owner<T>(handle: number): T | undefined { return this.owners.get(handle) as T | undefined; }

  /** static land: an upright cylinder (island) or a box (coastline strip) reaching well below the keel */
  addLand(x: number, y: number, shape: { r: number } | { hx: number; hy: number }) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, 0));
    const s = Math.SQRT1_2;
    const desc = 'r' in shape
      ? RAPIER.ColliderDesc.cylinder(40, shape.r).setRotation({ x: s, y: 0, z: 0, w: s })   // Rapier cylinders run along Y
      : RAPIER.ColliderDesc.cuboid(shape.hx, shape.hy, 40);
    const c = this.world.createCollider(desc.setCollisionGroups(GROUPS.land).setFriction(0.6).setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS), body);
    this.owners.set(c.handle, LAND);
    return body;
  }

  remove(body: RAPIER.RigidBody) {
    for (let i = 0; i < body.numColliders(); i++) this.owners.delete(body.collider(i).handle);
    this.world.removeRigidBody(body);
  }

  /** first vessel hit along a segment (shells, torpedoes) */
  castSegment(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, filter: number, exclude?: RAPIER.RigidBody) {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return null;
    const ray = new RAPIER.Ray({ x: x0, y: y0, z: z0 }, { x: dx / len, y: dy / len, z: dz / len });
    const hit = this.world.castRay(ray, len, true, undefined, filter, undefined, exclude);
    if (!hit) return null;
    const t = hit.timeOfImpact;
    return { collider: hit.collider, x: x0 + (dx / len) * t, y: y0 + (dy / len) * t, z: z0 + (dz / len) * t, t: t / len };
  }

  /** all vessel colliders intersecting a sphere */
  sphere(x: number, y: number, z: number, r: number, filter: number, fn: (c: RAPIER.Collider) => void) {
    const shape = new RAPIER.Ball(r);
    this.world.intersectionsWithShape({ x, y, z }, { x: 0, y: 0, z: 0, w: 1 }, shape, (c) => { fn(c); return true; }, undefined, filter);
  }

  dispose() { this.world.free(); this.events.free(); }
}
