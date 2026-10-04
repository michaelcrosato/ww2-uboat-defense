// Visual + physical effects of detonations and impacts: particles, ripple-sim splats, ocean rings
// that rock nearby hulls, light flashes, camera shake. Damage is applied by weapons.ts.

import type { World } from './world';
import { PK } from '../gfx/particles';
import { fx } from '../core/math';

export function splashColumn(w: World, x: number, y: number, size: number) {
  const P = w.renderer.particles;
  const n = Math.floor(18 + size * 30);
  for (let i = 0; i < n; i++) {
    const a = fx.next() * Math.PI * 2, r = fx.next() * size * 1.4;
    const up = fx.range(6, 14) * (0.6 + size * 0.5);
    P.spawn(PK.SPRAY, x + Math.cos(a) * r, y + Math.sin(a) * r, 0.2, Math.cos(a) * fx.range(0.5, 2.5), Math.sin(a) * fx.range(0.5, 2.5), up, fx.range(1.5, 3.2), fx.range(0.5, 1.1) * (0.7 + size * 0.4), [0.9, 0.95, 0.98]);
  }
  for (let i = 0; i < 6 + size * 6; i++) P.spawn(PK.MIST, x + fx.range(-2, 2) * size, y + fx.range(-2, 2) * size, fx.range(2, 8) * size, fx.range(-1, 1), fx.range(-1, 1), 1, fx.range(1.5, 3), 1.5 + size, [0.9, 0.93, 0.96]);
  w.splats.push({ x, y, radius: 2 + size * 2.5, wave: -1.2 * (0.6 + size), foam: 0.6 + size * 0.5, bio: 0.5, oil: 0, fire: 0, push: 1.5 * size });
  w.emit('splash', { x, y, size });
}

/** underwater detonation: depth charge, hedgehog, torpedo against a sub. depth in m below surface */
export function underwaterBlast(w: World, x: number, y: number, depth: number, power: number) {
  const P = w.renderer.particles;
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
  }
  w.splats.push({ x, y, radius: radius * 1.2, wave: -3.5 * (0.3 + surf), foam: 1.5 + surf * 2, bio: 1.2, oil: 0, fire: 0, push: 5 * surf + 1 });
  if (surf > 0.1) w.ocean.addRing(x, y, 0.35 + surf * 0.9);
  w.flashLight({ x, y, z: 1, reach: 30 + surf * 40, r: 0.6, g: 0.85, b: 1, intensity: 0.8 * surf, shadow: false }, 0.6);
  w.emit('explosion', { x, y, z: -depth, power, kind: 'underwater' });
}

export function surfaceExplosion(w: World, x: number, y: number, z: number, power: number, opts: { fire?: boolean; debris?: boolean } = {}) {
  const P = w.renderer.particles;
  const n = Math.floor(30 + power * 90);
  for (let i = 0; i < n; i++) {
    const a = fx.next() * Math.PI * 2, s = fx.range(2, 12) * (0.5 + power);
    P.spawn(PK.FIRE, x, y, z + 1, Math.cos(a) * s * 0.6, Math.sin(a) * s * 0.6, fx.range(3, 14) * (0.4 + power), fx.range(0.4, 1.2), fx.range(1.2, 3) * (0.6 + power * 0.6), [1, 0.7, 0.3]);
  }
  for (let i = 0; i < 10 + power * 30; i++) P.spawn(PK.SPARK, x, y, z + 1, fx.range(-1, 1) * 18 * power, fx.range(-1, 1) * 18 * power, fx.range(8, 26) * power, fx.range(0.6, 1.6), 0.3, [1, 0.8, 0.4]);
  for (let i = 0; i < 8 + power * 24; i++) P.spawn(PK.SMOKE, x + fx.range(-3, 3), y + fx.range(-3, 3), z + fx.range(2, 8), fx.range(-2, 2), fx.range(-2, 2), fx.range(2, 6), fx.range(6, 14), 3 + power * 3, [0.08, 0.08, 0.09]);
  if (opts.debris !== false) for (let i = 0; i < 6 + power * 20; i++) {
    const a = fx.next() * Math.PI * 2, s = fx.range(4, 16) * power;
    P.spawn(PK.DEBRIS, x, y, z + 2, Math.cos(a) * s, Math.sin(a) * s, fx.range(6, 18) * power, fx.range(12, 40), fx.range(0.4, 0.9), [0.22, 0.18, 0.14]);
  }
  P.spawn(PK.FLASH, x, y, z + 2, 0, 0, 0, 0.35, 6 + power * 10, [1, 0.9, 0.6]);
  w.flashLight({ x, y, z: z + 6, reach: 90 + power * 160, r: 1, g: 0.75, b: 0.4, intensity: 4 * power + 1, shadow: true, priority: 3 }, 0.9 + power * 0.6);
  w.splats.push({ x, y, radius: 6 + power * 10, wave: -2 * power, foam: 1.5 * power, bio: 0.6, oil: opts.fire ? 0.6 * power : 0, fire: opts.fire ? 0.6 * power : 0, push: 4 * power });
  w.emit('explosion', { x, y, z, power, kind: 'surface' });
}

export function muzzleFlash(w: World, x: number, y: number, z: number, dx: number, dy: number, caliber: number) {
  const P = w.renderer.particles;
  const s = caliber / 100;
  for (let i = 0; i < 6 * s + 2; i++) P.spawn(PK.FIRE, x + dx * 2, y + dy * 2, z, dx * fx.range(4, 14) * s, dy * fx.range(4, 14) * s, fx.range(0, 2), fx.range(0.08, 0.2), fx.range(0.8, 1.6) * s + 0.4, [1, 0.85, 0.5]);
  for (let i = 0; i < 4 * s + 1; i++) P.spawn(PK.SMOKE, x + dx * 3, y + dy * 3, z, dx * fx.range(2, 5), dy * fx.range(2, 5), 0.8, fx.range(1.5, 3), 1.5 * s + 0.5, [0.55, 0.55, 0.55]);
  w.flashLight({ x: x + dx * 3, y: y + dy * 3, z: z + 1, reach: 30 + caliber * 0.4, r: 1, g: 0.8, b: 0.5, intensity: 2.8, shadow: true }, 0.12);
}
