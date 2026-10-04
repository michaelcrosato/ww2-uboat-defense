// Bus graph shared by the realtime engine and the offline lab: category buses with live volumes,
// listener-submerged filtering, generated convolution reverbs and a master limiter + soft clipper.
//
//   air ──► airLp ► airShelf ──┐                  (surface sounds: muffled when the listener dives)
//   water ► waterLp ───────────┼─► sfx ──┐        (sounds in the water: muffled when listener is up)
//   interior / ui / chatter ───┘         │
//   ambAir ► ambLp ► ambShelf ─┬─► amb ──┼─► master ► limiter ► trim ► soft clip ► output
//   ambDeep ───────────────────┘         │
//   music (+ music reverb) ──────────────┘
//   reverbs: sky → air (pre-filter), sea → sfx, hull → interior

import { softClipCurve, type Bank, type VerbId } from './dsp';

export type BusId = 'air' | 'water' | 'interior' | 'ui' | 'chatter' | 'ambAir' | 'ambDeep' | 'music';

export interface Volumes { master: number; sfx: number; ambience: number; music: number; chatter: boolean }

// limiter: hard knee so the spec'd makeup gain is predictable, then trimmed back to unity
const LIM_THRESHOLD = -6, LIM_RATIO = 12;
const LIM_T = Math.pow(10, LIM_THRESHOLD / 20);
/** WebAudio compressors add makeup gain = (1 / curve(1.0))^0.6; undo it so quiet mixes pass at unity */
const LIM_TRIM = 1 / Math.pow(1 / Math.pow(LIM_T, 1 - 1 / LIM_RATIO), 0.6);

export class Mixer {
  /** pre-limiter sum (master volume applied) */
  readonly master: GainNode;
  readonly limiter: DynamicsCompressorNode;
  /** post-limiter, post-clipper output; peaks never exceed 0.97 */
  readonly output: GainNode;
  readonly sfx: GainNode;
  readonly amb: GainNode;
  readonly music: GainNode;
  readonly bus: Record<BusId, GainNode>;
  readonly verbs: Record<VerbId, GainNode>;
  readonly musicVerb: GainNode;
  private airLp: BiquadFilterNode;
  private airShelf: BiquadFilterNode;
  private airOut: GainNode;
  private waterLp: BiquadFilterNode;
  private waterOut: GainNode;
  private ambLp: BiquadFilterNode;
  private ambShelf: BiquadFilterNode;
  private ambAirOut: GainNode;
  private chatterGate: GainNode;

  constructor(readonly ctx: BaseAudioContext, bank: Bank, dest: AudioNode | null) {
    const g = (v = 1, to: AudioNode | null = null) => {
      const n = ctx.createGain();
      n.gain.value = v;
      if (to) n.connect(to);
      return n;
    };
    const f = (type: BiquadFilterType, freq: number, q: number, to: AudioNode, db = 0) => {
      const n = ctx.createBiquadFilter();
      n.type = type; n.frequency.value = freq; n.Q.value = q; n.gain.value = db;
      n.connect(to);
      return n;
    };

    // master chain
    this.output = g(1, dest);
    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve();
    clip.oversample = 'none'; // oversampling filters could overshoot the ceiling
    clip.connect(this.output);
    const clipIn = g(0.5, clip);
    const trim = g(LIM_TRIM, clipIn);
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = LIM_THRESHOLD;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = LIM_RATIO;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.2;
    this.limiter.connect(trim);
    this.master = g(1, this.limiter);

    // categories
    this.sfx = g(1, this.master);
    this.amb = g(1, this.master);
    this.music = g(1, this.master);

    this.airOut = g(1, this.sfx);
    this.airShelf = f('lowshelf', 160, 0.7, this.airOut, 0);
    this.airLp = f('lowpass', 18000, 0.5, this.airShelf);
    this.waterOut = g(0.7, this.sfx);
    this.waterLp = f('lowpass', 1200, 0.6, this.waterOut);
    this.chatterGate = g(1, this.sfx);
    this.ambAirOut = g(1, this.amb);
    this.ambShelf = f('highshelf', 3000, 0.7, this.ambAirOut, 0);
    this.ambLp = f('lowpass', 16000, 0.5, this.ambShelf);

    this.bus = {
      air: g(1, this.airLp),
      water: g(1, this.waterLp),
      interior: g(1, this.sfx),
      ui: g(1, this.sfx),
      chatter: g(1, this.chatterGate),
      ambAir: g(1, this.ambLp),
      ambDeep: g(1, this.amb),
      music: g(1, this.music),
    };

    const verb = (ir: AudioBuffer, to: AudioNode) => {
      const c = ctx.createConvolver();
      c.normalize = true;
      c.buffer = ir;
      c.connect(to);
      return g(1, c);
    };
    this.verbs = {
      sky: verb(bank.ir.sky, this.bus.air),
      sea: verb(bank.ir.sea, this.sfx),
      hull: verb(bank.ir.hull, this.bus.interior),
    };
    this.musicVerb = verb(bank.ir.music, this.music);
  }

  setVolumes(v: Volumes, t: number, tau = 0.05) {
    const set = (p: AudioParam, x: number) => p.setTargetAtTime(Math.max(0, x), t, tau);
    set(this.master.gain, v.master);
    set(this.sfx.gain, v.sfx);
    set(this.amb.gain, v.ambience);
    set(this.music.gain, v.music);
    set(this.chatterGate.gain, v.chatter ? 1 : 0);
  }

  /** 0 = surfaced listener, 1 = deep: surface sounds lose their highs, sounds in the water open up */
  setUnderwater(u: number, t: number, tau = 0.25) {
    const set = (p: AudioParam, x: number) => p.setTargetAtTime(x, t, tau);
    set(this.airLp.frequency, 18000 * Math.pow(380 / 18000, u));
    set(this.airShelf.gain, 5 * u);
    set(this.airOut.gain, 1 - 0.45 * u);
    set(this.waterLp.frequency, 1200 * Math.pow(9000 / 1200, u));
    set(this.waterOut.gain, 0.7 + 0.3 * u);
    set(this.ambLp.frequency, 16000 * Math.pow(260 / 16000, u));
    set(this.ambAirOut.gain, 1 - 0.55 * u);
  }

  /** night: the sea bed sounds darker and a little more hushed */
  setNight(n: number, t: number) {
    this.ambShelf.gain.setTargetAtTime(-6 * n, t, 0.5);
  }
}
