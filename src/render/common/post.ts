// Post / present parameters computed once per frame for either backend (same numbers → same image).

import { dev } from '../../core/devSettings';
import type { Camera } from '../camera';
import type { Screen } from '../screen';
import type { FrameParams } from '../types';
import type { FxSystem } from '../fx';

export const GRADES: Record<string, number> = { theater: 0, neutral: 1, newsreel: 2, technicolor: 3, uboat: 4, mono: 5 };

/** screen-space effect slots in the present shaders */
export const POST_RINGS = 8;
export const POST_HEAT = 8;
export const POST_SHAFTS = 4;

export interface PostParams {
  pw: number; ph: number; S: number; shiftX: number; shiftY: number; bw: number; bh: number;
  bloom: number; vignette: number; grain: number; scan: number; time: number; grade: number;
  flash: number; flashCol: [number, number, number];
  /** shockwaves: buffer px x, y, radius px, strength (px of displacement) */
  rings: Float32Array<ArrayBuffer>; ringCount: number;
  /** heat haze: buffer px x, y, radius px, strength */
  heat: Float32Array<ArrayBuffer>; heatCount: number;
  /** light shafts: half-res uv x, y, intensity, - */
  shafts: Float32Array<ArrayBuffer>; shaftCount: number; shaftAmt: number;
  /** radial colour split (buffer px) */
  chroma: number;
}

const rings = new Float32Array(POST_RINGS * 4), heat = new Float32Array(POST_HEAT * 4), shafts = new Float32Array(POST_SHAFTS * 4);

export function postParams(sc: Screen, cam: Camera, f: FrameParams, fx?: FxSystem): PostParams {
  // world -> lit-buffer pixel (the same mapping as worldToClip with the snapped origin)
  const bx = (x: number) => x * cam.zoom - cam.ix + cam.bw / 2;
  const by = (y: number, z: number) => (y * cam.cosT - z * cam.sinT) * cam.zoom - cam.iy + cam.bh / 2;
  let ringCount = 0, heatCount = 0, shaftCount = 0;
  const dist = dev.num('fx.distortion'), haze = dev.num('fx.haze'), shaftAmt = dev.num('fx.shafts');
  if (fx && dist > 0) {
    for (const r of fx.rings) {
      if (ringCount >= POST_RINGS) break;
      const k = r.t / r.life, R = r.r * (1 - Math.pow(1 - k, 2.5)) * cam.zoom;
      rings.set([bx(r.x), by(r.y, r.z), R, r.str * (1 - k) * dist * 5], ringCount++ * 4);
    }
  }
  if (fx && haze > 0) {
    // the strongest, nearest-to-view sources first
    const hs = fx.heat.slice().sort((a, b) => b.k - a.k);
    for (const h of hs) {
      if (heatCount >= POST_HEAT) break;
      const x = bx(h.x), y = by(h.y, h.z), r = h.r * cam.zoom;
      if (x < -r || y < -r * 2 || x > cam.bw + r || y > cam.bh + r) continue;
      heat.set([x, y, Math.max(4, r), h.k * haze], heatCount++ * 4);
    }
  }
  if (fx && shaftAmt > 0) {
    const gs = fx.glows.slice().sort((a, b) => b.k * (1 - b.t / b.life) - a.k * (1 - a.t / a.life));
    for (const g of gs) {
      if (shaftCount >= POST_SHAFTS) break;
      const x = bx(g.x) / cam.bw, y = by(g.y, g.z) / cam.bh;
      if (x < -0.5 || y < -0.5 || x > 1.5 || y > 1.5) continue;
      shafts.set([x, y, g.k * (1 - g.t / g.life), 0], shaftCount++ * 4);
    }
  }
  return {
    pw: sc.pw, ph: sc.ph, S: sc.S, shiftX: Math.round(cam.fx * sc.S), shiftY: Math.round(cam.fy * sc.S), bw: cam.bw, bh: cam.bh,
    bloom: dev.num('light.bloom'), vignette: dev.num('display.vignette'), grain: dev.num('display.grain'), scan: dev.num('display.scanlines'),
    time: f.time, grade: GRADES[dev.str('display.grade')] ?? 0, flash: f.flash, flashCol: f.flashCol,
    rings, ringCount, heat, heatCount, shafts, shaftCount, shaftAmt,
    chroma: fx ? Math.min(3, (fx.trauma * fx.trauma * 3 + f.flash * 2) * dev.num('fx.chroma')) : 0,
  };
}
