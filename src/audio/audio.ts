// Procedural audio engine. One AudioContext (created on the first user gesture), the shared bus
// graph from mixer.ts, spatial one-shots with a voice cap, positional loops, environment beds and
// adaptive music. Every method is a no-op until `unlock()` succeeds, so gameplay can call it freely.
// An engine can also wrap an OfflineAudioContext (lab self-test) and then renders the same graphs.

import { bankFor, Patch, type Bank } from './dsp';
import { Mixer, type Volumes } from './mixer';
import { LOOP_DEFS, SOUNDS, type LoopCtl, type LoopId, type SoundId } from './sounds';
import { Music, type MusicState } from './music';

export type { SoundId, LoopId } from './sounds';
export type { MusicState } from './music';

export interface PlayOpts { x?: number; y?: number; vol?: number; pitch?: number; delay?: number; doppler?: number; underwater?: boolean }
export interface LoopHandle {
  set(p: { vol?: number; pitch?: number; x?: number; y?: number; filter?: number }): void;
  stop(fade?: number): void;
}

const VOICE_CAP = 48;
const NULL_LOOP: LoopHandle = { set() {}, stop() {} };

interface Voice { patch: Patch; t0: number }
interface LoopVoice { patch: Patch; ctl: LoopCtl; level: GainNode; pan: StereoPannerNode; x?: number; y?: number; ref: number; vol: number; base: number; dead: boolean }

export class AudioEngine {
  ctx: BaseAudioContext | null = null;
  private bank: Bank | null = null;
  mixer: Mixer | null = null;
  private music: Music | null = null;
  private voices: Voice[] = [];
  private loops: LoopVoice[] = [];
  private lx = 0; private ly = 0; private zoom = 1;
  private underwater = 0;
  private env: { sea: LoopHandle; rain: LoopHandle; wind: LoopHandle } | null = null;
  private seed = 1;
  /** volume source (dev settings in the game; fixed in the lab) */
  volumes: () => Volumes = () => ({ master: 0.7, sfx: 0.8, ambience: 0.6, music: 0.4, chatter: true });
  private lastVol = '';

  get ready() { return !!this.ctx && (!('state' in this.ctx) || (this.ctx as AudioContext).state === 'running' || (typeof OfflineAudioContext !== 'undefined' && this.ctx instanceof OfflineAudioContext)); }
  get voiceCount() { return this.voices.length + this.loops.length; }

  /** wrap an existing context (OfflineAudioContext for the lab) */
  attach(ctx: BaseAudioContext, dest: AudioNode = ctx.destination) {
    this.ctx = ctx;
    this.bank = bankFor(ctx);
    this.mixer = new Mixer(ctx, this.bank, dest);
    this.music = new Music(ctx, this.bank, this.mixer.bus.music, this.mixer.musicVerb);
    this.applyVolumes(true);
  }

  /** create / resume the realtime context; safe to call on every gesture */
  unlock() {
    try {
      if (!this.ctx) {
        const AC = (globalThis as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
        if (!AC) return;
        this.attach(new AC({ latencyHint: 'interactive' }));
      }
      const c = this.ctx as AudioContext;
      if (c.state === 'suspended') void c.resume();
    } catch (e) { console.warn('audio unavailable', e); this.ctx = null; }
  }

  setListener(x: number, y: number, zoom = 1) { this.lx = x; this.ly = y; this.zoom = zoom; }

  setUnderwater(amount: number) {
    const u = Math.max(0, Math.min(1, amount));
    if (Math.abs(u - this.underwater) < 0.01 || !this.mixer || !this.ctx) { this.underwater = u; return; }
    this.underwater = u;
    this.mixer.setUnderwater(u, this.ctx.currentTime);
  }

  private rnd = () => { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; };

  /** distance gain + pan for a position (no position = centred, full level) */
  private spatial(x: number | undefined, y: number | undefined, ref: number): { g: number; pan: number; d: number } {
    if (x === undefined || y === undefined || ref <= 0) return { g: 1, pan: 0, d: 0 };
    const dx = x - this.lx, dy = y - this.ly, d = Math.hypot(dx, dy);
    return { g: 1 / (1 + (d / ref) * (d / ref)), pan: Math.max(-0.85, Math.min(0.85, dx / 700)), d };
  }

  play(id: SoundId, o: PlayOpts = {}) {
    const ctx = this.ctx, mx = this.mixer, bank = this.bank;
    if (!ctx || !mx || !bank || !this.ready) return;
    const def = SOUNDS[id];
    if (!def) return;
    const sp = this.spatial(o.x, o.y, def.ref);
    if (def.range > 0 && sp.d > def.range) return;
    const level = (o.vol ?? 1) * (def.gain ?? 1) * sp.g;
    if (level < 0.003) return;
    // voice cap: steal the oldest one-shot
    if (this.voices.length >= VOICE_CAP) {
      const v = this.voices.shift()!;
      v.patch.stopAt(ctx.currentTime + 0.02);
      v.patch.release();
    }
    const bus = o.underwater ? mx.bus.water : mx.bus[def.bus];
    const p = new Patch(ctx, bank, this.rnd);
    p.verbs = mx.verbs;
    const t = ctx.currentTime + Math.max(0, o.delay ?? 0) + 0.005;
    const pan = p.pan(sp.pan, bus);
    // distant sounds lose their highs (air absorption)
    const lp = p.bq('lowpass', Math.max(900, 18000 * Math.exp(-sp.d / 1400)), 0.5, pan);
    const g = p.gain(level, lp);
    const dur = def.synth(p, t, g, { pitch: o.pitch ?? 1, doppler: o.doppler ?? 1 });
    if (p.end < t + dur) p.end = t + dur;
    this.voices.push({ patch: p, t0: t });
  }

  loop(id: LoopId, o: PlayOpts = {}): LoopHandle {
    const ctx = this.ctx, mx = this.mixer, bank = this.bank;
    if (!ctx || !mx || !bank) return NULL_LOOP;
    const def = LOOP_DEFS[id];
    const p = new Patch(ctx, bank, this.rnd);
    p.verbs = mx.verbs;
    const t = ctx.currentTime + 0.01;
    const bus = o.underwater ? mx.bus.water : mx.bus[def.bus];
    const pan = p.pan(0, bus);
    const level = p.gain(0, pan);
    const ctl = def.build(p, t, level);
    const lv: LoopVoice = { patch: p, ctl, level, pan, x: o.x, y: o.y, ref: def.ref, vol: o.vol ?? 1, base: def.gain, dead: false };
    this.loops.push(lv);
    if (o.pitch !== undefined) ctl.setPitch(o.pitch, t);
    this.updateLoop(lv, 0.4);
    return {
      set: (s) => {
        if (lv.dead || !this.ctx) return;
        const now = this.ctx.currentTime;
        if (s.vol !== undefined) lv.vol = s.vol;
        if (s.x !== undefined) lv.x = s.x;
        if (s.y !== undefined) lv.y = s.y;
        if (s.pitch !== undefined) lv.ctl.setPitch(s.pitch, now);
        if (s.filter !== undefined) lv.ctl.setFilter?.(s.filter, now);
        this.updateLoop(lv, 0.08);
      },
      stop: (fade = 0.4) => {
        if (lv.dead || !this.ctx) return;
        lv.dead = true;
        const now = this.ctx.currentTime;
        lv.level.gain.cancelScheduledValues(now);
        lv.level.gain.setValueAtTime(lv.level.gain.value, now);
        lv.level.gain.setTargetAtTime(0, now, Math.max(0.01, fade / 4));
        lv.patch.stopAt(now + fade + 0.05);
      },
    };
  }

  private updateLoop(lv: LoopVoice, tau: number) {
    if (!this.ctx) return;
    const sp = this.spatial(lv.x, lv.y, lv.ref);
    const now = this.ctx.currentTime;
    lv.level.gain.setTargetAtTime(lv.vol * lv.base * sp.g, now, tau);
    lv.pan.pan.setTargetAtTime(sp.pan, now, tau);
  }

  setMusic(state: MusicState) { this.music?.set(state); }

  /** environment beds follow sea state, rain, wind and night (loops start on first call) */
  setEnvironment(e: { seaState: number; rain: number; wind: number; night: number }) {
    if (!this.ctx || !this.mixer) return;
    if (!this.env) this.env = { sea: this.loop('sea'), rain: this.loop('rain', { vol: 0 }), wind: this.loop('wind', { vol: 0 }) };
    const s = Math.max(0, Math.min(1, e.seaState / 10));
    this.env.sea.set({ vol: 0.35 + 0.65 * s, pitch: s });
    this.env.rain.set({ vol: Math.min(1, e.rain), pitch: Math.min(1, e.rain) });
    this.env.wind.set({ vol: Math.min(1, e.wind / 25), pitch: Math.min(1, e.wind / 25) });
    this.mixer.setNight(Math.max(0, Math.min(1, e.night)), this.ctx.currentTime);
  }

  private applyVolumes(force = false) {
    if (!this.mixer || !this.ctx) return;
    const v = this.volumes();
    const key = JSON.stringify(v);
    if (!force && key === this.lastVol) return;
    this.lastVol = key;
    this.mixer.setVolumes(v, this.ctx.currentTime);
  }

  /** per frame; `musicAhead` lets offline renders schedule the whole score at once */
  update(_dt: number, musicAhead = 0.6) {
    const ctx = this.ctx;
    if (!ctx) return;
    this.applyVolumes();
    this.music?.update(musicAhead);
    const now = ctx.currentTime;
    this.voices = this.voices.filter((v) => { if (v.patch.end < now - 0.1) { v.patch.release(); return false; } return true; });
    this.loops = this.loops.filter((l) => {
      if (l.dead && l.patch.end < now - 0.1) { l.patch.release(); return false; }
      if (!l.dead && l.x !== undefined) this.updateLoop(l, 0.08);
      return true;
    });
  }

  /** stop every mission sound (loops, voices); environment beds restart with setEnvironment */
  stopAll(fade = 0.5) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const v of this.voices) v.patch.stopAt(now + fade);
    for (const l of this.loops) if (!l.dead) { l.dead = true; l.level.gain.setTargetAtTime(0, now, fade / 4); l.patch.stopAt(now + fade + 0.05); }
    this.env = null;
  }
}

export const audio = new AudioEngine();
