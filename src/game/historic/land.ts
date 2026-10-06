// Real coastlines for the historical battles. Shore polygons (surveyed lat/lon turned into local metres)
// are rasterised once into a land mask; that one mask feeds both the art (flat voxel tiles, a few metres
// per voxel so a whole harbour fits the slice atlas) and the physics (greedy-merged static boxes), so a
// ship runs aground exactly where the shore is drawn. Berths are carved out of the mask, which turns a
// ship in a dry dock into a ship in a dock-shaped slot.

import type { World } from '../world';
import type { RenderScene } from '../../render/scene';
import { VoxelModel, VM } from '../../art/voxel';
import { hash2, noise2 } from '../../core/math';

export type Pt = [number, number];

/** lat/lon (degrees) to local metres about an origin: x east, y south (equirectangular, fine over 10 km) */
export function geo(lat0: number, lon0: number) {
  const mx = 111320 * Math.cos(lat0 * Math.PI / 180), my = 110574;
  return (lat: number, lon: number): Pt => [(lon - lon0) * mx, -(lat - lat0) * my];
}

export function inPoly(x: number, y: number, p: Pt[]) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** a land area and how it is dressed */
export interface LandArea {
  pts: Pt[];
  /** dressing: 'yard' (quays, sheds, cranes), 'base' (airfield buildings), 'town', 'cane' (sugar cane), 'scrub' */
  kind: 'yard' | 'base' | 'town' | 'cane' | 'scrub';
}
/** an oriented rectangle cut out of the land (berths, dry docks) */
export interface Carve { x: number; y: number; h: number; hl: number; hw: number }
/** an oriented strip painted on the land (runways) */
export interface Strip { x0: number; y0: number; x1: number; y1: number; hw: number; color: string }

export class LandMap {
  readonly nx: number; readonly ny: number;
  /** 0 water, else 1 + index of the area */
  readonly cell: Uint8Array;
  constructor(readonly x0: number, readonly y0: number, x1: number, y1: number, readonly res: number, readonly areas: LandArea[], carves: Carve[]) {
    this.nx = Math.ceil((x1 - x0) / res); this.ny = Math.ceil((y1 - y0) / res);
    this.cell = new Uint8Array(this.nx * this.ny);
    areas.forEach((a, ai) => {
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (const [x, y] of a.pts) { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); }
      const i0 = Math.max(0, Math.floor((bx0 - x0) / res)), i1 = Math.min(this.nx - 1, Math.ceil((bx1 - x0) / res));
      const j0 = Math.max(0, Math.floor((by0 - y0) / res)), j1 = Math.min(this.ny - 1, Math.ceil((by1 - y0) / res));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        if (this.cell[j * this.nx + i]) continue;
        if (inPoly(x0 + (i + 0.5) * res, y0 + (j + 0.5) * res, a.pts)) this.cell[j * this.nx + i] = ai + 1;
      }
    });
    for (const c of carves) {
      const r = Math.hypot(c.hl, c.hw) + res, cs = Math.cos(c.h), sn = Math.sin(c.h);
      for (let j = Math.floor((c.y - r - y0) / res); j <= Math.ceil((c.y + r - y0) / res); j++) for (let i = Math.floor((c.x - r - x0) / res); i <= Math.ceil((c.x + r - x0) / res); i++) {
        if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) continue;
        const dx = x0 + (i + 0.5) * res - c.x, dy = y0 + (j + 0.5) * res - c.y;
        if (Math.abs(dx * cs + dy * sn) <= c.hl + res * 0.5 && Math.abs(-dx * sn + dy * cs) <= c.hw + res * 0.5) this.cell[j * this.nx + i] = 0;
      }
    }
  }
  at(x: number, y: number) {
    const i = Math.floor((x - this.x0) / this.res), j = Math.floor((y - this.y0) / this.res);
    return i < 0 || j < 0 || i >= this.nx || j >= this.ny ? 0 : this.cell[j * this.nx + i];
  }
  isLand = (x: number, y: number) => this.at(x, y) > 0;
  private water(i: number, j: number) { return i >= 0 && j >= 0 && i < this.nx && j < this.ny && this.cell[j * this.nx + i] === 0; }

  /** static colliders: rows of land merged into runs, equal runs on following rows merged into boxes */
  addPhysics(w: World) {
    const { nx, ny, res } = this, used = new Uint8Array(nx * ny), rects: { x: number; y: number; hx: number; hy: number }[] = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (!this.cell[k] || used[k]) continue;
      let i1 = i;
      while (i1 + 1 < nx && this.cell[j * nx + i1 + 1] && !used[j * nx + i1 + 1]) i1++;
      let j1 = j;
      grow: while (j1 + 1 < ny) {
        for (let q = i; q <= i1; q++) if (!this.cell[(j1 + 1) * nx + q] || used[(j1 + 1) * nx + q]) break grow;
        j1++;
      }
      for (let b = j; b <= j1; b++) for (let q = i; q <= i1; q++) used[b * nx + q] = 1;
      // a metre of slack so hulls can lie alongside a quay without grinding on it
      const hx = (i1 - i + 1) * res / 2 - 1, hy = (j1 - j + 1) * res / 2 - 1;
      rects.push({ x: this.x0 + (i + i1 + 1) * res / 2, y: this.y0 + (j + j1 + 1) * res / 2, hx: Math.max(0.5, hx), hy: Math.max(0.5, hy) });
    }
    w.physics.addLandRects(rects);
    return rects.length;
  }

  /** flat voxel tiles (ground layer + a layer of buildings, trees and cranes) as scenery */
  addArt(w: World, scene: RenderScene, tag: string, tile: number, strips: Strip[]) {
    const { res } = this, n = Math.round(tile / res);
    let tiles = 0;
    for (let tj = 0; tj * n < this.ny; tj++) for (let ti = 0; ti * n < this.nx; ti++) {
      let any = false;
      for (let j = tj * n; j < Math.min(this.ny, tj * n + n) && !any; j++) for (let i = ti * n; i < Math.min(this.nx, ti * n + n); i++) if (this.cell[j * this.nx + i]) { any = true; break; }
      if (!any) continue;
      const ox = this.x0 + ti * n * res, oy = this.y0 + tj * n * res;
      const m = new VoxelModel(`${tag}_${ti}_${tj}`, n, n, 2, res, 2.5, 0, 0, -1);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const gi = ti * n + i, gj = tj * n + j;
        if (gi >= this.nx || gj >= this.ny) continue;
        const a = this.cell[gj * this.nx + gi];
        if (!a) continue;
        const area = this.areas[a - 1];
        const x = ox + (i + 0.5) * res, y = oy + (j + 0.5) * res;
        const shore = this.water(gi - 1, gj) || this.water(gi + 1, gj) || this.water(gi, gj - 1) || this.water(gi, gj + 1);
        const nz = hash2(gi, gj), soft = noise2(x / 60, y / 60), patch = noise2(x / 23 + 7, y / 23);
        // building lots: blocks of 8x8 cells (40 m at 5 m) with a street on two sides, a few long sheds
        const lot = hash2(gi >> 3, gj >> 3), li = gi & 7, lj = gj & 7;
        const inLot = (w0: number, w1: number, h0: number, h1: number) => li >= w0 && li <= w1 && lj >= h0 && lj <= h1;
        let c: string;
        if (shore) c = area.kind === 'yard' || area.kind === 'base' ? '#8e8c84' : soft > 0.5 ? '#7a6e54' : '#6a6250';
        else if (area.kind === 'cane') c = (gj + (gi >> 3)) % 3 === 0 ? '#58723a' : soft > 0.6 ? '#6f8e46' : '#678642';
        else if (area.kind === 'yard') c = soft > 0.7 ? '#6c6a62' : '#77756c';
        else if (area.kind === 'base') c = soft > 0.55 ? '#5f7a44' : '#67834a';
        else if (area.kind === 'town') c = soft > 0.55 ? '#5c7444' : '#64804a';
        else c = soft > 0.55 ? '#4e6838' : '#58723f';
        for (const s of strips) {
          const dx = s.x1 - s.x0, dy = s.y1 - s.y0, L2 = dx * dx + dy * dy;
          const u = ((x - s.x0) * dx + (y - s.y0) * dy) / L2;
          if (u < 0 || u > 1) continue;
          if (Math.abs((x - s.x0) * dy - (y - s.y0) * dx) / Math.sqrt(L2) <= s.hw) c = s.color;
        }
        m.set(i, j, 0, c, VM.LAND);
        if (shore) continue;
        // second layer: sheds and shops in the yard, hangars and barracks on the bases, houses and trees
        let roof: string | null = null;
        if (area.kind === 'yard' && lot > 0.3) roof = inLot(1, 6, 1, lot > 0.75 ? 6 : 3) ? (lot > 0.85 ? '#6e4c3a' : lot > 0.6 ? '#8a8478' : '#7c7a72') : null;
        else if (area.kind === 'base' && lot > 0.78 && patch > 0.35) roof = inLot(1, 6, 2, 4) ? '#9a9688' : null;
        else if (area.kind === 'town' && lot > 0.35) roof = (li & 3) >= 1 && (li & 3) <= 2 && (lj & 3) >= 1 && (lj & 3) <= 2 && hash2(gi >> 2, gj >> 2) > 0.45 ? (hash2(gi >> 2, (gj >> 2) + 9) > 0.5 ? '#a86a4e' : '#8c8070') : null;
        if (!roof && area.kind !== 'cane' && area.kind !== 'yard' && patch > 0.72 && nz > 0.35) roof = patch > 0.8 ? '#33492c' : '#3c5432';
        if (roof) m.set(i, j, 1, roof, VM.LAND);
      }
      w.scenery.push({ x: ox, y: oy, z: 0, model: scene.atlas.add(m) });
      tiles++;
    }
    return tiles;
  }
}
