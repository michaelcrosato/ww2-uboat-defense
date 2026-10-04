// Minimal adaptive score: modal, period-flavoured stems generated note by note (no melodies borrowed).
// Each state is a stem with its own gain; switching states crossfades over ~3 s, and only audible
// stems get notes scheduled, so the CPU cost is a handful of short patches per second.
//
//   menu     slow D-dorian melody over a soft pad
//   calm     drifting low pad, a sparse high note now and then
//   tension  pedal drone + heartbeat pulse
//   combat   minor pad, timpani hits and an ostinato
//   victory  one rising D-major swell        defeat  one sinking minor chord

import { ahr, mtof, perc, Patch, type Bank } from './dsp';

export type MusicState = 'off' | 'menu' | 'calm' | 'tension' | 'combat' | 'victory' | 'defeat';
const STATES: MusicState[] = ['menu', 'calm', 'tension', 'combat', 'victory', 'defeat'];

/** D dorian degrees (semitones above D) */
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const ROOT = 38; // D2

export class Music {
  private stems = new Map<MusicState, GainNode>();
  private state: MusicState = 'off';
  /** next schedule time per stem */
  private next = new Map<MusicState, number>();
  private step = new Map<MusicState, number>();
  private oneShotDone = new Set<MusicState>();
  private live: Patch[] = [];
  private rngState = 1234567;

  constructor(private ctx: BaseAudioContext, private bank: Bank, out: AudioNode, private verb: AudioNode) {
    for (const s of STATES) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(out);
      g.connect(verb);
      this.stems.set(s, g);
    }
  }

  private rnd() { this.rngState = (this.rngState * 1664525 + 1013904223) >>> 0; return this.rngState / 4294967296; }

  set(state: MusicState) {
    if (state === this.state) return;
    const t = this.ctx.currentTime;
    for (const [s, g] of this.stems) {
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.setTargetAtTime(s === state ? 1 : 0, t, 1);   // ~3 s to settle
    }
    if (state === 'victory' || state === 'defeat') this.oneShotDone.delete(state);
    this.state = state;
    this.next.set(state, Math.max(t + 0.05, this.next.get(state) ?? 0));
  }

  /** schedule notes up to `ahead` seconds into the future */
  update(ahead = 0.6) {
    const t = this.ctx.currentTime;
    for (const s of STATES) {
      const g = this.stems.get(s)!;
      const audible = s === this.state || g.gain.value > 0.01;
      if (!audible) { this.next.delete(s); continue; }
      let nt = this.next.get(s) ?? t + 0.05;
      while (nt < t + ahead) nt = this.schedule(s, Math.max(nt, t), g);
      this.next.set(s, nt);
    }
    // release finished note patches
    this.live = this.live.filter((p) => { if (p.end < t - 0.1) { p.release(); return false; } return true; });
  }

  private patch(): Patch { const p = new Patch(this.ctx, this.bank, () => this.rnd()); this.live.push(p); return p; }

  private pad(at: number, notes: number[], dur: number, out: AudioNode, level: number, cutoff: number) {
    const p = this.patch();
    const lp = p.bq('lowpass', cutoff, 0.6, out);
    for (const n of notes) {
      const e = p.gain(0, lp);
      ahr(e.gain, at, level / notes.length, dur * 0.35, dur * 0.3, dur * 0.6);
      p.osc('sawtooth', mtof(n), at, at + dur * 1.4, e, -7);
      p.osc('sawtooth', mtof(n), at, at + dur * 1.4, e, 8);
    }
  }
  private bell(at: number, note: number, out: AudioNode, level: number, decay: number) {
    const p = this.patch();
    const e = p.gain(0, out);
    perc(e.gain, at, level, 0.01, decay);
    p.osc('triangle', mtof(note), at, at + decay * 6, e);
    const e2 = p.gain(0, out);
    perc(e2.gain, at, level * 0.25, 0.01, decay * 0.5);
    p.osc('sine', mtof(note) * 3.01, at, at + decay * 3, e2);
  }
  private drum(at: number, f: number, out: AudioNode, level: number, tau: number) {
    const p = this.patch();
    const e = p.gain(0, out);
    perc(e.gain, at, level, 0.003, tau);
    const o = p.osc('sine', f, at, at + tau * 6, e);
    o.frequency.setValueAtTime(f * 1.6, at);
    o.frequency.exponentialRampToValueAtTime(f, at + 0.06);
    const n = p.gain(0, p.bq('lowpass', 600, 0.7, out));
    perc(n.gain, at, level * 0.4, 0.002, tau * 0.4);
    p.noise('brown', at, at + tau * 3, n);
  }
  private deg(d: number, oct = 0) { const i = ((d % 7) + 7) % 7; return ROOT + DORIAN[i] + 12 * (oct + Math.floor(d / 7)); }

  /** schedule one musical step of stem `s` at `at`; returns the time of the next step */
  private schedule(s: MusicState, at: number, out: AudioNode): number {
    const k = this.step.get(s) ?? 0;
    this.step.set(s, k + 1);
    switch (s) {
      case 'menu': {
        if (k % 8 === 0) this.pad(at, [this.deg(0, 1), this.deg(4, 1), this.deg(2, 2)], 9, out, 0.22, 900);
        const phrase = [4, 3, 2, 0, 2, 4, 5, 4];
        this.bell(at, this.deg(phrase[k % phrase.length], 3), out, 0.12, 0.9);
        return at + (k % 4 === 3 ? 2.4 : 1.2);
      }
      case 'calm': {
        const chords = [[0, 4, 9], [5, 9, 14], [3, 7, 12], [4, 8, 11]];
        const c = chords[k % chords.length];
        this.pad(at, c.map((d) => this.deg(d, 1)), 10, out, 0.18, 700);
        if (this.rnd() < 0.5) this.bell(at + 3 + this.rnd() * 4, this.deg(Math.floor(this.rnd() * 7), 4), out, 0.05, 1.4);
        return at + 8;
      }
      case 'tension': {
        if (k % 16 === 0) this.pad(at, [ROOT, ROOT + 7], 14, out, 0.2, 300);
        // heartbeat: lub-dub
        this.drum(at, 52, out, 0.35, 0.09);
        this.drum(at + 0.22, 46, out, 0.22, 0.08);
        return at + 0.95;
      }
      case 'combat': {
        if (k % 16 === 0) this.pad(at, [this.deg(0, 1), this.deg(2, 1), this.deg(4, 1), this.deg(0, 2)], 8, out, 0.24, 1200);
        if (k % 4 === 0) this.drum(at, 62, out, 0.55, 0.28);
        if (k % 8 === 6) this.drum(at, 74, out, 0.4, 0.22);
        const ost = [0, 0, 3, 0, 5, 0, 3, 2];
        this.bell(at, this.deg(ost[k % ost.length], 2), out, 0.08, 0.18);
        return at + 0.25;
      }
      case 'victory': {
        if (this.oneShotDone.has('victory')) return at + 4;
        this.oneShotDone.add('victory');
        this.pad(at, [ROOT + 12, ROOT + 16, ROOT + 19, ROOT + 24], 6, out, 0.3, 1600);
        [0, 4, 7, 12].forEach((n, i) => this.bell(at + i * 0.3, ROOT + 36 + n, out, 0.12, 1.2));
        return at + 8;
      }
      case 'defeat': {
        if (this.oneShotDone.has('defeat')) return at + 4;
        this.oneShotDone.add('defeat');
        this.pad(at, [ROOT, ROOT + 3, ROOT + 7, ROOT - 12], 8, out, 0.3, 500);
        this.drum(at, 40, out, 0.5, 0.6);
        return at + 10;
      }
      default: return at + 4;
    }
  }

  stopAll() { const t = this.ctx.currentTime; for (const p of this.live) p.stopAt(t); }
}
