// Every sound and loop as a small synth graph built on a Patch (dsp.ts). Synths take any
// BaseAudioContext, so the lab renders exactly these graphs offline. No samples, no melodies.
//
// A one-shot synth gets the patch, a start time and the node to feed (the voice's spatial input) and
// returns its duration. A loop synth returns a handle that maps pitch / filter changes onto its nodes.

import { ahr, driveCurve, glide, perc, type Patch } from './dsp';
import type { BusId } from './mixer';

export type SoundId = 'asdic_ping' | 'asdic_echo' | 'hydrophone_contact' | 'depth_charge_splash' | 'depth_charge_boom' | 'underwater_boom_far'
  | 'surface_explosion' | 'torpedo_hit' | 'torpedo_launch' | 'torpedo_run' | 'gun_heavy' | 'gun_light' | 'shell_whistle' | 'shell_splash'
  | 'hedgehog_launch' | 'hedgehog_hit' | 'star_shell_pop' | 'hull_creak' | 'hull_groan' | 'crush_rumble' | 'dive_alarm' | 'telegraph_bell'
  | 'blow_ballast' | 'flood_vents' | 'ramming_crunch' | 'metal_impact' | 'splash_small' | 'splash_big' | 'wave_slap' | 'loot_drop'
  | 'loot_legendary' | 'level_up' | 'ui_click' | 'ui_hover' | 'ui_back' | 'ui_error' | 'contract_complete' | 'radio_static' | 'morse_burst'
  | 'aircraft_pass' | 'whistle_signal' | 'bubbles' | 'decoy_fizz' | 'klaxon' | 'ship_sinking' | 'fire_crackle';
export type LoopId = 'sea' | 'rain' | 'wind' | 'engine_steam' | 'engine_diesel' | 'engine_electric' | 'cavitation' | 'fire' | 'underwater'
  | 'hydrophone_noise' | 'torpedo_run';

export interface SynthOpts { pitch: number; doppler: number }
type Synth = (p: Patch, t: number, out: AudioNode, o: SynthOpts) => number;

export interface SoundDef {
  synth: Synth;
  bus: BusId;
  /** distance (m) at which the sound has dropped to half loudness; 0 = not spatial (UI, interior) */
  ref: number;
  /** beyond this distance the sound is not started at all */
  range: number;
  gain?: number;
}

// ------------------------------------------------------------------ building blocks
/** noise burst through a filter with a percussive envelope */
function burst(p: Patch, t: number, out: AudioNode, kind: 'white' | 'pink' | 'brown', type: BiquadFilterType, f: number, q: number, peak: number, atk: number, tau: number, dur: number, rate = 1) {
  const e = p.gain(0, out);
  perc(e.gain, t, peak, atk, tau);
  p.noise(kind, t, t + dur, p.bq(type, f, q, e), rate);
  return e;
}
/** pitched thump: sine gliding down */
function thump(p: Patch, t: number, out: AudioNode, f0: number, f1: number, peak: number, tau: number, dur: number) {
  const e = p.gain(0, out);
  perc(e.gain, t, peak, 0.004, tau);
  const o = p.osc('sine', f0, t, t + dur, e);
  glide(o.frequency, t, f0, f1, Math.min(dur, tau * 3));
}
/** struck metal / bell: inharmonic partials with their own decays */
function modal(p: Patch, t: number, out: AudioNode, f: number, ratios: number[], peak: number, tau: number, dur: number) {
  ratios.forEach((r, i) => {
    const e = p.gain(0, out);
    perc(e.gain, t, peak / (1 + i * 0.6), 0.002, tau / (1 + i * 0.35));
    p.osc('sine', f * r, t, t + dur, e);
  });
}

// ------------------------------------------------------------------ one-shots
const S: Record<SoundId, SoundDef> = {
  asdic_ping: {
    bus: 'water', ref: 600, range: 6000, gain: 0.55,
    synth: (p, t, out, o) => {
      // the classic pure tone with a long watery tail
      const f = 1420 * o.pitch;
      const e = p.gain(0, out);
      ahr(e.gain, t, 0.9, 0.006, 0.22, 1.6);
      const osc = p.osc('sine', f, t, t + 2.4, e);
      glide(osc.frequency, t, f * 1.01, f * 0.985, 0.6);
      const e2 = p.gain(0, out);
      ahr(e2.gain, t, 0.12, 0.006, 0.1, 0.6);
      p.osc('sine', f * 2.01, t, t + 1, e2);
      const sv = p.send('sea', 0.8);
      e.connect(sv);
      return 2.6;
    },
  },
  asdic_echo: {
    bus: 'water', ref: 400, range: 4000, gain: 0.35,
    synth: (p, t, out, o) => {
      const f = 1420 * o.pitch * o.doppler;
      const e = p.gain(0, p.bq('bandpass', f, 6, out));
      ahr(e.gain, t, 0.7, 0.02, 0.08, 0.7);
      p.osc('sine', f, t, t + 1.2, e);
      p.noise('pink', t, t + 1.2, p.gain(0.15, e));
      e.connect(p.send('sea', 0.6));
      return 1.3;
    },
  },
  hydrophone_contact: {
    bus: 'water', ref: 800, range: 5000, gain: 0.5,
    synth: (p, t, out, o) => {
      // propeller thrum: band-passed noise beating at the shaft rate
      const env = p.gain(0, out);
      ahr(env.gain, t, 0.8, 0.25, 0.8, 0.5);
      const am = p.gain(0.5, env);
      p.dc(0.5, t, t + 1.8, am.gain);
      p.wave(p.bank.beat, 7.5 * o.pitch, t, t + 1.8, am.gain);
      p.noise('pink', t, t + 1.8, p.bq('bandpass', 320 * o.pitch, 1.5, am));
      return 1.9;
    },
  },
  depth_charge_splash: {
    bus: 'air', ref: 150, range: 1500, gain: 0.5,
    synth: (p, t, out) => {
      burst(p, t, out, 'pink', 'bandpass', 900, 0.8, 0.8, 0.01, 0.12, 0.8);
      thump(p, t, out, 110, 60, 0.4, 0.06, 0.3);
      return 0.9;
    },
  },
  depth_charge_boom: {
    bus: 'water', ref: 500, range: 4000, gain: 0.9,
    synth: (p, t, out) => {
      thump(p, t, out, 52, 26, 1, 0.5, 3);
      burst(p, t, out, 'brown', 'lowpass', 380, 0.7, 0.9, 0.02, 0.6, 3.5);
      // the slow column of water collapsing back
      const col = p.gain(0, out);
      ahr(col.gain, t + 0.6, 0.35, 0.4, 0.3, 1.6);
      p.noise('pink', t + 0.6, t + 3.5, p.bq('lowpass', 1200, 0.6, col));
      p.noise('bubbles', t + 0.6, t + 3.5, p.gain(0.4, col));
      const sv = p.send('sea', 0.7);
      out.connect(sv);
      return 4;
    },
  },
  underwater_boom_far: {
    bus: 'water', ref: 1500, range: 8000, gain: 0.7,
    synth: (p, t, out) => {
      const e = p.gain(0, out);
      ahr(e.gain, t, 0.9, 0.18, 0.2, 2.6);
      p.noise('brown', t, t + 3.5, p.bq('lowpass', 160, 0.8, e));
      thump(p, t + 0.05, out, 38, 24, 0.5, 0.8, 3);
      return 3.6;
    },
  },
  surface_explosion: {
    bus: 'air', ref: 500, range: 5000, gain: 0.9,
    synth: (p, t, out) => {
      burst(p, t, out, 'white', 'highpass', 1800, 0.7, 0.8, 0.001, 0.03, 0.25);
      thump(p, t, out, 70, 32, 1, 0.35, 2.5);
      burst(p, t, out, 'brown', 'lowpass', 900, 0.6, 0.9, 0.01, 0.7, 3.5);
      const deb = p.gain(0, out);
      ahr(deb.gain, t + 0.2, 0.25, 0.05, 0.4, 1.5);
      p.noise('crackle', t + 0.2, t + 3, p.bq('bandpass', 2500, 0.8, deb));
      out.connect(p.send('sky', 0.9));
      return 4;
    },
  },
  torpedo_hit: {
    bus: 'air', ref: 700, range: 7000, gain: 1,
    synth: (p, t, out) => {
      thump(p, t, out, 60, 25, 1, 0.6, 4);
      burst(p, t, out, 'brown', 'lowpass', 700, 0.6, 1, 0.01, 1.1, 5);
      burst(p, t, out, 'white', 'highpass', 1500, 0.7, 0.7, 0.001, 0.05, 0.4);
      modal(p, t + 0.05, p.gain(0.35, out), 140, [1, 2.43, 3.91, 5.6], 0.5, 1.4, 4);
      out.connect(p.send('sky', 1));
      return 5;
    },
  },
  torpedo_launch: {
    bus: 'water', ref: 250, range: 2500, gain: 0.7,
    synth: (p, t, out) => {
      // compressed-air impulse, then the eel spinning up
      const air = p.gain(0, out);
      ahr(air.gain, t, 0.8, 0.01, 0.15, 0.5);
      const f = p.bq('bandpass', 2200, 0.9, air);
      p.noise('pink', t, t + 1, f);
      glide(f.frequency, t, 2200, 380, 0.6);
      thump(p, t, out, 90, 45, 0.6, 0.1, 0.4);
      const w = p.gain(0, out);
      ahr(w.gain, t + 0.2, 0.25, 0.3, 0.3, 0.6);
      const o = p.osc('sawtooth', 160, t + 0.2, t + 1.6, p.bq('bandpass', 700, 3, w));
      glide(o.frequency, t + 0.2, 160, 420, 0.8);
      return 1.7;
    },
  },
  torpedo_run: {
    bus: 'water', ref: 200, range: 1500, gain: 0.5,
    synth: (p, t, out, o) => {
      const e = p.gain(0, out);
      ahr(e.gain, t, 0.6, 0.2, 1.4, 0.4);
      p.osc('sawtooth', 420 * o.pitch * o.doppler, t, t + 2.2, p.bq('bandpass', 900, 2, e));
      p.noise('white', t, t + 2.2, p.bq('bandpass', 3000, 1, p.gain(0.2, e)));
      return 2.2;
    },
  },
  gun_heavy: {
    bus: 'air', ref: 400, range: 5000, gain: 0.9,
    synth: (p, t, out) => {
      burst(p, t, out, 'white', 'highpass', 900, 0.6, 1, 0.0005, 0.02, 0.2);
      thump(p, t, out, 95, 40, 0.9, 0.12, 0.8);
      burst(p, t, out, 'brown', 'lowpass', 1000, 0.6, 0.7, 0.002, 0.25, 1.5);
      out.connect(p.send('sky', 0.8));
      return 2.5;
    },
  },
  gun_light: {
    bus: 'air', ref: 200, range: 2500, gain: 0.6,
    synth: (p, t, out) => {
      burst(p, t, out, 'white', 'bandpass', 1600, 0.8, 0.9, 0.0005, 0.03, 0.3);
      thump(p, t, out, 160, 90, 0.4, 0.04, 0.2);
      out.connect(p.send('sky', 0.4));
      return 0.7;
    },
  },
  shell_whistle: {
    bus: 'air', ref: 200, range: 1500, gain: 0.35,
    synth: (p, t, out) => {
      const e = p.gain(0, out);
      ahr(e.gain, t, 0.5, 0.4, 0.5, 0.3);
      const o = p.osc('sine', 1900, t, t + 1.4, e);
      glide(o.frequency, t, 1900, 850, 1.3);
      const n = p.bq('bandpass', 1600, 4, p.gain(0.3, e));
      p.noise('white', t, t + 1.4, n);
      glide(n.frequency, t, 1800, 900, 1.3);
      return 1.4;
    },
  },
  shell_splash: {
    bus: 'air', ref: 200, range: 2500, gain: 0.6,
    synth: (p, t, out) => {
      const e = p.gain(0, out);
      ahr(e.gain, t, 0.8, 0.005, 0.1, 0.9);
      const lp = p.bq('lowpass', 4000, 0.6, e);
      p.noise('pink', t, t + 1.2, lp);
      glide(lp.frequency, t, 4000, 700, 1);
      p.noise('drops', t + 0.1, t + 1.2, p.gain(0.4, e));
      thump(p, t, out, 120, 60, 0.4, 0.05, 0.3);
      return 1.3;
    },
  },
  hedgehog_launch: {
    bus: 'air', ref: 250, range: 2500, gain: 0.6,
    synth: (p, t, out) => {
      // the ripple of 24 spigot bombs leaving in quick pairs
      for (let i = 0; i < 12; i++) {
        const tt = t + i * 0.045 + p.rand(0, 0.01);
        thump(p, tt, out, 200 + p.rand(-20, 20), 120, 0.35, 0.03, 0.15);
        burst(p, tt, out, 'white', 'bandpass', 1300, 1, 0.25, 0.001, 0.02, 0.1);
      }
      return 1.1;
    },
  },
  hedgehog_hit: {
    bus: 'water', ref: 400, range: 3500, gain: 0.8,
    synth: (p, t, out) => {
      burst(p, t, out, 'white', 'bandpass', 2400, 1.2, 0.9, 0.001, 0.02, 0.2);
      thump(p, t, out, 80, 40, 0.8, 0.25, 1.3);
      out.connect(p.send('sea', 0.6));
      return 1.6;
    },
  },
  star_shell_pop: {
    bus: 'air', ref: 400, range: 3000, gain: 0.5,
    synth: (p, t, out) => {
      burst(p, t, out, 'white', 'bandpass', 1200, 0.9, 0.9, 0.001, 0.025, 0.2);
      const f = p.gain(0, out);
      ahr(f.gain, t + 0.05, 0.25, 0.1, 0.6, 1);
      p.noise('white', t + 0.05, t + 2, p.bq('highpass', 4000, 0.7, f));
      out.connect(p.send('sky', 0.7));
      return 2.1;
    },
  },
  hull_creak: {
    bus: 'interior', ref: 0, range: 0, gain: 0.5,
    synth: (p, t, out) => {
      const e = p.gain(0, out);
      ahr(e.gain, t, 0.6, 0.15, 0.6, 0.8);
      const f0 = p.rand(70, 120);
      const bp = p.bq('bandpass', f0 * 4, 8, e);
      const o = p.osc('sawtooth', f0, t, t + 1.8, bp);
      glide(o.frequency, t, f0, f0 * p.rand(0.7, 1.3), 1.5);
      e.connect(p.send('hull', 0.7));
      return 1.9;
    },
  },
  hull_groan: {
    bus: 'interior', ref: 0, range: 0, gain: 0.6,
    synth: (p, t, out) => {
      const e = p.gain(0, out);
      ahr(e.gain, t, 0.7, 0.5, 1.2, 1.2);
      const f0 = p.rand(38, 55);
      const sh = p.shape(driveCurve(2), p.bq('lowpass', 500, 2, e));
      const o = p.osc('sawtooth', f0, t, t + 3.2, sh);
      glide(o.frequency, t, f0, f0 * 0.7, 2.8);
      p.noise('brown', t, t + 3.2, p.gain(0.3, e));
      e.connect(p.send('hull', 0.8));
      return 3.3;
    },
  },
  crush_rumble: {
    bus: 'interior', ref: 0, range: 0, gain: 0.8,
    synth: (p, t, out) => {
      const e = p.gain(0, out);
      ahr(e.gain, t, 0.9, 0.3, 2, 1.5);
      p.noise('brown', t, t + 4, p.bq('lowpass', 220, 1, e));
      for (let i = 0; i < 4; i++) modal(p, t + 0.4 + i * 0.7, p.gain(0.25, e), p.rand(180, 600), [1, 1.7, 2.9], 0.4, 0.5, 1.5);
      e.connect(p.send('hull', 0.8));
      return 4.2;
    },
  },
  dive_alarm: {
    bus: 'interior', ref: 0, range: 0, gain: 0.35,
    synth: (p, t, out) => {
      // electric alarm bell: a fast-struck bell tone
      const e = p.gain(0, p.bq('bandpass', 1800, 1.5, out));
      e.gain.setValueAtTime(0, t);
      for (let k = 0; k < 40; k++) { const tt = t + k / 26; e.gain.setValueAtTime(0.9, tt); e.gain.setTargetAtTime(0.15, tt + 0.004, 0.012); }
      e.gain.setTargetAtTime(0, t + 1.55, 0.05);
      p.osc('square', 1850, t, t + 1.8, e);
      p.osc('square', 2600, t, t + 1.8, p.gain(0.4, e));
      return 1.8;
    },
  },
  telegraph_bell: {
    bus: 'interior', ref: 0, range: 0, gain: 0.4,
    synth: (p, t, out) => {
      for (let i = 0; i < 2; i++) modal(p, t + i * 0.22, out, 1180, [1, 2.76, 5.4], 0.6, 0.35, 1.2);
      out.connect(p.send('hull', 0.4));
      return 1.4;
    },
  },
  blow_ballast: {
    bus: 'interior', ref: 0, range: 0, gain: 0.6,
    synth: (p, t, out) => {
      const e = p.gain(0, out);
      ahr(e.gain, t, 0.9, 0.12, 1.4, 1.2);
      p.noise('white', t, t + 3, p.bq('bandpass', 1300, 0.6, e));
      p.noise('bubbles', t + 0.3, t + 3, p.gain(0.6, e), 0.7);
      return 3;
    },
  },
  flood_vents: {
    bus: 'interior', ref: 0, range: 0, gain: 0.55,
    synth: (p, t, out) => {
      const e = p.gain(0, out);
      ahr(e.gain, t, 0.9, 0.05, 0.9, 1.2);
      const lp = p.bq('lowpass', 3200, 0.7, e);
      p.noise('pink', t, t + 2.6, lp);
      glide(lp.frequency, t, 3200, 500, 2);
      p.noise('bubbles', t + 0.2, t + 2.6, p.gain(0.5, e), 1.3);
      return 2.6;
    },
  },
  ramming_crunch: {
    bus: 'air', ref: 300, range: 2500, gain: 0.9,
    synth: (p, t, out) => {
      thump(p, t, out, 70, 35, 1, 0.3, 1.5);
      const e = p.gain(0, out);
      ahr(e.gain, t, 0.8, 0.01, 0.6, 1.2);
      const sh = p.shape(driveCurve(4), e);
      p.noise('crackle', t, t + 2.4, p.bq('bandpass', 700, 2, sh));
      p.noise('white', t, t + 2.4, p.bq('bandpass', 2200, 3, p.gain(0.4, sh)));
      modal(p, t, p.gain(0.3, out), 210, [1, 2.2, 3.7], 0.6, 0.6, 2);
      return 2.5;
    },
  },
  metal_impact: {
    bus: 'air', ref: 250, range: 2500, gain: 0.6,
    synth: (p, t, out) => {
      burst(p, t, out, 'white', 'highpass', 2500, 0.7, 0.6, 0.0005, 0.01, 0.08);
      modal(p, t, out, 310, [1, 2.54, 4.61, 7.13], 0.7, 0.5, 2);
      out.connect(p.send('hull', 0.4));
      return 2;
    },
  },
  splash_small: {
    bus: 'air', ref: 80, range: 800, gain: 0.4,
    synth: (p, t, out) => {
      burst(p, t, out, 'pink', 'bandpass', 1600, 0.8, 0.7, 0.003, 0.08, 0.5);
      p.noise('drops', t + 0.05, t + 0.6, p.gain(0.3, out));
      return 0.6;
    },
  },
  splash_big: {
    bus: 'air', ref: 200, range: 2000, gain: 0.7,
    synth: (p, t, out) => {
      thump(p, t, out, 90, 45, 0.6, 0.12, 0.6);
      const e = p.gain(0, out);
      ahr(e.gain, t, 0.9, 0.01, 0.3, 1.3);
      const lp = p.bq('lowpass', 2800, 0.6, e);
      p.noise('brown', t, t + 1.8, lp);
      p.noise('pink', t, t + 1.8, p.gain(0.5, lp));
      glide(lp.frequency, t, 2800, 500, 1.5);
      return 1.8;
    },
  },
  wave_slap: {
    bus: 'air', ref: 60, range: 400, gain: 0.4,
    synth: (p, t, out) => {
      burst(p, t, out, 'pink', 'lowpass', 900, 0.7, 0.8, 0.01, 0.12, 0.5);
      return 0.5;
    },
  },
  loot_drop: {
    bus: 'ui', ref: 0, range: 0, gain: 0.35,
    synth: (p, t, out) => {
      modal(p, t, out, 880, [1, 3.01], 0.5, 0.3, 0.8);
      modal(p, t + 0.09, out, 1320, [1, 3.01], 0.5, 0.35, 0.9);
      return 1;
    },
  },
  loot_legendary: {
    bus: 'ui', ref: 0, range: 0, gain: 0.4,
    synth: (p, t, out) => {
      [587, 740, 880, 1175].forEach((f, i) => modal(p, t + i * 0.11, out, f, [1, 2.01, 3.02], 0.45, 0.6, 1.8));
      const s = p.gain(0, out);
      ahr(s.gain, t + 0.3, 0.12, 0.4, 0.4, 1);
      p.noise('white', t + 0.3, t + 2.2, p.bq('highpass', 6000, 0.7, s));
      return 2.3;
    },
  },
  level_up: {
    bus: 'ui', ref: 0, range: 0, gain: 0.35,
    synth: (p, t, out) => {
      [392, 523, 659, 784].forEach((f, i) => {
        const e = p.gain(0, p.bq('lowpass', 2500, 0.8, out));
        ahr(e.gain, t + i * 0.12, 0.4, 0.02, i === 3 ? 0.5 : 0.08, 0.5);
        p.osc('sawtooth', f, t + i * 0.12, t + 1.6, e);
        p.osc('sawtooth', f * 1.005, t + i * 0.12, t + 1.6, e);
      });
      return 1.7;
    },
  },
  ui_click: {
    bus: 'ui', ref: 0, range: 0, gain: 0.45,
    synth: (p, t, out) => { const e = p.gain(0, out); perc(e.gain, t, 0.6, 0.0005, 0.008); p.osc('square', 1900, t, t + 0.06, p.bq('bandpass', 2000, 2, e)); return 0.08; },
  },
  ui_hover: {
    bus: 'ui', ref: 0, range: 0, gain: 0.25,
    synth: (p, t, out) => { const e = p.gain(0, out); perc(e.gain, t, 0.5, 0.0005, 0.005); p.osc('sine', 3200, t, t + 0.04, e); return 0.05; },
  },
  ui_back: {
    bus: 'ui', ref: 0, range: 0, gain: 0.25,
    synth: (p, t, out) => {
      [880, 660].forEach((f, i) => { const e = p.gain(0, out); perc(e.gain, t + i * 0.07, 0.5, 0.002, 0.04); p.osc('triangle', f, t + i * 0.07, t + 0.3, e); });
      return 0.32;
    },
  },
  ui_error: {
    bus: 'ui', ref: 0, range: 0, gain: 0.25,
    synth: (p, t, out) => {
      const e = p.gain(0, p.bq('lowpass', 1400, 0.7, out));
      ahr(e.gain, t, 0.6, 0.005, 0.18, 0.08);
      p.osc('square', 140, t, t + 0.3, e);
      p.osc('square', 147, t, t + 0.3, e);
      return 0.32;
    },
  },
  contract_complete: {
    bus: 'ui', ref: 0, range: 0, gain: 0.3,
    synth: (p, t, out) => {
      [294, 370, 440, 587].forEach((f) => {
        const e = p.gain(0, p.bq('lowpass', 1800, 0.7, out));
        ahr(e.gain, t, 0.3, 0.5, 0.8, 1.2);
        p.osc('sawtooth', f, t, t + 2.6, e, -6);
        p.osc('sawtooth', f, t, t + 2.6, e, 6);
      });
      return 2.6;
    },
  },
  radio_static: {
    bus: 'chatter', ref: 0, range: 0, gain: 0.3,
    synth: (p, t, out) => {
      const e = p.gain(0, out);
      ahr(e.gain, t, 0.7, 0.01, 0.55, 0.2);
      const sh = p.shape(driveCurve(3), p.bq('bandpass', 2400, 0.8, e));
      p.noise('white', t, t + 0.9, p.gain(0.4, sh));
      p.noise('crackle', t, t + 0.9, sh);
      return 0.9;
    },
  },
  morse_burst: {
    bus: 'chatter', ref: 0, range: 0, gain: 0.25,
    synth: (p, t, out) => {
      const e = p.gain(0, out);
      e.gain.setValueAtTime(0, t);
      let tt = t;
      for (let i = 0; i < 12; i++) {
        const len = p.rnd() < 0.4 ? 0.18 : 0.06;
        e.gain.setValueAtTime(0.7, tt); e.gain.setValueAtTime(0, tt + len);
        tt += len + 0.06 + (p.rnd() < 0.2 ? 0.12 : 0);
      }
      p.osc('sine', 720, t, tt + 0.05, e);
      p.noise('white', t, tt + 0.05, p.bq('bandpass', 2000, 0.6, p.gain(0.04, out)));
      return tt - t + 0.1;
    },
  },
  aircraft_pass: {
    bus: 'air', ref: 1200, range: 6000, gain: 0.5,
    synth: (p, t, out, o) => {
      const e = p.gain(0, p.bq('lowpass', 900, 0.7, out));
      ahr(e.gain, t, 0.7, 1.8, 0.3, 1.8);
      for (const [f, g] of [[88, 0.6], [176, 0.3], [262, 0.15]] as const) {
        const osc = p.osc('sawtooth', f * o.pitch * 1.08, t, t + 4.2, p.gain(g, e));
        glide(osc.frequency, t + 1.6, f * o.pitch * 1.08, f * o.pitch * 0.9, 0.8);
      }
      p.noise('pink', t, t + 4.2, p.bq('bandpass', 400, 0.6, p.gain(0.3, e)));
      return 4.2;
    },
  },
  whistle_signal: {
    bus: 'chatter', ref: 600, range: 5000, gain: 0.4,
    synth: (p, t, out) => {
      const e = p.gain(0, p.bq('bandpass', 600, 1.2, out));
      ahr(e.gain, t, 0.7, 0.08, 1.3, 0.3);
      p.osc('sawtooth', 182, t, t + 1.8, e, -8);
      p.osc('sawtooth', 182, t, t + 1.8, e, 9);
      p.osc('sawtooth', 273, t, t + 1.8, p.gain(0.4, e));
      out.connect(p.send('sky', 0.6));
      return 1.8;
    },
  },
  bubbles: {
    bus: 'water', ref: 120, range: 1000, gain: 0.5,
    synth: (p, t, out) => { const e = p.gain(0, out); ahr(e.gain, t, 0.8, 0.05, 0.9, 0.6); p.noise('bubbles', t, t + 1.7, e); return 1.7; },
  },
  decoy_fizz: {
    bus: 'water', ref: 300, range: 2500, gain: 0.5,
    synth: (p, t, out) => {
      const e = p.gain(0, out);
      ahr(e.gain, t, 0.8, 0.05, 2.2, 0.8);
      p.noise('bubbles', t, t + 3.2, e, 1.4);
      p.noise('white', t, t + 3.2, p.bq('highpass', 3000, 0.7, p.gain(0.3, e)));
      return 3.2;
    },
  },
  klaxon: {
    bus: 'interior', ref: 0, range: 0, gain: 0.35,
    synth: (p, t, out) => {
      for (let i = 0; i < 3; i++) {
        const tt = t + i * 0.8;
        const e = p.gain(0, p.bq('bandpass', 700, 1, out));
        ahr(e.gain, tt, 0.8, 0.03, 0.45, 0.1);
        const o = p.osc('sawtooth', 220, tt, tt + 0.7, p.shape(driveCurve(2), e));
        glide(o.frequency, tt, 220, 340, 0.4);
      }
      return 2.4;
    },
  },
  ship_sinking: {
    bus: 'air', ref: 600, range: 5000, gain: 0.8,
    synth: (p, t, out) => {
      const e = p.gain(0, out);
      ahr(e.gain, t, 0.8, 1, 3, 2);
      const o = p.osc('sawtooth', 48, t, t + 6, p.shape(driveCurve(2), p.bq('lowpass', 350, 2, e)));
      glide(o.frequency, t, 48, 30, 5);
      p.noise('brown', t, t + 6, p.bq('lowpass', 400, 0.7, p.gain(0.6, e)));
      p.noise('bubbles', t + 1, t + 6, p.gain(0.5, e), 0.6);
      for (let i = 0; i < 3; i++) modal(p, t + 0.8 + i * 1.4, p.gain(0.2, out), p.rand(150, 400), [1, 2.3, 3.9], 0.5, 0.7, 2);
      out.connect(p.send('sea', 0.5));
      return 6;
    },
  },
  fire_crackle: {
    bus: 'air', ref: 120, range: 900, gain: 0.4,
    synth: (p, t, out) => {
      const e = p.gain(0, out);
      ahr(e.gain, t, 0.8, 0.1, 1.4, 0.5);
      p.noise('crackle', t, t + 2, p.bq('bandpass', 2600, 0.7, e));
      p.noise('brown', t, t + 2, p.bq('lowpass', 300, 0.7, p.gain(0.5, e)));
      return 2;
    },
  },
};
export const SOUNDS = S;
export const SOUND_IDS = Object.keys(S) as SoundId[];

// ------------------------------------------------------------------ loops
export interface LoopCtl {
  /** pitch multiplier 0.25..4 (engine speed, wind strength…) */
  setPitch(p: number, t: number): void;
  /** optional brightness 0..1 */
  setFilter?(f: number, t: number): void;
}
export interface LoopDef { bus: BusId; ref: number; gain: number; build: (p: Patch, t: number, out: AudioNode) => LoopCtl }

const INF = Infinity;
const LOOPS: Record<LoopId, LoopDef> = {
  sea: {
    bus: 'ambAir', ref: 0, gain: 0.5,
    build: (p, t, out) => {
      // slow swells: a low surf bed, a brighter wash breathing with a random modulator
      const bed = p.bq('lowpass', 420, 0.7, out);
      p.noise('brown', t, INF, bed);
      const wash = p.gain(0.25, out);
      const wf = p.bq('bandpass', 900, 0.5, wash);
      p.noise('pink', t, INF, wf);
      const m = p.gain(0.2, wash.gain);
      p.noise('mod', t, INF, m, 0.08);
      p.noise('drops', t, INF, p.gain(0.08, out), 0.8);
      return {
        setPitch: (k, tt) => { bed.frequency.setTargetAtTime(260 + 260 * k, tt, 0.5); wf.frequency.setTargetAtTime(600 + 600 * k, tt, 0.5); wash.gain.setTargetAtTime(0.1 + 0.3 * k, tt, 0.5); },
        setFilter: (f, tt) => bed.frequency.setTargetAtTime(200 + 600 * f, tt, 0.5),
      };
    },
  },
  rain: {
    bus: 'ambAir', ref: 0, gain: 0.35,
    build: (p, t, out) => {
      const hp = p.bq('bandpass', 5000, 0.4, out);
      p.noise('white', t, INF, hp);
      p.noise('drops', t, INF, p.gain(0.5, out), 1.2);
      return { setPitch: (k, tt) => hp.frequency.setTargetAtTime(3500 + 2500 * k, tt, 0.4) };
    },
  },
  wind: {
    bus: 'ambAir', ref: 0, gain: 0.35,
    build: (p, t, out) => {
      const bp = p.bq('bandpass', 600, 1.8, out);
      p.noise('pink', t, INF, bp);
      const m = p.gain(250, bp.frequency);
      p.noise('mod', t, INF, m, 0.15);
      return { setPitch: (k, tt) => { bp.frequency.setTargetAtTime(350 + 450 * k, tt, 0.8); m.gain.setTargetAtTime(120 + 300 * k, tt, 0.8); } };
    },
  },
  engine_steam: {
    bus: 'air', ref: 0, gain: 0.3,
    build: (p, t, out) => {
      const lp = p.bq('lowpass', 900, 0.8, out);
      const whine = p.osc('triangle', 240, t, INF, p.gain(0.25, lp));
      const hum = p.osc('sawtooth', 60, t, INF, p.gain(0.3, p.bq('lowpass', 200, 1, out)));
      const thr = p.gain(0.6, out);
      const shaft = p.wave(p.bank.beat, 3, t, INF, thr.gain);
      p.noise('brown', t, INF, p.bq('lowpass', 300, 0.7, thr));
      return {
        setPitch: (k, tt) => {
          whine.frequency.setTargetAtTime(160 + 220 * k, tt, 0.3);
          hum.frequency.setTargetAtTime(45 + 30 * k, tt, 0.3);
          shaft.frequency.setTargetAtTime(1.5 + 3.5 * k, tt, 0.3);
        },
      };
    },
  },
  engine_diesel: {
    bus: 'air', ref: 0, gain: 0.35,
    build: (p, t, out) => {
      const lp = p.bq('lowpass', 420, 1.2, out);
      const fire = p.wave(p.bank.pulse, 16, t, INF, lp);
      const chug = p.gain(0.4, out);
      const am = p.wave(p.bank.beat, 8, t, INF, chug.gain);
      p.noise('brown', t, INF, p.bq('lowpass', 500, 0.7, chug));
      return {
        setPitch: (k, tt) => { fire.frequency.setTargetAtTime(9 + 14 * k, tt, 0.4); am.frequency.setTargetAtTime(4.5 + 7 * k, tt, 0.4); },
      };
    },
  },
  engine_electric: {
    bus: 'interior', ref: 0, gain: 0.2,
    build: (p, t, out) => {
      const a = p.osc('sine', 50, t, INF, p.gain(0.5, out));
      const b = p.osc('sine', 100, t, INF, p.gain(0.3, out));
      const w = p.osc('sine', 420, t, INF, p.gain(0.05, out));
      return {
        setPitch: (k, tt) => { const f = 40 + 30 * k; a.frequency.setTargetAtTime(f, tt, 0.3); b.frequency.setTargetAtTime(f * 2, tt, 0.3); w.frequency.setTargetAtTime(300 + 500 * k, tt, 0.3); },
      };
    },
  },
  cavitation: {
    bus: 'water', ref: 0, gain: 0.35,
    build: (p, t, out) => {
      const bp = p.bq('bandpass', 3200, 0.8, out);
      p.noise('crackle', t, INF, bp, 1.3);
      p.noise('bubbles', t, INF, p.gain(0.4, out), 1.6);
      return { setPitch: (k, tt) => bp.frequency.setTargetAtTime(2200 + 1500 * k, tt, 0.3) };
    },
  },
  fire: {
    bus: 'air', ref: 100, gain: 0.4,
    build: (p, t, out) => {
      p.noise('crackle', t, INF, p.bq('bandpass', 2400, 0.7, out));
      const roar = p.bq('lowpass', 320, 0.7, p.gain(0.6, out));
      p.noise('brown', t, INF, roar);
      return { setPitch: (k, tt) => roar.frequency.setTargetAtTime(200 + 250 * k, tt, 0.5) };
    },
  },
  underwater: {
    bus: 'ambDeep', ref: 0, gain: 0.35,
    build: (p, t, out) => {
      const lp = p.bq('lowpass', 180, 0.8, out);
      p.noise('brown', t, INF, lp);
      p.noise('bubbles', t, INF, p.gain(0.06, out), 0.5);
      const m = p.gain(60, lp.frequency);
      p.noise('mod', t, INF, m, 0.05);
      return { setPitch: (k, tt) => lp.frequency.setTargetAtTime(120 + 120 * k, tt, 1) };
    },
  },
  hydrophone_noise: {
    bus: 'ambDeep', ref: 0, gain: 0.15,
    build: (p, t, out) => {
      const bp = p.bq('bandpass', 700, 0.5, out);
      p.noise('pink', t, INF, bp);
      return { setPitch: (k, tt) => bp.frequency.setTargetAtTime(500 + 400 * k, tt, 0.5) };
    },
  },
  torpedo_run: {
    bus: 'water', ref: 150, gain: 0.35,
    build: (p, t, out) => {
      const o = p.osc('sawtooth', 420, t, INF, p.bq('bandpass', 900, 2, out));
      p.noise('white', t, INF, p.bq('bandpass', 3000, 1, p.gain(0.2, out)));
      return { setPitch: (k, tt) => o.frequency.setTargetAtTime(420 * k, tt, 0.1) };
    },
  },
};
export const LOOP_DEFS = LOOPS;
export const LOOP_IDS = Object.keys(LOOPS) as LoopId[];
