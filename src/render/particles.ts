// CPU particle simulation (spray, smoke, fire, debris…). Gameplay spawns into it; backends draw
// the packed particles (render/pack.ts) into the G-buffer, so fire lights nothing by itself but
// smoke is lit by searchlights and fires.

import { fx } from '../core/math';
import { PK } from './materials';

export class ParticleSystem {
  readonly cap: number;
  n = 0;
  px: Float32Array; py: Float32Array; pz: Float32Array;
  vx: Float32Array; vy: Float32Array; vz: Float32Array;
  life: Float32Array; max: Float32Array; size: Float32Array; grow: Float32Array;
  kind: Uint8Array; r: Float32Array; g: Float32Array; b: Float32Array;
  drag: Float32Array; grav: Float32Array;
  /** impact points of spray hitting the water this frame (for ripples) */
  impacts: { x: number; y: number; s: number }[] = [];
  wind = { x: 0, y: 0 };
  /** share of cosmetic particles actually spawned (display.particles): thins smoke, spray and
   * debris to cut overdraw; fire, sparks, flashes and tracers always spawn */
  density = 1;

  constructor(cap = 24000) {
    this.cap = cap;
    const F = () => new Float32Array(cap);
    this.px = F(); this.py = F(); this.pz = F(); this.vx = F(); this.vy = F(); this.vz = F();
    this.life = F(); this.max = F(); this.size = F(); this.grow = F();
    this.kind = new Uint8Array(cap); this.r = F(); this.g = F(); this.b = F();
    this.drag = F(); this.grav = F();
  }

  spawn(kind: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, col: [number, number, number], opts?: { drag?: number; grav?: number; grow?: number }) {
    if (this.density < 1 && THINNABLE[kind] && fx.next() > this.density) return;
    let i = this.n;
    if (i >= this.cap) {
      // recycle a random old particle rather than dropping new effects
      i = (fx.next() * this.cap) | 0;
    } else this.n++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = life; this.max[i] = life; this.size[i] = size;
    this.kind[i] = kind; this.r[i] = col[0]; this.g[i] = col[1]; this.b[i] = col[2];
    const def = DEFAULTS[kind] ?? DEFAULTS[0];
    this.drag[i] = opts?.drag ?? def.drag;
    this.grav[i] = opts?.grav ?? def.grav;
    this.grow[i] = opts?.grow ?? def.grow;
  }

  /** water level lookup for landing tests */
  update(dt: number, waterAt: (x: number, y: number) => number) {
    this.impacts.length = 0;
    const wx = this.wind.x, wy = this.wind.y;
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      const k = this.kind[i];
      let dead = this.life[i] <= 0;
      if (!dead) {
        const dr = Math.exp(-this.drag[i] * dt);
        // smoke and steam drift with the wind
        const windK = k === PK.SMOKE || k === PK.STEAM || k === PK.MIST || k === PK.SNOW ? 1 - dr : 0;
        this.vx[i] = this.vx[i] * dr + wx * windK;
        this.vy[i] = this.vy[i] * dr + wy * windK;
        this.vz[i] = this.vz[i] * dr - this.grav[i] * dt;
        this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
        this.size[i] += this.grow[i] * dt;
        if (k === PK.SPRAY || k === PK.SPARK || k === PK.SHEET || k === PK.FOAMBIT || k === PK.DEBRIS || k === PK.SNOW) {
          const w = waterAt(this.px[i], this.py[i]);
          if (this.pz[i] < w && this.vz[i] < 0) {
            if (k === PK.DEBRIS) { this.pz[i] = w; this.vz[i] = 0; this.vx[i] *= 0.9; this.vy[i] *= 0.9; this.grav[i] = 0; this.drag[i] = 0.6; }
            else {
              if (k === PK.SPRAY && this.size[i] > 0.5 && this.impacts.length < 64) this.impacts.push({ x: this.px[i], y: this.py[i], s: this.size[i] });
              dead = true;
            }
          }
        }
      }
      if (dead) {
        const j = --this.n;
        if (i !== j) this.copy(j, i);
        continue;
      }
      i++;
    }
  }

  private copy(from: number, to: number) {
    this.px[to] = this.px[from]; this.py[to] = this.py[from]; this.pz[to] = this.pz[from];
    this.vx[to] = this.vx[from]; this.vy[to] = this.vy[from]; this.vz[to] = this.vz[from];
    this.life[to] = this.life[from]; this.max[to] = this.max[from]; this.size[to] = this.size[from]; this.grow[to] = this.grow[from];
    this.kind[to] = this.kind[from]; this.r[to] = this.r[from]; this.g[to] = this.g[from]; this.b[to] = this.b[from];
    this.drag[to] = this.drag[from]; this.grav[to] = this.grav[from];
  }
}

/** kinds that display.particles may thin out (purely atmospheric; none carry gameplay meaning) */
const THINNABLE: Record<number, boolean> = { [PK.SPRAY]: true, [PK.MIST]: true, [PK.SMOKE]: true, [PK.STEAM]: true, [PK.DEBRIS]: true, [PK.FOAMBIT]: true, [PK.SHEET]: true };

const DEFAULTS: Record<number, { drag: number; grav: number; grow: number }> = {
  [PK.SPRAY]: { drag: 0.4, grav: 9.81, grow: 0 },
  [PK.MIST]: { drag: 1.6, grav: 1.2, grow: 0.8 },
  [PK.SMOKE]: { drag: 0.9, grav: -1.4, grow: 1.6 },
  [PK.FIRE]: { drag: 1.2, grav: -4, grow: -0.4 },
  [PK.SPARK]: { drag: 0.3, grav: 9.81, grow: 0 },
  [PK.DEBRIS]: { drag: 0.2, grav: 9.81, grow: 0 },
  [PK.FOAMBIT]: { drag: 0.8, grav: 6, grow: 0 },
  [PK.STEAM]: { drag: 1.0, grav: -2.2, grow: 1.2 },
  [PK.TRACER]: { drag: 0, grav: 0, grow: 0 },
  [PK.SHEET]: { drag: 0.6, grav: 9.81, grow: 0.2 },
  [PK.FLASH]: { drag: 0, grav: 0, grow: 6 },
  [PK.SNOW]: { drag: 2.5, grav: 1.5, grow: 0 },
};
