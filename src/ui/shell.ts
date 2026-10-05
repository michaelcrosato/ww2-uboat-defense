// UI shell: owns the DOM screen stack and the boot flow between menus, the attract-mode backdrop
// and missions. Routes menu input, pause / F1 / fullscreen hotkeys, and keeps `app.menuOpen` true
// while a menu covers a real mission so the simulation halts underneath.

import type { App } from '../app';
import type { Mission } from '../game/mission';
import { arena } from '../game/arenaConfig';
import { audio } from '../audio/audio';
import { Ui } from './dom';
import { TouchOverlay } from './touch';
import { titleScreen, creditsScreen } from './screens/title';
import { arenaScreen } from './screens/arenaSetup';
import { devScreen } from './screens/devSettings';
import { settingsScreen } from './screens/settings';
import { pauseScreen } from './screens/pause';
import { controlsScreen } from './screens/controls';
import { missionEndScreen } from './screens/missionEnd';
import { factionScreen, portScreen } from './screens/port';
import { afterActionScreen } from './screens/afterAction';
import { tutorialScreen } from './screens/tutorial';
import { TUTORIAL_ARENA, tutorialStats, type TutorialSide } from '../game/tutorial';
import { Career } from '../game/career';
import type { Contract } from '../meta/index.ts';

export type MenuId = 'title' | 'arena' | 'dev' | 'settings' | 'controls' | 'credits' | 'pause' | 'end' | 'port' | 'faction' | 'tutorial';

/** attract-mode looks, picked at random each time the backdrop restarts */
const ATTRACT: Record<string, number | string | boolean>[] = [
  { 'arena.hour': 17.5, 'arena.weather': 'overcast', 'arena.seaState': 4, 'arena.theater': 'north_atlantic' },
  { 'arena.hour': 22.5, 'arena.weather': 'clear', 'arena.seaState': 3, 'arena.moon': 0.5, 'arena.theater': 'north_atlantic' },
  { 'arena.hour': 9, 'arena.weather': 'clear', 'arena.seaState': 3, 'arena.theater': 'mediterranean' },
  { 'arena.hour': 6.5, 'arena.weather': 'fog', 'arena.seaState': 2, 'arena.theater': 'north_atlantic' },
];

export class Shell {
  readonly ui: Ui;
  readonly touch: TouchOverlay;
  readonly career = new Career();
  /** what the current mission counts as: a contract, arena free play, a tutorial, or a URL test mission */
  private mode: 'career' | 'arena' | 'tutorial' | 'test' = 'test';
  private attractIdx = Math.floor(Math.random() * ATTRACT.length);

  constructor(readonly app: App) {
    const root = document.getElementById('ui')!;
    this.ui = new Ui(root, app.input);
    this.touch = new TouchOverlay(this);
    app.onFrame.push((dt) => this.update(dt));
    addEventListener('keydown', (e) => {
      if (e.code === 'F11' || (e.code === 'Enter' && e.altKey)) { e.preventDefault(); void app.screen.toggleFullscreen(); return; }
      if (e.code === 'F1') { e.preventDefault(); this.toggleDev(); }
    });
    (window as unknown as { __shell: Shell }).__shell = this;
  }

  /** a mission the player is commanding (not the attract backdrop) */
  get playing(): Mission | null { const m = this.app.mission; return m && !m.spectator ? m : null; }

  // ---------------------------------------------------------------- flow
  startAttract() {
    this.attractIdx = (this.attractIdx + 1) % ATTRACT.length;
    const look = ATTRACT[this.attractIdx];
    this.app.startMission({
      ...look, 'arena.side': 'escort', 'arena.seed': 1 + Math.floor(Math.random() * 99998), 'arena.convoy': 9, 'arena.escorts': 4,
      'arena.uboats': 3, 'arena.timeFlow': 0, 'arena.aircraft': 'gap', 'arena.islands': 0, 'arena.size': 9,
    }, { spectator: true, onEnd: () => { if (this.app.mission?.spectator) this.startAttract(); } });
    audio.setMusic('menu');
  }

  /** menus need something behind them: keep a running mission, else the attract backdrop */
  ensureBackdrop() { if (!this.app.mission) this.startAttract(); }

  openTitle() {
    this.ui.clear();
    if (!this.app.mission || !this.app.mission.spectator) this.startAttract();
    this.ui.push(titleScreen(this));
  }

  open(id: MenuId, arg?: string) {
    switch (id) {
      case 'title': this.openTitle(); return;
      case 'arena': this.ui.push(arenaScreen(this)); return;
      case 'dev': this.ui.push(devScreen(this, arg)); return;
      case 'settings': this.ui.push(settingsScreen(this)); return;
      case 'controls': this.ui.push(controlsScreen(this)); return;
      case 'credits': this.ui.push(creditsScreen(this)); return;
      case 'tutorial': this.ui.push(tutorialScreen(this)); return;
      case 'pause': if (this.playing) this.ui.push(pauseScreen(this)); return;
      case 'end': if (this.app.mission) this.ui.push(missionEndScreen(this, this.app.mission)); return;
      case 'faction': this.ui.push(factionScreen(this, () => this.open('port'))); return;
      case 'port':
        this.ensureBackdrop();
        if (!this.career.faction) this.open('faction');
        else this.ui.push(portScreen(this));
        return;
    }
  }

  /** start a mission from the arena store (+ overrides); menus close */
  launch(overrides: Record<string, number | string | boolean> = {}, mode: 'arena' | 'test' = 'arena') {
    this.mode = mode;
    this.ui.clear();
    this.app.startMission(overrides, { onEnd: (m) => this.onMissionEnd(m) });
    this.app.paused = false;
  }
  /** a guided lesson: the gentle tutorial arena with the coach panel (earns no experience) */
  launchTutorial(side: TutorialSide) {
    this.mode = 'tutorial';
    this.ui.clear();
    this.app.startMission(TUTORIAL_ARENA[side], { tutorial: side, stats: tutorialStats(), onEnd: (m) => this.onMissionEnd(m) });
    this.app.paused = false;
  }
  /** fly a contract with the active captain (stats, abilities, mutators, loot drops) */
  launchContract(k: Contract) {
    this.mode = 'career';
    this.ui.clear();
    const { overrides, hooks } = this.career.contractMission(k);
    this.app.startMission(overrides, { ...hooks, onEnd: (m) => this.onMissionEnd(m) });
    this.app.paused = false;
  }
  restart() { const ls = this.app.lastStart; this.ui.clear(); this.app.startMission(ls.overrides, ls.hooks); }
  abandon() {
    const career = this.mode === 'career';
    this.career.active = null;
    this.app.endMission();
    this.openTitle();
    if (career) this.open('port');
  }

  private onMissionEnd(m: Mission) {
    if (this.app.mission !== m || m.spectator) return;
    this.ui.clear();
    if (this.mode === 'career') { this.ui.push(afterActionScreen(this, this.career.finish(m, false))); return; }
    // arena free play earns the side's captain half experience (URL test missions earn nothing)
    const xp = this.mode === 'arena' ? this.career.finish(m, true).summary.xp : 0;
    this.ui.push(missionEndScreen(this, m, xp));
  }

  toggleDev() {
    if (this.ui.top?.id === 'dev') { this.ui.pop(); return; }
    if (this.ui.capturing) return;
    this.ensureBackdrop();
    this.open('dev');
  }

  // ---------------------------------------------------------------- per frame
  update(dt: number) {
    const app = this.app, inp = app.input, ui = this.ui;
    const wasActive = ui.active;
    // gamepad Select + Options opens the dev settings
    if ((inp.codeDown('Pad8') && inp.codePressed('Pad9')) || (inp.codeDown('Pad9') && inp.codePressed('Pad8'))) this.toggleDev();
    else if (wasActive) ui.update(dt);
    else if (this.playing) {
      // window lost focus during a mission, or the pause key
      if (app.paused || (inp.pressed('pause') && !this.playing.over)) { app.paused = false; this.open('pause'); }
    }
    // a menu over a real mission halts it (also on the frame a menu closes, so its keypress stays in the menu)
    app.menuOpen = !!this.playing && (wasActive || ui.active);
    this.touch.update();
  }
}
