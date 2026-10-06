// Boot: init Rapier (WASM), pick a render backend (WebGPU → WebGL2 fallback), then hand over to the app.
// With no parameters the title screen opens over the attract mode. URL parameters that set arena
// values jump straight into a mission (tests), e.g. ?side=uboat&hour=12&seaState=6, and
// ?menu=title|arena|dev|settings|controls|credits|pause|end|tutorial|battles (+ &tab=Lighting) opens a screen directly,
// ?tutorial=uboat|escort starts a lesson.
import RAPIER from '@dimforge/rapier3d-compat';
import { App } from './app';
import { arena } from './game/arenaConfig';
import { dev } from './core/devSettings';
import { fx } from './core/math';
import { Screen } from './render/screen';
import { createBackend, parseBackendPref } from './render/backend';
import { Shell, type MenuId } from './ui/shell';
import { showFatal } from './ui/dom';

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
      { gpuFail: params.get('gpufail') === '1', gpuReadback: params.get('gpupresent') === 'readback', testPattern: params.get('testpattern') === '1',
        glFail: params.get('glfail') === '1', gpuLose: Number(params.get('gpulose')) || 0 });
    const app = new App(screen, backend);
    app.frozen = params.get('freeze') === '1';
    const overrides: Record<string, number | string | boolean> = {};
    for (const [k, v] of params) {
      const key = k.startsWith('arena.') ? k : 'arena.' + k;
      if (!arena.byKey.has(key)) continue;
      overrides[key] = urlValue(v);
    }
    const menu = params.get('menu') as MenuId | null;
    if (params.get('scene') === 'lookdev') app.startLookdev(overrides, Number(params.get('frames')) || 40);
    else if (params.get('scene') === 'fleet') app.startFleet(overrides);
    else if (params.get('scene') === 'pacific') app.startFleet({ 'arena.theater': 'pacific', ...overrides }, true);
    else {
      const shell = new Shell(app);
      const inMission = Object.keys(overrides).length > 0 || menu === 'pause' || menu === 'end';
      if (params.has('faction')) shell.career.faction = params.get('faction') === 'uboat' ? 'uboat' : 'escort';
      const lesson = params.get('tutorial');
      if (lesson === 'uboat' || lesson === 'escort') shell.launchTutorial(lesson);
      else if (inMission) shell.launch(overrides, 'test'); else shell.openTitle();
      if (menu && menu !== 'title') shell.open(menu, params.get('tab') ?? undefined);
    }
    app.start();
    document.getElementById('boot')!.classList.add('gone');
  } catch (e) {
    console.error(e);
    showFatal(String((e as Error).message ?? e));
  }
}

boot();
