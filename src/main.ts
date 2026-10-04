// Boot: init Rapier (WASM) and WebGL2, then hand over to the app.
// URL parameters override arena settings for quick testing, e.g. ?side=uboat&hour=12&seaState=6
import RAPIER from '@dimforge/rapier3d-compat';
import { App } from './app';
import { arena } from './game/arenaConfig';

async function boot() {
  const msg = document.getElementById('boot-msg')!;
  try {
    await RAPIER.init();
    msg.textContent = 'Building ships…';
    await new Promise((r) => setTimeout(r, 10));
    const app = new App(document.getElementById('stage')!);
    const params = new URLSearchParams(location.search);
    const overrides: Record<string, number | string | boolean> = {};
    for (const [k, v] of params) {
      const key = k.startsWith('arena.') ? k : 'arena.' + k;
      if (!arena.byKey.has(key)) continue;
      overrides[key] = v === 'true' ? true : v === 'false' ? false : isFinite(Number(v)) && v.trim() !== '' ? Number(v) : v;
    }
    app.startMission(overrides);
    app.start();
    document.getElementById('boot')!.classList.add('gone');
  } catch (e) {
    console.error(e);
    msg.innerHTML = `<div class="boot-err">${String((e as Error).message ?? e)}</div>`;
  }
}

boot();
