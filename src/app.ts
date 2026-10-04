// Application shell: owns the screen, renderer, input and the current mode (menus or a mission),
// and runs the frame loop: input -> player orders -> fixed physics steps -> render -> HUD.

import { Screen } from './gfx/screen';
import { createGL } from './gfx/gl';
import { Renderer } from './gfx/renderer';
import { Camera } from './gfx/camera';
import { Input } from './input/input';
import { Hud } from './ui/hud';
import { Mission } from './game/mission';
import { PlayerControl } from './game/player';
import { dev } from './core/devSettings';
import { arena } from './game/arenaConfig';
import { DEG, clamp } from './core/math';
import type { AbilityId, AbilityState } from './meta/types';
import { StatBlock } from './meta/stats';

export interface MissionHooks {
  stats?: StatBlock;
  loadout?: (AbilityId | null)[];
  abilities?: Partial<Record<AbilityId, AbilityState>>;
  onEnd?: (m: Mission) => void;
}

const DEFAULT_LOADOUT: Record<'allied' | 'axis', AbilityId[]> = {
  allied: ['dc_pattern', 'asdic_sweep', 'hedgehog', 'star_shell', 'flank_speed', 'damage_control'],
  axis: ['torpedo_spread', 'crash_dive', 'silent_running', 'bold_decoy', 'periscope_scan', 'damage_control'],
};

export class App {
  screen: Screen;
  renderer: Renderer;
  cam = new Camera();
  input: Input;
  hud: Hud;
  mission: Mission | null = null;
  player: PlayerControl | null = null;
  paused = false;
  private last = performance.now();
  private acc = 0;
  private realTime = 0;
  private hooks: MissionHooks = {};
  onFrame: ((dt: number) => void)[] = [];
  /** extra pause sources (menus open over the mission) */
  menuOpen = false;

  constructor(root: HTMLElement) {
    this.screen = new Screen(root, dev);
    const { gl, caps } = createGL(this.screen.canvas);
    this.renderer = new Renderer(gl, caps, this.screen);
    this.input = new Input(this.screen.canvas, (x, y) => this.screen.clientToPixel(x, y));
    this.hud = new Hud(this.screen, this.cam, this.input);
    dev.on('camera.tilt', () => this.cam.setTilt(dev.num('camera.tilt') * DEG));
    this.cam.setTilt(dev.num('camera.tilt') * DEG);
    this.cam.zoom = this.cam.targetZoom = dev.num('camera.zoom');
    // auto-pause when the window loses focus during a mission
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.mission && !this.mission.over) this.paused = true; });
    (window as unknown as { __app: App }).__app = this;
  }

  startMission(overrides: Record<string, number | string | boolean> = {}, hooks: MissionHooks = {}) {
    this.endMission();
    this.hooks = hooks;
    const m = new Mission(this.renderer, arena, overrides);
    this.mission = m;
    this.renderer.simNeedsReset = true;
    this.renderer.particles.n = 0;
    const p = m.world.player;
    if (p) {
      if (hooks.stats) { p.stats = hooks.stats; this.applyStats(p.stats, p); }
      this.player = new PlayerControl(m, this.input, this.cam);
      this.player.abilities.setLoadout(hooks.loadout ?? DEFAULT_LOADOUT[m.side], hooks.abilities ?? {});
      this.cam.x = p.pos.x; this.cam.y = p.pos.y;
      this.player.aimX = p.pos.x + 200; this.player.aimY = p.pos.y;
    }
    this.cam.zoom = this.cam.targetZoom = dev.num('camera.zoom');
    this.hud.attach(m);
    this.paused = false;
    this.acc = 0;
  }

  /** stats that change vessel numbers at spawn (hull, ammo) */
  private applyStats(s: StatBlock, v: import('./game/vessel').Vessel) {
    v.maxHp = (v.cls.hp + s.get('hull_hp')) * s.mul('hull_hp_pct');
    v.hp = v.maxHp;
    if (v.cls.dc) v.dcLeft = Math.max(0, Math.round((v.cls.dc.capacity + s.get('dc_capacity')) * (s.has('ks_gunnery_school') ? 0.7 : 1)));
    if (v.hedgehogLeft > 0) v.hedgehogLeft += Math.round(s.get('hedgehog_capacity'));
    v.starShells += Math.round(s.get('star_shells'));
    v.decoys += Math.round(s.get('decoy_capacity'));
    if (v.cls.torpedoes) v.torpedoReloads = Math.max(0, v.cls.torpedoes.reloads + Math.round(s.get('torpedo_capacity')) - (s.has('ks_wolf_leader') ? 2 : 0));
    if (s.has('ks_silent_hunter')) v.visualBoost = 1;
  }

  endMission() {
    if (this.mission) this.mission.dispose();
    this.mission = null;
    this.player = null;
  }

  start() {
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      try { this.frame(dt); } catch (e) { console.error(e); }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private frame(dt: number) {
    this.realTime += dt;
    this.input.update();
    for (const f of this.onFrame) f(dt);
    const m = this.mission;
    if (m) {
      const pc = this.player;
      const halted = this.paused || this.menuOpen;
      if (pc && !halted) pc.update(dt);
      // fixed-step simulation
      const hz = parseInt(dev.str('phys.hz')) || 60;
      m.world.physics.setRate(hz);
      const tempo = dev.num('phys.tempo') * (pc ? pc.timeScale : 1);
      let simDt = 0;
      if (!halted) {
        this.acc += dt * tempo;
        const step = 1 / hz;
        let n = 0;
        const maxSteps = 12;
        while (this.acc >= step && n < maxSteps) {
          m.world.step(step);
          m.update(step);
          this.acc -= step;
          simDt += step;
          n++;
        }
        if (n >= maxSteps) this.acc = 0;
      }
      // camera
      if (pc) pc.updateCamera(dt);
      this.cam.update(dt, dev.num('camera.shake'));
      // render
      m.world.submit(halted ? 0 : dt * tempo);
      this.renderer.particles.wind.x = Math.cos(m.world.ocean.params.windDir) * m.world.ocean.windSpeed * 0.5;
      this.renderer.particles.wind.y = Math.sin(m.world.ocean.params.windDir) * m.world.ocean.windSpeed * 0.5;
      if (!halted) this.renderer.particles.update(dt * tempo, (x, y) => m.world.ocean.height(x, y));
      const bio = this.bioLevel(m);
      this.renderer.frame({
        camera: this.cam, ocean: m.world.ocean, env: m.world.env, theater: m.world.theater,
        hulls: m.world.hulls, splats: m.world.splats, simDt: clamp(simDt, 0, 0.1), time: m.world.time,
        flash: m.world.flash, flashCol: m.world.flashCol, bio, ice: m.world.theater.ice ? 0.6 : 0,
      });
      if (simDt > 0) m.world.splats.length = 0;
      m.world.flash *= Math.exp(-dt * 6);
      if (pc) this.hud.draw(m, pc, dt);
      if (m.over && !this.endFired) { this.endFired = true; setTimeout(() => this.hooks.onEnd?.(m), 2500); }
      if (!m.over) this.endFired = false;
    }
    this.input.endFrame();
  }
  private endFired = false;

  /** run the simulation without rendering (testing / skipping transit) */
  fastForward(seconds: number, hz = 30): string[] {
    const m = this.mission;
    const log: string[] = [];
    if (!m) return log;
    const off = m.world.bus.on('message', (e) => log.push(`[${m.world.time.toFixed(0)}s] ${e.text}`));
    m.world.physics.setRate(hz);
    const step = 1 / hz;
    for (let t = 0; t < seconds && !m.over; t += step) { m.world.step(step); m.update(step); m.world.splats.length = 0; m.world.hulls.length = 0; }
    off();
    return log;
  }

  bioLevel(m: Mission): number {
    const mode = dev.str('water.bio');
    if (mode === 'off') return 0;
    const base = mode === 'on' ? 1 : m.world.theater.bio;
    return base * m.world.env.darkness;
  }
}
