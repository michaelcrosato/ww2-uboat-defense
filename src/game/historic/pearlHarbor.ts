// Pearl Harbor, Sunday 7 December 1941, 07:50-10:02, at true scale on the real harbour.
// Berths and shorelines: surveyed positions (Arizona Memorial, Pier F-5, Ford Island) and berthing plans,
// converted from lat/lon; expect +-150 m near Ford Island. Order of battle and timeline: the action
// reports of the ships and the Japanese strike plan (docs/milestones/M17-pearl-midway.md lists sources).
// Escort side: USS Monaghan (DD-354), ready-duty destroyer, outboard in the DesDiv 2 nest at X-14.
// U-boat side: the Type A midget submarine from I-22 in the North Channel.

import type { Mission } from '../mission';
import type { Vessel } from '../vessel';
import type { RenderScene } from '../../render/scene';
import { Scenario, RouteAI, brg } from './scenario';
import { LandMap, type Carve, type Pt } from './land';
import { P, PEARL_LAND, dressPearl, type PearlDetail } from './pearlDetail';
import { HarborCraft, StackSmoke, Traffic } from './harborLife';
import { quayArt } from '../../art/shoreArt';
import type { Element } from './airRaid';
import { Convoy } from '../convoy';
import { EscortAI } from '../ai/escort';
import { intercept } from '../ai/uboat';
import { VESSELS } from '../vesselClasses';
import { angleDiff, KNOT } from '../../core/math';

const FORD_ISLAND = P(21.3640, -157.9620), HICKAM = P(21.3330, -157.9470);
const HOSPITAL_POINT = P(21.3474, -157.9628);
/** the channel south past Ford Island to Hospital Point and out to sea (mid-channel points) */
const MAIN_CHANNEL: Pt[] = [P(21.3563, -157.9598), P(21.3505, -157.9640), P(21.3400, -157.9655), P(21.3250, -157.9671), P(21.3050, -157.9670)];
/** from the nest at X-14 down the North Channel, round Ford Island's west tip into the main channel */
const NORTH_CHANNEL: Pt[] = [P(21.3720, -157.9660), P(21.3650, -157.9704), P(21.3572, -157.9685), P(21.3505, -157.9640), P(21.3400, -157.9655), P(21.3250, -157.9671), P(21.3050, -157.9670)];

interface Berth { name: string; cls: string; at: Pt; bow: number }
/** a ship lying `off` metres to one side (positive: starboard) of a berth point */
const beside = (p: Pt, bow: number, off: number): Pt => { const h = brg(bow); return [p[0] - Math.sin(h) * off, p[1] + Math.cos(h) * off]; };
const along = (p: Pt, bow: number, d: number): Pt => { const h = brg(bow); return [p[0] + Math.cos(h) * d, p[1] + Math.sin(h) * d]; };

// Drydock No. 1: the dock runs inland from the yard's waterfront at about 150 deg; Pennsylvania aft,
// Cassin and Downes side by side at the head of the dock
const DOCK_MOUTH = P(21.3551, -157.9594), DOCK_AXIS = 149;
// the 1010 Dock waterfront runs at 060 deg; Helena alongside, Oglala outboard of her
const DOCK_1010 = P(21.3582, -157.9536);
const NEST = P(21.3777, -157.9610);

const BERTHS: Berth[] = [
  // Battleship Row, bows toward the channel at 235 deg; outboard ships to the south-east
  { name: 'USS Nevada', cls: 'bb_nevada', at: P(21.36635, -157.94813), bow: 235 },
  { name: 'USS Arizona', cls: 'bb_pennsylvania', at: P(21.36505, -157.95004), bow: 235 },
  { name: 'USS Vestal', cls: 'ar_vestal', at: P(21.36488, -157.94974), bow: 235 },
  { name: 'USS Tennessee', cls: 'bb_tennessee', at: P(21.36379, -157.95198), bow: 235 },
  { name: 'USS West Virginia', cls: 'bb_colorado', at: P(21.36354, -157.95179), bow: 235 },
  { name: 'USS Maryland', cls: 'bb_colorado', at: P(21.36252, -157.95391), bow: 235 },
  { name: 'USS Oklahoma', cls: 'bb_nevada', at: P(21.36228, -157.95373), bow: 235 },
  { name: 'USS Neosho', cls: 'ao_neosho', at: P(21.36135, -157.95597), bow: 235 },
  { name: 'USS California', cls: 'bb_tennessee', at: P(21.35988, -157.95805), bow: 235 },
  // north-west side of Ford Island: ~65 m off the seawall (the Utah memorial stands in front of her hull)
  { name: 'USS Detroit', cls: 'cl_omaha', at: P(21.37151, -157.95840), bow: 55 },
  { name: 'USS Raleigh', cls: 'cl_omaha', at: P(21.37027, -157.96029), bow: 55 },
  { name: 'USS Utah', cls: 'ag_utah', at: P(21.36900, -157.96219), bow: 55 },
  // Tangier (a C3 conversion) drawn with the Curtiss-class tender, the nearest hull in the table
  { name: 'USS Tangier', cls: 'av_curtiss', at: P(21.36779, -157.96402), bow: 55 },
  { name: 'USS Curtiss', cls: 'av_curtiss', at: P(21.3754, -157.9697), bow: 145 },
  // Navy Yard
  { name: 'USS Pennsylvania', cls: 'bb_pennsylvania', at: along(DOCK_MOUTH, DOCK_AXIS, 112), bow: DOCK_AXIS },
  { name: 'USS Cassin', cls: 'dd_mahan', at: beside(along(DOCK_MOUTH, DOCK_AXIS, 262), DOCK_AXIS, -5.6), bow: DOCK_AXIS },
  { name: 'USS Downes', cls: 'dd_mahan', at: beside(along(DOCK_MOUTH, DOCK_AXIS, 262), DOCK_AXIS, 5.6), bow: DOCK_AXIS },
  { name: 'USS Helena', cls: 'cl_brooklyn', at: beside(DOCK_1010, 240, 12), bow: 240 },
  { name: 'USS Oglala', cls: 'cm_oglala', at: beside(DOCK_1010, 240, 31), bow: 240 },
  // YFD-2, the floating dry dock off the yard's west waterfront
  { name: 'USS Shaw', cls: 'dd_mahan', at: P(21.3512, -157.9632), bow: 170 },
  // DesDiv 2 nest at X-14, starboard to port: Aylwin, Farragut, Dale, Monaghan (outboard)
  { name: 'USS Aylwin', cls: 'dd_farragut', at: beside(NEST, 235, 18.75), bow: 235 },
  { name: 'USS Farragut', cls: 'dd_farragut', at: beside(NEST, 235, 6.25), bow: 235 },
  { name: 'USS Dale', cls: 'dd_farragut', at: beside(NEST, 235, -6.25), bow: 235 },
  { name: 'USS Monaghan', cls: 'dd_farragut', at: beside(NEST, 235, -18.75), bow: 235 },
];

const MIDGET_START = P(21.3728, -157.9652);
/** mid-channel in the North Channel between Pearl City and Ford Island (narrower than a destroyer's
 *  turning circle at speed, so she lies there listening rather than patrolling up and down) */
const NORTH_PATROL: Pt[] = [P(21.3735, -157.9655)];

export class PearlHarbor extends Scenario {
  readonly title = 'Pearl Harbor, 7 December 1941';
  readonly brief: string;
  land: LandMap;
  detail!: PearlDetail;
  midget: Vessel | null = null;
  monaghan: Vessel | null = null;
  private oSub; private oUnderway; private oSurvive; private oHit;
  private torpHits = 0;
  private nevadaBeached = false;

  constructor(m: Mission, scene: RenderScene) {
    super(m, scene, 7 + 50 / 60);
    const w = this.world, side = m.side;
    this.brief = side === 'allied'
      ? 'USS Monaghan, ready-duty destroyer, outboard in the nest at X-14. Japanese carrier aircraft are minutes away. Man the guns, get under way, and find the midget submarine loose in the harbour.'
      : 'Type A midget submarine, launched from I-22 before dawn, now inside the harbour in the North Channel. Two torpedoes. Battleship Row lies beyond Ford Island.';
    w.bounds = { x0: -3800, y0: -3900, x1: 3300, y1: 6200 };
    w.seabed = 12;
    w.physics.addSeabed(12, w.bounds.x0 - 500, w.bounds.y0 - 500, w.bounds.x1 + 500, w.bounds.y1 + 500);

    // ---- the harbour: berths cut out of the land mask first, so no hull starts inside a quay
    const carves: Carve[] = BERTHS.map((b) => { const c = VESSELS[b.cls]; return { x: b.at[0], y: b.at[1], h: brg(b.bow), hl: c.length / 2 + 4, hw: c.beam / 2 + 2.5 }; });
    carves.push({ ...(() => { const c = along(DOCK_MOUTH, DOCK_AXIS, 158); return { x: c[0], y: c[1] }; })(), h: brg(DOCK_AXIS), hl: 152, hw: 19 });
    this.land = new LandMap(w.bounds.x0, w.bounds.y0, w.bounds.x1, w.bounds.y1 - 1200, 5, PEARL_LAND.map((a) => ({ ...a })), carves);
    // the shore in detail: Southeast Loch, the second dry dock and the piers, roads and runways, then the
    // buildings, trees, parked aircraft and AA pits (pearlDetail.ts); colliders and ground tiles after
    const d = this.detail = dressPearl(w, scene, this.land);
    this.land.addPhysics(w);
    this.land.addArt(w, scene, 'pearl', 1000, [], false);
    this.raid.isLand = this.isLand = this.land.isLand;
    // Ford Island's mooring quays: a pair on the inboard (starboard, island) side of each inboard berth
    const quay = scene.atlas.add(quayArt());
    for (const b of BERTHS) {
      if (!/Nevada|Arizona|Tennessee|Maryland|Neosho|California|Detroit|Raleigh|Utah|Tangier/.test(b.name)) continue;
      const c = VESSELS[b.cls], h = brg(b.bow);
      for (const s of [-1, 1]) { const q = beside(along(b.at, b.bow, s * c.length * 0.3), b.bow, c.beam / 2 + 9); w.addScenery(quay, q[0], q[1], 0, h); }
    }
    // land AA, parked aircraft that bombs and strafing destroy, the life of the harbour
    for (const g of d.aa) this.raid.landAA.push({ ...g, ready: this.T(g.ready) });
    this.raid.onGround = (x, y, power) => this.groundHit(x, y, power, 26);
    this.raid.onStrafe = (x, y) => { if (w.rng.next() < 0.02) this.groundHit(x, y, 0, 14); };
    w.systems.push(new Traffic(w, scene, d.roads, 380), new HarborCraft(w, scene, d.routes, d.moored, (c) => this.T(c)), new StackSmoke(w, d.stacks));

    // ---- the fleet at its moorings
    for (const b of BERTHS) {
      const v = this.spawn(b.cls, b.name, b.at[0], b.at[1], brg(b.bow), { moored: true });
      // gun crews reach their mounts in the first minutes of the attack (ready ammunition, Condition III)
      this.raid.aaReady.set(v, this.T('07:57') + w.rng.range(0, 240));
      // Sunday in port: watertight doors open, many hands ashore; damage control can barely start
      v.leakControl = 0.3;
    }
    this.monaghan = this.ship('USS Monaghan');

    // ---- the midget submarine in the North Channel
    const ms = VESSELS.ss_kohyoteki, keel = ms.sub!.periscopeDepth;
    // the player's boat points along the channel toward East Loch, the way round Ford Island to Battleship Row
    const midget = w.spawn(ms, MIDGET_START[0], MIDGET_START[1], brg(side === 'allied' ? 120 : 60), { name: 'Midget submarine (I-22)', submerged: keel - ms.draft });
    midget.sub!.orderedDepth = keel; midget.sub!.periscopeUp = true; midget.sub!.periscope = 1;
    this.midget = midget;

    if (side === 'allied') {
      const p = this.monaghan!;
      p.isPlayer = true; w.player = p;
      this.raid.aaReady.set(p, this.T('08:00'));
      midget.ai = new MidgetAI(this, midget);
      this.oUnderway = this.objective('Get under way');
      this.oSub = this.objective('Sink the midget submarine');
      this.oSurvive = this.objective('Survive the raid (09:45)');
    } else {
      midget.isPlayer = true; w.player = midget;
      // creeping on the motor: slow enough that a boat left alone noses into a bank instead of ramming a
      // moored cruiser (impacts under 1.2 m/s do no damage)
      midget.speedCmd = 0.1;
      this.oHit = this.objective('Torpedo a battleship');
      this.oSurvive = this.objective('Survive (09:45)');
    }
    w.bus.on('torpedoHit', (e) => {
      if (e.dud || !e.by || e.by !== this.midget) return;
      this.torpHits++;
      if (this.oHit && e.target.cls.role === 'capital') this.oHit.state = 'done';
    });
    w.bus.on('sunk', (e) => {
      if (e.v === this.midget) { if (this.oSub) this.oSub.state = 'done'; this.say('The midget submarine is destroyed.', 'info'); }
    });
    this.timeline();
  }

  /** a bomb (or a strafing burst) ashore: parked aircraft within reach burn, a building hit catches fire */
  private groundHit(x: number, y: number, power: number, reach: number) {
    const w = this.world, raid = this.raid;
    for (const p of this.detail.planes) {
      if (!p.alive || Math.hypot(p.x - x, p.y - y) > reach) continue;
      p.alive = false; p.s.model = p.wreck;
      raid.addFire(p.x, p.y, 400 + w.rng.next() * 900, 0.7);
    }
    if (power <= 0) return;
    for (const b of this.detail.buildings) {
      if (b.burning) continue;
      const dx = x - b.x, dy = y - b.y, c = Math.cos(b.h), sn = Math.sin(b.h);
      if (Math.abs(dx * c + dy * sn) > b.hl || Math.abs(-dx * sn + dy * c) > b.hw) continue;
      if (b.big || w.rng.next() < 0.5) { b.burning = true; raid.addFire(x, y, 900 + w.rng.next() * 1800, b.big ? 1.6 : 1); }
      break;
    }
  }

  protected override canCastOff(): true | string {
    return this.clock >= 8 ? true : 'Captain, the ship is not yet at general quarters.';
  }

  private wave(els: Element[]) { for (const e of els) this.raid.add(e); }
  private el(o: Omit<Element, 'side' | 'at'> & { at: string }): Element { return { side: 'axis', ...o, at: this.T(o.at) }; }

  /** aim points ashore round c: the parked rows and the hangars and barracks (what the strikes went for) */
  private aims(c: Pt, R: number) {
    const out: { x: number; y: number; r: number }[] = [];
    this.detail.planes.forEach((p, i) => { if (i % 2 === 0 && Math.hypot(p.x - c[0], p.y - c[1]) < R) out.push({ x: p.x, y: p.y, r: 18 }); });
    for (const b of this.detail.buildings) if (b.big && Math.hypot(b.x - c[0], b.y - c[1]) < R) out.push({ x: b.x, y: b.y, r: Math.min(b.hl, b.hw) });
    return out;
  }

  private timeline() {
    const e = (o: Omit<Element, 'side' | 'at'> & { at: string }) => this.el(o);
    const fiAims = this.aims(P(21.3600, -157.9617), 500), hickamAims = this.aims(P(21.3320, -157.9500), 900);
    const SE = brg(135), NW = brg(300);
    this.wave([
      // first wave: dive bombers on the airfields, torpedo planes from both sides of Ford Island
      e({ kind: 'val', role: 'dive', n: 9, at: '07:55', targets: [], ground: { x: FORD_ISLAND[0], y: FORD_ISLAND[1], r: 450, aims: fiAims }, from: brg(330), call: 'Aircraft diving on Ford Island!' }),
      e({ kind: 'val', role: 'dive', n: 18, at: '07:56', targets: [], ground: { x: HICKAM[0], y: HICKAM[1], r: 650, aims: hickamAims }, from: brg(200) }),
      e({ kind: 'kate', role: 'torpedo', n: 6, at: '07:56', targets: ['USS Utah'], hits: 2, from: NW, release: 450, call: 'Torpedo planes attacking the ships north-west of Ford Island!' }),
      e({ kind: 'kate', role: 'torpedo', n: 2, at: '07:57', targets: ['USS Raleigh'], hits: 1, from: NW, release: 450 }),
      e({ kind: 'kate', role: 'torpedo', n: 9, at: '07:57', targets: ['USS Oklahoma'], hits: 7, from: SE, release: 500, call: 'Torpedo planes coming in low over Southeast Loch!' }),
      e({ kind: 'kate', role: 'torpedo', n: 9, at: '07:58', targets: ['USS West Virginia'], hits: 7, from: SE, release: 500 }),
      e({ kind: 'kate', role: 'torpedo', n: 4, at: '07:59', targets: ['USS Helena'], hits: 1, from: brg(255), release: 380 }),
      e({ kind: 'kate', role: 'torpedo', n: 4, at: '08:00', targets: ['USS California'], hits: 2, from: brg(150), release: 480 }),
      e({ kind: 'kate', role: 'torpedo', n: 2, at: '08:02', targets: ['USS Nevada'], hits: 1, from: SE, release: 480 }),
      e({ kind: 'zero', role: 'fighter', n: 6, at: '08:01', targets: ['USS Curtiss', 'USS Monaghan'], from: brg(320) }),
      // the 800 kg armour-piercing bombs: Hiryu's level bombers put four into Arizona at 08:06
      e({ kind: 'kate', role: 'level', n: 10, at: '08:05', targets: ['USS Tennessee'], hits: 2, from: brg(200), load: 'apbomb' }),
      e({ kind: 'kate', role: 'level', n: 10, at: '08:06', targets: ['USS Arizona'], hits: 4, magazine: true, from: brg(205), load: 'apbomb', call: 'High-level bombers over Battleship Row!' }),
      e({ kind: 'kate', role: 'level', n: 10, at: '08:08', targets: ['USS Maryland'], hits: 2, from: brg(200), load: 'apbomb' }),
      e({ kind: 'kate', role: 'level', n: 9, at: '08:10', targets: ['USS West Virginia', 'USS Tennessee'], hits: 2, from: brg(195), load: 'apbomb' }),
      e({ kind: 'kate', role: 'level', n: 10, at: '08:12', targets: ['USS California'], hits: 0, from: brg(200), load: 'apbomb' }),
      // second wave: level bombers on the airfields, dive bombers after anything moving and the yard
      e({ kind: 'kate', role: 'level', n: 18, at: '08:56', targets: [], ground: { x: HICKAM[0], y: HICKAM[1], r: 700, aims: hickamAims }, from: brg(180), call: 'Second wave! More aircraft coming in from the east.' }),
      e({ kind: 'kate', role: 'level', n: 9, at: '08:58', targets: [], ground: { x: FORD_ISLAND[0], y: FORD_ISLAND[1], r: 500, aims: fiAims }, from: brg(30) }),
      e({ kind: 'val', role: 'dive', n: 14, at: '08:55', targets: ['USS Nevada'], hits: 5, from: brg(80) }),
      e({ kind: 'val', role: 'dive', n: 6, at: '08:58', targets: ['USS Shaw'], hits: 3, from: brg(60) }),
      e({ kind: 'val', role: 'dive', n: 6, at: '09:00', targets: ['USS Pennsylvania'], hits: 1, from: brg(90) }),
      e({ kind: 'val', role: 'dive', n: 6, at: '09:02', targets: ['USS Downes', 'USS Cassin'], hits: 2, from: brg(90) }),
      e({ kind: 'val', role: 'dive', n: 4, at: '09:05', targets: ['USS Curtiss'], hits: 1, from: brg(20) }),
      e({ kind: 'val', role: 'dive', n: 4, at: '09:06', targets: ['USS Raleigh'], hits: 0, from: brg(40) }),
      // dive bombers after the destroyers standing out (free aim at the player's ship; historically no hits)
      e({ kind: 'val', role: 'dive', n: 3, at: '09:08', targets: ['USS Monaghan', 'USS Dale'], hits: this.mission.side === 'allied' ? undefined : 0, from: brg(60) }),
      e({ kind: 'val', role: 'dive', n: 4, at: '09:12', targets: ['USS Helena', 'USS Honolulu'], hits: 0, from: brg(100) }),
      e({ kind: 'zero', role: 'fighter', n: 9, at: '08:57', targets: [], ground: { x: FORD_ISLAND[0], y: FORD_ISLAND[1], r: 600, aims: fiAims }, from: brg(10) }),
    ]);
    this.at('07:58', () => this.say('AIR RAID PEARL HARBOR. THIS IS NOT DRILL.', 'alert'));
    this.at('08:00', () => {
      // the destroyers' crews close up at general quarters
      for (const n of ['USS Monaghan', 'USS Dale', 'USS Farragut', 'USS Aylwin']) { const v = this.ship(n); if (v) v.leakControl = 1; }
      if (this.mission.side === 'allied') this.say('General quarters! Gun crews closed up. Ring down for speed when ready to get under way.', 'crew', 'allied');
      // the torpedo that hit Helena ran under Oglala and burst against both hulls
      // her seams sprung, she had no power of her own (it came from Helena) to pump: a slow, steady leak
      const o = this.ship('USS Oglala');
      if (o?.alive) { o.leakControl = 0; for (let i = 0; i < o.ingress.length; i++) o.ingress[i] += i % 2 === 0 ? 0.00008 : 0.00004; }
    });
    this.at('08:27', () => {
      const m = this.monaghan;
      if (!m?.alive) return;
      if (m.isPlayer) { if (m.moored) this.say('Monaghan: get under way and join Ward off the harbour entrance.', 'radio', 'allied'); return; }
      // AI Monaghan: casts off and patrols the North Channel with her sound gear
      m.moored = null;
      m.ai = new HarborPatrol(m, new EscortAI(this.world, m, anchor(this, P(21.3720, -157.9665)), { ahead: 0, side: 0 }), NORTH_PATROL);
    });
    this.at('08:36', () => this.say('Curtiss: submarine periscope in the North Channel, 700 yards off our starboard quarter!', 'alert'));
    this.at('08:40', () => {
      // Nevada gets under way without tugs and makes for the channel past the burning Arizona
      const n = this.ship('USS Nevada');
      if (!n?.alive) return;
      n.moored = null;
      // she backs and walks herself out sideways from F-8 into the channel (Arizona lay 65 m ahead), then
      // steams down Battleship Row outboard of the wrecks, past the burning Arizona
      const b: Pt = [n.pos.x, n.pos.y], out = beside(b, 235, -150);
      this.say('Nevada is getting under way!', 'info');
      this.warp(n, out[0], out[1], brg(225), 150, () => {
        n.moored = null;
        n.ai = new RouteAI(n, [beside(along(b, 235, 700), 235, -150), beside(along(b, 235, 1400), 235, -140), ...MAIN_CHANNEL.slice(0, 2), HOSPITAL_POINT], 10, () => this.beachNevada(), true);
      });
    });
    for (const [t, name] of [['08:45', 'USS Dale'], ['08:52', 'USS Farragut'], ['08:58', 'USS Aylwin']] as const) {
      this.at(t, () => {
        const v = this.ship(name);
        if (!v?.alive || v.isPlayer) return;
        v.moored = null;
        v.ai = new RouteAI(v, NORTH_CHANNEL, 18);
      });
    }
    this.at('09:30', () => {
      // fire reached Shaw's forward magazine
      const s = this.ship('USS Shaw');
      if (s?.alive && s.hpFrac < 0.95) this.raid.magazineExplosion(s);
    });
    // the capsizes, once enough water is in them (the times are when they went over)
    const roll = (name: string, side: 'port' | 'starboard', min: number, t: string) => this.at(t, () => {
      const v = this.ship(name);
      if (v && v.hydro.floodTotal() > 0.2) { this.capsize(v, side, min); this.say(`${name} is rolling over!`, 'alert'); }
    });
    roll('USS Oklahoma', 'port', 4, '08:04');
    roll('USS Utah', 'port', 5, '08:07');
    roll('USS Oglala', 'port', 8, '09:52');
    this.at('09:45', () => this.say('The last Japanese aircraft are leaving.', 'info'));
    this.at('10:02', () => this.finish());
  }

  private beachNevada() {
    if (this.nevadaBeached) return;
    this.nevadaBeached = true;
    const n = this.ship('USS Nevada');
    if (!n?.alive) return;
    n.ai = null; n.speedCmd = 0; n.course = n.heading;
    n.moored = { x: n.pos.x, y: n.pos.y, h: n.heading };
    this.say('Nevada has run herself aground at Hospital Point to keep the channel clear.', 'info');
  }

  protected tick(_dt: number) {
    const w = this.world, p = w.player;
    // Nevada, badly hit before she reaches the point, is put on the beach where she is
    const n = this.ship('USS Nevada');
    if (n?.alive && n.ai instanceof RouteAI && n.hpFrac < 0.35) this.beachNevada();
    if (this.mission.side === 'allied') {
      if (this.oUnderway && this.oUnderway.state === 'open' && p && !p.moored) this.oUnderway.state = 'done';
      // leaving through the entrance after the submarine is dead ends the battle early
      if (p?.alive && this.oSub?.state === 'done' && p.pos.y > P(21.318, -157.967)[1]) { if (this.oSurvive) this.oSurvive.state = 'done'; this.end('victory', 'Monaghan stands out to sea through the harbour entrance.'); }
    } else {
      const m = this.midget!;
      const left = m.tubes.filter((t) => t.loaded).length;
      if (m.alive && left === 0 && this.firedAt < 0) this.firedAt = w.time;
      if (m.alive && this.firedAt >= 0 && w.time - this.firedAt > 240) this.finish();
    }
  }
  private firedAt = -1;

  private finish() {
    const p = this.world.player;
    if (this.mission.over) return;
    if (!p?.alive) return;
    if (this.oSurvive) this.oSurvive.state = 'done';
    if (this.mission.side === 'allied') {
      const subDead = this.oSub?.state === 'done';
      this.end(subDead ? 'victory' : 'withdrew', subDead ? 'The raid is over. The midget submarine that got into the harbour is on the bottom.' : 'The raid is over, but the midget submarine was never found.');
    } else {
      const m = this.midget!, unfired = m.tubes.filter((t) => t.loaded).length;
      const reason = this.oHit?.state === 'done' ? 'Your torpedo struck home. The boat slips away to await recovery.'
        : unfired === m.tubes.length ? 'The raid is over; the boat lies low with both torpedoes unfired.'
        : `Torpedoes spent without hitting a battleship (${this.torpHits} hits).`;
      this.end(this.oHit?.state === 'done' ? 'victory' : 'withdrew', reason);
    }
  }
}

/**
 * A destroyer inside the harbour: steams to a listening point and lies there while the escort AI has nothing
 * to prosecute (its open-sea screening station would drive her into the banks), handing over for a contact.
 */
class HarborPatrol {
  debug = '';
  private route: RouteAI;
  constructor(private v: Vessel, private esc: EscortAI, pts: Pt[]) { this.route = new RouteAI(v, pts, 12); }
  update(dt: number) {
    this.esc.update(dt);
    if (this.esc.state !== 'station') { this.debug = this.esc.debug; this.route.i = 0; return; }
    // drifted off the listening point: steam back to it
    const [x, y] = this.route.pts[0];
    if (this.route.i > 0 && Math.hypot(x - this.v.pos.x, y - this.v.pos.y) > 250) this.route.i = 0;
    this.route.update(dt);
    this.debug = 'listening, ' + this.route.debug;
  }
}

/** a fixed point in the harbour for the escort AI to keep station on */
function anchor(s: Scenario, at: Pt) {
  const c = new Convoy(s.world, 0);
  c.x = at[0]; c.y = at[1]; c.zigzag = false;
  return c;
}

/**
 * The midget submarine's last hour as the reports describe it: waiting at periscope depth in the North
 * Channel, sighted at 08:36, surfacing to fire at Curtiss at 08:40 (a miss that hit a dock at Pearl City),
 * then the second torpedo at the destroyer charging down on her (it ran past into the Ford Island bank).
 */
class MidgetAI {
  debug = '';
  private shots = 0;
  constructor(private s: PearlHarbor, private v: Vessel) {}
  update(_dt: number) {
    const v = this.v, s = this.s, sub = v.sub!, w = s.world;
    sub.periscopeUp = true;
    if (w.time < s.T('08:38')) { sub.orderedDepth = 5; v.course = v.heading; v.speedCmd = 0.08; this.debug = 'waiting'; return; }
    if (w.time < s.T('08:40')) { sub.orderedDepth = 2.4; v.speedCmd = 0.2; this.debug = 'surfacing'; return; }
    const target = this.shots === 0 ? s.ship('USS Curtiss') : s.monaghan;
    if (this.shots < 2 && target?.alive && w.time > s.T(this.shots === 0 ? '08:40' : '08:43')) {
      const lv = target.body.linvel();
      const sol = intercept(v.pos.x, v.pos.y, target.pos.x, target.pos.y, lv.x, lv.y, 44 * KNOT);
      // both ran wide: the boat was broached and pitching (one hit a dock at Pearl City, one the Ford Island
      // bank). Pick a miss whose track crosses no other hull either.
      const base = sol ? sol.heading : Math.atan2(target.pos.y - v.pos.y, target.pos.x - v.pos.x);
      const clear = (a: number) => w.vessels.every((o) => {
        if (o === v || !o.alive) return true;
        const dx = o.pos.x - v.pos.x, dy = o.pos.y - v.pos.y, along = dx * Math.cos(a) + dy * Math.sin(a);
        return along < 0 || along > 3000 || Math.abs(-dx * Math.sin(a) + dy * Math.cos(a)) > o.cls.length / 2 + 25;
      });
      const aim = base + ([0.14, -0.14, 0.22, -0.22, 0.32, -0.32].find((o) => clear(base + o)) ?? 0.4);
      // come round onto the firing course first: a torpedo leaves along the boat's heading before its gyro
      // turns it, and a wide turn would carry it through the destroyer nest
      v.course = aim; v.speedCmd = 0.3;
      if (Math.abs(angleDiff(v.heading, aim)) < 0.2 && w.projectiles.fireTorpedo(v, aim, { target })) this.shots++;
      this.debug = 'firing';
      return;
    }
    if (this.shots >= 1) sub.orderedDepth = 8;
    v.speedCmd = 0.4;
    this.debug = 'diving';
  }
}
