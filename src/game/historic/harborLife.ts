// Life round a historical harbour (M18): cars and trucks on the roads, launches, whaleboats, a tug and a
// lighter on their errands across the water (wakes through the water sim, fire hoses played on burning
// ships), boats moored at the piers, and chimney smoke. All cosmetic and deterministic: positions follow
// from the world clock and fixed per-object hashes, never the simulation RNG, so a replay is unchanged.

import type { World } from '../world';
import type { RenderScene } from '../../render/scene';
import type { StackModel } from '../../art/voxel';
import type { Pt } from './land';
import { carArt, craftArt, type CraftKind } from '../../art/shoreArt';
import { FX } from '../../render/fx';
import { fx, hash2, quatFromEuler, quatFromYaw } from '../../core/math';
import { GROUND, type CraftRoute } from './pearlDetail';

/** a polyline with its cumulative lengths, sampled by distance */
class Path {
  readonly cum: number[] = [0];
  constructor(readonly pts: Pt[]) {
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  get length() { return this.cum[this.cum.length - 1]; }
  /** position and heading at distance s */
  at(s: number): [number, number, number] {
    const c = this.cum, n = c.length;
    s = Math.max(0, Math.min(s, c[n - 1]));
    let i = 1;
    while (i < n - 1 && c[i] < s) i++;
    const a = this.pts[i - 1], b = this.pts[i], seg = c[i] - c[i - 1] || 1, u = (s - c[i - 1]) / seg;
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, Math.atan2(b[1] - a[1], b[0] - a[0])];
  }
}

interface Car { path: Path; s: number; dir: number; speed: number; pause: number; model: StackModel; lane: number }

/** cars, trucks and buses driving the roads, turning back at the ends */
export class Traffic {
  private cars: Car[] = [];
  constructor(private w: World, scene: RenderScene, roads: Pt[][], count: number) {
    const paths = roads.map((r) => new Path(r)).filter((p) => p.length > 120);
    const total = paths.reduce((a, p) => a + p.length, 0);
    if (!paths.length) return;
    const kinds: ['sedan' | 'pickup' | 'truck' | 'navytruck' | 'bus', number][] = [['sedan', 8], ['pickup', 3], ['truck', 2], ['navytruck', 2], ['bus', 2]];
    const models = kinds.map(([k, n]) => Array.from({ length: n }, (_, v) => scene.atlas.add(carArt(k, v))));
    for (let i = 0; i < count; i++) {
      // roads drawn by length: a long highway carries more cars than a yard street
      let r = hash2(i, 101) * total, p = paths[0];
      for (const q of paths) { if (r < q.length) { p = q; break; } r -= q.length; }
      const kv = hash2(i, 7), k = kv < 0.55 ? 0 : kv < 0.72 ? 1 : kv < 0.84 ? 2 : kv < 0.94 ? 3 : 4;
      const set = models[k];
      this.cars.push({ path: p, s: hash2(i, 13) * p.length, dir: hash2(i, 17) < 0.5 ? 1 : -1, speed: k >= 2 ? 9 + hash2(i, 19) * 3 : 11 + hash2(i, 19) * 5, pause: 0, model: set[i % set.length], lane: 2.4 });
    }
  }
  update(dt: number) {
    for (const c of this.cars) {
      if (c.pause > 0) { c.pause -= dt; continue; }
      c.s += c.dir * c.speed * dt;
      if (c.s < 0 || c.s > c.path.length) { c.dir = -c.dir; c.s = Math.max(0, Math.min(c.s, c.path.length)); c.pause = 2 + (c.speed % 3); }
    }
  }
  submit() {
    const w = this.w, V = w.view, R = w.scene;
    for (const c of this.cars) {
      let [x, y, h] = c.path.at(c.s);
      if (c.dir < 0) h += Math.PI;
      // keep right
      x += -Math.sin(h) * c.lane; y += Math.cos(h) * c.lane;
      if (Math.abs(x - V.x) > V.r || Math.abs(y - V.y) > V.r) continue;
      R.stacks.push({ model: c.model, x, y, z: GROUND, q: quatFromYaw(h) });
    }
  }
}

interface Craft { kind: CraftKind; model: StackModel; path: Path; s: number; dir: number; speed: number; v: number; start: number; loop: boolean; hose: boolean; x: number; y: number; h: number; len: number; beam: number }
const DIMS: Record<CraftKind, [number, number]> = { launch: [15.2, 3.8], whaleboat: [7.9, 2.2], tug: [30.5, 7.6], lighter: [33, 9], sweeper: [57, 10.8], pt: [23.5, 6] };

/**
 * Harbour craft on their routes (they start at a clock time, run back and forth, give way to ships),
 * and craft moored at the piers. Each pushes a wake into the water sim while under way; craft marked
 * `hose` play a fire hose on the nearest burning ship.
 */
export class HarborCraft {
  private craft: Craft[] = [];
  private moored: { model: StackModel; x: number; y: number; h: number; ph: number }[] = [];
  constructor(private w: World, scene: RenderScene, routes: CraftRoute[], moored: { kind: CraftKind; x: number; y: number; h: number }[], T: (clock: string) => number) {
    const model = (k: CraftKind) => scene.atlas.add(craftArt(k));
    for (const r of routes) {
      const p = new Path(r.pts), [x, y, h] = p.at(0), [len, beam] = DIMS[r.kind];
      this.craft.push({ kind: r.kind, model: model(r.kind), path: p, s: 0, dir: 1, speed: r.speed, v: 0, start: r.start ? T(r.start) : 0, loop: !!r.loop, hose: !!r.hose, x, y, h, len, beam });
    }
    for (const [i, m] of moored.entries()) this.moored.push({ model: model(m.kind), x: m.x, y: m.y, h: m.h, ph: i * 1.7 });
  }
  update(dt: number) {
    const w = this.w;
    for (const c of this.craft) {
      if (w.time < c.start) continue;
      // give way: slow to a stop if a ship lies close ahead
      let want = c.speed;
      const ax = c.x + Math.cos(c.h) * (c.len + 15), ay = c.y + Math.sin(c.h) * (c.len + 15);
      for (const v of w.vessels) {
        if (Math.hypot(v.pos.x - ax, v.pos.y - ay) < v.cls.length * 0.5 + 12 && Math.hypot(v.body.linvel().x, v.body.linvel().y) > 0.5) { want = 0; break; }
      }
      c.v += (want - c.v) * Math.min(1, dt * 0.5);
      c.s += c.dir * c.v * dt;
      if (c.s > c.path.length || c.s < 0) {
        if (c.loop) { c.dir = -c.dir; c.s = Math.max(0, Math.min(c.s, c.path.length)); c.v = 0; }
        else { c.s = Math.max(0, Math.min(c.s, c.path.length)); c.v = 0; c.speed = 0; }
      }
      const [x, y, h] = c.path.at(c.s);
      // turn smoothly onto the new leg (the path heading flips at each end of a back-and-forth run)
      const want_h = c.dir > 0 ? h : h + Math.PI;
      let d = want_h - c.h; d = Math.atan2(Math.sin(d), Math.cos(d));
      c.h += d * Math.min(1, dt * 0.6);
      c.x = x; c.y = y;
    }
  }
  submit(frameDt: number) {
    const w = this.w, R = w.scene, V = w.view;
    for (const c of this.craft) {
      if (w.time < c.start) continue;
      if (Math.abs(c.x - V.x) > V.r + 200 || Math.abs(c.y - V.y) > V.r + 200) continue;
      const z = w.ocean.height(c.x, c.y), t = w.time;
      R.stacks.push({ model: c.model, x: c.x, y: c.y, z, q: quatFromEuler(Math.sin(t * 1.3 + c.len) * 0.03, Math.sin(t * 0.9 + c.beam) * 0.02 - c.v * 0.004, c.h) });
      const fxv = Math.cos(c.h), fyv = Math.sin(c.h);
      if (c.v > 0.3) R.hulls.push({ x: c.x, y: c.y, fx: fxv, fy: fyv, halfLen: c.len / 2, halfBeam: c.beam / 2, vx: fxv * c.v, vy: fyv * c.v, angVel: 0, thrust: Math.min(1, c.v / 4), draft: c.kind === 'tug' ? 2.8 : 1, depth: 0, foam: 1, oil: 0, fire: 0, kind: 0 });
      if (c.hose && frameDt > 0) this.hose(c, frameDt);
    }
    for (const m of this.moored) {
      if (Math.abs(m.x - V.x) > V.r + 200 || Math.abs(m.y - V.y) > V.r + 200) continue;
      const z = w.ocean.height(m.x, m.y);
      R.stacks.push({ model: m.model, x: m.x, y: m.y, z, q: quatFromEuler(Math.sin(w.time * 0.8 + m.ph) * 0.02, 0, m.h) });
    }
  }
  /** a jet of water arcing from the bow monitor onto the nearest burning ship within 140 m */
  private hose(c: Craft, dt: number) {
    const w = this.w, F = w.scene.fx;
    let best = null, bd = 140;
    for (const v of w.vessels) { if (!v.fires.length) continue; const d = Math.hypot(v.pos.x - c.x, v.pos.y - c.y); if (d < bd) { bd = d; best = v; } }
    if (!best) return;
    const f = best.fires[0], p = best.local(f.lx, f.ly, f.lz);
    const sx = c.x + Math.cos(c.h) * c.len * 0.3, sy = c.y + Math.sin(c.h) * c.len * 0.3, sz = 5;
    const dx = p.x - sx, dy = p.y - sy, D = Math.hypot(dx, dy) || 1;
    // a ballistic arc: launched up at 45 degrees with the speed that carries it to the fire
    const v = Math.min(32, Math.sqrt(9.81 * D)) * 0.72;
    if (fx.next() < dt * 40) F.burst(FX.PLUME, sx, sy, sz, { n: 2, speed: 1.2, vx: dx / D * v, vy: dy / D * v, vz: v, life: 2.2, size: 0.45, size1: 1.4, col: [0.85, 0.9, 0.95] });
  }
}

/** smoke from chimneys and power-plant stacks */
export class StackSmoke {
  constructor(private w: World, private stacks: { x: number; y: number; z: number }[]) {}
  update() {}
  submit(frameDt: number) {
    const w = this.w, F = w.scene.fx, V = w.view;
    if (frameDt <= 0) return;
    for (const s of this.stacks) {
      if (Math.abs(s.x - V.x) > V.r + 600 || Math.abs(s.y - V.y) > V.r + 600) continue;
      if (fx.next() < frameDt * 1.6) F.burst(FX.SMOKE, s.x, s.y, s.z, { n: 1, speed: 0.6, up: 4, spread: 0.2, radius: 1, life: 26, size: 3, size1: 18, col: [1.6, 1.55, 1.5] });
    }
  }
}
