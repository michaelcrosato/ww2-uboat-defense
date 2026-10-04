// Hydrodynamics for floating rigid bodies.
//  * Buoyancy: the hull planform is split into vertical columns. Each column's submerged length
//    under the local Gerstner surface gives an upward force at its submerged centroid, so ships
//    heave, pitch and roll on the swell, and flooded compartments (extra weight at their
//    location) make them settle by the bow, list and finally go down — no scripted sinking.
//    Column areas are calibrated so the hull floats exactly at its design draft in calm water.
//  * Drag: strongly anisotropic in the hull frame (keel), lateral force applied low so ships heel
//    in turns; quadratic + linear yaw damping.
//  * Propulsion: propeller thrust at the stern (loses grip when the stern lifts out), rudder force
//    from flow over the blade plus propeller wash (so you can kick the stern round at low speed).
//  * Submarines: main ballast tanks add weight up to neutral buoyancy, dive planes give lift and
//    pitch with speed, vertical drag when submerged.

import type RAPIER from '@dimforge/rapier3d-compat';
import { clamp, qrot, v3, type Quat, type V3 } from '../core/math';
import type { Ocean } from '../water/ocean';

export const RHO = 1025;
export const GRAV = 9.81;

export interface HydroSpec {
  length: number; beam: number; draft: number; freeboard: number;
  mass: number;               // kg
  comZ: number;               // center of mass height (m, waterline = 0)
  maxSpeed: number;           // m/s at full thrust
  reverseFrac: number;        // astern thrust fraction
  accelTime: number;          // s, rough time to reach top speed from rest
  turnRadius: number;         // m at full rudder, full speed
  bowTaper?: number;          // u where the planform starts narrowing
  columnsX: number; columnsY: number;
  compartments: number;       // along the hull (each split port/starboard)
  /** submarine: hull is a cylinder; draft is surfaced draft */
  sub?: { reserveFrac: number; hullHeight: number };
}

export interface Column {
  lx: number; ly: number;     // local position (m)
  z0: number;                 // local bottom (m)
  h: number;                  // column height (m)
  area: number;               // m^2
  comp: number;               // compartment index
  prevEta: number;
  sub: number;                // last submerged length
}

export interface HydroControls {
  thrust: number;             // -1..1 effort
  rudder: number;             // -1..1 (positive = starboard)
  ballast: number;            // 0..1.1 main ballast fill (subs)
  planes: number;             // -1..1 dive planes (positive = rise)
  trim: number;               // -1..1 fore/aft trim moment
}

export interface HydroTuning {
  waves: boolean;
  accelMul: number;
  turnMul: number;
  heelMul: number;
  speedMul: number;
}

const tmp = v3(), tmp2 = v3(), tmp3 = v3();

export class HullHydro {
  cols: Column[] = [];
  /** water mass fraction per compartment [along * 2 + side] (0..1) */
  flood: Float32Array;
  compVolume: number;
  // derived coefficients
  thrustMax = 0; kFwd = 0; kLat = 0; cLat = 0; kYaw = 0; cYaw = 0; kRud = 0; kWash = 0;
  inertia = { x: 1, y: 1, z: 1 };
  /** last frame diagnostics */
  immersion = 0;         // 0..1 fraction of buoyancy columns wetted at design draft
  submergedAll = false;  // completely under water
  speed = 0; fwdSpeed = 0; sideSpeed = 0; yawRate = 0;
  depth = 0;             // depth of the deck/casing below surface (subs)
  centerEta = 0;
  totalVolume = 0;       // m^3 if fully submerged
  sternWet = 1;

  constructor(readonly s: HydroSpec) {
    this.flood = new Float32Array(s.compartments * 2);
    this.buildColumns();
    const vol = s.mass / RHO;
    this.compVolume = (this.totalVolume) / (s.compartments * 2);
    void vol;
    this.deriveCoefficients();
  }

  private planform(u: number): number {
    const b = this.s.bowTaper ?? 0.35;
    if (u > b) return Math.max(0.12, 1 - Math.pow((u - b) / (1 - b), 1.6));
    if (u < -0.75) return Math.max(0.35, 1 - Math.pow((-u - 0.75) / 0.25, 2) * 0.6);
    return 1;
  }

  private buildColumns() {
    const s = this.s, nx = s.columnsX, ny = s.columnsY;
    const L = s.length, B = s.beam;
    const cols: Column[] = [];
    let weightSum = 0;
    for (let i = 0; i < nx; i++) {
      const u = ((i + 0.5) / nx) * 2 - 1;     // -1 stern .. 1 bow
      const pf = this.planform(u);
      for (let j = 0; j < ny; j++) {
        const v = ny === 1 ? 0 : ((j + 0.5) / ny) * 2 - 1;
        // keel rises toward the ends
        const endRise = Math.max(0, Math.abs(u) - 0.7) / 0.3;
        const z0 = s.sub ? -s.draft * (1 - 0.35 * Math.abs(v) - 0.5 * endRise * endRise) : -s.draft * (1 - 0.6 * endRise * endRise) * (1 - 0.18 * Math.abs(v));
        const h = s.sub ? s.sub.hullHeight * (1 - 0.4 * endRise) : -z0 + s.freeboard * (u > 0.2 ? 1.25 : 1);
        const w = pf * (s.sub ? Math.sqrt(Math.max(0.05, 1 - v * v * 0.6)) : 1);
        const comp = Math.min(s.compartments - 1, Math.floor(((u + 1) / 2) * s.compartments)) * 2 + (v < 0 ? 0 : 1);
        cols.push({ lx: (u * L) / 2, ly: (v * B * pf) / 2 * 0.95, z0, h, area: w, comp, prevEta: 0, sub: 0 });
        weightSum += w * Math.max(0.1, -z0);
      }
    }
    // calibrate: sum(area_i * draft_i) * RHO = mass (floats at design draft; subs at surfaced draft)
    const k = s.mass / RHO / weightSum;
    let tv = 0;
    for (const c of cols) { c.area *= k; tv += c.area * c.h; }
    this.totalVolume = tv;
    this.cols = cols;
  }

  private deriveCoefficients() {
    const s = this.s, m = s.mass;
    const H = s.draft + s.freeboard;
    this.inertia = {
      x: (m * (s.beam * s.beam + H * H)) / 12 * 0.9,
      y: (m * (s.length * s.length + H * H)) / 12 * 0.75,
      z: (m * (s.length * s.length + s.beam * s.beam)) / 12 * 0.75,
    };
    this.retune({ waves: true, accelMul: 1, turnMul: 1, heelMul: 1, speedMul: 1 });
  }

  /** recompute handling coefficients (handling preset, upgrades) */
  retune(t: HydroTuning) {
    const s = this.s, m = s.mass;
    const vmax = s.maxSpeed * t.speedMul;
    this.thrustMax = (m * vmax) / Math.max(4, s.accelTime / t.accelMul);
    this.kFwd = this.thrustMax / (vmax * vmax);
    this.kLat = this.kFwd * 38;
    this.cLat = m * 0.12;
    const tauYaw = 3.2 / Math.sqrt(t.turnMul);
    this.cYaw = this.inertia.z / tauYaw;
    this.kYaw = this.cYaw * 0.6;
    const wT = vmax / (s.turnRadius / t.turnMul);
    this.kRud = (this.cYaw * wT + this.kYaw * wT * wT) / ((vmax * vmax * s.length) / 2) * 1.35;
    this.kWash = (this.kRud * vmax * vmax * 0.28) / this.thrustMax;
    this.heel = t.heelMul;
    this.waves = t.waves;
  }
  private heel = 1;
  private waves = true;

  /** mass properties for Rapier */
  massProps(): { mass: number; com: V3; inertia: V3 } {
    return { mass: this.s.mass, com: v3(0, 0, this.s.comZ), inertia: v3(this.inertia.x, this.inertia.y, this.inertia.z) };
  }

  /**
   * Apply all hydrodynamic forces for one step. `extraWeight` adds kg at local points (ballast).
   * Returns nothing; read diagnostics fields afterwards.
   */
  apply(body: RAPIER.RigidBody, ocean: Ocean, c: HydroControls, dt: number) {
    const s = this.s;
    body.resetForces(true);
    body.resetTorques(true);
    const p = body.translation(), q = body.rotation() as Quat;
    const v = body.linvel(), w = body.angvel();
    const com = body.worldCom();
    const up = qrot(q, 0, 0, 1, tmp3);
    const upz = Math.max(0.15, up.z);
    let wet = 0, wetRef = 0, sternWet = 0, sternRef = 0, allUnder = true;
    let fx = 0, fy = 0, fz = 0, tx = 0, ty = 0, tz = 0;
    const addAt = (Fx: number, Fy: number, Fz: number, px: number, py: number, pz: number) => {
      fx += Fx; fy += Fy; fz += Fz;
      const rx = px - com.x, ry = py - com.y, rz = pz - com.z;
      tx += ry * Fz - rz * Fy; ty += rz * Fx - rx * Fz; tz += rx * Fy - ry * Fx;
    };
    const heaveDamp = 0.9 * RHO * Math.sqrt(GRAV * Math.max(1, s.draft));
    for (const col of this.cols) {
      const b = qrot(q, col.lx, col.ly, col.z0, tmp);
      const bx = p.x + b.x, by = p.y + b.y, bz = p.z + b.z;
      const eta = this.waves ? ocean.height(bx, by) : 0;
      const etaV = dt > 0 ? (eta - col.prevEta) / dt : 0;
      col.prevEta = eta;
      const sub = clamp((eta - bz) / upz, 0, col.h);
      col.sub = sub;
      if (sub < col.h - 0.01) allUnder = false;
      wet += sub * col.area; wetRef += Math.max(0.1, -col.z0) * col.area;
      if (col.lx < -s.length * 0.3) { sternWet += sub; sternRef += Math.max(0.1, -col.z0); }
      if (sub <= 0) continue;
      const cx = bx + up.x * sub * 0.5, cy = by + up.y * sub * 0.5, cz = bz + up.z * sub * 0.5;
      // point velocity at the submerged centroid
      const rx = cx - com.x, ry = cy - com.y, rz = cz - com.z;
      const vpz = v.z + (w.x * ry - w.y * rx);
      const Fb = RHO * GRAV * col.area * sub;
      const damp = -heaveDamp * col.area * Math.min(1, sub / Math.max(0.5, -col.z0)) * (vpz - etaV);
      addAt(0, 0, Fb + damp, cx, cy, cz);
      void rz;
    }
    // flooding: water weight at compartment locations
    const nC = s.compartments;
    for (let i = 0; i < nC * 2; i++) {
      const f = this.flood[i];
      if (f <= 0.001) continue;
      const along = ((Math.floor(i / 2) + 0.5) / nC) * 2 - 1;
      const side = i % 2 === 0 ? -1 : 1;
      const lp = qrot(q, (along * s.length) / 2, side * s.beam * 0.25, -s.draft * 0.5, tmp);
      addAt(0, 0, -f * this.compVolume * RHO * GRAV, p.x + lp.x, p.y + lp.y, p.z + lp.z);
    }
    this.immersion = wetRef > 0 ? wet / wetRef : 0;
    this.submergedAll = allUnder;
    this.sternWet = sternRef > 0 ? clamp(sternWet / sternRef, 0, 1.5) : 1;
    const imm = clamp(this.immersion, 0, 1.4);

    // ---- horizontal hydrodynamics in the hull frame
    const fwd = qrot(q, 1, 0, 0, tmp);
    const fl = Math.hypot(fwd.x, fwd.y) || 1;
    const fX = fwd.x / fl, fY = fwd.y / fl;
    const rX = -fY, rY = fX;
    // drift with the swell's orbital current at the hull center
    const vx = v.x, vy = v.y;
    const vf = vx * fX + vy * fY, vl = vx * rX + vy * rY;
    this.fwdSpeed = vf; this.sideSpeed = vl; this.speed = Math.hypot(vx, vy); this.yawRate = w.z;
    const dragF = -this.kFwd * vf * Math.abs(vf) * Math.max(0.3, imm);
    const dragL = -(this.kLat * Math.abs(vl) + this.cLat) * vl * Math.max(0.3, imm);
    // lateral resistance acts low on the hull -> heel outward in turns
    const clrZ = p.z - s.draft * 0.55 * this.heel + s.comZ * (1 - this.heel);
    addAt(fX * dragF, fY * dragF, 0, p.x, p.y, com.z);
    addAt(rX * dragL, rY * dragL, 0, p.x, p.y, clrZ);
    // yaw damping
    tz += -(this.kYaw * Math.abs(w.z) + this.cYaw) * w.z * Math.max(0.3, imm);
    // roll / pitch damping (keeps motions realistic without killing them)
    const rollW = w.x * fwd.x + w.y * fwd.y;
    const rd = -this.inertia.x * 0.35 * rollW;
    tx += fwd.x * rd; ty += fwd.y * rd;
    const right = qrot(q, 0, 1, 0, tmp2);
    const pitchW = w.x * right.x + w.y * right.y;
    const pd = -this.inertia.y * 0.6 * pitchW;
    tx += right.x * pd; ty += right.y * pd;

    // ---- propeller (loses grip when the stern lifts out of the water)
    const grip = clamp(this.sternWet * 1.2, 0, 1);
    const T = (c.thrust >= 0 ? c.thrust : c.thrust * s.reverseFrac) * this.thrustMax * grip;
    const prop = qrot(q, -s.length * 0.45, 0, -s.draft * 0.6, tmp2);
    addAt(fX * T, fY * T, 0, p.x + prop.x, p.y + prop.y, p.z + prop.z);
    // ---- rudder: flow over the blade + propeller wash; force at the stern toward port for a starboard turn
    const flow = this.kRud * vf * Math.abs(vf) + this.kWash * Math.abs(T) * (vf >= -0.5 ? 1 : -1);
    const Fr = -c.rudder * flow * grip;
    addAt(rX * Fr, rY * Fr, 0, p.x + prop.x, p.y + prop.y, clrZ);

    // ---- submarine: ballast, planes, vertical drag
    if (s.sub) {
      const reserve = this.totalVolume * RHO - s.mass;          // kg of buoyancy above surfaced weight
      const ballastKg = clamp(c.ballast, 0, 1.15) * reserve * 1.0;
      addAt(0, 0, -ballastKg * GRAV, com.x, com.y, com.z);
      // trim: move weight fore/aft
      if (c.trim) {
        const tl = qrot(q, s.length * 0.35 * Math.sign(c.trim), 0, 0, tmp2);
        const tw = Math.abs(c.trim) * s.mass * 0.012 * GRAV;
        addAt(0, 0, -tw, com.x + tl.x, com.y + tl.y, com.z + tl.z);
        addAt(0, 0, tw, com.x - tl.x, com.y - tl.y, com.z - tl.z);
      }
      if (imm > 0.6) {
        const lift = c.planes * Math.min(vf * Math.abs(vf), 40) * s.mass * 0.0042;
        addAt(0, 0, lift, com.x, com.y, com.z);
        // planes also pitch the boat toward the commanded direction
        const pitchT = c.planes * Math.min(Math.abs(vf), 6) * this.inertia.y * 0.012;
        tx -= right.x * pitchT; ty -= right.y * pitchT;
        const kV = s.mass * 0.25;
        fz += -kV * v.z * Math.abs(v.z) * 0.3 - s.mass * 0.05 * v.z;
      }
      // self-righting: keep the boat near level in pitch when submerged.
      // (positive rotation about the starboard axis pitches the bow down)
      const pitch = Math.asin(clamp(fwd.z, -1, 1));
      const pr = pitch * this.inertia.y * 0.05;
      tx += right.x * pr; ty += right.y * pr;
    }
    this.centerEta = this.waves ? ocean.height(p.x, p.y) : 0;
    this.depth = this.centerEta - p.z;
    body.addForce({ x: fx, y: fy, z: fz }, true);
    body.addTorque({ x: tx, y: ty, z: tz }, true);
  }

  floodTotal(): number {
    let t = 0;
    for (let i = 0; i < this.flood.length; i++) t += this.flood[i];
    return t / this.flood.length;
  }
}
