// Time of day, sun and moon, sky light, weather and visibility. Rendering reads the light colors;
// gameplay reads `darkness` and `visibility` (lookouts, periscopes, aircraft all depend on them).

import { clamp, clamp01, DEG, fx, hex01, lerp, smoothstep, TAU } from '../core/math';
import type { Theater } from './theaters';

export type Weather = 'clear' | 'overcast' | 'rain' | 'storm' | 'fog' | 'snow';
export const WEATHERS: Weather[] = ['clear', 'overcast', 'rain', 'storm', 'fog', 'snow'];

export interface EnvInputs {
  hour: number;           // 0..24
  timeFlow: number;       // game minutes per real second / 60 (1 = real time)
  moonPhase: number;      // 0 new, 0.5 full
  season: number;         // -1 winter solstice .. 0 equinox .. 1 summer solstice
  weather: Weather;
  cloud: number;          // extra cloud cover 0..1
}

type RGB = [number, number, number];

export class Environment {
  hour = 22;
  timeFlow = 0;
  moonPhase = 0.5;
  season = 0;
  weather: Weather = 'clear';
  cloudExtra = 0.2;
  theater!: Theater;
  // derived
  sunDir = { x: 0, y: 0, z: 1 };
  moonDir = { x: 0, y: 0, z: 1 };
  sunElev = 0; moonElev = 0;
  sunColor: RGB = [1, 1, 1]; sunIntensity = 0;
  moonColor: RGB = [0.7, 0.8, 1]; moonIntensity = 0;
  ambient: RGB = [0.1, 0.1, 0.15];
  sky: RGB = [0.2, 0.25, 0.3];
  fogColor: RGB = [0.5, 0.5, 0.55];
  fogDensity = 0;
  cloud = 0.2;
  rain = 0; snow = 0;
  lightning = 0;
  private lightningTimer = 3;
  /** 0 bright day .. 1 moonless night */
  darkness = 0;
  /** meters at which a surfaced boat can be seen by a lookout */
  visibility = 3000;
  wind = 0;

  setTheater(t: Theater) { this.theater = t; }

  apply(inp: Partial<EnvInputs>) {
    if (inp.hour !== undefined) this.hour = ((inp.hour % 24) + 24) % 24;
    if (inp.timeFlow !== undefined) this.timeFlow = inp.timeFlow;
    if (inp.moonPhase !== undefined) this.moonPhase = inp.moonPhase;
    if (inp.season !== undefined) this.season = inp.season;
    if (inp.weather !== undefined) this.weather = inp.weather;
    if (inp.cloud !== undefined) this.cloudExtra = inp.cloud;
  }

  /** dt in sim seconds */
  update(dt: number) {
    if (this.timeFlow > 0) this.hour = (this.hour + (dt * this.timeFlow) / 3600) % 24;
    const th = this.theater;
    const lat = th.latitude * DEG;
    const decl = 23.44 * DEG * this.season;
    // sun
    const H = (this.hour - 12) * 15 * DEG;
    this.sunElev = elevation(lat, decl, H);
    setDir(this.sunDir, lat, decl, H, this.sunElev);
    // moon: full moon transits at midnight, roughly opposite declination
    const mH = (this.hour - 12 - this.moonPhase * 24) * 15 * DEG;
    const mDecl = -decl * Math.cos(this.moonPhase * TAU) + 5 * DEG;
    this.moonElev = elevation(lat, mDecl, mH);
    setDir(this.moonDir, lat, mDecl, mH, this.moonElev);

    // weather
    const w = this.weather;
    const baseCloud = { clear: 0.05, overcast: 0.85, rain: 0.9, storm: 1, fog: 0.6, snow: 0.9 }[w];
    this.cloud = clamp01(Math.max(baseCloud, this.cloudExtra * (w === 'clear' ? 1 : 0.5) + baseCloud * 0.5));
    this.rain = w === 'rain' ? 0.6 : w === 'storm' ? 1 : 0;
    this.snow = w === 'snow' ? 0.8 : 0;
    this.fogDensity = { clear: 0.02, overcast: 0.06, rain: 0.14, storm: 0.18, fog: 0.62, snow: 0.3 }[w];

    const se = Math.sin(this.sunElev), me = Math.sin(this.moonElev);
    const day = smoothstep(-0.06, 0.22, se);
    const twilight = smoothstep(-0.2, 0.0, se) * (1 - smoothstep(0.05, 0.3, se));
    const cloudDim = 1 - 0.62 * this.cloud;
    // sun color reddens near the horizon
    const warm = 1 - smoothstep(0.02, 0.4, se);
    this.sunColor = [1, lerp(0.97, 0.62, warm), lerp(0.92, 0.38, warm)];
    this.sunIntensity = day * cloudDim * 1.05;
    // moon light = illuminated fraction
    const illum = (1 - Math.cos(this.moonPhase * TAU)) / 2;
    this.moonIntensity = illum * smoothstep(-0.03, 0.18, me) * (1 - 0.85 * this.cloud) * 0.42 * (1 - day);
    this.moonColor = [0.62, 0.72, 0.95];

    const T = this.theater;
    const skyD = hex01(T.skyDay), skyK = hex01(T.skyDusk), skyN = hex01(T.skyNight);
    let sky = mix3(skyN, skyD, day);
    sky = mix3(sky, skyK, twilight * 0.75);
    // moonlit nights get a silver lift
    sky = add3(sky, scale3([0.08, 0.1, 0.16], this.moonIntensity));
    if (this.cloud > 0.5) sky = mix3(sky, [lum(sky), lum(sky), lum(sky) * 1.05], (this.cloud - 0.5) * 0.8);
    this.sky = sky;
    // ambient: hemispheric sky light at the surface
    const amb = scale3(sky, 0.55 + 0.25 * day);
    this.ambient = [Math.max(amb[0], 0.025), Math.max(amb[1], 0.03), Math.max(amb[2], 0.045)];
    const fog = hex01(T.fog);
    this.fogColor = mix3(scale3(fog, 0.12), fog, day * 0.9 + twilight * 0.3);
    this.fogColor = add3(this.fogColor, scale3([0.05, 0.06, 0.09], this.moonIntensity));

    // lightning in storms
    this.lightning *= Math.exp(-dt * 9);
    if (w === 'storm') {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightning = 1.5 + fx.next() * 1.5;
        this.lightningTimer = 4 + fx.next() * 12;
      }
    }

    // gameplay values
    const moonLift = this.moonIntensity / 0.42;
    this.darkness = clamp(1 - day - twilight * 0.4 - moonLift * 0.35, 0, 1);
    let vis = lerp(3200, 380, this.darkness);
    vis *= { clear: 1, overcast: 0.85, rain: 0.55, storm: 0.4, fog: 0.16, snow: 0.35 }[w];
    vis *= 1 + this.lightning * 2;
    this.visibility = vis;
  }
}

function elevation(lat: number, decl: number, H: number) {
  return Math.asin(clamp(Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H), -1, 1));
}
function setDir(out: { x: number; y: number; z: number }, lat: number, decl: number, H: number, elev: number) {
  // azimuth measured clockwise from north
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) + Math.PI;
  const ce = Math.cos(elev);
  out.x = ce * Math.sin(az);
  out.y = -ce * Math.cos(az);
  out.z = Math.sin(elev);
}
const mix3 = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const add3 = (a: RGB, b: RGB): RGB => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale3 = (a: RGB, s: number): RGB => [a[0] * s, a[1] * s, a[2] * s];
const lum = (a: RGB) => a[0] * 0.3 + a[1] * 0.55 + a[2] * 0.15;
