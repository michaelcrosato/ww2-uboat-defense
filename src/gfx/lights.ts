// Frame light list. Gameplay adds lights every frame (searchlights, star shells, fires, muzzle
// flashes, explosions, loot beacons, lighthouse); the renderer culls to the camera, keeps the
// most important ones and uploads them to a float texture read by the lighting pass.

import type { GL } from './gl';
import { MAX_LIGHTS } from './passes/lightingPass';

export interface Light {
  x: number; y: number; z: number;
  reach: number;             // radius (m)
  r: number; g: number; b: number;
  intensity: number;
  /** spot direction (unit) and cos of the outer half-angle; omit for omni */
  dx?: number; dy?: number; dz?: number; cosOuter?: number; cosInner?: number;
  shadow?: boolean;
  /** in-scattered haze strength: searchlight beams, flare halos */
  beam?: number;
  /** lens / source size for beams (m) */
  size?: number;
  /** importance bias for culling */
  priority?: number;
}

export class LightList {
  list: Light[] = [];
  tex: WebGLTexture;
  private data = new Float32Array(MAX_LIGHTS * 4 * 4);
  count = 0;
  constructor(private gl: GL) {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 4, MAX_LIGHTS, 0, gl.RGBA, gl.FLOAT, null);
    this.tex = t;
  }
  clear() { this.list.length = 0; }
  add(l: Light) { this.list.push(l); return l; }

  /** cull to the view, sort by importance, upload relative to the render origin */
  upload(ox: number, oy: number, view: { x0: number; y0: number; x1: number; y1: number }, max: number, reachMul: number) {
    const cand: { l: Light; score: number }[] = [];
    const cx = (view.x0 + view.x1) / 2, cy = (view.y0 + view.y1) / 2;
    for (const l of this.list) {
      const R = l.reach * reachMul;
      // spotlights and beams reach further on screen than their radius suggests
      const ext = R + (l.beam ? R * 0.2 : 0);
      if (l.x + ext < view.x0 || l.x - ext > view.x1 || l.y + ext < view.y0 - 30 || l.y - ext > view.y1 + 30) continue;
      const d = Math.hypot(l.x - cx, l.y - cy);
      const score = (l.intensity * R) / (50 + d) + (l.priority ?? 0) * 10;
      cand.push({ l, score });
    }
    cand.sort((a, b) => b.score - a.score);
    const n = Math.min(cand.length, max, MAX_LIGHTS);
    const D = this.data;
    D.fill(0);
    for (let i = 0; i < n; i++) {
      const l = cand[i].l, b = i * 16;
      D[b] = l.x - ox; D[b + 1] = l.y - oy; D[b + 2] = l.z; D[b + 3] = l.reach;
      D[b + 4] = l.r; D[b + 5] = l.g; D[b + 6] = l.b; D[b + 7] = l.intensity;
      const spot = l.cosOuter !== undefined;
      if (spot) {
        const len = Math.hypot(l.dx ?? 1, l.dy ?? 0, l.dz ?? 0) || 1;
        D[b + 8] = (l.dx ?? 1) / len; D[b + 9] = (l.dy ?? 0) / len; D[b + 10] = (l.dz ?? 0) / len; D[b + 11] = l.cosOuter!;
      } else { D[b + 11] = -2; }
      D[b + 12] = l.shadow ? 1 : 0; D[b + 13] = l.beam ?? 0;
      D[b + 14] = spot ? (l.cosInner ?? Math.min(0.9999, l.cosOuter! + (1 - l.cosOuter!) * 0.5)) : 0;
      D[b + 15] = l.size ?? 0.6;
    }
    this.count = n;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 4, MAX_LIGHTS, gl.RGBA, gl.FLOAT, D);
  }
}
