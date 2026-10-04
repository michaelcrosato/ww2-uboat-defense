// Boot: init Rapier (WASM), pick a render backend (WebGPU → WebGL2 fallback), then hand over to the app.
// URL parameters override arena settings for quick testing, e.g. ?side=uboat&hour=12&seaState=6
import RAPIER from '@dimforge/rapier3d-compat';
import { App } from './app';
import { arena } from './game/arenaConfig';
import { dev } from './core/devSettings';
import { fx } from './core/math';
import { Screen } from './render/screen';
import { createBackend, parseBackendPref } from './render/backend';

const urlValue = (v: string): number | string | boolean =>
  v === 'true' ? true : v === 'false' ? false : isFinite(Number(v)) && v.trim() !== '' ? Number(v) : v;

async function boot() {
  const msg = document.getElementById('boot-msg')!;
  try {
    await RAPIER.init();
    msg.textContent = 'Building ships…';
    await new Promise((r) => setTimeout(r, 10));
    const params = new URLSearchParams(location.search);
    // test hooks: reproducible cosmetics, transient dev settings (never persisted), frozen time
    if (params.has('fxseed')) fx.reseed(Number(params.get('fxseed')) || params.get('fxseed')!);
    for (const [k, v] of params) if (k.startsWith('dev.')) dev.set(k.slice(4), urlValue(v), false);
    const screen = new Screen(document.getElementById('stage')!, dev);
    const backend = await createBackend(screen, parseBackendPref(params.get('renderer') ?? dev.str('display.renderer')),
      { gpuFail: params.get('gpufail') === '1', gpuReadback: params.get('gpupresent') === 'readback', testPattern: params.get('testpattern') === '1' });
    const app = new App(screen, backend);
    app.frozen = params.get('freeze') === '1';
    const overrides: Record<string, number | string | boolean> = {};
    for (const [k, v] of params) {
      const key = k.startsWith('arena.') ? k : 'arena.' + k;
      if (!arena.byKey.has(key)) continue;
      overrides[key] = urlValue(v);
    }
    if (params.get('scene') === 'lookdev') app.startLookdev(overrides, Number(params.get('frames')) || 40);
    else app.startMission(overrides);
    app.start();
    document.getElementById('boot')!.classList.add('gone');
  } catch (e) {
    console.error(e);
    msg.innerHTML = `<div class="boot-err">${String((e as Error).message ?? e)}</div>`;
  }
}

boot();
