// Player command of an escort or a U-boat: helm (telegraph + rudder) or direct steering, mouse /
// stick aiming, guns, depth charges, ASDIC, torpedoes with TDC assistance, periscope, depth
// orders, searchlight, abilities, target selection and time compression.

import type { Input } from '../input/input';
import type { Camera } from '../render/camera';
import type { Mission } from './mission';
import type { Vessel } from './vessel';
import { TELEGRAPH } from './vessel';
import { AbilityRunner, aimCourse, type AbilityCtx } from './abilities';
import { angleDiff, clamp, damp, KNOT, wrapAngle } from '../core/math';
import { dev } from '../core/devSettings';
import { intercept } from './ai/uboat';
import { Assist } from './assist';

export const CHARGE_DEPTHS = [25, 45, 70, 100, 140, 190];
export const TIME_STEPS = [1, 2, 4, 8, 16];

export class PlayerControl {
  aimX = 0; aimY = 0;
  /** aim offset in world meters for gamepad (relative to ship) */
  private padAim = { x: 200, y: 0 };
  chargeDepthIdx = 2;
  target: Vessel | null = null;
  abilities: AbilityRunner;
  timeIdx = 0;
  weaponMode: 'torpedo' | 'gun' = 'torpedo';
  freeCam = false;
  /** last torpedo solution for HUD */
  solution: { heading: number; tx: number; ty: number; t: number } | null = null;
  lastRudderInput = 0;
  private holdFire = 0;
  /** the touch controls are in charge (set by the touch overlay every frame) */
  mobile = false;
  /** touch: charge depth follows the plot instead of chargeDepthIdx */
  chargeDepthAuto = true;
  /** touch-play helpers: target picking, auto attack, context actions */
  readonly assist: Assist;
  private autoPingT = 0;

  constructor(private m: Mission, private input: Input, private cam: Camera) {
    this.abilities = new AbilityRunner(m.world.player!);
    this.assist = new Assist(m, this);
  }

  get v(): Vessel | null { return this.m.world.player; }
  get timeScale() { return TIME_STEPS[this.timeIdx]; }
  get chargeDepth() { return this.mobile && this.chargeDepthAuto ? Math.round(this.assist.chargeDepth() / 5) * 5 : CHARGE_DEPTHS[this.chargeDepthIdx]; }

  ctx(): AbilityCtx {
    return { world: this.m.world, v: this.v!, aimX: this.aimX, aimY: this.aimY, chargeDepth: this.chargeDepth, pack: this.m.pack, target: this.target };
  }

  /** per-frame input handling (real dt) */
  update(dt: number) {
    const v = this.v, inp = this.input, w = this.m.world;
    // ---- time compression
    const maxT = parseInt(dev.str('game.maxCompression')) || 8;
    if (inp.pressed('timeUp')) this.timeIdx = Math.min(TIME_STEPS.findIndex((t) => t >= maxT), this.timeIdx + 1);
    if (inp.pressed('timeDown')) this.timeIdx = Math.max(0, this.timeIdx - 1);
    if (TIME_STEPS[this.timeIdx] > maxT) this.timeIdx = 0;
    // ---- zoom
    if (inp.pressed('zoomIn')) this.cam.zoomBy(1.15);
    if (inp.pressed('zoomOut')) this.cam.zoomBy(1 / 1.15);
    if (inp.pressed('camera')) this.freeCam = !this.freeCam;
    if (!v) return;
    // ---- aim point
    if (inp.usingPad) {
      if (Math.abs(inp.rx) + Math.abs(inp.ry) > 0.05) {
        const reach = 1100;
        this.padAim.x += inp.rx * reach * dt * 1.8;
        this.padAim.y += inp.ry * reach * dt * 1.8;
        const l = Math.hypot(this.padAim.x, this.padAim.y);
        if (l > reach) { this.padAim.x *= reach / l; this.padAim.y *= reach / l; }
      }
      this.aimX = v.pos.x + this.padAim.x; this.aimY = v.pos.y + this.padAim.y;
      // aim assist: pull toward the nearest contact near the reticle
      const assist = dev.num('game.aimAssist');
      if (assist > 0) {
        let best: { x: number; y: number } | null = null, bd = 120 * assist;
        for (const c of w.sensors.list(v.side)) { const d = Math.hypot(c.x - this.aimX, c.y - this.aimY); if (d < bd && w.time - c.last < 20) { bd = d; best = c; } }
        if (best) { this.aimX += (best.x - this.aimX) * assist * 0.6; this.aimY += (best.y - this.aimY) * assist * 0.6; }
      }
    } else if (this.mobile) {
      // touch: a dragging finger aims; otherwise the reticle rides the locked target or stays put
      if (inp.touchAxes.aiming) { const [wx, wy] = this.cam.toWorld(inp.mx, inp.my, 0); this.aimX = wx; this.aimY = wy; }
      else if (this.target?.alive) { const p = this.assist.posOf(this.target); if (p) { this.aimX = p.x; this.aimY = p.y; } }
    } else {
      const [wx, wy] = this.cam.toWorld(inp.mx, inp.my, 0);
      this.aimX = wx; this.aimY = wy;
    }
    if (!v.alive) return;
    this.abilities.update(dt * this.timeScale);
    // ---- steering
    const scheme = dev.str('controls.scheme');
    const [mx, my] = inp.moveAxes();
    const padSteer = inp.usingPad && (Math.abs(inp.lx) + Math.abs(inp.ly) > 0);
    if (this.mobile) {
      // touch: the stick points the course, which holds when the thumb lifts; the throttle sets the telegraph
      const t = inp.touchAxes;
      if (Math.hypot(t.x, t.y) > 0.3) v.course = Math.atan2(t.y, t.x);
    } else if (scheme === 'direct' || inp.device === 'touch' || (padSteer && scheme === 'direct')) {
      // a touch stick without the touch controls (controls.touch off) still steers directly
      if (Math.abs(mx) + Math.abs(my) > 0.1) {
        v.course = Math.atan2(my, mx);
        v.speedCmd = clamp(Math.hypot(mx, my), 0, 1);
      } else if (v.speedCmd !== null && v.speedCmd !== 0) {
        v.speedCmd *= 1 - damp(0.6, dt);
      }
    } else {
      if (inp.pressed('throttleUp') && !(v.sub && inp.codeDown('Pad12') && false)) v.setTelegraph(v.telegraph + 1);
      if (inp.pressed('throttleDown')) v.setTelegraph(v.telegraph - 1);
      if (inp.usingPad && Math.abs(inp.ly) > 0.7) {
        if (!this.stickLatch) { v.setTelegraph(v.telegraph + (inp.ly < 0 ? 1 : -1)); this.stickLatch = true; }
      } else this.stickLatch = false;
      const rud = inp.usingPad ? inp.lx : (inp.down('rudderLeft') ? -1 : 0) + (inp.down('rudderRight') ? 1 : 0);
      if (Math.abs(rud) > 0.05) { v.course = null; v.rudderCmd = clamp(rud, -1, 1); this.lastRudderInput = rud; }
      else if (v.course === null) v.rudderCmd = 0;
    }
    if (inp.pressed('alt') && dev.bool('controls.mouseSteer') && !inp.usingPad) {
      v.course = Math.atan2(this.aimY - v.pos.y, this.aimX - v.pos.x);
    }
    // ---- target selection
    if (inp.pressed('target')) this.cycleTarget();
    if (this.target && !this.target.alive) this.target = null;
    // ---- abilities (pad: hold L1 for slots 5-6)
    const mod = inp.down('abilityMod');
    for (let i = 0; i < 6; i++) {
      const act = (['ability1', 'ability2', 'ability3', 'ability4', 'ability5', 'ability6'] as const)[i];
      if (inp.pressed(act)) {
        const slot = mod && i < 2 ? i + 4 : i;
        if (!(mod && inp.usingPad && i >= 2)) this.abilities.trigger(slot, this.ctx());
      }
    }
    if (v.kind === 'escort') this.escort(dt); else if (v.sub) this.uboat(dt);
  }
  private stickLatch = false;

  private cycleTarget() {
    const v = this.v!, w = this.m.world;
    const list = w.vessels.filter((o) => o.alive && o.side !== v.side && (w.isVisibleToPlayer(o) || w.sensors.contacts[v.side].has(o.id)))
      .sort((a, b) => Math.hypot(a.pos.x - this.aimX, a.pos.y - this.aimY) - Math.hypot(b.pos.x - this.aimX, b.pos.y - this.aimY));
    if (!list.length) { this.target = null; return; }
    const i = this.target ? list.indexOf(this.target) : -1;
    this.target = list[(i + 1) % list.length];
  }

  private escort(dt: number) {
    const v = this.v!, inp = this.input, w = this.m.world, P = w.projectiles;
    // charge depth setting
    if (inp.pressed('depthUp')) this.chargeDepthIdx = Math.max(0, this.chargeDepthIdx - 1);
    if (inp.pressed('depthDown')) this.chargeDepthIdx = Math.min(CHARGE_DEPTHS.length - 1, this.chargeDepthIdx + 1);
    // guns: every turret that bears tracks the aim point; hold fire to shoot (auto attack: the guns pick
    // a visible surfaced U-boat themselves)
    const auto = this.assist.enabled && this.assist.gunsAuto ? this.assist.gunTarget() : null;
    const firing = inp.down('fire') || inp.r2 > 0.35 || !!auto;
    const gx = auto ? auto.pos.x : this.aimX, gy = auto ? auto.pos.y : this.aimY;
    for (const g of v.guns) {
      const on = P.aimGun(v, g, gx, gy, dt);
      if (firing && on && g.reload <= 0) P.fireGun(v, g, gx, gy);
    }
    if (inp.pressed('charge')) P.dropCharge(v, 'rail', this.chargeDepth);
    if (inp.pressed('chargePort')) P.dropCharge(v, 'port', this.chargeDepth);
    if (inp.pressed('chargeStbd')) P.dropCharge(v, 'stbd', this.chargeDepth);
    // manual ASDIC ping toward the aim point; auto attack keeps a fresh contact in the beam
    this.pingCd -= dt * this.timeScale;
    this.autoPingT -= dt * this.timeScale;
    if (inp.pressed('ping') && this.pingCd <= 0) this.ping(Math.atan2(this.aimY - v.pos.y, this.aimX - v.pos.x));
    if (this.assist.enabled && this.pingCd <= 0 && this.autoPingT <= 0) {
      const brg = this.assist.autoPingBearing();
      if (brg !== null) { this.ping(brg); this.autoPingT = 3; }
    }
    // searchlight
    if (inp.pressed('searchlight') && !v.stats.has('ks_star_gazer')) v.searchlightOn = !v.searchlightOn;
    if (v.searchlightOn) {
      const want = wrapAngle(Math.atan2(this.aimY - v.pos.y, this.aimX - v.pos.x) - v.heading);
      v.searchlightYaw = wrapAngle(v.searchlightYaw + clamp(angleDiff(v.searchlightYaw, want), -1.4 * dt, 1.4 * dt));
    }
    // creeping attack: an AI escort keeps sub contacts near you firm
    if (v.creeping > 0) {
      for (const c of w.sensors.list(v.side)) if (c.truth && c.kind === 'sub' && Math.hypot(c.x - v.pos.x, c.y - v.pos.y) < 1400) {
        c.x += (c.truth.pos.x - c.x) * 0.2; c.y += (c.truth.pos.y - c.y) * 0.2; c.err = Math.max(15, c.err * 0.9); c.last = w.time;
      }
    }
    if (v.revealUntil > w.time) void 0;
  }
  private pingCd = 0;
  private ping(brg: number) {
    const v = this.v!, arc = dev.str('game.asdic') === 'arcade' ? Math.PI * 2 : 16 * Math.PI / 180;
    this.m.world.sensors.ping(v, brg, arc);
    this.pingCd = 2.2 / v.stats.mul('ping_rate_pct');
  }
  /** touch PING: on the contact, or sweeping the bow */
  smartPing() { const v = this.v; if (v?.alive && v.kind === 'escort' && this.pingCd <= 0) this.ping(this.assist.pingBearing()); }
  /** touch D/C: a salvo from the stern rails and both throwers */
  dropSalvo() {
    const v = this.v, P = this.m.world.projectiles;
    if (!v?.alive || v.kind !== 'escort') return;
    for (const side of ['rail', 'port', 'stbd'] as const) P.dropCharge(v, side, this.chargeDepth);
  }
  /** touch: lock the enemy nearest a tapped world point; false when none was close enough */
  selectAt(wx: number, wy: number, radius: number): boolean {
    const v = this.v, w = this.m.world;
    if (!v) return false;
    let best: Vessel | null = null, bd = radius;
    for (const o of w.vessels) {
      if (!o.alive || o.side === v.side) continue;
      const p = this.assist.posOf(o);
      if (!p) continue;
      const d = Math.hypot(p.x - wx, p.y - wy) - o.cls.length * 0.4;
      if (d < bd) { bd = d; best = o; }
    }
    if (best) this.target = best;
    return !!best;
  }

  private uboat(dt: number) {
    const v = this.v!, s = v.sub!, inp = this.input, w = this.m.world, P = w.projectiles, sc = v.cls.sub!;
    // depth orders
    const step = inp.down('abilityMod') ? 50 : 10;
    if (inp.pressed('depthUp')) s.orderedDepth = Math.max(0, s.orderedDepth - step);
    if (inp.pressed('depthDown')) s.orderedDepth = Math.min(sc.crushDepth, s.orderedDepth + step);
    if (inp.pressed('surface')) { s.orderedDepth = 0; }
    if (inp.pressed('periscopeDepth')) { s.orderedDepth = sc.periscopeDepth; }
    if (!dev.bool('game.autoDepth')) {
      // manual planes: Q/E hold acts on the planes, ballast follows orders slowly
      s.planes = inp.down('depthUp') ? 0.8 : inp.down('depthDown') ? -0.8 : s.planes * (1 - damp(2, dt));
    }
    if (inp.pressed('periscope')) s.periscopeUp = !s.periscopeUp;
    if (inp.pressed('ping') && v.guns.length && !v.stats.has('ks_silent_hunter')) this.weaponMode = this.weaponMode === 'torpedo' ? 'gun' : 'torpedo';
    if (this.weaponMode === 'gun' && (!s.surfaced || !v.guns.length)) this.weaponMode = 'torpedo';
    // TDC: solution to the locked target or straight at the aim point
    const tgt = this.target ?? this.hoverTarget();
    this.updateSolution(tgt);
    const fireNow = inp.pressed('fire') || (inp.r2 > 0.6 && this.holdFire <= 0);
    if (inp.r2 > 0.6) this.holdFire = 0.4; else this.holdFire = Math.max(0, this.holdFire - dt);
    if (this.weaponMode === 'gun') {
      for (const g of v.guns) {
        const on = P.aimGun(v, g, this.aimX, this.aimY, dt);
        const auto = (v.deckGunBoost > 0 || (this.assist.enabled && this.assist.gunsAuto)) && tgt;
        if ((inp.down('fire') || inp.r2 > 0.35 || auto) && on && g.reload <= 0) P.fireGun(v, g, auto && tgt ? tgt.pos.x : this.aimX, auto && tgt ? tgt.pos.y : this.aimY);
      }
    } else {
      for (const g of v.guns) P.aimGun(v, g, this.aimX, this.aimY, dt);
      if (fireNow) this.launch(tgt);
    }
    void aimCourse; void TELEGRAPH;
  }

  /** the TDC solution on `tgt` (none with manual aiming or no intercept) */
  private updateSolution(tgt: Vessel | null) {
    const v = this.v!, w = this.m.world, spec = v.cls.torpedoes!, mode = dev.str('game.tdc');
    this.solution = null;
    if (!tgt || mode === 'manual') return;
    const c = w.sensors.contacts[v.side].get(tgt.id);
    const exact = mode === 'auto' || v.scanUntil > w.time;
    const tx = exact || !c ? tgt.pos.x : c.x, ty = exact || !c ? tgt.pos.y : c.y;
    const vel = exact || !c ? tgt.body.linvel() : { x: c.vx, y: c.vy };
    const sol = intercept(v.pos.x, v.pos.y, tx, ty, vel.x, vel.y, spec.speedKn * KNOT * v.stats.mul('torpedo_speed_pct'));
    if (sol) this.solution = { heading: sol.heading, tx: tx + vel.x * sol.t, ty: ty + vel.y * sol.t, t: sol.t };
  }

  /** one torpedo along the solution (straight at the reticle without one): bow tubes, or the stern tube aft */
  private launch(tgt: Vessel | null): boolean {
    const v = this.v!, w = this.m.world;
    const course = this.solution ? this.solution.heading : Math.atan2(this.aimY - v.pos.y, this.aimX - v.pos.x);
    const stern = Math.abs(angleDiff(v.heading, course)) > Math.PI * 0.6 && v.tubes.some((t) => t.stern && t.loaded);
    const single = v.stats.has('ks_one_torpedo') ? 1.8 : 1;
    if (w.projectiles.fireTorpedo(v, course, { stern, target: tgt, damageMul: single })) return true;
    w.emit('message', { text: 'No tube ready!', kind: 'crew' });
    return false;
  }

  /** touch FIRE: lock the best target when none is locked, then one torpedo along the solution */
  fireAssisted() {
    const v = this.v, w = this.m.world;
    if (!v?.alive || !v.sub) return;
    if (!this.target?.alive) this.target = this.assist.bestTorpedoTarget();
    const tgt = this.target;
    if (!tgt) { w.emit('message', { text: 'No target in sight.', kind: 'crew' }); return; }
    const p = this.assist.posOf(tgt);
    if (p) { this.aimX = p.x; this.aimY = p.y; }
    this.updateSolution(tgt);
    if (!this.solution && dev.str('game.tdc') !== 'manual') { w.emit('message', { text: `No firing solution on ${tgt.name}.`, kind: 'crew' }); return; }
    this.launch(tgt);
  }

  /** enemy vessel under the reticle */
  hoverTarget(): Vessel | null {
    const w = this.m.world, v = this.v!;
    let best: Vessel | null = null, bd = 60;
    for (const o of w.vessels) {
      if (!o.alive || o.side === v.side) continue;
      if (!w.isVisibleToPlayer(o) && !w.sensors.contacts[v.side].has(o.id)) continue;
      const c = w.sensors.contacts[v.side].get(o.id);
      const ox = c && !w.isVisibleToPlayer(o) ? c.x : o.pos.x, oy = c && !w.isVisibleToPlayer(o) ? c.y : o.pos.y;
      const d = Math.hypot(ox - this.aimX, oy - this.aimY) - o.cls.length * 0.4;
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  /** camera follow with look-ahead */
  updateCamera(dt: number) {
    const v = this.v, cam = this.cam, inp = this.input;
    if (!v) return;
    if (this.freeCam) {
      cam.x -= inp.dragX / cam.zoom; cam.y -= inp.dragY / (cam.zoom * cam.cosT);
      if (inp.usingPad) { cam.x += inp.rx * 600 * dt / cam.zoom; cam.y += inp.ry * 600 * dt / cam.zoom; }
      return;
    }
    const la = dev.num('camera.lookAhead');
    let ax = (this.aimX - v.pos.x) * la * 0.5, ay = (this.aimY - v.pos.y) * la * 0.5;
    if (this.mobile) {
      // touch: lead toward the locked target, else ahead of the bow; a tapped aim point stays put in the
      // world and would pull the view off the boat as it sails on
      const p = this.target?.alive ? this.assist.posOf(this.target) : null, lv = v.body.linvel();
      ax = p ? (p.x - v.pos.x) * la * 0.5 : lv.x * 20 * la;
      ay = p ? (p.y - v.pos.y) * la * 0.5 : lv.y * 20 * la;
    }
    // touch screens (a narrow portrait one above all) keep the boat well inside the view
    const lim = (this.mobile ? Math.min(cam.W, cam.H) * 0.3 : 260) / cam.zoom;
    const tx = v.pos.x + clamp(ax, -lim, lim), ty = v.pos.y + clamp(ay, -lim * 0.7, lim * 0.7);
    cam.follow(tx, ty, dt, dev.num('camera.follow'));
    if (inp.dragX || inp.dragY) { this.freeCam = true; }
  }
}
