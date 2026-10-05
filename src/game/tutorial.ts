// Guided first missions for both sides. A coach panel on the HUD walks a new captain through the
// helm, the sensors and the weapons one action at a time. Steps complete from what actually happens
// in the world (the boat is under way, it dived, a torpedo hit), info steps advance after a reading
// pause, and Enter (or the pause menu) skips a step. The battle itself is an ordinary arena mission
// set up to be gentle: daylight, a calm sea, a small convoy, one escort or one U-boat, a toughened hull.

import type { Mission } from './mission';
import type { PlayerControl } from './player';
import type { Action, Input } from '../input/input';
import type { Vessel } from './vessel';
import type { AbilityId } from '../meta/types';
import { StatBlock } from '../meta/stats';
import { SRC } from './sensors';
import { audio } from '../audio/audio';
import { dev } from '../core/devSettings';
import { angleDiff, KNOT } from '../core/math';

export type TutorialSide = 'uboat' | 'escort';

const GENTLE: Record<string, number | string | boolean> = {
  'arena.year': 1942, 'arena.difficulty': 1, 'arena.theater': 'north_atlantic', 'arena.hour': 10, 'arena.timeFlow': 0,
  'arena.moon': 0.5, 'arena.season': '0', 'arena.weather': 'clear', 'arena.seaState': 2.5, 'arena.windDir': 250, 'arena.swell': 0.8,
  'arena.layer': 70, 'arena.convoy': 6, 'arena.columns': 2, 'arena.convoySpeed': 7, 'arena.zigzag': false, 'arena.aircraft': 'none',
  'arena.survivors': true, 'arena.size': 9, 'arena.islands': 0, 'arena.lighthouse': false,
};

/** every arena key the lessons depend on, so the player's own arena settings never leak in */
export const TUTORIAL_ARENA: Record<TutorialSide, Record<string, number | string | boolean>> = {
  uboat: { ...GENTLE, 'arena.side': 'uboat', 'arena.uboatClass': 'type7', 'arena.escorts': 1, 'arena.uboats': 0, 'arena.seed': 4242 },
  escort: { ...GENTLE, 'arena.side': 'escort', 'arena.escortClass': 'destroyer', 'arena.escorts': 0, 'arena.uboats': 1, 'arena.seed': 4243 },
};

/** the lesson boat takes 40 % damage, so a mistake teaches instead of ending the lesson */
export function tutorialStats(): StatBlock {
  const s = new StatBlock();
  s.add('damage_taken_pct', -60);
  return s;
}

const STORE = 'wolfpack.tutorial.v1';
/** sides whose tutorial was finished or dismissed (title screen: suggest it until then) */
export function tutorialsDone(): Partial<Record<TutorialSide, boolean>> {
  try { return JSON.parse(localStorage.getItem(STORE) ?? '{}') as Partial<Record<TutorialSide, boolean>>; } catch { return {}; }
}
function markDone(side: TutorialSide) {
  try { localStorage.setItem(STORE, JSON.stringify({ ...tutorialsDone(), [side]: true })); } catch { /* private window */ }
}

/** what the touch controls call each action (src/ui/touch.ts), spelt with glyphs the HUD font has */
const TOUCH: Partial<Record<Action, string>> = {
  ping: 'PING', charge: 'D/C', periscope: 'SCOPE', depthUp: 'DEPTH', depthDown: 'DEPTH', timeUp: '>>', timeDown: '>>', pause: 'MENU', fire: 'FIRE',
  throttleUp: 'THROTTLE', throttleDown: 'THROTTLE', ability1: '★', ability2: '★', ability3: '★', ability4: '★', ability5: '★', ability6: '★',
};

interface Ctx {
  m: Mission; pc: PlayerControl; v: Vessel; inp: Input; t: Tutorial;
  /** `[key]` for an action on the current device */
  k(a: Action): string;
  /** the action has a binding on the current device (keyboard/mouse or pad) */
  bound(a: Action): boolean;
  /** `[key]` of a slotted ability, '' when it is not in the loadout */
  ab(id: AbilityId): string;
  /** rudder + telegraph helm (not direct stick steering) */
  helm: boolean;
  /** the touch controls are in charge: stick, throttle and the fixed buttons */
  touch: boolean;
}

interface Step {
  title: string;
  text: (c: Ctx) => string;
  /** completed? polled every frame; info steps have none and advance after `read` seconds */
  done?: (c: Ctx) => boolean;
  /** seconds the text stays up at least, so a step finished at once still gets read */
  read?: number;
  /** give up waiting and move on after this many seconds */
  timeout?: number;
  enter?: (c: Ctx) => void;
  /** per frame while the step is up (real seconds) */
  tick?: (c: Ctx, dt: number) => void;
  /** leave the step out (e.g. a mouse-only control on a gamepad) */
  skip?: (c: Ctx) => boolean;
}

export interface TutorialView { title: string; body: string; n: number; total: number; done: boolean; alpha: number; footer: string }

export class Tutorial {
  private readonly steps: Step[];
  private idx = -1;
  /** real seconds in the current step, and since it was completed (-1: not yet) */
  private stepT = 0;
  private doneT = -1;
  private fadeT = 0;
  finished = false;
  /** per-step scratch: degrees turned, seconds of hard rudder, time compression tried */
  private turned = 0;
  private lastHeading = 0;
  private rudderT = 0;
  private flag = false;
  /** world events credited to the player since the lesson began */
  private n = { echo: 0, dc: 0, subHits: 0 };

  constructor(readonly side: TutorialSide, private m: Mission, private pc: PlayerControl, private inp: Input) {
    const w = m.world, p = w.player!;
    this.steps = side === 'uboat' ? UBOAT_STEPS : ESCORT_STEPS;
    w.bus.on('echo', (e) => { if (e.by === w.player) this.n.echo++; });
    w.bus.on('dcDrop', (e) => { if (e.by === w.player) this.n.dc++; });
    w.bus.on('damaged', (e) => { if (e.from === w.player && e.v.kind === 'uboat') this.n.subHits++; });
    // under way but slow, so ringing up the telegraph is the first lesson
    p.setTelegraph(3);
    if (side === 'escort') {
      // the lesson U-boat loiters at periscope depth a short run ahead of the destroyer, holding its fire
      // until the player has learnt to find and attack it; the battle outlasts its sinking until the end
      const u = this.enemySub(), f = p.fwd();
      if (u) {
        const a = Math.atan2(f.y, f.x) + 0.45;
        u.body.setTranslation({ x: p.pos.x + Math.cos(a) * 1300, y: p.pos.y + Math.sin(a) * 1300, z: u.pos.z }, true);
        if (u.sub) u.sub.orderedDepth = 13;
      }
      w.holdFire = true;
      m.holdVictory = true;
    }
    this.next();
  }

  private ctx(): Ctx | null {
    const v = this.m.world.player, inp = this.inp, pc = this.pc;
    if (!v) return null;
    const pad = inp.usingPad, touch = pc.mobile || inp.device === 'touch';
    return {
      m: this.m, pc, v, inp, t: this,
      k: (a) => `[${touch ? TOUCH[a] ?? inp.glyph(a) : inp.glyph(a)}]`,
      bound: (a) => touch ? a in TOUCH : inp.bindings[a].some((c) => c.startsWith('Pad') === pad),
      ab: (id) => {
        const i = pc.abilities.slots.findIndex((s) => s?.id === id);
        if (i < 0) return '';
        const keys = ['ability1', 'ability2', 'ability3', 'ability4', 'ability5', 'ability6'] as const;
        return `[${touch ? '★' : pad && i >= 4 ? 'L1+' + inp.glyph(keys[i - 4]) : inp.glyph(keys[i])}]`;
      },
      helm: dev.str('controls.scheme') !== 'direct' && !touch,
      touch,
    };
  }

  get stepTime() { return this.stepT; }
  get turnedDeg() { return this.turned * 180 / Math.PI; }
  get hardRudderTime() { return this.rudderT; }
  get triedCompression() { return this.flag; }
  get playerEchoes() { return this.n.echo; }
  get playerCharges() { return this.n.dc; }
  get subHits() { return this.n.subHits; }
  /** the lesson U-boat (escort side) */
  enemySub(): Vessel | null { return this.m.world.vessels.find((o) => o.alive && o.kind === 'uboat' && !o.isPlayer) ?? null; }
  /** let the lesson U-boat fight back */
  releaseFire() { this.m.world.holdFire = false; }

  /** a lookout keeps the periscope in sight: a fresh visual fix on the lesson U-boat */
  plantSighting() {
    const w = this.m.world, u = this.enemySub();
    if (!u) return;
    w.sensors.fix(w.playerSide, u, u.pos.x + w.rng.gauss(0, 50), u.pos.y + w.rng.gauss(0, 50), 140, SRC.VISUAL, null);
  }

  private next() {
    const c = this.ctx();
    for (this.idx++; this.idx < this.steps.length; this.idx++) if (!c || !this.steps[this.idx].skip?.(c)) break;
    this.stepT = 0; this.doneT = -1; this.turned = 0; this.rudderT = 0; this.flag = false;
    if (c) this.lastHeading = c.v.heading;
    if (this.idx >= this.steps.length) { this.finish(); return; }
    if (c) this.steps[this.idx].enter?.(c);
  }

  private finish() {
    if (this.finished) return;
    this.finished = true;
    this.releaseFire();
    this.m.holdVictory = false;
    markDone(this.side);
  }

  /** per frame, real seconds (reading pauses ignore time compression) */
  update(dt: number) {
    // (Alt+Enter is the fullscreen toggle, not a skip)
    if (this.inp.pressed('tutorialNext') && !this.inp.codeDown('AltLeft') && !this.inp.codeDown('AltRight')) this.skip();
    if (this.finished) { this.fadeT += dt; return; }
    const c = this.ctx(), st = this.steps[this.idx];
    if (!c || !st) return;
    this.stepT += dt;
    this.turned += Math.abs(angleDiff(this.lastHeading, c.v.heading));
    this.lastHeading = c.v.heading;
    if (Math.abs(c.v.rudder) > 0.8) this.rudderT += dt;
    if (this.pc.timeIdx > 0) this.flag = true;
    st.tick?.(c, dt);
    if (this.doneT < 0) {
      const read = st.read ?? 2.5;
      const ok = st.done ? st.done(c) : this.stepT >= read;
      if ((ok && this.stepT >= Math.min(read, 1.2)) || (st.timeout && this.stepT >= st.timeout)) {
        this.doneT = 0;
        audio.play('ui_click');
      }
    } else if ((this.doneT += dt) > 1.3 && this.stepT >= (st.read ?? 2.5)) {
      this.next();
      if (this.finished) audio.play('contract_complete');
    }
  }

  /** skip the current step (Enter or the pause menu); on the last one, close the panel */
  skip() {
    if (this.finished) { this.fadeT = 99; return; }
    this.next();
  }
  /** stop coaching; the battle goes on as free play */
  end() { this.idx = this.steps.length; this.finish(); this.fadeT = 99; }

  /** what the HUD panel shows this frame (null: nothing) */
  view(): TutorialView | null {
    const total = this.steps.length;
    if (this.finished) {
      // the closing words stay up a while after the last step completes
      const last = this.steps[total - 1], c = this.ctx();
      const alpha = Math.max(0, Math.min(1, (3 - this.fadeT) / 1.5));
      if (alpha <= 0 || !c) return null;
      return { title: last.title, body: last.text(c), n: total, total, done: true, alpha, footer: '' };
    }
    const st = this.steps[this.idx], c = this.ctx();
    if (!st || !c) return null;
    const skipKey = c.bound('tutorialNext') ? `${c.k('tutorialNext')} skip step` : `${c.k('pause')} menu: skip step`;
    return { title: (this.doneT >= 0 ? '✓ ' : '') + st.title, body: st.text(c), n: this.idx + 1, total, done: this.doneT >= 0, alpha: 1, footer: skipKey };
  }
}

// ---------------------------------------------------------------- shared steps
const mouseCourse = (c: Ctx) => !c.helm || c.inp.usingPad || !dev.bool('controls.mouseSteer');
const telegraph = (intro: string): Step => ({
  title: 'Engine telegraph',
  text: (c) => c.touch
    ? `${intro} Point the stick under your left thumb where you want to go; the course holds when you let go. Speed is the throttle above it: slide it up to HALF.`
    : c.helm
      ? `${intro} Get her moving: ${c.k('throttleUp')} rings the engine telegraph ahead, ${c.k('throttleDown')} astern. Ring up Half ahead.`
      : `${intro} Steer with the stick or ${c.k('throttleUp')}${c.k('rudderLeft')}${c.k('throttleDown')}${c.k('rudderRight')}: the ship heads where you push, and pushing further makes more speed.`,
  done: (c) => c.v.speedCmd !== null ? c.v.speedCmd > 0.45 : c.v.telegraph >= 4,
  read: 3,
});
// a slow boat turns slowly: holding the rudder hard over for a few seconds counts too
const rudder: Step = {
  title: 'Rudder',
  text: (c) => c.helm
    ? `Hold ${c.k('rudderLeft')} or ${c.k('rudderRight')} to put the rudder over; it stays over while you hold the key and centres when you let go. A ship answers slowly: turn through 25°. (${Math.min(25, Math.round(c.t.turnedDeg))}°)`
    : `${c.touch ? 'Point the stick' : 'Push sideways'} to turn. A ship answers slowly: turn through 25°. (${Math.min(25, Math.round(c.t.turnedDeg))}°)`,
  done: (c) => c.t.turnedDeg >= 25 || c.t.hardRudderTime >= 5,
};
const course: Step = {
  title: 'Set a course',
  text: (c) => `Or let the helmsman steer: ${c.k('alt')} on the sea sets a course toward that point (green ▾ on the compass, CRS on the status panel). The rudder keys take the helm back.`,
  done: (c) => c.v.course !== null && c.t.stepTime > 0.5,
  skip: mouseCourse,
  read: 3,
};
const range = (c: Ctx, x: number, y: number) => Math.round(Math.hypot(x - c.v.pos.x, y - c.v.pos.y) / 10) * 10;

// ---------------------------------------------------------------- the U-boat
/** the locked target's position as the player knows it */
function targetPos(c: Ctx): { x: number; y: number } | null {
  const t = c.pc.target;
  if (!t) return null;
  const w = c.m.world, k = w.sensors.contacts[c.v.side].get(t.id);
  return w.isVisibleToPlayer(t) || !k ? { x: t.pos.x, y: t.pos.y } : { x: k.x, y: k.y };
}
const ownHeard = (c: Ctx) => c.m.world.sensors.list(c.v.side).filter((k) => k.heard.has(c.v.id)).length;

const UBOAT_STEPS: Step[] = [
  telegraph('Welcome aboard, Kaleun. A convoy is steaming in from the west.'),
  rudder,
  course,
  {
    title: 'Hydrophones',
    text: () => 'Your hydrophones hear the convoy: each tick on the ring around the boat is a bearing to a ship. The ♦ marks are where we think they are (circle = how sure). The plot at the top right shows 3 km around you.',
    done: (c) => ownHeard(c) >= 1,
    read: 8,
    timeout: 20,
  },
  {
    title: 'Time compression',
    text: (c) => `The approach takes a while. ${c.touch ? `${c.k('timeUp')} steps time compression up to 8x and round to 1x` : `${c.k('timeUp')} speeds time up (up to 8x), ${c.k('timeDown')} slows it again`}. Try it, then go back to 1x.${c.pc.timeIdx > 0 ? `  (now x${c.pc.timeScale})` : ''}`,
    done: (c) => c.t.triedCompression && c.pc.timeIdx === 0,
    skip: (c) => !c.bound('timeUp') || dev.str('game.maxCompression') === '1',
  },
  {
    title: 'Dive',
    text: (c) => `Dive! ${c.touch ? 'Tap [DIVE] and choose PERISCOPE (13 m).' : `${c.bound('periscopeDepth') ? `${c.k('periscopeDepth')} orders periscope depth (13 m); ` : ''}${c.k('depthDown')} / ${c.k('depthUp')} order 10 m deeper / shallower.`} Submerged you are slow and run on the battery, but hidden.`,
    done: (c) => !!c.v.sub && !c.v.sub.surfaced && c.v.keelDepth >= 10,
  },
  {
    title: 'Periscope',
    text: (c) => `Raise the periscope with ${c.k('periscope')}. At periscope depth you see the ships, and only the periscope can give you away; deeper you are blind and steer by the hydrophones.`,
    done: (c) => !!c.v.sub && c.v.sub.periscope > 0.8,
  },
  {
    title: 'Pick a target',
    text: (c) => `${c.touch ? 'Tap a merchant (or its ♦) to lock it' : `${c.inp.usingPad ? 'Aim the reticle at a merchant with the right stick' : 'Put the reticle on a merchant'}${c.bound('target') ? ` and press ${c.k('target')} to lock the contact nearest to it` : ''}`}. The green line is the torpedo solution: the computer leads the target for you.`,
    // aiming at a ship is the point (touch has no lock button): the lesson locks it for the next steps
    tick: (c) => { if (!c.pc.target && c.t.stepTime > 2) c.pc.target = c.pc.hoverTarget(); },
    done: (c) => !!c.pc.target && c.pc.target.alive,
  },
  {
    title: 'Close in',
    text: (c) => {
      const p = targetPos(c);
      return p ? `Close to under 1500 m for a sure shot (range ${range(c, p.x, p.y)} m); time compression shortens the wait. A long run gives the target time to steer away. Keep an eye on the escort.` : `Lock a target again with ${c.k('target')}.`;
    },
    done: (c) => { const p = targetPos(c); return !!p && range(c, p.x, p.y) < 1600; },
  },
  {
    title: 'Fire',
    text: (c) => `Fire with ${c.k('fire')}: a torpedo runs along the solution, from a bow tube, or the stern tube when the target is astern. Tubes reload one at a time.`,
    done: (c) => c.m.stats.torpedoes >= 1,
  },
  {
    title: 'Torpedo running',
    text: (c) => `The solution shows the run time. Missed? Fire again${c.ab('torpedo_spread') ? `, or fan three at once with Torpedo Spread ${c.ab('torpedo_spread')}` : ''}.`,
    done: (c) => c.m.stats.torpedoHits >= 1,
    read: 4,
  },
  {
    title: 'Go deep',
    text: (c) => `The escort will come for you now. Go deep: ${c.touch ? `tap the depth button and choose ${c.m.world.layerDepth > 0 ? 'UNDER LAYER' : 'DEEP'}` : `${c.k('depthDown')} again and again`}${c.ab('crash_dive') ? `, or Crash Dive ${c.ab('crash_dive')}` : ''}. Below the thermal layer (blue line on the depth gauge, ${c.m.world.layerDepth} m) the ASDIC struggles. Slow down to run quiet${c.ab('silent_running') ? `; Silent Running is ${c.ab('silent_running')}` : ''}.`,
    done: (c) => c.v.keelDepth > Math.max(40, c.m.world.layerDepth) + 5,
    read: 5,
  },
  {
    title: 'Good hunting',
    text: (c) => `That is the patrol: shadow, dive, aim, fire, go deep. Wait for the escort to lose you, then come back up for another attack. ${c.k('pause')} opens the menu.`,
    read: 12,
  },
];

// ---------------------------------------------------------------- the escort
const subDist = (c: Ctx) => {
  const u = c.t.enemySub();
  if (!u) return null;
  const k = c.m.world.sensors.contacts[c.v.side].get(u.id);
  return k ? range(c, k.x, k.y) : null;
};

const ESCORT_STEPS: Step[] = [
  telegraph('You command the destroyer screening this convoy.'),
  rudder,
  course,
  {
    title: 'Periscope sighted',
    text: (c) => {
      const d = subDist(c);
      return `Lookout: periscope! The red ♦ is where it was seen; the circle shows how sure we are. Head for it${d !== null ? ` (${d} m)` : ''}. Red ticks on the ring around your ship are hydrophone bearings on it.`;
    },
    enter: (c) => c.t.plantSighting(),
    // the lookouts keep the periscope in sight until you are close
    tick: (c, dt) => { if (Math.floor(c.t.stepTime / 20) > Math.floor((c.t.stepTime - dt) / 20)) c.t.plantSighting(); },
    done: (c) => { const d = subDist(c); return !c.t.enemySub() || c.t.playerEchoes > 0 || (d !== null && d < 1100); },
    read: 5,
  },
  {
    title: 'Slow down',
    text: (c) => `The ASDIC is deaf at speed, and a fast ship is heard coming. ${c.touch ? 'Slide the throttle down to SLOW' : `Ring down to Slow ahead with ${c.k('throttleDown')}`} (now ${Math.round(Math.abs(c.v.hydro.fwdSpeed) / KNOT)} kn).`,
    done: (c) => !c.t.enemySub() || c.t.playerEchoes > 0 || Math.abs(c.v.hydro.fwdSpeed) / KNOT < 12,
  },
  {
    title: 'ASDIC',
    text: (c) => c.touch
      ? `Tap ${c.k('ping')}: the ASDIC beam trains on the ♦ by itself (auto attack keeps pinging a fresh contact). An echo fixes the U-boat's position.`
      : `Ping with ${c.k('ping')}: the beam goes out toward the reticle${dev.str('game.asdic') === 'arcade' ? ' (arcade: all round)' : ' and is narrow, 16°'}. Sweep across the ♦ until an echo comes back; an echo fixes the U-boat's position.`,
    done: (c) => !c.t.enemySub() || c.t.playerEchoes > 0,
  },
  {
    title: 'Depth charges',
    text: (c) => c.touch
      ? `Run over the contact and tap ${c.k('charge')}: three charges, from the stern rail and both throwers. The depth chip on it follows the plot (now ${c.pc.chargeDepth} m); DROP PATTERN pops up when you are over her.`
      : `Set the charge depth with ${c.k('depthUp')} / ${c.k('depthDown')} (now ${c.pc.chargeDepth} m; she is shallow, 25-45 m). Run over the contact and drop: ${c.k('charge')} rolls one off the stern${c.bound('chargePort') ? `, ${c.k('chargePort')} / ${c.k('chargeStbd')} throw the K-guns to port / starboard` : ''}.`,
    done: (c) => !c.t.enemySub() || c.t.playerCharges > 0,
  },
  {
    title: 'Attack run',
    text: (c) => `One charge rarely does it. Pass over the U-boat again and drop several${c.ab('dc_pattern') ? `, or lay a Depth-Charge Pattern ${c.ab('dc_pattern')}` : ''}. Keep pinging to stay on her: she will fight back now.`,
    enter: (c) => c.t.releaseFire(),
    done: (c) => !c.t.enemySub() || c.t.subHits > 0,
  },
  {
    title: 'Finish her',
    text: (c) => `She will go deep and twist away. ${c.ab('hedgehog') ? `Hedgehog ${c.ab('hedgehog')} throws its bombs ahead of the ship, so you keep ASDIC contact while you attack. ` : ''}Stay on her until she is sunk.`,
    done: (c) => !c.t.enemySub(),
    read: 5,
    timeout: 180,
  },
  {
    title: 'More tools',
    text: (c) => c.touch
      ? `The guns open fire by themselves on a surfaced U-boat ([GUNS] holds fire). At night${c.ab('star_shell') ? `, Star Shell ${c.ab('star_shell')} and` : ''} the searchlight light up the sea; the context button offers them when they help.`
      : `Hold ${c.k('fire')} to fire the guns at the reticle: a surfaced U-boat is a gun target. At night${c.ab('star_shell') ? `, Star Shell ${c.ab('star_shell')} and` : ''} the searchlight ${c.k('searchlight')} light up the sea.`,
    read: 10,
  },
  {
    title: 'Well done',
    text: (c) => `That is the escort's trade: screen, listen, ping, attack, and never stray far from the merchants. ${c.k('pause')} opens the menu.`,
    read: 12,
  },
];
