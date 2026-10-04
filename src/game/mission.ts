// Arena mission: builds the battlefield from the arena config (or a contract), tracks the score,
// decides when it is over and produces a MissionResult for the meta layer.

import { World } from './world';
import { Convoy, MerchantAI } from './convoy';
import { EscortAI } from './ai/escort';
import { UboatAI, Wolfpack } from './ai/uboat';
import { VESSELS, MERCHANT_CLASSES, MERCHANT_NAMES, ESCORT_NAMES, UBOAT_NAMES } from './vesselClasses';
import type { Side } from './vesselClasses';
import { Projectiles } from './weapons';
import { Sensors } from './sensors';
import { theaterById } from './theaters';
import type { ConfigStore } from '../core/config';
import type { RenderScene } from '../render/scene';
import { DEG, fromBearing, Rng } from '../core/math';
import type { Vessel } from './vessel';
import type { Weather } from './environment';
import type { MissionResult, Item } from '../meta/types';
import { islandArt } from '../art/ships';
import { dev } from '../core/devSettings';

export interface MissionStats {
  tonnageSunk: number;
  shipsSunk: { kind: string; grt: number; name: string }[];
  escortsSunk: number;
  uboatsSunk: number;
  uboatsDamaged: Set<number>;
  merchantsLost: number;
  tonnageLost: number;
  pings: number;
  torpedoes: number;
  torpedoHits: number;
  charges: number;
  loot: Item[];
  darkTime: number;
}

export class Mission {
  world: World;
  convoy: Convoy;
  pack = new Wolfpack();
  side: Side;
  over = false;
  outcome: MissionResult['outcome'] | null = null;
  overReason = '';
  stats: MissionStats = { tonnageSunk: 0, shipsSunk: [], escortsSunk: 0, uboatsSunk: 0, uboatsDamaged: new Set(), merchantsLost: 0, tonnageLost: 0, pings: 0, torpedoes: 0, torpedoHits: 0, charges: 0, loot: [], darkTime: 0 };
  merchantsTotal = 0;
  tonnageTotal = 0;
  elapsed = 0;
  /** seconds the player has been far from the fight (U-boat escape) */
  private escapeT = 0;
  readonly cfg: Record<string, number | string | boolean>;

  /** attract mode: no player vessel, every ship AI, fog of war off */
  readonly spectator: boolean;

  constructor(scene: RenderScene, arena: ConfigStore, overrides: Record<string, number | string | boolean> = {}, opts: { spectator?: boolean } = {}) {
    this.spectator = !!opts.spectator;
    const cfg = { ...arena.snapshot(), ...overrides };
    this.cfg = cfg;
    const num = (k: string) => Number(cfg[k]);
    const str = (k: string) => String(cfg[k]);
    const w = new World(scene);
    this.world = w;
    w.rng = new Rng(num('arena.seed'));
    const rng = w.rng;
    w.year = num('arena.year');
    w.theater = theaterById(str('arena.theater'));
    w.env.setTheater(w.theater);
    w.env.apply({ hour: num('arena.hour'), timeFlow: num('arena.timeFlow'), moonPhase: num('arena.moon'), season: Number(str('arena.season')), weather: str('arena.weather') as Weather });
    w.env.update(0);   // sun, sky and visibility valid before the first step
    w.layerDepth = num('arena.layer');
    // wind "from" -> waves travel toward the opposite bearing
    const windToward = fromBearing((num('arena.windDir') + 180) % 360);
    w.ocean.setSea({
      seaState: num('arena.seaState'), windDir: windToward, swellHeight: num('arena.swell'),
      swellDir: fromBearing((w.theater.swellDirDeg + 180) % 360), swellLength: w.theater.swellLength,
      choppiness: dev.num('water.choppiness'), count: dev.num('water.waveCount'), ampScale: dev.num('water.ampScale'), seed: num('arena.seed'),
    });
    w.projectiles = new Projectiles(w);
    w.sensors = new Sensors(w);
    this.side = str('arena.side') === 'uboat' ? 'axis' : 'allied';
    w.playerSide = this.side;
    w.spectator = this.spectator;
    const L = num('arena.size') * 1000;
    w.bounds = { x0: -L / 2 - 1500, y0: -L * 0.35 - 1500, x1: L / 2 + 1500, y1: L * 0.35 + 1500 };

    // ---- convoy
    const conv = new Convoy(w, num('arena.convoySpeed'));
    this.convoy = conv;
    conv.columns = Math.max(1, num('arena.columns'));
    conv.zigzag = !!cfg['arena.zigzag'];
    conv.startX = -L / 2; conv.exitX = L / 2;
    conv.x = -L / 2 + 700; conv.y = rng.range(-150, 150);
    conv.heading = conv.baseHeading = 0;
    const nM = num('arena.convoy');
    const rows = Math.ceil(nM / conv.columns);
    const names = [...MERCHANT_NAMES].sort(() => rng.next() - 0.5);
    for (let i = 0; i < nM; i++) {
      const col = i % conv.columns, row = Math.floor(i / conv.columns);
      const cls = VESSELS[MERCHANT_CLASSES[rng.int(0, MERCHANT_CLASSES.length - 1)]];
      const sp = conv.slotPos(col, row);
      const m = w.spawn(cls, sp.x + rng.range(-30, 30), sp.y + rng.range(-30, 30), conv.heading, { name: names[i % names.length] });
      m.slot = { col, row };
      m.ai = new MerchantAI(m, conv);
      m.thrust = 0.3;
      conv.merchants.push(m);
      this.tonnageTotal += m.grt;
    }
    void rows;
    this.merchantsTotal = nM;

    // ---- escorts (AI) + the player escort
    const stations = [
      { ahead: 900, side: 0 }, { ahead: 300, side: -900 }, { ahead: 300, side: 900 }, { ahead: -700, side: -800 },
      { ahead: -700, side: 800 }, { ahead: -1500, side: 0 }, { ahead: 1300, side: -600 }, { ahead: 1300, side: 600 },
    ];
    const escNames = [...ESCORT_NAMES].sort(() => rng.next() - 0.5);
    const nE = num('arena.escorts');
    const escortClasses = ['corvette', 'destroyer', 'frigate', 'corvette'];
    let si = 0;
    if (this.side === 'allied' && !this.spectator) {
      const cls = VESSELS[str('arena.escortClass')] ?? VESSELS.destroyer;
      const st = stations[si++];
      const p = this.stationPos(st);
      const pl = w.spawn(cls, p.x, p.y, conv.heading, { name: 'HMS ' + escNames[0] });
      pl.isPlayer = true;
      w.player = pl;
      pl.setTelegraph(4);
    }
    for (let i = 0; i < nE; i++) {
      const st = stations[si++ % stations.length];
      const p = this.stationPos(st);
      const cls = VESSELS[escortClasses[i % escortClasses.length]];
      const e = w.spawn(cls, p.x, p.y, conv.heading, { name: 'HMS ' + escNames[(i + 1) % escNames.length] });
      e.ai = new EscortAI(w, e, conv, st);
      e.setTelegraph(4);
    }

    // ---- U-boats: wolfpack ahead of the convoy, player among them
    const uNames = [...UBOAT_NAMES].sort(() => rng.next() - 0.5);
    const nU = num('arena.uboats');
    const spawnU = (i: number, isPlayer: boolean) => {
      const ahead = rng.range(1800, 3200), abeam = rng.range(-1500, 1500) + (isPlayer ? 0 : (i % 2 ? 900 : -900));
      const x = conv.x + ahead, y = conv.y + abeam;
      const cls = VESSELS[isPlayer ? str('arena.uboatClass') : (w.year >= 1945 && rng.chance(0.3) ? 'type21' : rng.chance(0.25) ? 'type9' : 'type7')] ?? VESSELS.type7;
      const depth = isPlayer ? 0 : (w.env.darkness > 0.5 ? 0 : 13);
      const u = w.spawn(cls, x, y, Math.PI + rng.range(-0.6, 0.6), { name: uNames[i % uNames.length], submerged: depth });
      if (u.sub) u.sub.orderedDepth = depth;
      return u;
    };
    if (this.side === 'axis' && !this.spectator) {
      const u = spawnU(0, true);
      u.isPlayer = true;
      w.player = u;
      u.setTelegraph(4);
    }
    for (let i = 0; i < nU; i++) {
      const u = spawnU(i + 1, false);
      u.ai = new UboatAI(w, u, this.pack);
    }
    // B-Dienst intelligence: the pack knows roughly where the convoy is
    this.pack.report({ x: conv.x + rng.range(-600, 600), y: conv.y + rng.range(-600, 600), vx: Math.cos(conv.heading) * conv.speed, vy: Math.sin(conv.heading) * conv.speed, err: 800, t: 0 });

    // ---- islands
    for (let i = 0; i < num('arena.islands'); i++) {
      const r = rng.range(60, 160);
      const x = rng.range(-L / 2, L / 2), y = (rng.sign()) * rng.range(900, L * 0.32);
      w.islands.push({ x, y, r, model: scene.atlas.add(islandArt(i + 1, r)) });
    }

    this.hookEvents();
  }

  private stationPos(st: { ahead: number; side: number }) {
    const c = this.convoy, cs = Math.cos(c.heading), sn = Math.sin(c.heading);
    return { x: c.x + st.ahead * cs - st.side * sn, y: c.y + st.ahead * sn + st.side * cs };
  }

  private hookEvents() {
    const w = this.world, S = this.stats;
    w.bus.on('sunk', (e) => {
      const v = e.v;
      const byPlayerSide = e.by && e.by.side === this.side;
      if (v.kind === 'merchant') {
        S.merchantsLost++; S.tonnageLost += v.grt;
        if (this.side === 'axis' && e.by?.isPlayer) { S.tonnageSunk += v.grt; S.shipsSunk.push({ kind: v.cls.id, grt: v.grt, name: v.name }); }
        w.emit('message', { text: `${v.name} (${v.grt.toLocaleString()} GRT) is going down!`, kind: 'alert', important: true });
        if (cfgBool(this.cfg, 'arena.survivors')) w.projectiles.launchBoats(v.pos.x, v.pos.y, 2 + (w.rng.int(0, 2)), 'allied');
      } else if (v.kind === 'escort') {
        S.escortsSunk++;
        w.emit('message', { text: `${v.name} has been sunk!`, kind: 'alert', important: true });
        if (cfgBool(this.cfg, 'arena.survivors')) w.projectiles.launchBoats(v.pos.x, v.pos.y, 1, 'allied');
      } else if (v.kind === 'uboat') {
        if (byPlayerSide || this.side === 'allied') S.uboatsSunk++;
        w.emit('message', { text: `${v.name} destroyed! Oil and debris on the surface.`, kind: 'alert', important: true });
      }
      if (v.isPlayer) this.end('sunk', 'Your vessel has been lost.');
      void byPlayerSide;
    });
    w.bus.on('damaged', (e) => { if (e.v.kind === 'uboat' && e.from?.side === 'allied') S.uboatsDamaged.add(e.v.id); });
    w.bus.on('ping', (e) => { if (e.by.isPlayer) S.pings++; });
    w.bus.on('torpedoFired', (e) => { if (e.by.isPlayer) S.torpedoes++; });
    w.bus.on('torpedoHit', (e) => { if (e.by?.isPlayer && !e.dud) S.torpedoHits++; });
    w.bus.on('dcDrop', (e) => { if (e.by.isPlayer) S.charges++; });
    w.bus.on('lootPicked', (e) => { S.loot.push(e.item); });
  }

  update(dt: number) {
    if (this.over) return;
    const w = this.world;
    this.elapsed += dt;
    this.convoy.update(dt);
    if (w.env.darkness > 0.5) this.stats.darkTime += dt;
    // end conditions
    const alive = this.convoy.alive;
    if (this.convoy.progress >= 1 || (alive.length && alive.every((m) => m.pos.x > this.convoy.exitX - 200))) {
      this.end(this.side === 'allied' ? (this.stats.merchantsLost <= this.merchantsTotal / 2 ? 'victory' : 'defeat') : (this.stats.tonnageSunk > 0 ? 'victory' : 'defeat'), 'The convoy has passed through the arena.');
    } else if (this.merchantsTotal > 0 && alive.length === 0) {
      this.end(this.side === 'allied' ? 'defeat' : 'victory', 'Every merchant ship has been sunk.');
    }
    const subs = w.vessels.filter((v) => v.alive && v.kind === 'uboat');
    if (this.side === 'allied' && subs.length === 0 && this.elapsed > 20) this.end('victory', 'The wolfpack has been destroyed.');
    // U-boat player escapes once far from the convoy and its escorts after attacking
    const p = w.player;
    if (p && p.alive && this.side === 'axis') {
      const far = Math.hypot(p.pos.x - this.convoy.x, p.pos.y - this.convoy.y) > 4200;
      this.escapeT = far ? this.escapeT + dt : 0;
      if (this.escapeT > 20 && this.stats.torpedoes > 0) this.end(this.stats.tonnageSunk > 0 ? 'victory' : 'withdrew', 'You slipped away from the convoy.');
    }
  }

  end(outcome: MissionResult['outcome'], reason: string) {
    if (this.over) return;
    this.over = true;
    this.outcome = outcome;
    this.overReason = reason;
    this.world.emit('message', { text: reason, kind: 'info', important: true });
  }

  result(contractId?: string): MissionResult {
    const w = this.world, p = w.player, S = this.stats;
    const alive = this.convoy.alive;
    return {
      side: this.side === 'allied' ? 'escort' : 'uboat',
      outcome: this.outcome ?? 'withdrew',
      durationSec: this.elapsed,
      tonnageSunk: S.tonnageSunk,
      shipsSunk: S.shipsSunk,
      escortsSunk: S.escortsSunk,
      merchantsTotal: this.merchantsTotal,
      merchantsLost: S.merchantsLost,
      tonnageDelivered: alive.reduce((a, m) => a + m.grt, 0),
      tonnageLost: S.tonnageLost,
      uboatsSunk: S.uboatsSunk,
      uboatsDamaged: S.uboatsDamaged.size,
      survivorsRescued: p ? p.rescued : 0,
      playerHullDamage: p ? Math.min(1, Math.max(0, 1 - p.hpFrac) * 0.8 + p.hydro.floodTotal() * 0.5) : 1,
      playerSunk: !p || !p.alive,
      nightFraction: this.elapsed > 0 ? S.darkTime / this.elapsed : 0,
      pingsUsed: S.pings,
      torpedoesFired: S.torpedoes,
      torpedoHits: S.torpedoHits,
      depthChargesDropped: S.charges,
      lootCollected: S.loot,
      contractId,
    };
  }

  dispose() { this.world.dispose(); }
}

function cfgBool(cfg: Record<string, number | string | boolean>, k: string) { return cfg[k] === true || cfg[k] === 'true' || cfg[k] === 1; }
void DEG;
export type { Vessel };
