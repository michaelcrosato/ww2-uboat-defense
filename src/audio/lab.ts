// Audio lab: buttons for every sound / loop / music state, plus an offline self-test that renders each
// SoundId and LoopId through an OfflineAudioContext with the engine's own graphs and checks levels.
// window.__audioTest resolves to [{ id, rms, peak, ok }].

import { AudioEngine, audio, type LoopHandle } from './audio';
import { LOOP_IDS, SOUND_IDS } from './sounds';
import type { MusicState } from './music';

interface Res { id: string; rms: number; peak: number; ok: boolean }
const SR = 44100;
const FULL = () => ({ master: 1, sfx: 1, ambience: 1, music: 1, chatter: true });

async function render(seconds: number, build: (e: AudioEngine) => void): Promise<Res & { nan: boolean }> {
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * seconds), SR);
  const e = new AudioEngine();
  e.volumes = FULL;
  e.attach(ctx);
  build(e);
  const buf = await ctx.startRendering();
  // rms = loudest 50 ms window (short UI ticks and long booms are judged alike)
  let peak = 0, nan = false, rms = 0;
  const win = Math.floor(SR * 0.05);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    let sum = 0;
    for (let i = 0; i < d.length; i++) {
      const v = d[i];
      if (!Number.isFinite(v)) { nan = true; continue; }
      sum += v * v;
      if (i >= win) { const o = d[i - win]; if (Number.isFinite(o)) sum -= o * o; }
      if (i >= win - 1) rms = Math.max(rms, Math.sqrt(Math.max(0, sum) / win));
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
  }
  return { id: '', rms, peak, nan, ok: !nan && rms > 2e-3 && peak <= 1 };
}

async function selfTest(): Promise<Res[]> {
  const out: Res[] = [];
  for (const id of SOUND_IDS) {
    const r = await render(3, (e) => e.play(id));
    out.push({ ...r, id });
  }
  for (const id of LOOP_IDS) {
    const r = await render(1.5, (e) => { e.loop(id, { vol: 1, pitch: 0.7 }); });
    out.push({ ...r, id: 'loop:' + id });
  }
  for (const st of ['menu', 'calm', 'tension', 'combat', 'victory', 'defeat'] as MusicState[]) {
    const r = await render(4, (e) => { e.setMusic(st); e.update(0, 4); });
    out.push({ ...r, id: 'music:' + st });
  }
  return out;
}

function ui() {
  const add = (parent: string, label: string, fn: (b: HTMLButtonElement) => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => { audio.unlock(); fn(b); };
    document.getElementById(parent)!.append(b);
  };
  for (const id of SOUND_IDS) add('sounds', id, () => audio.play(id, { x: 0, y: 0 }));
  const live = new Map<string, LoopHandle>();
  for (const id of LOOP_IDS) add('loops', id, (b) => {
    const h = live.get(id);
    if (h) { h.stop(); live.delete(id); b.classList.remove('on'); }
    else { live.set(id, audio.loop(id, { pitch: 0.7 })); b.classList.add('on'); }
  });
  for (const st of ['off', 'menu', 'calm', 'tension', 'combat', 'victory', 'defeat'] as MusicState[]) add('music', st, () => audio.setMusic(st));
  addEventListener('pointerdown', () => audio.unlock());
  const tick = () => { audio.update(1 / 60); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}

ui();
const test = selfTest().then((res) => {
  const bad = res.filter((r) => !r.ok);
  document.getElementById('status')!.textContent = `self-test: ${res.length - bad.length}/${res.length} ok`;
  document.getElementById('results')!.innerHTML = res.map((r) =>
    `<span class="${r.ok ? 'ok' : 'bad'}">${r.ok ? 'ok ' : 'BAD'}</span> ${r.id.padEnd(26)} rms ${r.rms.toFixed(4)}  peak ${r.peak.toFixed(3)}`).join('\n');
  return res.map((r) => ({ id: r.id, rms: +r.rms.toFixed(5), peak: +r.peak.toFixed(4), ok: r.ok }));
});
(window as unknown as { __audioTest: Promise<Res[]> }).__audioTest = test;
