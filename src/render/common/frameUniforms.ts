// Per-frame uniform values computed once on the CPU for BOTH backends (water surface, lighting,
// occluder window). Each backend only lays these numbers out for its own shader language, so the
// two renderers cannot drift apart on tuning.

import { dev } from '../../core/devSettings';
import { hex01 } from '../../core/math';
import type { Camera } from '../camera';
import type { FrameParams } from '../types';

type V3 = [number, number, number];

export interface WaterParams {
  /** 8 palette tones, rgb */
  ramp: V3[];
  foamCol: V3; foamShade: V3; murk: V3;
  clarity: number; hs: number; contrast: number; detail: number; crestFoam: number;
  time: number; wind: [number, number]; parallax: boolean; bio: number; ice: number; rippleScale: number;
  /** Gerstner swell on (else only the flat sea + rings) */
  swell: boolean;
}

export function waterParams(f: FrameParams): WaterParams {
  const T = f.theater, o = f.ocean;
  return {
    ramp: T.ramp.map((h) => hex01(h)),
    foamCol: hex01(T.foam), foamShade: hex01(T.foamShade), murk: hex01(T.murk),
    clarity: T.clarity * dev.num('water.clarity'),
    hs: Math.max(0.3, o.hs + o.params.swellHeight * 0.5),
    contrast: dev.num('water.contrast'), detail: dev.num('water.detail'), crestFoam: dev.num('water.crestFoam'),
    time: f.time,
    wind: [o.params.seaState > 0 ? Math.cos(o.params.windDir) * o.windSpeed : 0, Math.sin(o.params.windDir) * o.windSpeed],
    parallax: dev.bool('water.parallax'), bio: f.bio, ice: f.ice, rippleScale: dev.num('water.rippleScale'),
    swell: dev.bool('water.swell'),
  };
}

export const DEBUG_VIEWS: Record<string, number> = { albedo: 1, normal: 2, height: 3, light: 4 };

export interface LightParams {
  ambient: V3; sky: V3; fogCol: V3;
  sunDir: V3; sunCol: V3; moonDir: V3; moonCol: V3;
  reach: number; strength: number; ambientFill: number; soft: number; bands: number; ditherAmt: number;
  beams: number; spec: number; reflect: number; fog: number; lightning: number; haze: number;
  steps: number; shadows: boolean; celShadows: boolean; lightsOn: boolean;
  /** heightmap ambient occlusion strength (contact shadows) */
  ao: number;
  /** 0 final, 1 albedo, 2 normal, 3 height, 4 light only */
  view: number;
}

export function lightParams(f: FrameParams): LightParams {
  const env = f.env;
  const sc = (c: V3, k: number): V3 => [c[0] * k, c[1] * k, c[2] * k];
  return {
    ambient: env.ambient, sky: env.sky, fogCol: env.fogColor,
    sunDir: [env.sunDir.x, env.sunDir.y, env.sunDir.z], sunCol: sc(env.sunColor, env.sunIntensity),
    moonDir: [env.moonDir.x, env.moonDir.y, env.moonDir.z], moonCol: sc(env.moonColor, env.moonIntensity),
    reach: dev.num('light.reach'), strength: dev.num('light.strength'), ambientFill: dev.num('light.ambient'),
    soft: dev.num('light.softness'), bands: dev.num('light.bands'), ditherAmt: dev.num('light.dither'),
    beams: dev.num('light.beams'), spec: dev.num('light.specular'), reflect: dev.num('water.reflection'),
    fog: Math.min(0.85, env.fogDensity * dev.num('light.fog') * 0.55), lightning: env.lightning * 0.35,
    haze: 0.35 + env.fogDensity * 2.2,
    steps: dev.num('light.shadowSteps'), shadows: dev.bool('light.shadows'),
    celShadows: dev.bool('light.celestialShadows'), lightsOn: dev.bool('light.enabled'),
    ao: dev.num('light.ao'),
    view: DEBUG_VIEWS[dev.str('debug.view')] ?? 0,
  };
}

/** light that falls on effect smoke (forward-shaded after the lighting pass): ambient, sun and moon */
export function smokeLight(L: LightParams): [number, number, number] {
  const k = (i: number) => Math.min(2, L.ambient[i] * L.ambientFill + L.sunCol[i] * 0.85 + L.moonCol[i] * 0.8 + L.lightning);
  return [k(0), k(1), k(2)];
}

/**
 * Highest the sea surface can reach this frame (m): every swell crest and ring at once plus a margin
 * for ripple-sim waves. Sprite-stack fragments above it skip the per-fragment swell maths.
 */
export function seaTop(waveA: Float32Array, waveCount: number, rings: Float32Array, ringCount: number, rippleScale: number): number {
  let h = 0;
  for (let i = 0; i < waveCount; i++) h += Math.abs(waveA[i * 4 + 3]);
  for (let i = 0; i < ringCount; i++) h += Math.abs(rings[i * 4 + 3]);
  return h + 1.5 * rippleScale + 0.4;
}

/** occluder heightmap window: world aligned, snapped to texels so shadows do not shimmer */
export function occluderRect(cam: Camera, occRes: number): { x: number; y: number; s: number } {
  const view = cam.viewRect(0);
  const span = Math.max(view.x1 - view.x0, view.y1 - view.y0) + 360;
  const texel = span / occRes;
  const x = Math.floor(((view.x0 + view.x1) / 2 - span / 2) / texel) * texel;
  const y = Math.floor(((view.y0 + view.y1) / 2 - span / 2) / texel) * texel;
  return { x, y, s: span };
}

export function occluderRes(): number { return parseInt(dev.str('light.shadowRes')) || 1024; }
