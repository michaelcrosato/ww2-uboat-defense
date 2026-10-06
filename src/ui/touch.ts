// Touch controls for phones and tablets: their own game layout, not a copy of the mouse-and-keyboard bridge.
//  * Left thumb: a course stick (point where to go; the course holds when the thumb lifts) and above it a
//    throttle with the telegraph steps.
//  * Right thumb: four fixed buttons with silhouette icons per side (U-boat: FIRE, DEPTH, SCOPE/GUN, ★;
//    escort: D/C, PING, GUNS, ★), a context button that appears when one action matters (crash dive, drop a
//    pattern, a star shell...) and pop-ups for depth orders, charge depths and the six abilities.
//  * The sea: tap a ship to lock it (tap open water to let go and aim there), drag to aim, pinch to zoom.
//  * Top right: pause and time compression; the crew's messages are swipeable toasts (src/ui/toasts.ts).
// Missions on a touch device go fullscreen holding their orientation (controls.autoFullscreen); the
// layout follows the screen, portrait (9:16) first. Shown when `controls.touch` is on, or auto on a touch
// device, and only while a mission is under command.

import type { Shell } from './shell';
import type { PlayerControl } from '../game/player';
import type { Vessel } from '../game/vessel';
import type { ContextAction } from '../game/assist';
import { CHARGE_DEPTHS, TIME_STEPS } from '../game/player';
import { dev } from '../core/devSettings';
import { clamp } from '../core/math';
import { ABILITIES } from '../meta/abilities';
import { h } from './dom';
import { iconSvg } from './icons';
import { Toasts } from './toasts';

const STICK_R = 56;
/** throttle notches from the top: telegraph index and label */
const THROTTLE: [number, string][] = [[6, 'FLANK'], [5, 'FULL'], [4, 'HALF'], [3, 'SLOW'], [2, 'STOP'], [1, 'HALF AST'], [0, 'FULL AST']];

interface Btn { el: HTMLElement; ico: HTMLElement; lbl: HTMLElement; badge: HTMLElement; icon: string }
interface PopItem { label: string; glyph?: string; note?: string; active?: boolean; off?: boolean; run: () => void }

export class TouchOverlay {
  readonly el: HTMLElement;
  private world: HTMLElement;
  private base: HTMLElement;
  private knob: HTMLElement;
  private ghost: HTMLElement;
  private throttle: HTMLElement;
  private notches: HTMLElement[] = [];
  private cluster: HTMLElement;
  private btns: Btn[] = [];
  private depthChip: HTMLElement;
  private ctxBtn: Btn;
  private ctxAction: ContextAction | null = null;
  private top: HTMLElement;
  private timeBtn: Btn;
  private backdrop: HTMLElement;
  private pop: HTMLElement;
  private popKind: 'abilities' | 'depth' | 'charge' | null = null;
  private toasts: Toasts;
  /** the side the button cluster was built for */
  private side: string | null = null;
  private shown = false;
  private portrait: boolean | null = null;
  // gestures
  private stickId = -1;
  private throttleId = -1;
  private sx = 0; private sy = 0;
  private touches = new Map<number, { x: number; y: number; x0: number; y0: number; t0: number }>();
  private pinch: { d0: number; z0: number; mx: number; my: number } | null = null;
  private camBtn: Btn;
  private tapOk = true;
  private readonly coarse = typeof matchMedia === 'function' && (matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0);

  constructor(private shell: Shell) {
    this.world = h('div', { class: 't-world' });
    this.base = h('div', { class: 't-stick-base' });
    this.knob = h('div', { class: 't-stick-knob' });
    this.ghost = h('div', { class: 't-stick-ghost' });
    this.notches = THROTTLE.map(([i, name]) => h('div', { class: 't-notch' + (i === 2 ? ' stop' : '') }, name));
    this.throttle = h('div', { class: 't-throttle' }, this.notches);
    this.cluster = h('div', { class: 't-cluster' });
    this.depthChip = h('div', { class: 't-depth' });
    this.depthChip.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.gesture(); this.openChargeDepth(); });
    this.ctxBtn = this.button('ctx hidden', 'target', '', () => { this.ctxAction?.run(); this.ctxAction = null; });
    this.timeBtn = this.button('small', 'time', '1×', () => this.cycleTime());
    const pauseBtn = this.button('small', 'pause', 'MENU', () => this.shell.open('pause'));
    // free camera: one finger drags the map instead of aiming; tap again to ride the ship
    this.camBtn = this.button('small', 'look', 'LOOK', () => { const pc = this.pc; if (pc) pc.freeCam = !pc.freeCam; });
    this.top = h('div', { class: 't-top' }, this.camBtn.el, this.timeBtn.el, pauseBtn.el);
    this.backdrop = h('div', { class: 't-backdrop hidden' });
    this.backdrop.addEventListener('pointerdown', (e) => { e.preventDefault(); this.closePop(); });
    this.pop = h('div', { class: 't-pop hidden' });
    this.el = h('div', { class: 't-overlay hidden' },
      this.world, this.ghost, this.base, this.knob, this.throttle, this.cluster, this.ctxBtn.el, this.top, this.backdrop, this.pop);
    this.toasts = new Toasts(this.el, shell.app.hud);
    this.wireWorld();
    this.wireThrottle();
    document.getElementById('ui')!.append(this.el);
  }

  get enabled() {
    const mode = dev.str('controls.touch');
    return mode === 'on' || (mode === 'auto' && this.coarse);
  }

  private get pc(): PlayerControl | null { return this.shell.app.player; }
  private get vessel(): Vessel | null { return this.shell.app.mission?.world.player ?? null; }

  /** every touch: prompts switch to touch labels; a battle takes the screen (fullscreen needs a gesture) */
  private gesture() {
    const app = this.shell.app;
    app.input.setDevice('touch');
    if (!document.fullscreenElement && document.fullscreenEnabled && dev.bool('controls.autoFullscreen')) void app.screen.enterGameMode();
  }

  private button(cls: string, icon: string, label: string, onTap: () => void): Btn {
    const ico = h('span', { class: 't-ico' }), lbl = h('span', { class: 't-lbl' }, label), badge = h('span', { class: 't-badge' });
    ico.innerHTML = iconSvg(icon);
    const el = h('div', { class: 't-btn ' + cls }, ico, lbl, badge);
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      this.gesture();
      if (el.classList.contains('off')) return;
      el.classList.add('down');
      onTap();
    });
    const up = () => el.classList.remove('down');
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
    return { el, ico, lbl, badge, icon };
  }
  private setIcon(b: Btn, icon: string) { if (b.icon !== icon) { b.icon = icon; b.ico.innerHTML = iconSvg(icon); } }
  private setText(el: HTMLElement, t: string) { if (el.textContent !== t) el.textContent = t; }

  /** the four fixed buttons for the side in command */
  private build(side: string) {
    this.side = side;
    this.closePop();
    this.btns = side === 'axis' ? [
      this.button('b0 primary', 'torpedo', 'FIRE', () => this.pc?.fireAssisted()),
      this.button('b1', 'depth', 'DEPTH', () => this.openDepth()),
      this.button('b2', 'periscope', 'SCOPE', () => this.scopeOrGun()),
      this.button('b3', 'star', 'ABILITY', () => this.openAbilities()),
    ] : [
      this.button('b0 primary', 'charge', 'D/C', () => this.pc?.dropSalvo()),
      this.button('b1', 'ping', 'PING', () => this.pc?.smartPing()),
      this.button('b2', 'gun', 'GUNS', () => { const pc = this.pc; if (pc) pc.assist.gunsAuto = !pc.assist.gunsAuto; }),
      this.button('b3', 'star', 'ABILITY', () => this.openAbilities()),
    ];
    this.cluster.replaceChildren(...this.btns.map((b) => b.el), ...(side === 'axis' ? [] : [this.depthChip]));
  }

  // ---------------------------------------------------------------- sea, stick and pinch
  private inStickZone(x: number, y: number) {
    const W = innerWidth, H = innerHeight;
    return this.portrait ? x < W * 0.58 && y > H * 0.62 : x < W * 0.42 && y > H * 0.3;
  }

  private wireWorld() {
    const z = this.world;
    z.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.gesture();
      z.setPointerCapture(e.pointerId);
      if (this.stickId < 0 && this.inStickZone(e.clientX, e.clientY)) {
        this.stickId = e.pointerId; this.sx = e.clientX; this.sy = e.clientY;
        this.placeStick(e.clientX, e.clientY, 0, 0);
        return;
      }
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() });
      this.tapOk = this.touches.size === 1;
      if (this.touches.size === 2) {
        const [a, b] = [...this.touches.values()];
        this.pinch = { d0: Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)), z0: this.shell.app.cam.targetZoom, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
        this.shell.app.input.touchAxes.aiming = false;
      }
    });
    z.addEventListener('pointermove', (e) => {
      const inp = this.shell.app.input;
      if (e.pointerId === this.stickId) {
        let dx = e.clientX - this.sx, dy = e.clientY - this.sy;
        const l = Math.hypot(dx, dy);
        if (l > STICK_R) { dx *= STICK_R / l; dy *= STICK_R / l; }
        inp.touchAxes.x = dx / STICK_R; inp.touchAxes.y = dy / STICK_R;
        this.placeStick(this.sx, this.sy, dx, dy);
        return;
      }
      const t = this.touches.get(e.pointerId);
      if (!t) return;
      const px = t.x, py = t.y;
      t.x = e.clientX; t.y = e.clientY;
      if (this.pinch && this.touches.size >= 2) {
        const [a, b] = [...this.touches.values()], cam = this.shell.app.cam;
        cam.targetZoom = clamp(this.pinch.z0 * Math.hypot(a.x - b.x, a.y - b.y) / this.pinch.d0, cam.minZoom, cam.maxZoom);
        // in free camera the two fingers also carry the map
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (this.pc?.freeCam) this.dragBy(this.pinch.mx, this.pinch.my, mx, my);
        this.pinch.mx = mx; this.pinch.my = my;
        return;
      }
      if (this.pc?.freeCam) {
        // free camera: the finger drags the map (a short touch is still a tap)
        if (Math.hypot(t.x - t.x0, t.y - t.y0) > 12) { this.tapOk = false; this.dragBy(px, py, t.x, t.y); }
        return;
      }
      if (Math.hypot(t.x - t.x0, t.y - t.y0) > 12) {
        // a drag aims: the reticle follows the finger
        this.tapOk = false;
        const [px, py] = this.shell.app.screen.clientToPixel(t.x, t.y);
        inp.mx = px; inp.my = py; inp.mouseMoved = true; inp.touchAxes.aiming = true;
      }
    });
    const up = (e: PointerEvent) => {
      const inp = this.shell.app.input;
      if (e.pointerId === this.stickId) {
        this.stickId = -1; inp.touchAxes.x = inp.touchAxes.y = 0;
        this.base.style.opacity = this.knob.style.opacity = '0';
        this.ghost.classList.remove('hidden');
        return;
      }
      const t = this.touches.get(e.pointerId);
      if (!t) return;
      this.touches.delete(e.pointerId);
      if (this.pinch) { if (this.touches.size < 2) this.pinch = null; return; }
      inp.touchAxes.aiming = false;
      if (e.type === 'pointerup' && this.tapOk && performance.now() - t.t0 < 350 && Math.hypot(t.x - t.x0, t.y - t.y0) < 14) this.tapAt(t.x, t.y);
    };
    z.addEventListener('pointerup', up);
    z.addEventListener('pointercancel', up);
  }

  /** a drag of the map between two client points, in game pixels (PlayerControl.freeLook reads it) */
  private dragBy(x0: number, y0: number, x1: number, y1: number) {
    const sc = this.shell.app.screen, inp = this.shell.app.input;
    const [ax, ay] = sc.clientToPixel(x0, y0), [bx, by] = sc.clientToPixel(x1, y1);
    inp.dragX += bx - ax; inp.dragY += by - ay;
  }

  /** a tap on the sea locks the ship under it; on open water it lets go of the lock and aims there */
  private tapAt(x: number, y: number) {
    const app = this.shell.app, pc = this.pc;
    if (!pc) return;
    const [px, py] = app.screen.clientToPixel(x, y);
    const [wx, wy] = app.cam.toWorld(px, py, 0);
    if (!pc.selectAt(wx, wy, 34 / app.cam.zoom + 15)) { pc.target = null; pc.aimX = wx; pc.aimY = wy; }
  }

  private placeStick(x: number, y: number, dx: number, dy: number) {
    const r = this.el.getBoundingClientRect();
    this.base.style.opacity = this.knob.style.opacity = '1';
    this.ghost.classList.add('hidden');
    this.base.style.transform = `translate(${x - r.left - STICK_R}px, ${y - r.top - STICK_R}px)`;
    this.knob.style.transform = `translate(${x - r.left + dx - 22}px, ${y - r.top + dy - 22}px)`;
  }

  private wireThrottle() {
    const t = this.throttle;
    const set = (e: PointerEvent) => {
      const r = t.getBoundingClientRect();
      const k = clamp(Math.floor(((e.clientY - r.top) / r.height) * THROTTLE.length), 0, THROTTLE.length - 1);
      this.vessel?.setTelegraph(THROTTLE[k][0]);
    };
    t.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.gesture(); this.throttleId = e.pointerId; t.setPointerCapture(e.pointerId); set(e); });
    t.addEventListener('pointermove', (e) => { if (e.pointerId === this.throttleId) set(e); });
    const up = (e: PointerEvent) => { if (e.pointerId === this.throttleId) this.throttleId = -1; };
    t.addEventListener('pointerup', up);
    t.addEventListener('pointercancel', up);
  }

  // ---------------------------------------------------------------- buttons and pop-ups
  /** U-boat third button: the deck gun on the surface (when the boat has one), the periscope below */
  private scopeOrGun() {
    const v = this.vessel, pc = this.pc, s = v?.sub;
    if (!v || !pc || !s) return;
    if (s.surfaced && v.guns.length && !v.stats.has('ks_silent_hunter')) pc.weaponMode = pc.weaponMode === 'gun' ? 'torpedo' : 'gun';
    else s.periscopeUp = !s.periscopeUp;
  }

  private cycleTime() {
    const pc = this.pc;
    if (!pc) return;
    const maxT = parseInt(dev.str('game.maxCompression')) || 8, top = TIME_STEPS.findIndex((t) => t >= maxT);
    pc.timeIdx = pc.timeIdx >= top ? 0 : pc.timeIdx + 1;
  }

  private openPop(kind: 'abilities' | 'depth' | 'charge', items: PopItem[]) {
    this.popKind = kind;
    this.pop.className = 't-pop ' + kind;
    this.pop.replaceChildren(...items.map((it) => {
      const el = h('div', { class: 't-item' + (it.active ? ' active' : '') + (it.off ? ' off' : '') },
        it.glyph ? h('span', { class: 't-glyph' }, it.glyph) : null, h('span', { class: 't-name' }, it.label), h('span', { class: 't-note' }, it.note ?? ''));
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); if (el.classList.contains('off')) return; it.run(); this.closePop(); });
      return el;
    }));
    this.backdrop.classList.remove('hidden');
  }
  private closePop() { this.popKind = null; this.pop.classList.add('hidden'); this.backdrop.classList.add('hidden'); }

  private openDepth() {
    const v = this.vessel, s = v?.sub;
    if (!v || !s) return;
    const sc = v.cls.sub!, layer = this.shell.app.mission!.world.layerDepth;
    const deep = Math.round(Math.min(sc.testDepth * 0.85, Math.max(layer + 40, 120)));
    const orders: [string, number][] = [['SURFACE', 0], ['PERISCOPE', sc.periscopeDepth], ['40 M', 40]];
    if (layer > 0) orders.push([`UNDER LAYER ${layer + 15} M`, layer + 15]);
    orders.push([`DEEP ${deep} M`, deep]);
    this.openPop('depth', orders.map(([label, d]) => ({ label, active: Math.abs(s.orderedDepth - d) < 1, run: () => { s.orderedDepth = d; } })));
  }

  private openChargeDepth() {
    const pc = this.pc;
    if (!pc) return;
    this.openPop('charge', [
      { label: 'AUTO', note: 'from the plot', active: pc.chargeDepthAuto, run: () => { pc.chargeDepthAuto = true; } },
      ...CHARGE_DEPTHS.map((d, i) => ({ label: `${d} M`, active: !pc.chargeDepthAuto && pc.chargeDepthIdx === i, run: () => { pc.chargeDepthAuto = false; pc.chargeDepthIdx = i; } })),
    ]);
  }

  private openAbilities() {
    const pc = this.pc;
    if (!pc) return;
    this.openPop('abilities', pc.abilities.slots.flatMap((s, i) => s ? [{
      label: ABILITIES[s.id].name, glyph: ABILITIES[s.id].glyph, note: this.abilityNote(pc, i), off: !pc.abilities.ready(i),
      run: () => { pc.abilities.trigger(i, pc.ctx()); },
    }] : []));
  }
  private abilityNote(pc: PlayerControl, i: number) {
    const s = pc.abilities.slots[i]!;
    const cool = s.cooldown > 0 && !dev.bool('game.noCooldowns') ? `${Math.ceil(s.cooldown)}s` : '';
    return [cool, s.charges !== null ? `×${s.charges}` : ''].filter(Boolean).join(' ');
  }

  // ---------------------------------------------------------------- per frame
  update() {
    const app = this.shell.app, pc = this.pc, v = this.vessel;
    app.screen.setTouchHud(this.enabled);
    const show = this.enabled && !!this.shell.playing && !this.shell.ui.active;
    if (show !== this.shown) {
      this.shown = show;
      this.el.classList.toggle('hidden', !show);
      if (!show) this.reset();
    }
    app.hud.mobile = app.hud.touchAbilities = show;
    const res = app.hud.reserved;
    if (!show) { res.right = res.below = 0; res.throttle = null; }
    if (pc) pc.mobile = show;
    if (!show || !pc || !v) return;
    const portrait = innerHeight >= innerWidth;
    if (portrait !== this.portrait) {
      this.portrait = portrait;
      this.el.classList.toggle('portrait', portrait);
      this.el.classList.toggle('landscape', !portrait);
    }
    if (this.side !== v.side) this.build(v.side);
    // pause and time under the plot (portrait: height is plenty) or beside it (landscape: the cluster needs the
    // height); the HUD keeps its panels clear of them and of the throttle (HUD px <-> CSS px by k)
    const k = (app.screen.S * app.screen.hudScale) / app.screen.dpr, L = app.hud.layout, st = this.top.style;
    const topW = this.top.offsetWidth + 8, topH = this.top.offsetHeight + 8, topY = portrait ? L.right * k + 6 : 6;
    st.top = `${Math.round(topY)}px`;
    st.right = portrait ? '' : `${Math.round(innerWidth - L.plotX * k + 8)}px`;
    res.below = portrait ? topH / k : 0;
    res.right = portrait ? 0 : topW / k;
    const tr = this.throttle.getBoundingClientRect();
    res.throttle = { x0: tr.left / k, y0: tr.top / k, x1: tr.right / k, y1: tr.bottom / k };
    if (portrait) {
      // full width under both columns (and the tutorial), so also clear of the pause / time buttons
      const tw = Math.min(innerWidth * 0.92, 460);
      this.toasts.sync(Math.max(Math.max(L.left, L.right, L.center) * k + 8, topY + topH), (innerWidth - tw) / 2, tw, 4);
    } else {
      // between the status column and the plot with its buttons, under the compass (or the tutorial)
      const l = L.leftX * k + 8, r = L.rightX * k - 8, tw = clamp(r - l, 200, 460);
      this.toasts.sync(Math.max(L.center, 32) * k + 8, (l + r - tw) / 2, tw, innerHeight < 480 ? 3 : 4);
    }
    this.setText(this.timeBtn.lbl, `${pc.timeScale}×`);
    this.setIcon(this.camBtn, pc.freeCam ? 'ship' : 'look');
    this.setText(this.camBtn.lbl, pc.freeCam ? 'SHIP' : 'LOOK');
    this.camBtn.el.classList.toggle('active', pc.freeCam);
    this.timeBtn.el.classList.toggle('active', pc.timeScale > 1);
    // throttle shows the rung telegraph
    this.notches.forEach((n, i) => n.classList.toggle('active', v.speedCmd === null && THROTTLE[i][0] === v.telegraph));
    this.syncButtons(pc, v);
    // the context button: the one action the situation calls for
    const a = v.alive ? pc.assist.context() : null;
    this.ctxAction = a;
    this.ctxBtn.el.classList.toggle('hidden', !a);
    if (a) { this.setIcon(this.ctxBtn, a.icon); this.setText(this.ctxBtn.lbl, a.label); }
    if (this.popKind === 'abilities') this.refreshAbilityPop(pc);
  }

  private syncButtons(pc: PlayerControl, v: Vessel) {
    const [b0, b1, b2, b3] = this.btns;
    if (!b3) return;
    const readyN = pc.abilities.slots.filter((s, i) => s && pc.abilities.ready(i)).length;
    this.setText(b3.badge, readyN ? String(readyN) : '');
    if (v.sub) {
      const s = v.sub, sc = v.cls.sub!;
      this.setText(b0.badge, String(v.tubes.filter((t) => t.loaded).length));
      b0.el.classList.toggle('off', !v.alive);
      const d = Math.round(s.orderedDepth);
      // the depth button names its next move on the surface, the standing order below
      this.setText(b1.lbl, d === 0 ? 'DIVE' : d === sc.periscopeDepth ? 'PERISCOPE' : `${d} M`);
      const gun = s.surfaced && v.guns.length > 0 && !v.stats.has('ks_silent_hunter');
      this.setIcon(b2, gun ? 'gun' : 'periscope');
      this.setText(b2.lbl, gun ? (pc.weaponMode === 'gun' ? 'GUN ON' : 'GUN') : 'SCOPE');
      b2.el.classList.toggle('active', gun ? pc.weaponMode === 'gun' : s.periscopeUp);
      b2.el.classList.toggle('off', !gun && !(v.atPeriscopeDepth || v.keelDepth < 9));
    } else {
      this.setText(b0.badge, String(v.dcLeft));
      b0.el.classList.toggle('off', v.dcLeft <= 0);
      this.setText(this.depthChip, `${pc.chargeDepth}m${pc.chargeDepthAuto ? ' A' : ''}`);
      this.setText(b2.lbl, pc.assist.gunsAuto ? 'GUNS AUTO' : 'HOLD FIRE');
      b2.el.classList.toggle('active', pc.assist.gunsAuto);
    }
  }

  private refreshAbilityPop(pc: PlayerControl) {
    let k = 0;
    pc.abilities.slots.forEach((s, i) => {
      if (!s) return;
      const el = this.pop.children[k++] as HTMLElement | undefined;
      if (!el) return;
      el.classList.toggle('off', !pc.abilities.ready(i));
      this.setText(el.querySelector('.t-note') as HTMLElement, this.abilityNote(pc, i));
    });
  }

  private reset() {
    const t = this.shell.app.input.touchAxes;
    t.x = t.y = 0; t.aiming = false;
    this.stickId = this.throttleId = -1;
    this.touches.clear(); this.pinch = null;
    this.base.style.opacity = this.knob.style.opacity = '0';
    this.ghost.classList.remove('hidden');
    this.closePop();
    this.toasts.clear();
  }
}
