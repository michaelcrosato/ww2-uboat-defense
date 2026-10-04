// Post / present parameters computed once per frame for either backend (same numbers → same image).

import { dev } from '../../core/devSettings';
import type { Camera } from '../camera';
import type { Screen } from '../screen';
import type { FrameParams } from '../types';

export const GRADES: Record<string, number> = { theater: 0, neutral: 1, newsreel: 2, technicolor: 3, uboat: 4, mono: 5 };

export interface PostParams {
  pw: number; ph: number; S: number; shiftX: number; shiftY: number; bw: number; bh: number;
  bloom: number; vignette: number; grain: number; scan: number; time: number; grade: number;
  flash: number; flashCol: [number, number, number];
}

export function postParams(sc: Screen, cam: Camera, f: FrameParams): PostParams {
  return {
    pw: sc.pw, ph: sc.ph, S: sc.S, shiftX: Math.round(cam.fx * sc.S), shiftY: Math.round(cam.fy * sc.S), bw: cam.bw, bh: cam.bh,
    bloom: dev.num('light.bloom'), vignette: dev.num('display.vignette'), grain: dev.num('display.grain'), scan: dev.num('display.scanlines'),
    time: f.time, grade: GRADES[dev.str('display.grade')] ?? 0, flash: f.flash, flashCol: f.flashCol,
  };
}
