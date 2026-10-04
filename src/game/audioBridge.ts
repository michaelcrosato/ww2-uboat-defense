// Connects a mission to the audio engine: world events → spatial one-shots, the player's engine and
// cavitation loops, torpedo run loops near the listener, environment beds, the submerged-listener
// filter and the adaptive music state. Created by the App per mission, disposed with it.

import { audio, type LoopHandle } from '../audio/audio';
import type { Mission } from './mission';
import type { Camera } from '../render/camera';
import type { Vessel } from './vessel';
import type { WorldEvents } from './world';

const RUN_RANGE = 1200;
const MAX_RUNS = 4;

export class AudioBridge {
  private offs: (() => void)[] = [];
  private engine: LoopHandle | null = null;
  private engineKind = '';
  private cav: LoopHandle | null = null;
  private fire: LoopHandle | null = null;
  private runs = new Map<number, LoopHandle>();
  private lastTelegraph = -1;
  private lastCrash = 0;
  private combatT = -1e9;
  private tensionT = -1e9;
  /** recent event names for the perf overlay / tests */
  readonly log: string[] = [];

  constructor(private m: Mission, private cam: Camera) {
    const w = m.world, bus = w.bus;
    const me = () => w.player;
    const near = (x: number, y: number, r: number) => Math.hypot(x - cam.x, y - cam.y) < r;
    const note = (s: string) => { this.log.push(`${w.time.toFixed(1)} ${s}`); if (this.log.length > 40) this.log.shift(); };
    const on = <K extends keyof WorldEvents>(k: K, f: (e: WorldEvents[K]) => void) => { this.offs.push(bus.on(k, f)); };

    on('ping', (e) => {
      const p = me();
      if (e.by === p) { audio.play('asdic_ping', { vol: 0.9 }); note('ping (own)'); return; }
      // a U-boat being pinged hears it ring on the hull
      const onHull = p?.sub && e.by.side !== p.side && Math.hypot(e.by.pos.x - p.pos.x, e.by.pos.y - p.pos.y) < 2500;
      audio.play('asdic_ping', { x: e.by.pos.x, y: e.by.pos.y, vol: onHull ? 1.3 : 0.6, underwater: true });
      if (onHull) this.tensionT = w.time;
      note('ping');
    });
    on('echo', (e) => { if (e.by === me()) { audio.play('asdic_echo', { doppler: e.doppler, vol: 0.4 + 0.6 * Math.min(1, e.strength) }); note('echo'); } });
    on('gunFired', (e) => {
      audio.play(e.caliber >= 100 ? 'gun_heavy' : 'gun_light', { x: e.x, y: e.y });
      if (near(e.x, e.y, 2500)) this.combatT = w.time;
      note('gun');
    });
    on('dcDrop', (e) => { audio.play('depth_charge_splash', { x: e.x, y: e.y }); note('dcDrop'); });
    on('explosion', (e) => {
      if (e.kind === 'torpedo') return;   // torpedoHit plays its own
      const d = Math.hypot(e.x - cam.x, e.y - cam.y);
      if (e.kind === 'hedgehog') audio.play('hedgehog_hit', { x: e.x, y: e.y });
      else if (e.kind === 'ram') audio.play('ramming_crunch', { x: e.x, y: e.y });
      else if (e.z < -1) audio.play(d > 1500 ? 'underwater_boom_far' : 'depth_charge_boom', { x: e.x, y: e.y, vol: 0.5 + e.power * 0.5 });
      else audio.play('surface_explosion', { x: e.x, y: e.y, vol: 0.5 + e.power * 0.5 });
      if (d < 2500) this.combatT = w.time;
      note('explosion ' + e.kind);
    });
    on('torpedoFired', (e) => { audio.play('torpedo_launch', { x: e.x, y: e.y }); if (e.by.side !== me()?.side) this.tensionT = w.time; note('torpedoFired'); });
    on('torpedoHit', (e) => {
      const t = e.target.pos;
      audio.play(e.dud ? 'metal_impact' : 'torpedo_hit', { x: t.x, y: t.y });
      this.combatT = w.time;
      note(e.dud ? 'torpedo dud' : 'torpedoHit');
    });
    on('sunk', (e) => { audio.play('ship_sinking', { x: e.v.pos.x, y: e.v.pos.y }); note('sunk'); });
    on('hullCreak', (e) => { if (e.v === me()) { audio.play(e.severity > 0.6 ? 'hull_groan' : 'hull_creak'); note('hullCreak'); } });
    on('lootPicked', (e) => { if (e.by === me()) { audio.play(e.item.rarity === 'legendary' || e.item.rarity === 'unique' ? 'loot_legendary' : 'loot_drop'); note('loot'); } });
    on('starShell', (e) => { audio.play('star_shell_pop', { x: e.x, y: e.y }); note('starShell'); });
    on('splash', (e) => { audio.play(e.size >= 1.2 ? 'splash_big' : 'splash_small', { x: e.x, y: e.y }); });
    on('greenWater', (e) => { if (e.v === me()) audio.play('wave_slap', { vol: Math.min(1, 0.4 + e.amount) }); });
    on('damaged', (e) => { if (e.v === me() && e.amount > 25 && e.kind !== 'fire') audio.play('metal_impact', { x: e.x, y: e.y, vol: 0.6 }); });
    on('message', (e) => {
      if (e.kind !== 'radio' || (e.side && e.side !== w.playerSide)) return;
      audio.play(w.playerSide === 'axis' ? 'morse_burst' : 'radio_static');
      note('radio');
    });
  }

  private playerEngine(p: Vessel) {
    const kind = !p.sub ? 'engine_steam' : p.sub.surfaced || p.sub.snorkel ? 'engine_diesel' : 'engine_electric';
    if (kind !== this.engineKind) {
      this.engine?.stop(0.6);
      this.engine = audio.loop(kind as 'engine_steam');
      this.engineKind = kind;
    }
    const frac = Math.min(1.2, Math.abs(p.speed) / Math.max(0.5, p.maxSpeed));
    this.engine?.set({ pitch: 0.25 + frac, vol: 0.5 + 0.5 * Math.min(1, frac + 0.2) });
  }

  update(dt: number) {
    const m = this.m, w = m.world, p = w.player, cam = this.cam;
    audio.setListener(cam.x, cam.y, cam.zoom);
    if (!audio.ready) return;
    audio.setEnvironment({ seaState: w.ocean.params.seaState, rain: w.env.rain, wind: w.ocean.windSpeed, night: w.env.darkness });
    if (p && p.alive) {
      this.playerEngine(p);
      // submerged listener (player U-boat keel depth: 5 m → 0, 15 m → 1)
      audio.setUnderwater(p.sub ? Math.max(0, Math.min(1, (p.keelDepth - 5) / 10)) : 0);
      // cavitation: a submerged boat driven hard near the surface
      const cav = p.sub && !p.sub.surfaced ? Math.max(0, p.speed / Math.max(0.5, p.maxSpeed) - 0.55) * 2.2 * Math.max(0, 1 - p.keelDepth / 80) : 0;
      if (cav > 0.05 && !this.cav) this.cav = audio.loop('cavitation', { vol: 0 });
      this.cav?.set({ vol: Math.min(1, cav), pitch: 0.5 + cav });
      if (cav <= 0.05 && this.cav) { this.cav.stop(); this.cav = null; }
      // own fires
      const fire = p.fires.reduce((a, f) => a + f.power, 0);
      if (fire > 0.05 && !this.fire) this.fire = audio.loop('fire');
      this.fire?.set({ vol: Math.min(1, fire), pitch: Math.min(1, fire) });
      if (fire <= 0.05 && this.fire) { this.fire.stop(); this.fire = null; }
      // telegraph bell, dive alarm
      if (this.lastTelegraph >= 0 && p.telegraph !== this.lastTelegraph) audio.play('telegraph_bell');
      this.lastTelegraph = p.telegraph;
      const crash = p.sub?.crash ?? 0;
      if (crash > 0 && this.lastCrash <= 0) audio.play('dive_alarm');
      this.lastCrash = crash;
    } else {
      this.engine?.stop(1); this.engine = null; this.engineKind = '';
      audio.setUnderwater(0);
    }
    // torpedo runs near the listener
    const seen = new Set<number>();
    const torps = w.projectiles.torpedoes
      .filter((t) => t.alive && Math.hypot(t.x - cam.x, t.y - cam.y) < RUN_RANGE)
      .sort((a, b) => Math.hypot(a.x - cam.x, a.y - cam.y) - Math.hypot(b.x - cam.x, b.y - cam.y))
      .slice(0, MAX_RUNS);
    for (const t of torps) {
      seen.add(t.id);
      let h = this.runs.get(t.id);
      if (!h) { h = audio.loop('torpedo_run', { x: t.x, y: t.y, underwater: true }); this.runs.set(t.id, h); }
      h.set({ x: t.x, y: t.y, pitch: 0.7 + t.speed / 40 });
    }
    for (const [id, h] of this.runs) if (!seen.has(id)) { h.stop(0.5); this.runs.delete(id); }
    // music
    let state: Parameters<typeof audio.setMusic>[0] = 'calm';
    if (m.spectator) state = 'menu';
    else if (m.over) state = m.outcome === 'victory' ? 'victory' : m.outcome === 'withdrew' ? 'calm' : 'defeat';
    else if (w.time - this.combatT < 12) state = 'combat';
    else if (w.time - this.tensionT < 15 || this.enemyNear()) state = 'tension';
    audio.setMusic(state);
    audio.update(dt);
  }

  private enemyNear(): boolean {
    const w = this.m.world, p = w.player;
    if (!p) return false;
    for (const v of w.vessels) {
      if (!v.alive || v.side === p.side || (v.kind !== 'uboat' && v.kind !== 'escort')) continue;
      if (Math.hypot(v.pos.x - p.pos.x, v.pos.y - p.pos.y) < 1500 && w.isVisibleToPlayer(v)) return true;
    }
    return false;
  }

  dispose() {
    for (const off of this.offs) off();
    this.engine?.stop(0.5);
    this.cav?.stop(); this.fire?.stop();
    for (const h of this.runs.values()) h.stop(0.3);
    this.runs.clear();
    audio.stopAll(0.8);
    audio.setUnderwater(0);
    audio.setMusic('menu');
  }
}
