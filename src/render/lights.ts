// Frame light list. Gameplay adds lights every frame (searchlights, star shells, fires, muzzle
// flashes, explosions, loot beacons, lighthouse); backends cull them to the camera with
// `packLights`, keep the most important ones and upload the packed rows for the lighting pass.

export const MAX_LIGHTS = 64;
/** floats per packed light (4 × vec4) */
export const LIGHT_FLOATS = 16;

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
  /** global beam-haze multiplier (searchlight shafts fade out in daylight) */
  beamScale = 1;
  /** fog spreads light: beam width and light reach multipliers */
  sizeScale = 1;
  reachScale = 1;
  clear() { this.list.length = 0; }
  add(l: Light) { this.list.push(l); return l; }
}

export interface ViewRect { x0: number; y0: number; x1: number; y1: number }

/** cull to the view, sort by importance, pack relative to the render origin (MAX_LIGHTS rows of 16 floats) */
export function packLights(lights: LightList, ox: number, oy: number, view: ViewRect, max: number, reachMul: number,
  out: Float32Array<ArrayBuffer> = new Float32Array(MAX_LIGHTS * LIGHT_FLOATS)): { data: Float32Array<ArrayBuffer>; count: number } {
  const cand: { l: Light; score: number }[] = [];
  const cx = (view.x0 + view.x1) / 2, cy = (view.y0 + view.y1) / 2;
  for (const l of lights.list) {
    const R = l.reach * reachMul * lights.reachScale;
    // spotlights and beams reach further on screen than their radius suggests
    const ext = R + (l.beam ? R * 0.2 : 0);
    if (l.x + ext < view.x0 || l.x - ext > view.x1 || l.y + ext < view.y0 - 30 || l.y - ext > view.y1 + 30) continue;
    const d = Math.hypot(l.x - cx, l.y - cy);
    const score = (l.intensity * R) / (50 + d) + (l.priority ?? 0) * 10;
    cand.push({ l, score });
  }
  cand.sort((a, b) => b.score - a.score);
  const n = Math.min(cand.length, max, MAX_LIGHTS);
  const D = out;
  D.fill(0);
  for (let i = 0; i < n; i++) {
    const l = cand[i].l, b = i * LIGHT_FLOATS;
    D[b] = l.x - ox; D[b + 1] = l.y - oy; D[b + 2] = l.z; D[b + 3] = l.reach * lights.reachScale;
    D[b + 4] = l.r; D[b + 5] = l.g; D[b + 6] = l.b; D[b + 7] = l.intensity;
    const spot = l.cosOuter !== undefined;
    if (spot) {
      const len = Math.hypot(l.dx ?? 1, l.dy ?? 0, l.dz ?? 0) || 1;
      D[b + 8] = (l.dx ?? 1) / len; D[b + 9] = (l.dy ?? 0) / len; D[b + 10] = (l.dz ?? 0) / len; D[b + 11] = l.cosOuter!;
    } else { D[b + 11] = -2; }
    D[b + 12] = l.shadow ? 1 : 0; D[b + 13] = (l.beam ?? 0) * lights.beamScale;
    D[b + 14] = spot ? (l.cosInner ?? Math.min(0.9999, l.cosOuter! + (1 - l.cosOuter!) * 0.5)) : 0;
    D[b + 15] = (l.size ?? 0.6) * lights.sizeScale;
  }
  return { data: D, count: n };
}
