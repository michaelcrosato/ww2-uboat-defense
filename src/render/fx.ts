// GPU effect particles (M18): the heavy, flashy layer of explosions, fires and flak, simulated on the GPU
// (WebGPU compute; WebGL2 transform feedback) and drawn after the lighting pass into the HDR buffer, so
// fire and sparks bloom while smoke dims what is behind it. Game code only calls `burst`, `shock`, `heat`
// and `shake`; new particles are generated here on the CPU (the same initial state for both backends)
// into a ring buffer of `cap` slots that the backend uploads, integrates and draws.
// Cosmetic only: all randomness is `fx`, never the simulation RNG.

import { fx } from '../core/math';

/** particle kinds: the same numbers index the per-kind tables in both shader sets */
export const FX = {
  FIRE: 0, EMBER: 1, SPARK: 2, SMOKE: 3, FLASH: 4, PLUME: 5, DEBRIS: 6, STEAM: 7, FLAK: 8, RING: 9, DUST: 10,
} as const;
export const FX_KINDS = 11;

/**
 * Per-kind motion: buoyancy (m/s² up at birth, fading with age), drag (1/s), gravity (m/s²), curl-noise
 * turbulence (m/s²), wind coupling (0..1) and what the water plane does (0 nothing, 1 kills, 2 floats).
 */
export const FX_MOTION: { buoy: number; drag: number; grav: number; curl: number; wind: number; water: number }[] = [
  { buoy: 11, drag: 2.2, grav: 0, curl: 7, wind: 0.6, water: 0 },     // FIRE: a fireball puff that turns into smoke
  { buoy: 3.5, drag: 1.1, grav: 0, curl: 16, wind: 1, water: 1 },     // EMBER
  { buoy: 0, drag: 0.35, grav: 9.81, curl: 0, wind: 0, water: 1 },    // SPARK
  { buoy: 2.4, drag: 0.55, grav: 0, curl: 2.6, wind: 1, water: 0 },   // SMOKE
  { buoy: 0, drag: 0, grav: 0, curl: 0, wind: 0, water: 0 },          // FLASH
  { buoy: 0, drag: 0.28, grav: 9.81, curl: 0, wind: 0.3, water: 1 },  // PLUME: water thrown up by a blast
  { buoy: 0, drag: 0.12, grav: 9.81, curl: 0, wind: 0, water: 2 },    // DEBRIS
  { buoy: 3, drag: 1.2, grav: 0, curl: 4, wind: 1, water: 0 },        // STEAM
  { buoy: 0.3, drag: 3, grav: 0, curl: 1.2, wind: 1, water: 0 },      // FLAK burst
  { buoy: 0, drag: 0, grav: 0, curl: 0, wind: 0, water: 0 },          // RING: one particle drawn as an annulus
  { buoy: 0.6, drag: 2.6, grav: 0, curl: 2.2, wind: 1, water: 0 },    // DUST
];

/** floats per particle: pos.xyz + age · vel.xyz + life · size0, size1, seed, kind · tint.rgb + heat */
export const FX_FLOATS = 16;

export interface BurstOpts {
  n: number;
  /** m/s; directions spread over a sphere (spread 1) or narrowed around `up` */
  speed?: number;
  /** upward bias added to the random direction before normalising (0 = isotropic, 3 = a column) */
  up?: number;
  /** 0..1 how much of the random direction is kept (0 = straight up when up > 0) */
  spread?: number;
  /** spawn radius (m) */
  radius?: number;
  life: number;
  /** relative lifetime variation */
  lifeVar?: number;
  size: number;
  size1?: number;
  col?: [number, number, number];
  /** 0..1 how hot/bright the particle starts (fire, sparks, debris glow) */
  heat?: number;
  /** base velocity added to every particle (a moving ship, wind) */
  vx?: number; vy?: number; vz?: number;
  /** horizontal-only directions (shock rings of spray and dust) */
  flat?: boolean;
}

export interface ShockRing { x: number; y: number; z: number; t: number; life: number; r: number; str: number }
export interface HeatSource { x: number; y: number; z: number; r: number; k: number }
/** a steady emitter of light for the GI grid (a burning point): radius m, colour, strength */
export interface GiEmitter { x: number; y: number; z: number; r: number; cr: number; cg: number; cb: number; k: number }
/** most GI emitters a frame carries (the backends size their buffers by it) */
export const MAX_GI_EMITTERS = 256;
export interface GlowSource { x: number; y: number; z: number; k: number; t: number; life: number }

/** most particles generated in one frame (a magazine explosion is ~2,500) */
const MAX_NEW = 12000;

export class FxSystem {
  /** ring capacity, a power of two (the backend sets it: 65,536 on WebGPU, 16,384 on WebGL2) */
  cap = 65536;
  /** next ring slot (monotonic; slot = head & (cap - 1)) */
  head = 0;
  /** slots ever written (bounds the draw) */
  used = 0;
  /** this frame's new particles, packed, and where each run of them goes in the ring */
  readonly staged = new Float32Array(MAX_NEW * FX_FLOATS);
  staging = 0;
  runs: { slot: number; n: number; src: number }[] = [];
  /** count multiplier (dev fx.density) and master switch (dev fx.particles), set by the App each frame */
  density = 1;
  enabled = true;
  /** expanding shockwaves (screen distortion + an annulus particle) */
  rings: ShockRing[] = [];
  /** heat haze sources this frame (fires), filled every frame by the game */
  heat: HeatSource[] = [];
  /** steady GI emitters (fires), refilled by the game every frame like `heat` */
  emitters: GiEmitter[] = [];
  /** brief bright sources for light shafts (explosion flashes) */
  glows: GlowSource[] = [];
  /** camera shake: trauma adds up, decays; shake = trauma² */
  trauma = 0;
  /** world point the camera looks at (the App sets it) so shake falls off with distance */
  camX = 0; camY = 0;

  /** queue `o.n` particles of `kind` born around (x, y, z) */
  burst(kind: number, x: number, y: number, z: number, o: BurstOpts) {
    if (!this.enabled) return;
    let n = Math.round(o.n * (kind === FX.RING || kind === FX.FLASH ? 1 : this.density));
    n = Math.min(n, MAX_NEW - this.staging, this.cap >> 2);
    if (n <= 0) return;
    const speed = o.speed ?? 0, up = o.up ?? 0, spread = o.spread ?? 1, rad = o.radius ?? 0;
    const life = o.life, lv = o.lifeVar ?? 0.4, s0 = o.size, s1 = o.size1 ?? o.size;
    const col = o.col ?? [1, 1, 1], heat = o.heat ?? 0;
    const bx = o.vx ?? 0, by = o.vy ?? 0, bz = o.vz ?? 0;
    const S = this.staged;
    // split the run where it wraps around the ring
    const start = this.head & (this.cap - 1);
    const first = Math.min(n, this.cap - start);
    this.runs.push({ slot: start, n: first, src: this.staging });
    if (first < n) this.runs.push({ slot: 0, n: n - first, src: this.staging + first });
    this.head += n;
    this.used = Math.min(this.cap, Math.max(this.used, this.head));
    for (let i = 0; i < n; i++) {
      // random direction on the sphere (or the horizon), narrowed and lifted
      let dx: number, dy: number, dz: number;
      const a = fx.next() * Math.PI * 2;
      if (o.flat) { dx = Math.cos(a); dy = Math.sin(a); dz = 0; }
      else {
        const cz = fx.next() * 2 - 1, sr = Math.sqrt(1 - cz * cz);
        dx = Math.cos(a) * sr * spread; dy = Math.sin(a) * sr * spread; dz = cz * spread + up;
        const l = Math.hypot(dx, dy, dz) || 1;
        dx /= l; dy /= l; dz /= l;
      }
      const v = speed * (0.35 + 0.65 * fx.next());
      const pr = rad * Math.sqrt(fx.next()), pa = fx.next() * Math.PI * 2;
      const o16 = (this.staging + i) * FX_FLOATS;
      S[o16] = x + Math.cos(pa) * pr; S[o16 + 1] = y + Math.sin(pa) * pr; S[o16 + 2] = z + (o.flat ? 0 : (fx.next() - 0.5) * rad * 0.6);
      S[o16 + 3] = 0;
      S[o16 + 4] = dx * v + bx; S[o16 + 5] = dy * v + by; S[o16 + 6] = dz * v + bz;
      S[o16 + 7] = life * (1 - lv * 0.5 + lv * fx.next());
      const sz = 0.75 + 0.5 * fx.next();
      S[o16 + 8] = s0 * sz; S[o16 + 9] = s1 * sz; S[o16 + 10] = fx.next(); S[o16 + 11] = kind;
      S[o16 + 12] = col[0]; S[o16 + 13] = col[1]; S[o16 + 14] = col[2]; S[o16 + 15] = heat;
    }
    this.staging += n;
  }

  /** an expanding shockwave: screen distortion ring and a pale annulus on the surface */
  shock(x: number, y: number, z: number, radius: number, strength: number, life = 0.6) {
    if (!this.enabled) return;
    this.rings.push({ x, y, z, t: 0, life, r: radius, str: strength });
    if (this.rings.length > 16) this.rings.shift();
    this.burst(FX.RING, x, y, Math.max(z, 1.2), { n: 1, life, size: 0, size1: radius, heat: strength });
  }

  /** a bright flash for the light shafts (and the backends' bright pass) */
  glow(x: number, y: number, z: number, k: number, life = 0.5) {
    this.glows.push({ x, y, z, k, t: 0, life });
    if (this.glows.length > 8) this.glows.shift();
  }

  /** camera trauma from an explosion of `power` at (x, y), falling off with distance from the view */
  shake(power: number, x: number, y: number) {
    const d = Math.hypot(x - this.camX, y - this.camY);
    this.trauma = Math.min(1, this.trauma + power * Math.max(0, 1 - d / 1500));
  }

  /** advance rings, glows and trauma by real seconds (the backend's sim dt) */
  update(dt: number) {
    for (const r of this.rings) r.t += dt;
    this.rings = this.rings.filter((r) => r.t < r.life);
    for (const g of this.glows) g.t += dt;
    this.glows = this.glows.filter((g) => g.t < g.life);
    this.trauma = Math.max(0, this.trauma - dt * 1.2);
  }

  /** the backend took this frame's new particles */
  consumed() { this.staging = 0; this.runs.length = 0; }

  /** forget everything (new mission, a fast-forward that never rendered) */
  clear() { this.consumed(); this.head = 0; this.used = 0; this.rings.length = 0; this.glows.length = 0; this.heat.length = 0; this.emitters.length = 0; this.trauma = 0; }
}
