// Visual + physical effects of detonations and impacts: particles, ripple-sim splats, ocean rings
// that rock nearby hulls, light flashes, camera shake. Damage is applied by weapons.ts.
// Since M18 every effect is layered: the CPU particles (lit in the G-buffer, cast smoke shadows) carry
// the base, and the GPU effect particles (render/fx.ts) add the flash, the fireball that rolls into smoke,
// embers on curl-noise turbulence, stretched sparks, debris, water plumes, the shockwave ring that bends
// the screen, light shafts and camera trauma.

import type { World } from './world';
import { PK } from '../render/materials';
import { FX } from '../render/fx';
import { fx } from '../core/math';

const SPRAY_COL: [number, number, number] = [0.92, 0.95, 0.97];
const SMOKE_COL: [number, number, number] = [0.9, 0.86, 0.82];

export function splashColumn(w: World, x: number, y: number, size: number) {
  const P = w.scene.particles, F = w.scene.fx;
  const n = Math.floor(18 + size * 30);
  for (let i = 0; i < n; i++) {
    const a = fx.next() * Math.PI * 2, r = fx.next() * size * 1.4;
    const up = fx.range(6, 14) * (0.6 + size * 0.5);
    P.spawn(PK.SPRAY, x + Math.cos(a) * r, y + Math.sin(a) * r, 0.2, Math.cos(a) * fx.range(0.5, 2.5), Math.sin(a) * fx.range(0.5, 2.5), up, fx.range(1.5, 3.2), fx.range(0.5, 1.1) * (0.7 + size * 0.4), [0.9, 0.95, 0.98]);
  }
  for (let i = 0; i < 6 + size * 6; i++) P.spawn(PK.MIST, x + fx.range(-2, 2) * size, y + fx.range(-2, 2) * size, fx.range(2, 8) * size, fx.range(-1, 1), fx.range(-1, 1), 1, fx.range(1.5, 3), 1.5 + size, [0.9, 0.93, 0.96]);
  // a white column and a skirt of spray running out over the water
  F.burst(FX.PLUME, x, y, 0.3, { n: 8 + size * 22, speed: 6 + size * 9, up: 3, spread: 0.35, radius: size, life: 1.6 + size * 0.4, size: 0.7 + size * 0.3, size1: 1.8 + size, col: SPRAY_COL });
  F.burst(FX.PLUME, x, y, 0.3, { n: 6 + size * 12, speed: 3 + size * 4, flat: true, vz: 2.5, life: 1.1, size: 0.6, size1: 1.6, col: SPRAY_COL });
  w.scene.splats.push({ x, y, radius: 2 + size * 2.5, wave: -1.2 * (0.6 + size), foam: 0.6 + size * 0.5, bio: 0.5, oil: 0, fire: 0, push: 1.5 * size });
  w.emit('splash', { x, y, size });
}

/** underwater detonation: depth charge, hedgehog, torpedo against a sub. depth in m below surface */
export function underwaterBlast(w: World, x: number, y: number, depth: number, power: number) {
  const P = w.scene.particles, F = w.scene.fx;
  // the gas bubble reaches the surface: the shallower the bigger the dome and column
  const surf = Math.max(0, 1 - depth / 90) * power;
  const radius = 6 + surf * 14;
  if (surf > 0.05) {
    const n = Math.floor(60 + surf * 260);
    for (let i = 0; i < n; i++) {
      const a = fx.next() * Math.PI * 2, r = Math.sqrt(fx.next()) * radius * 0.7;
      const up = fx.range(4, 20) * surf * (1 - r / radius * 0.6);
      P.spawn(PK.SPRAY, x + Math.cos(a) * r, y + Math.sin(a) * r, 0.3, Math.cos(a) * fx.range(1, 5) * surf, Math.sin(a) * fx.range(1, 5) * surf, up, fx.range(1.5, 4), fx.range(0.6, 1.4), [0.92, 0.96, 0.98]);
    }
    for (let i = 0; i < 20 * surf + 4; i++) P.spawn(PK.MIST, x + fx.range(-1, 1) * radius * 0.5, y + fx.range(-1, 1) * radius * 0.5, fx.range(3, 14) * surf, fx.range(-2, 2), fx.range(-2, 2), 1.5, fx.range(2, 4), 3 + surf * 3, [0.9, 0.93, 0.96]);
    // the dome bursts: a tall column, a ring of spray racing outward, mist hanging over it
    F.burst(FX.PLUME, x, y, 0.4, { n: 30 + surf * 140, speed: 10 + surf * 26, up: 3.2, spread: 0.32, radius: radius * 0.35, life: 2.4 + surf * 1.6, size: 1, size1: 3 + surf * 2, col: SPRAY_COL });
    F.burst(FX.PLUME, x, y, 0.3, { n: 24 + surf * 70, speed: 7 + surf * 16, flat: true, vz: 3, life: 1.6, size: 0.8, size1: 2.6, col: SPRAY_COL });
    F.burst(FX.STEAM, x, y, 2, { n: 4 + surf * 12, speed: 2, up: 2, radius: radius * 0.4, life: 4 + surf * 3, size: 4, size1: 12 + surf * 8, col: [0.85, 0.88, 0.92] });
    F.shock(x, y, 0.3, 14 + surf * 34, 0.5 + surf * 0.6, 0.55);
    F.shake(0.08 * surf, x, y);
  }
  w.scene.splats.push({ x, y, radius: radius * 1.2, wave: -3.5 * (0.3 + surf), foam: 1.5 + surf * 2, bio: 1.2, oil: 0, fire: 0, push: 5 * surf + 1 });
  if (surf > 0.1) w.ocean.addRing(x, y, 0.35 + surf * 0.9);
  w.flashLight({ x, y, z: 1, reach: 30 + surf * 40, r: 0.6, g: 0.85, b: 1, intensity: 0.8 * surf, shadow: false }, 0.6);
  w.emit('explosion', { x, y, z: -depth, power, kind: 'underwater' });
}

export function surfaceExplosion(w: World, x: number, y: number, z: number, power: number, opts: { fire?: boolean; debris?: boolean; ground?: boolean } = {}) {
  const P = w.scene.particles, F = w.scene.fx;
  // with the GPU layer on, the CPU particles carry a lighter base (they still shadow and get lit)
  const cpu = F.enabled ? 0.55 : 1;
  const n = Math.floor((30 + power * 90) * cpu);
  for (let i = 0; i < n; i++) {
    const a = fx.next() * Math.PI * 2, s = fx.range(2, 12) * (0.5 + power);
    P.spawn(PK.FIRE, x, y, z + 1, Math.cos(a) * s * 0.6, Math.sin(a) * s * 0.6, fx.range(3, 14) * (0.4 + power), fx.range(0.4, 1.2), fx.range(1.2, 3) * (0.6 + power * 0.6), [1, 0.7, 0.3]);
  }
  for (let i = 0; i < (10 + power * 30) * cpu; i++) P.spawn(PK.SPARK, x, y, z + 1, fx.range(-1, 1) * 18 * power, fx.range(-1, 1) * 18 * power, fx.range(8, 26) * power, fx.range(0.6, 1.6), 0.3, [1, 0.8, 0.4]);
  for (let i = 0; i < (8 + power * 24) * cpu * cpu; i++) P.spawn(PK.SMOKE, x + fx.range(-3, 3), y + fx.range(-3, 3), z + fx.range(2, 8), fx.range(-2, 2), fx.range(-2, 2), fx.range(2, 6), fx.range(6, 14), 3 + power * 3, [0.08, 0.08, 0.09]);
  if (opts.debris !== false) for (let i = 0; i < (6 + power * 20) * cpu; i++) {
    const a = fx.next() * Math.PI * 2, s = fx.range(4, 16) * power;
    P.spawn(PK.DEBRIS, x, y, z + 2, Math.cos(a) * s, Math.sin(a) * s, fx.range(6, 18) * power, fx.range(12, 40), fx.range(0.4, 0.9), [0.22, 0.18, 0.14]);
  }
  P.spawn(PK.FLASH, x, y, z + 2, 0, 0, 0, 0.35, 6 + power * 10, [1, 0.9, 0.6]);
  // ---- GPU layer
  const p = power;
  F.burst(FX.FLASH, x, y, z + 2, { n: 1, life: 0.22 + p * 0.1, size: 4 + p * 6, size1: 14 + p * 24, heat: 1 });
  F.burst(FX.FIRE, x, y, z + 1, { n: 10 + p * 20, speed: 6 + p * 11, up: 0.9, radius: 1 + p * 2, life: 1.3 + p * 1.2, size: 3 + p * 3, size1: 9 + p * 11, col: SMOKE_COL, heat: 1 });
  F.burst(FX.EMBER, x, y, z + 1, { n: 20 + p * 50, speed: 8 + p * 14, up: 0.7, radius: 1 + p, life: 1.6 + p * 1.8, size: 0.45, heat: 1 });
  F.burst(FX.SPARK, x, y, z + 1, { n: 18 + p * 42, speed: 18 + p * 30, up: 0.9, life: 0.55 + p * 0.6, size: 0.35, heat: 1 });
  F.burst(FX.SMOKE, x, y, z + 2, { n: 4 + p * 10, speed: 1.5, up: 3, spread: 0.45, radius: 2 + p * 2, life: 10 + p * 12, size: 5 + p * 4, size1: 18 + p * 24, col: SMOKE_COL, heat: 0.7 });
  if (opts.debris !== false) F.burst(FX.DEBRIS, x, y, z + 1, { n: 8 + p * 22, speed: 10 + p * 18, up: 1.3, life: 3 + p * 2, size: 0.5, col: [0.55, 0.47, 0.4], heat: 0.8 });
  if (opts.ground) {
    // earth and dust thrown up, a brown skirt rolling out along the ground
    F.burst(FX.DUST, x, y, z, { n: 10 + p * 16, speed: 5 + p * 8, up: 1.6, spread: 0.6, radius: 2 + p * 2, life: 6 + p * 4, size: 3, size1: 12 + p * 10, col: [0.62, 0.5, 0.38] });
    F.burst(FX.DUST, x, y, z, { n: 10 + p * 12, speed: 9 + p * 10, flat: true, vz: 1, life: 4, size: 2, size1: 9, col: [0.66, 0.55, 0.42] });
  } else if (z < 4) F.burst(FX.PLUME, x, y, 0.3, { n: 10 + p * 30, speed: 6 + p * 12, up: 2.4, spread: 0.6, radius: 1 + p * 2, life: 1.5 + p, size: 0.8, size1: 2.2, col: SPRAY_COL });
  F.shock(x, y, Math.max(z, 0.3), 18 + p * 42, 0.55 + p * 0.6, 0.45 + p * 0.25);
  F.glow(x, y, z + 4, 0.6 + p * 0.9, 0.35 + p * 0.25);
  F.shake(0.16 * p, x, y);
  w.flashLight({ x, y, z: z + 6, reach: 90 + power * 160, r: 1, g: 0.75, b: 0.4, intensity: 4 * power + 1, shadow: true, priority: 3 }, 0.9 + power * 0.6);
  w.scene.splats.push({ x, y, radius: 6 + power * 10, wave: -2 * power, foam: 1.5 * power, bio: 0.6, oil: opts.fire ? 0.6 * power : 0, fire: opts.fire ? 0.6 * power : 0, push: 4 * power });
  w.emit('explosion', { x, y, z, power, kind: 'surface' });
}

/**
 * A magazine detonation (Arizona, 08:06): a white flash, a fireball climbing hundreds of metres, a
 * shower of burning debris, a shockwave across the harbour and a column of black smoke that stands for
 * hours. `x, y, z` is the magazine.
 */
export function magazineBlast(w: World, x: number, y: number, z: number) {
  const F = w.scene.fx;
  for (let i = 0; i < 4; i++) surfaceExplosion(w, x + fx.range(-15, 15), y + fx.range(-8, 8), z + i * 6, 2.4);
  F.burst(FX.FLASH, x, y, z + 10, { n: 1, life: 0.6, size: 30, size1: 160, heat: 1.6 });
  F.burst(FX.FIRE, x, y, z + 4, { n: 160, speed: 30, up: 2.2, spread: 0.7, radius: 12, life: 4.5, lifeVar: 0.6, size: 9, size1: 34, col: SMOKE_COL, heat: 1 });
  F.burst(FX.EMBER, x, y, z + 6, { n: 420, speed: 34, up: 1.4, radius: 10, life: 5, size: 0.6, heat: 1 });
  F.burst(FX.SPARK, x, y, z + 4, { n: 220, speed: 60, up: 1.2, life: 1.6, size: 0.5, heat: 1 });
  F.burst(FX.DEBRIS, x, y, z + 4, { n: 160, speed: 42, up: 1.6, life: 6, size: 0.9, col: [0.5, 0.42, 0.36], heat: 1 });
  F.burst(FX.SMOKE, x, y, z + 20, { n: 70, speed: 4, up: 4, spread: 0.35, radius: 18, life: 60, lifeVar: 0.5, size: 18, size1: 70, col: [0.7, 0.66, 0.62], heat: 0.9 });
  F.burst(FX.PLUME, x, y, 0.4, { n: 140, speed: 20, flat: true, vz: 6, life: 2.6, size: 1.2, size1: 4, col: SPRAY_COL });
  F.shock(x, y, 0.5, 420, 2.4, 1.6);
  F.shock(x, y, 0.5, 220, 1.4, 0.9);
  F.glow(x, y, z + 30, 3.2, 1.6);
  F.shake(1, x, y);
}

/** a heavy flak burst at altitude: a black puff with a brief orange core */
export function flakBurst(w: World, x: number, y: number, z: number) {
  const F = w.scene.fx;
  F.burst(FX.FLAK, x, y, z, { n: 2, radius: 1.5, life: 3.5, size: 2.5, size1: 8, col: [1, 1, 1] });
  F.burst(FX.SPARK, x, y, z, { n: 5, speed: 22, life: 0.35, size: 0.25, heat: 1 });
}

/**
 * Continuous emission from a burning point (ship fires, fires ashore, burning oil), called every frame
 * with the frame time: flames, embers, a column of black smoke and a heat-haze source.
 */
export function fireEmit(w: World, x: number, y: number, z: number, power: number, dt: number, vx = 0, vy = 0) {
  const F = w.scene.fx, V = w.view;
  if (!F.enabled || dt <= 0) return;
  // far off screen nothing is emitted (a column takes ~30 s to rise, the camera pans slower than that)
  const dx = Math.abs(x - V.x), dy = Math.abs(y - V.y);
  if (dx > V.r + 1500 || dy > V.r + 1500) return;
  const p = Math.min(power, 2);
  if (fx.next() < dt * 9 * p) F.burst(FX.FIRE, x, y, z, { n: 1, speed: 1.5, up: 3, spread: 0.5, radius: 1.5, life: 1.4 + p * 0.6, size: 1.6 + p, size1: 4 + p * 3, col: SMOKE_COL, heat: 0.85, vx, vy });
  if (fx.next() < dt * 5 * p) F.burst(FX.EMBER, x, y, z + 1, { n: 2, speed: 3, up: 2, radius: 1.5, life: 2.5, size: 0.35, heat: 1, vx, vy });
  if (fx.next() < dt * 2.6 * p) F.burst(FX.SMOKE, x, y, z + 3, { n: 1, speed: 1, up: 4, spread: 0.3, radius: 2, life: 22 + p * 10, size: 4 + p * 2, size1: 20 + p * 16, col: [0.62, 0.6, 0.58], heat: 0.5, vx: vx * 0.5, vy: vy * 0.5 });
  // heat haze only from fires in view, so the frame's few haze slots go to what can be seen
  if (F.heat.length < 24 && dx < V.r && dy < V.r) F.heat.push({ x, y, z: z + 4, r: 6 + p * 6, k: 0.5 + p * 0.4 });
}

export function muzzleFlash(w: World, x: number, y: number, z: number, dx: number, dy: number, caliber: number) {
  const P = w.scene.particles, F = w.scene.fx;
  const s = caliber / 100;
  for (let i = 0; i < 6 * s + 2; i++) P.spawn(PK.FIRE, x + dx * 2, y + dy * 2, z, dx * fx.range(4, 14) * s, dy * fx.range(4, 14) * s, fx.range(0, 2), fx.range(0.08, 0.2), fx.range(0.8, 1.6) * s + 0.4, [1, 0.85, 0.5]);
  for (let i = 0; i < 4 * s + 1; i++) P.spawn(PK.SMOKE, x + dx * 3, y + dy * 3, z, dx * fx.range(2, 5), dy * fx.range(2, 5), 0.8, fx.range(1.5, 3), 1.5 * s + 0.5, [0.55, 0.55, 0.55]);
  F.burst(FX.FLASH, x + dx * 3, y + dy * 3, z, { n: 1, life: 0.1, size: 1 + s, size1: 3 + s * 3, heat: 0.8 });
  F.burst(FX.SMOKE, x + dx * 4, y + dy * 4, z, { n: 1 + Math.round(s * 2), speed: 1, up: 0.5, life: 3 + s * 2, size: 1 + s, size1: 4 + s * 4, col: [1.6, 1.6, 1.6], vx: dx * 4 * s, vy: dy * 4 * s });
  if (caliber >= 200) { F.shock(x + dx * 6, y + dy * 6, 0.3, 10 + s * 4, 0.35, 0.3); F.shake(0.05, x, y); }
  w.flashLight({ x: x + dx * 3, y: y + dy * 3, z: z + 1, reach: 30 + caliber * 0.4, r: 1, g: 0.8, b: 0.5, intensity: 2.8, shadow: true }, 0.12);
}
