// Shared DSP material for the procedural audio engine: seeded noise and texture buffers, generated
// impulse responses, shaper curves, periodic waves, envelope helpers and the Patch node builder that
// every sound, loop and music note is made from. Everything takes a BaseAudioContext, so the lab can
// render the exact same graphs through an OfflineAudioContext.

import { Rng } from '../core/math';

export type NoiseKind = 'white' | 'pink' | 'brown' | 'crackle' | 'drops' | 'bubbles' | 'mod';
export type VerbId = 'sky' | 'sea' | 'hull';
export type Dest = AudioNode | AudioParam | null;

const TWO_PI = Math.PI * 2;
/** modulation buffers are slow signals; a low rate keeps them tiny */
const MOD_RATE = 3000;

// ------------------------------------------------------------------------------ sample data
// Raw Float32 data is generated once per sample rate; each context only wraps it in AudioBuffers.
const dataCache = new Map<string, Float32Array[]>();
function cached(key: string, make: () => Float32Array[]): Float32Array[] {
  let d = dataCache.get(key);
  if (!d) { d = make(); dataCache.set(key, d); }
  return d;
}

function normalize(d: Float32Array, peak: number): Float32Array {
  let m = 0;
  for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > m) m = a; }
  if (m > 0) { const s = peak / m; for (let i = 0; i < d.length; i++) d[i] *= s; }
  return d;
}

function whiteData(sr: number, secs: number, seed: number): Float32Array {
  const n = Math.floor(sr * secs), d = new Float32Array(n), r = new Rng(seed);
  for (let i = 0; i < n; i++) d[i] = r.next() * 2 - 1;
  return d;
}

/** Paul Kellet's pink filter, run twice so the state wraps and the loop point is seamless */
function pinkData(sr: number, secs: number, seed: number): Float32Array {
  const w = whiteData(sr, secs, seed), n = w.length, d = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const x = w[i];
      b0 = 0.99886 * b0 + x * 0.0555179;
      b1 = 0.99332 * b1 + x * 0.0750759;
      b2 = 0.969 * b2 + x * 0.153852;
      b3 = 0.8665 * b3 + x * 0.3104856;
      b4 = 0.55 * b4 + x * 0.5329522;
      b5 = -0.7616 * b5 - x * 0.016898;
      d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362;
      b6 = x * 0.115926;
    }
  }
  return normalize(d, 0.95);
}

/** red noise: one-pole lowpass at ~120 Hz, two passes for a seamless loop */
function brownData(sr: number, secs: number, seed: number): Float32Array {
  const w = whiteData(sr, secs, seed), n = w.length, d = new Float32Array(n);
  const a = 1 - Math.exp(-TWO_PI * 120 / sr);
  let b = 0;
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < n; i++) { b += a * (w[i] - b); d[i] = b; }
  return normalize(d, 0.95);
}

/** sparse random pops with a heavy-tailed loudness: fire, debris, static, cavitation */
function crackleData(sr: number, secs: number, seed: number): Float32Array {
  const n = Math.floor(sr * secs), d = new Float32Array(n), r = new Rng(seed);
  let i = 0;
  for (;;) {
    i += Math.floor(sr * (0.003 + -Math.log(1 - r.next() * 0.999) * 0.028));
    if (i >= n) break;
    const amp = (0.08 + Math.pow(r.next(), 2.2)) * (r.next() < 0.5 ? -1 : 1);
    const len = Math.floor(sr * (0.0004 + r.next() * 0.0035));
    for (let j = 0; j < len && i + j < n; j++) d[i + j] += amp * (r.next() * 2 - 1) * Math.exp(-5 * j / len);
  }
  return normalize(d, 0.95);
}

/** resonant chirps on a Poisson clock: water droplets (rising, bright) or bubbles (lower, longer) */
function chirpData(sr: number, secs: number, seed: number, rate: number, fLo: number, fHi: number, dLo: number, dHi: number, rise: number): Float32Array {
  const n = Math.floor(sr * secs), d = new Float32Array(n), r = new Rng(seed);
  let t = 0;
  for (;;) {
    // bursty: occasional clusters of close events
    t += -Math.log(1 - r.next() * 0.999) / rate * (r.next() < 0.3 ? 0.25 : 1);
    const i = Math.floor(t * sr);
    if (i >= n) break;
    const f0 = fLo * Math.pow(fHi / fLo, Math.pow(r.next(), 1.4));
    const dur = dLo + r.next() * (dHi - dLo);
    const amp = 0.25 + 0.75 * r.next();
    const len = Math.min(n - i, Math.floor(dur * 5 * sr));
    let ph = r.next() * TWO_PI;
    for (let j = 0; j < len; j++) {
      const tt = j / sr;
      ph += TWO_PI * f0 * (1 + rise * Math.min(1, tt / dur)) / sr;
      const att = Math.min(1, j / (0.0006 * sr));
      d[i + j] += amp * Math.sin(ph) * Math.exp(-tt / dur) * att;
    }
  }
  return normalize(d, 0.95);
}

/** smooth periodic random signal in [-1, 1] (integer cycles, so it loops seamlessly) */
function modData(secs: number, seed: number): Float32Array {
  const n = Math.floor(MOD_RATE * secs), d = new Float32Array(n), r = new Rng(seed);
  for (let k = 1; k <= 40; k++) {
    const amp = (0.4 + r.next()) / Math.pow(k, 0.85), ph = r.next() * TWO_PI, w = TWO_PI * k / n;
    for (let i = 0; i < n; i++) d[i] += amp * Math.sin(w * i + ph);
  }
  return normalize(d, 1);
}

// ------------------------------------------------------------------------------ impulse responses
interface IrSpec {
  secs: number; rt60: number; pre: number;
  /** lowpass cutoff at the start and end of the tail: high frequencies die first */
  lp0: number; lp1: number; hp: number;
  /** slow random amplitude flutter (granular, watery reverberation) */
  flutter: number;
  /** envelope swell [time, width, gain]: the rolling echo of thunder off the horizon */
  bump?: [number, number, number];
  /** discrete bounces [time, gain] (surface / seabed reflections) */
  echoes?: number[];
  /** number of resonant modes (metal hulls) */
  modes?: number;
}

const IRS: Record<VerbId | 'music', IrSpec> = {
  sky: { secs: 3.6, rt60: 3.1, pre: 0.03, lp0: 5200, lp1: 380, hp: 35, flutter: 0.15, bump: [0.5, 0.22, 0.9] },
  sea: { secs: 2.8, rt60: 2.4, pre: 0.012, lp0: 4200, lp1: 1300, hp: 160, flutter: 0.55, echoes: [0.13, 2.2, 0.29, 1.5, 0.47, 1.0, 0.71, 0.6] },
  hull: { secs: 1.5, rt60: 1.1, pre: 0.004, lp0: 6000, lp1: 900, hp: 60, flutter: 0, modes: 28 },
  music: { secs: 3.0, rt60: 2.6, pre: 0.025, lp0: 7000, lp1: 1500, hp: 60, flutter: 0.05 },
};

function irData(sr: number, s: IrSpec, seed: number): Float32Array[] {
  const n = Math.floor(sr * s.secs), pre = Math.floor(s.pre * sr), out: Float32Array[] = [];
  const hpA = Math.exp(-TWO_PI * s.hp / sr);
  for (let c = 0; c < 2; c++) {
    const d = new Float32Array(n), r = new Rng(seed * 7 + c * 131 + 1);
    let lp = 0, hpY = 0, hpX = 0;
    // flutter: random walk between points every ~50 ms, smoothed
    let fl = 0, flTarget = 0, flCount = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      let env = Math.exp(-6.9078 * t / s.rt60);
      if (s.bump) env *= 1 + s.bump[2] * Math.exp(-(((t - s.bump[0]) / s.bump[1]) ** 2));
      if (s.flutter > 0) {
        if (--flCount <= 0) { flTarget = r.next() * 2 - 1; flCount = Math.floor(sr * (0.03 + r.next() * 0.05)); }
        fl += (flTarget - fl) * 0.0015;
        env *= 1 + s.flutter * fl;
      }
      const fc = s.lp0 * Math.pow(s.lp1 / s.lp0, t / s.secs);
      lp += (1 - Math.exp(-TWO_PI * fc / sr)) * ((r.next() * 2 - 1) - lp);
      // one-pole DC/rumble blocker
      hpY = hpA * (hpY + lp - hpX); hpX = lp;
      d[i] = hpY * env;
    }
    // onset fade (2 ms) so the direct sound does not click
    const fade = Math.floor(0.002 * sr);
    for (let i = 0; i < fade && pre + i < n; i++) d[pre + i] *= i / fade;
    // discrete bounces: short decaying noise bursts
    if (s.echoes) {
      for (let e = 0; e < s.echoes.length; e += 2) {
        const at = pre + Math.floor((s.echoes[e] + (r.next() - 0.5) * 0.01 * (c + 1)) * sr);
        const g = s.echoes[e + 1] * Math.exp(-6.9078 * s.echoes[e] / s.rt60) * 0.35;
        const len = Math.floor(0.03 * sr);
        let y = 0;
        for (let j = 0; j < len && at + j < n; j++) {
          y += 0.35 * ((r.next() * 2 - 1) - y);
          d[at + j] += g * y * Math.exp(-j / (len * 0.3));
        }
      }
    }
    // resonant modes: inharmonic two-pole ringers mixed in at comparable energy
    if (s.modes) {
      const m = new Float32Array(n);
      for (let k = 0; k < s.modes; k++) {
        const f = 90 * Math.pow(3000 / 90, r.next());
        const tau = 0.08 + 0.7 * (1 - Math.log(f / 90) / Math.log(3000 / 90)) * (0.4 + r.next() * 0.6);
        const g = Math.exp(-1 / (tau * sr)), cw = 2 * g * Math.cos(TWO_PI * f / sr), g2 = g * g;
        const amp = (0.3 + r.next()) * (r.next() < 0.5 ? -1 : 1);
        let y1 = 0, y2 = 0;
        for (let i = pre; i < n; i++) {
          const y = cw * y1 - g2 * y2 + (i === pre ? amp : 0);
          m[i] += y; y2 = y1; y1 = y;
        }
      }
      let en = 0, em = 0;
      for (let i = 0; i < n; i++) { en += d[i] * d[i]; em += m[i] * m[i]; }
      const k = em > 0 ? Math.sqrt((en * 1.5) / em) : 0;
      for (let i = 0; i < n; i++) d[i] += m[i] * k;
    }
    out.push(d);
  }
  return out;
}

// ------------------------------------------------------------------------------ curves
const curveCache = new Map<string, Float32Array<ArrayBuffer>>();

/** master safety clipper: unity below 0.7, smooth knee to a 0.97 ceiling. The shaper input is
 *  pre-scaled by 0.5, so the curve covers signals up to +6 dBFS before it flattens. */
export function softClipCurve(): Float32Array<ArrayBuffer> {
  let c = curveCache.get('clip');
  if (!c) {
    const n = 4097, k = 0.7, ceil = 0.97;
    c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const s = ((i / (n - 1)) * 2 - 1) * 2, a = Math.abs(s);
      c[i] = Math.sign(s) * (a <= k ? a : k + (ceil - k) * Math.tanh((a - k) / (ceil - k)));
    }
    curveCache.set('clip', c);
  }
  return c;
}

/** symmetric tanh drive, normalized to +-1 (buzzers, radio, grit) */
export function driveCurve(drive: number): Float32Array<ArrayBuffer> {
  const key = 'drive' + drive;
  let c = curveCache.get(key);
  if (!c) {
    const n = 2049, norm = Math.tanh(drive);
    c = new Float32Array(n);
    for (let i = 0; i < n; i++) c[i] = Math.tanh(((i / (n - 1)) * 2 - 1) * drive) / norm;
    curveCache.set(key, c);
  }
  return c;
}

/** one-sided expander: keeps the peaks of a modulation signal, silences the troughs */
export function peaksCurve(power: number): Float32Array<ArrayBuffer> {
  const key = 'peaks' + power;
  let c = curveCache.get(key);
  if (!c) {
    const n = 1025;
    c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = x > 0 ? Math.pow(x, power) : 0; }
    curveCache.set(key, c);
  }
  return c;
}

// ------------------------------------------------------------------------------ per-context bank
export class Bank {
  readonly white: AudioBuffer;
  readonly pink: AudioBuffer;
  readonly brown: AudioBuffer;
  readonly crackle: AudioBuffer;
  readonly drops: AudioBuffer;
  readonly bubbles: AudioBuffer;
  readonly mod: AudioBuffer;
  readonly ir: Record<VerbId | 'music', AudioBuffer>;
  /** narrow pulse (diesel firing, buzzers) */
  readonly pulse: PeriodicWave;
  /** soft peaked beat (propeller thrum) */
  readonly beat: PeriodicWave;

  constructor(readonly ctx: BaseAudioContext) {
    const sr = ctx.sampleRate;
    const mono = (key: string, make: () => Float32Array, rate = sr) => this.buffer(cached(key + '@' + rate, () => [make()]), rate);
    this.white = mono('white', () => whiteData(sr, 3, 11));
    this.pink = mono('pink', () => pinkData(sr, 4, 23));
    this.brown = mono('brown', () => brownData(sr, 4, 37));
    this.crackle = mono('crackle', () => crackleData(sr, 4, 41));
    this.drops = mono('drops', () => chirpData(sr, 4, 53, 22, 900, 3600, 0.006, 0.02, 0.7));
    this.bubbles = mono('bubbles', () => chirpData(sr, 4, 67, 26, 260, 1300, 0.014, 0.05, 1.6));
    this.mod = mono('mod', () => modData(8, 71), MOD_RATE);
    const ir = (id: VerbId | 'music', seed: number) => this.buffer(cached('ir.' + id + '@' + sr, () => irData(sr, IRS[id], seed)), sr);
    this.ir = { sky: ir('sky', 3), sea: ir('sea', 5), hull: ir('hull', 7), music: ir('music', 9) };
    const H = 40, re = new Float32Array(H), im = new Float32Array(H);
    for (let k = 1; k < H; k++) re[k] = Math.sin(Math.PI * k * 0.12) / (Math.PI * k) * Math.exp(-k / 28);
    this.pulse = ctx.createPeriodicWave(re, im);
    this.beat = ctx.createPeriodicWave(new Float32Array([0, 1, 0.75, 0.45, 0.22, 0.08]), new Float32Array(6));
  }

  private buffer(chans: Float32Array[], rate: number): AudioBuffer {
    const b = this.ctx.createBuffer(chans.length, chans[0].length, rate);
    for (let c = 0; c < chans.length; c++) b.getChannelData(c).set(chans[c]);
    return b;
  }

  noise(kind: NoiseKind): AudioBuffer {
    switch (kind) {
      case 'white': return this.white;
      case 'pink': return this.pink;
      case 'brown': return this.brown;
      case 'crackle': return this.crackle;
      case 'drops': return this.drops;
      case 'bubbles': return this.bubbles;
      default: return this.mod;
    }
  }
}

const banks = new WeakMap<BaseAudioContext, Bank>();
export function bankFor(ctx: BaseAudioContext): Bank {
  let b = banks.get(ctx);
  if (!b) { b = new Bank(ctx); banks.set(ctx, b); }
  return b;
}

// ------------------------------------------------------------------------------ envelopes
/** percussive: ramp to `peak` in `atk`, then exponential decay with time constant `tau` (-60 dB at ~7 tau) */
export function perc(p: AudioParam, t: number, peak: number, atk: number, tau: number) {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + atk);
  p.setTargetAtTime(0, t + atk, tau);
}
/** attack, hold, release (release `r` is the time to roughly -40 dB) */
export function ahr(p: AudioParam, t: number, peak: number, a: number, h: number, r: number) {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  if (h > 0) p.setValueAtTime(peak, t + a + h);
  p.setTargetAtTime(0, t + a + h, r / 4.6);
}
/** exponential glide (both values must be > 0) */
export function glide(p: AudioParam, t: number, from: number, to: number, d: number) {
  p.setValueAtTime(from, t);
  p.exponentialRampToValueAtTime(to, t + d);
}
/** linear ramp */
export function ramp(p: AudioParam, t: number, from: number, to: number, d: number) {
  p.setValueAtTime(from, t);
  p.linearRampToValueAtTime(to, t + d);
}
/** freeze a param at its current value so new automation starts from there */
export function hold(p: AudioParam, t: number) {
  const v = p.value;
  p.cancelScheduledValues(t);
  p.setValueAtTime(v, t);
}

// ------------------------------------------------------------------------------ patch builder
/** A group of nodes built for one sound, loop or note. Records every node so the whole group can be
 *  stopped (voice stealing) and disconnected once it has finished. */
export class Patch {
  readonly nodes: AudioNode[] = [];
  readonly srcs: AudioScheduledSourceNode[] = [];
  /** context time at which every source of this patch has stopped (Infinity while looping) */
  end = 0;
  /** reverb inputs this patch may send to, and the scale applied to every send level */
  verbs: Partial<Record<VerbId, AudioNode>> = {};
  wet = 1;

  constructor(readonly ctx: BaseAudioContext, readonly bank: Bank, readonly rnd: () => number) {}

  add<T extends AudioNode>(n: T, to: Dest): T {
    this.nodes.push(n);
    if (to) {
      if ((to as AudioNode).connect) n.connect(to as AudioNode);
      else n.connect(to as AudioParam);
    }
    return n;
  }

  private run<T extends AudioScheduledSourceNode>(n: T, t0: number, t1: number, offset = -1): T {
    this.srcs.push(n);
    if (offset >= 0) (n as unknown as AudioBufferSourceNode).start(t0, offset);
    else n.start(t0);
    if (t1 < Infinity) { n.stop(t1); if (t1 > this.end) this.end = t1; } else this.end = Infinity;
    return n;
  }

  osc(type: OscillatorType, f: number, t0: number, t1: number, to: Dest, detune = 0): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    if (detune) o.detune.value = detune;
    return this.run(this.add(o, to), t0, t1);
  }

  wave(w: PeriodicWave, f: number, t0: number, t1: number, to: Dest): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.setPeriodicWave(w);
    o.frequency.value = f;
    return this.run(this.add(o, to), t0, t1);
  }

  /** looping noise/texture buffer starting at a random offset */
  noise(kind: NoiseKind, t0: number, t1: number, to: Dest, rate = 1): AudioBufferSourceNode {
    return this.sample(this.bank.noise(kind), t0, t1, to, rate, true);
  }

  sample(buf: AudioBuffer, t0: number, t1: number, to: Dest, rate = 1, loop = true): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = loop;
    s.playbackRate.value = rate;
    return this.run(this.add(s, to), t0, t1, loop ? this.rnd() * buf.duration * 0.95 : 0);
  }

  dc(v: number, t0: number, t1: number, to: Dest): ConstantSourceNode {
    const c = this.ctx.createConstantSource();
    c.offset.value = v;
    return this.run(this.add(c, to), t0, t1);
  }

  gain(v: number, to: Dest): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return this.add(g, to);
  }

  bq(type: BiquadFilterType, f: number, q: number, to: Dest, db = 0): BiquadFilterNode {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    if (db) b.gain.value = db;
    return this.add(b, to);
  }

  shape(curve: Float32Array<ArrayBuffer>, to: Dest): WaveShaperNode {
    const s = this.ctx.createWaveShaper();
    s.curve = curve;
    return this.add(s, to);
  }

  delay(time: number, to: Dest, max = 1): DelayNode {
    const d = this.ctx.createDelay(max);
    d.delayTime.value = time;
    return this.add(d, to);
  }

  pan(p: number, to: Dest): StereoPannerNode {
    const s = this.ctx.createStereoPanner();
    s.pan.value = p;
    return this.add(s, to);
  }

  /** gain node feeding a shared reverb (an unconnected sink when that reverb is not wired) */
  send(id: VerbId, level: number): GainNode {
    return this.gain(level * this.wet, this.verbs[id] ?? null);
  }

  /** a random value in [a, b) */
  rand(a: number, b: number): number { return a + (b - a) * this.rnd(); }

  /** stop every source at t (voice stealing, loop stop) */
  stopAt(t: number) {
    for (const s of this.srcs) { try { s.stop(t); } catch { /* already stopped */ } }
    this.end = t;
  }

  /** disconnect everything once the patch has finished */
  release() {
    for (const n of this.nodes) { try { n.disconnect(); } catch { /* already gone */ } }
    this.nodes.length = 0;
    this.srcs.length = 0;
  }
}

/** MIDI note number to Hz */
export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
