// Application shell: owns the screen, render scene + backend, input and the current mode (menus or
// a mission), and runs the frame loop: input -> player orders -> fixed physics steps -> render -> HUD.

import { Screen } from './render/screen';
import { Camera } from './render/camera';
import { RenderScene } from './render/scene';
import type { RenderBackend } from './render/types';
import { fallbackToWebGL2 } from './render/backend';
import { Input } from './input/input';
import { Hud } from './ui/hud';
import { Mission } from './game/mission';
import { PlayerControl } from './game/player';
import { dev } from './core/devSettings';
import { arena } from './game/arenaConfig';
import { DEG, clamp, damp } from './core/math';
import type { AbilityId, AbilityState } from './meta/types';
import { StatBlock } from './meta/stats';
import { buildFleet, buildLookdev } from './game/lookdev';
import { audio } from './audio/audio';
import { AudioBridge } from './game/audioBridge';

export interface MissionHooks {
  stats?: StatBlock;
  loadout?: (AbilityId | null)[];
  abilities?: Partial<Record<AbilityId, AbilityState>>;
  onEnd?: (m: Mission) => void;
  /** attract mode: AI-only mission, drifting camera, no HUD */
  spectator?: boolean;
  /** contract mutators applied to the enemy side's warships */
  enemyStats?: StatBlock;
  /** hull damage carried from the last patrol (0..1) */
  hullDamage?: number;
  /** called once the mission exists (career hooks: loot drops) */
  onStart?: (m: Mission) => void;
}

const DEFAULT_LOADOUT: Record<'allied' | 'axis', AbilityId[]> = {
  allied: ['dc_pattern', 'asdic_sweep', 'hedgehog', 'star_shell', 'flank_speed', 'damage_control'],
  axis: ['torpedo_spread', 'crash_dive', 'silent_running', 'bold_decoy', 'periscope_scan', 'damage_control'],
};

export class App {
  screen: Screen;
  /** what the game draws this frame; backends only read it */
  scene = new RenderScene();
  backend: RenderBackend;
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
  /** arguments of the last startMission (restart) */
  lastStart: { overrides: Record<string, number | string | boolean>; hooks: MissionHooks } = { overrides: {}, hooks: {} };
  onFrame: ((dt: number) => void)[] = [];
  /** extra pause sources (menus open over the mission) */
  menuOpen = false;
  /** test hook (`?freeze=1`): render only; world, sims and particles never advance */
  frozen = false;
  /** look-dev scene (`?scene=lookdev`): fixed-dt frames left before freezing */
  private lookdev: { left: number; dt: number } | null = null;
  /** mission ↔ audio engine (events, loops, music) */
  private audioBridge: AudioBridge | null = null;
  /** stop calling frame() (look-dev scene finished) */
  stopped = false;
  /** perf overlay numbers (debug.perf) */
  perf = { cpuMs: 0, steps: 0 };

  constructor(screen: Screen, backend: RenderBackend) {
    this.screen = screen;
    this.backend = backend;
    // listen on the stage, not the canvas: a backend fallback swaps in a fresh canvas
    this.input = new Input(screen.root, (x, y) => this.screen.clientToPixel(x, y));
    this.hud = new Hud(this.screen, this.cam, this.input);
    this.hud.backend = backend;
    this.hud.perf = this.perf;
    screen.onResize(() => this.backend.resize());
    // audio: the context can only start after a user gesture; volumes follow the dev settings live
    this.input.onGesture.push(() => audio.unlock());
    audio.volumes = () => ({
      master: dev.num('audio.master'), sfx: dev.num('audio.sfx'), ambience: dev.num('audio.ambience'),
      music: dev.num('audio.music'), chatter: dev.bool('audio.chatter'),
    });
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
    this.lastStart = { overrides, hooks };
    const m = new Mission(this.scene, arena, overrides, { spectator: hooks.spectator, enemyStats: hooks.enemyStats });
    this.mission = m;
    this.backend.resetSims();
    this.scene.particles.n = 0;
    this.scene.splats.length = 0;
    const p = m.world.player;
    if (p) {
      if (hooks.stats) { p.stats = hooks.stats; this.applyStats(p.stats, p); }
      // unrepaired damage: the ship sails with part of its hull already gone
      if (hooks.hullDamage) p.hp = p.maxHp * (1 - clamp(hooks.hullDamage, 0, 1) * 0.6);
      this.player = new PlayerControl(m, this.input, this.cam);
      this.player.abilities.setLoadout(hooks.loadout ?? DEFAULT_LOADOUT[m.side], hooks.abilities ?? {});
      this.cam.x = p.pos.x; this.cam.y = p.pos.y;
      this.player.aimX = p.pos.x + 200; this.player.aimY = p.pos.y;
    }
    this.cam.zoom = this.cam.targetZoom = dev.num('camera.zoom');
    if (m.spectator) {
      this.cam.x = m.convoy.x; this.cam.y = m.convoy.y;
      this.cam.zoom = this.cam.targetZoom = 0.6;
      this.attractT = 0;
    }
    this.hud.attach(m);
    this.audioBridge = new AudioBridge(m, this.cam);
    hooks.onStart?.(m);
    this.paused = false;
    this.acc = 0;
  }

  /**
   * Deterministic renderer comparison scene: AI frozen, fixed spawns, `frames` fixed-dt frames (same
   * sim inputs on every backend), then frozen with the HUD hidden; sets `window.__lookdevDone`.
   */
  startLookdev(overrides: Record<string, number | string | boolean> = {}, frames = 40, dt = 0.1) {
    dev.set('ai.freeze', true, false);
    this.startMission({ 'arena.timeFlow': 0, ...overrides });
    const m = this.mission!;
    buildLookdev(m.world);
    if (this.player) this.player.freeCam = true;
    const p = m.world.player;
    if (p) { this.cam.x = p.pos.x + 10; this.cam.y = p.pos.y + 5; }
    this.backend.strictFrames = true;
    this.screen.hud.style.display = 'none';
    this.lookdev = { left: frames, dt };
  }

  /** art review (`?scene=fleet`): one of every class lined up, AI frozen, camera fixed on the grid */
  startFleet(overrides: Record<string, number | string | boolean> = {}) {
    dev.set('ai.freeze', true, false);
    this.startMission({ 'arena.timeFlow': 0, 'arena.convoy': 0, 'arena.escorts': 0, 'arena.uboats': 0, 'arena.aircraft': 'none', 'arena.seaState': 2, ...overrides }, { spectator: true });
    const c = buildFleet(this.mission!.world);
    this.cam.x = c.x; this.cam.y = c.y;
    this.cam.zoom = this.cam.targetZoom = dev.num('camera.zoom');
    this.fixedCam = true;
  }
  /** keep the camera where a test scene put it */
  fixedCam = false;

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
    this.audioBridge?.dispose();
    this.audioBridge = null;
    if (this.mission) this.mission.dispose();
    this.mission = null;
    this.player = null;
  }

  start() {
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      if (!this.stopped) try { this.frame(dt); } catch (e) { console.error(e); }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /** runtime fallback: the WebGPU device was lost or errored → WebGL2 on a fresh canvas */
  private switchToWebGL2(reason: string) {
    console.warn(`renderer: ${reason}; switching to WebGL2`);
    try { this.backend.dispose(); } catch { /* already gone */ }
    this.backend = fallbackToWebGL2(this.screen);
    this.hud.backend = this.backend;
    this.backend.resetSims();
    this.mission?.world.emit('message', { text: 'Renderer switched to WebGL2', kind: 'alert' });
  }

  private frame(dt: number) {
    const t0 = performance.now();
    const ld = this.lookdev;
    if (ld && ld.left > 0) {
      dt = ld.dt;
      if (--ld.left === 0) {
        this.frozen = true;
        // let the frozen frame reach the screen before signalling (readback present lags)
        // render a few frozen frames so the final image reaches the screen, then stop the loop so the
        // page stays responsive for screenshots (software WebGPU can saturate the main thread)
        void this.backend.whenIdle().then(() => setTimeout(() => {
          this.stopped = true;
          void this.backend.whenIdle().then(() => setTimeout(() => { (window as unknown as { __lookdevDone: boolean }).__lookdevDone = true; }, 500));
        }, 1500));
      }
    }
    this.realTime += dt;
    if (this.backend.lost) this.switchToWebGL2(this.backend.lost);
    this.input.update();
    for (const f of this.onFrame) f(dt);
    const m = this.mission;
    if (m) {
      const pc = this.player;
      const halted = this.paused || this.menuOpen || this.frozen;
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
        this.perf.steps = n;
      }
      // camera (frozen test frames settle it at once so shots don't depend on the frame count)
      const camDt = this.frozen ? 60 : dt;
      if (pc) pc.updateCamera(camDt);
      else if (m.spectator && !this.fixedCam) this.attractCamera(m, dt);
      this.cam.update(camDt, dev.num('camera.shake'));
      this.shipSway(m, camDt);
      // render
      m.world.submit(halted ? 0 : dt * tempo);
      this.hud.weather.update(m.world, this.cam, halted ? 0 : dt * tempo);
      const ps = this.scene.particles;
      ps.density = dev.num('display.particles');
      ps.wind.x = Math.cos(m.world.ocean.params.windDir) * m.world.ocean.windSpeed * 0.5;
      ps.wind.y = Math.sin(m.world.ocean.params.windDir) * m.world.ocean.windSpeed * 0.5;
      if (!halted) ps.update(dt * tempo, (x, y) => m.world.ocean.height(x, y));
      const bio = this.bioLevel(m);
      this.backend.render(this.scene, {
        camera: this.cam, ocean: m.world.ocean, env: m.world.env, theater: m.world.theater,
        simDt: clamp(simDt, 0, 0.1), time: m.world.time,
        flash: m.world.flash, flashCol: m.world.flashCol, bio, ice: m.world.theater.ice ? 0.6 : 0,
      });
      if (simDt > 0) this.scene.splats.length = 0;
      m.world.flash *= Math.exp(-dt * 6);
      this.audioBridge?.update(dt);
      if (pc) this.hud.draw(m, pc, dt);
      else this.hud.ambient(m, halted ? 0 : dt);
      if (m.over && !this.endFired) { this.endFired = true; setTimeout(() => this.hooks.onEnd?.(m), 2500); }
      if (!m.over) this.endFired = false;
    }
    this.input.endFrame();
    this.perf.cpuMs = this.perf.cpuMs * 0.9 + (performance.now() - t0) * 0.1;
  }
  private endFired = false;

  /** camera.roll: the view sways with the player's roll and pitch (seasickness option) */
  private shipSway(m: Mission, dt: number) {
    const p = m.world.player, cam = this.cam;
    let tx = 0, ty = 0;
    if (dev.bool('camera.roll') && p && p.alive) {
      const { roll, pitch } = p.attitude(), f = p.fwd();
      const k = 45;   // metres of sway per radian
      tx = (-f.y * roll + f.x * pitch) * k; ty = (f.x * roll + f.y * pitch) * k;
    }
    const a = damp(6, dt);
    cam.bobX += (tx - cam.bobX) * a; cam.bobY += (ty - cam.bobY) * a;
  }
  private attractT = 0;

  /** slow drift around the convoy's centre, a little ahead of it */
  private attractCamera(m: Mission, dt: number) {
    this.attractT += dt;
    const c = m.convoy, a = this.attractT * 0.045;
    const alive = c.alive;
    let cx = c.x, cy = c.y;
    if (alive.length) { cx = 0; cy = 0; for (const s of alive) { cx += s.pos.x; cy += s.pos.y; } cx /= alive.length; cy /= alive.length; }
    this.cam.follow(cx + Math.cos(a) * 140 + 80, cy + Math.sin(a) * 90, dt, 0.6);
  }

  /** run the simulation without rendering (testing / skipping transit) */
  fastForward(seconds: number, hz = 30): string[] {
    const m = this.mission;
    const log: string[] = [];
    if (!m) return log;
    const off = m.world.bus.on('message', (e) => log.push(`[${m.world.time.toFixed(0)}s] ${e.text}`));
    m.world.physics.setRate(hz);
    const step = 1 / hz;
    for (let t = 0; t < seconds && !m.over; t += step) { m.world.step(step); m.update(step); this.scene.splats.length = 0; this.scene.hulls.length = 0; }
    off();
    // the camera follows smoothly, so after a jump in time put it back on the player at once
    const p = m.world.player;
    if (p) { this.cam.x = p.pos.x; this.cam.y = p.pos.y; }
    return log;
  }

  bioLevel(m: Mission): number {
    const mode = dev.str('water.bio');
    if (mode === 'off') return 0;
    const base = mode === 'on' ? 1 : m.world.theater.bio;
    return base * m.world.env.darkness;
  }
}
