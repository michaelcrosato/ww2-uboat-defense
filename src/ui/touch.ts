// Touch overlay for phones/tablets: left half = virtual steering stick (input.touchAxes), right half =
// drag to aim / tap to fire, plus buttons that press actions through their first binding. Shown when
// `controls.touch` is on, or auto on a touch device, and only while a mission is under command.

import type { Shell } from './shell';
import type { Action } from '../input/input';
import { dev } from '../core/devSettings';
import { ABILITIES } from '../meta/abilities';
import { h } from './dom';

const STICK_R = 56;

export class TouchOverlay {
  readonly el: HTMLElement;
  private knob: HTMLElement;
  private base: HTMLElement;
  private stickId = -1;
  private sx = 0; private sy = 0;
  private aimId = -1;
  private aimT0 = 0; private aimX0 = 0; private aimY0 = 0;
  private abilityBtns: HTMLElement[] = [];
  private shown = false;
  /** portrait phones: the HUD needs landscape width, so missions wait behind this notice */
  private rotate: HTMLElement;
  private readonly coarse = typeof matchMedia === 'function' && (matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0);

  constructor(private shell: Shell) {
    const inp = shell.app.input;
    this.base = h('div', { class: 't-stick-base' });
    this.knob = h('div', { class: 't-stick-knob' });
    const stickZone = h('div', { class: 't-zone t-left' }, this.base, this.knob);
    const aimZone = h('div', { class: 't-zone t-right' });
    const btn = (label: string, a: Action, cls = '', hold = false) => {
      const b = h('div', { class: 't-btn ' + cls }, label);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        inp.setDevice('touch');
        b.classList.add('down');
        if (hold) inp.holdAction(a, true); else inp.tapAction(a);
      });
      const up = () => { b.classList.remove('down'); if (hold) inp.holdAction(a, false); };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      return b;
    };
    this.abilityBtns = ([1, 2, 3, 4, 5, 6] as const).map((i) => btn(String(i), `ability${i}` as Action, 'ab ab' + i));
    this.el = h('div', { class: 't-overlay hidden' },
      stickZone, aimZone,
      h('div', { class: 't-abilities' }, this.abilityBtns),
      h('div', { class: 't-actions' },
        btn('PING', 'ping'), btn('CHG', 'charge'), btn('DEP−', 'depthUp'), btn('DEP+', 'depthDown')),
      h('div', { class: 't-top' }, btn('T−', 'timeDown', 'small'), btn('T+', 'timeUp', 'small'), btn('❚❚', 'pause', 'small')));
    // stick: anchored where the thumb lands
    stickZone.addEventListener('pointerdown', (e) => {
      if (this.stickId >= 0) return;
      e.preventDefault();
      inp.setDevice('touch');
      this.stickId = e.pointerId; this.sx = e.clientX; this.sy = e.clientY;
      stickZone.setPointerCapture(e.pointerId);
      this.placeStick(e.clientX, e.clientY, 0, 0);
    });
    stickZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      let dx = e.clientX - this.sx, dy = e.clientY - this.sy;
      const l = Math.hypot(dx, dy);
      if (l > STICK_R) { dx *= STICK_R / l; dy *= STICK_R / l; }
      inp.touchAxes.x = dx / STICK_R; inp.touchAxes.y = dy / STICK_R;
      this.placeStick(this.sx, this.sy, dx, dy);
    });
    const stickUp = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = -1; inp.touchAxes.x = 0; inp.touchAxes.y = 0;
      this.base.style.opacity = this.knob.style.opacity = '0';
    };
    stickZone.addEventListener('pointerup', stickUp);
    stickZone.addEventListener('pointercancel', stickUp);
    // aim: the reticle follows the finger; a short tap fires
    const aimAt = (e: PointerEvent) => {
      const [x, y] = shell.app.screen.clientToPixel(e.clientX, e.clientY);
      inp.mx = x; inp.my = y; inp.mouseMoved = true;
      inp.touchAxes.ax = x; inp.touchAxes.ay = y; inp.touchAxes.aiming = true;
    };
    aimZone.addEventListener('pointerdown', (e) => {
      if (this.aimId >= 0) return;
      e.preventDefault();
      inp.setDevice('touch');
      this.aimId = e.pointerId; this.aimT0 = performance.now(); this.aimX0 = e.clientX; this.aimY0 = e.clientY;
      aimZone.setPointerCapture(e.pointerId);
      aimAt(e);
    });
    aimZone.addEventListener('pointermove', (e) => { if (e.pointerId === this.aimId) aimAt(e); });
    const aimUp = (e: PointerEvent) => {
      if (e.pointerId !== this.aimId) return;
      this.aimId = -1; inp.touchAxes.aiming = false;
      if (e.type === 'pointerup' && performance.now() - this.aimT0 < 280 && Math.hypot(e.clientX - this.aimX0, e.clientY - this.aimY0) < 18) inp.tapAction('fire');
    };
    aimZone.addEventListener('pointerup', aimUp);
    aimZone.addEventListener('pointercancel', aimUp);
    this.rotate = h('div', { class: 't-rotate hidden' }, h('div', { class: 't-rotate-icon' }, '⟳'),
      h('div', null, 'Turn your device sideways'), h('div', { class: 'dim' }, 'The bridge needs a landscape view. The patrol waits.'));
    document.getElementById('ui')!.append(this.el, this.rotate);
  }

  private placeStick(x: number, y: number, dx: number, dy: number) {
    const r = this.el.getBoundingClientRect();
    this.base.style.opacity = this.knob.style.opacity = '1';
    this.base.style.transform = `translate(${x - r.left - STICK_R}px, ${y - r.top - STICK_R}px)`;
    this.knob.style.transform = `translate(${x - r.left + dx - 22}px, ${y - r.top + dy - 22}px)`;
  }

  get enabled() {
    const mode = dev.str('controls.touch');
    return mode === 'on' || (mode === 'auto' && this.coarse);
  }

  update() {
    const show = this.enabled && !!this.shell.playing && !this.shell.ui.active;
    if (show !== this.shown) {
      this.shown = show;
      this.el.classList.toggle('hidden', !show);
      // one ability bar on screen: these buttons replace the HUD's (too small for fingers on phones)
      this.shell.app.hud.touchAbilities = show;
      if (!show) { const t = this.shell.app.input.touchAxes; t.x = t.y = 0; t.aiming = false; this.stickId = this.aimId = -1; }
    }
    const portrait = show && innerHeight > innerWidth * 1.1;
    this.rotate.classList.toggle('hidden', !portrait);
    this.shell.app.held = portrait;
    if (!show) return;
    // ability buttons mirror the loadout: glyph, cooldown seconds, charges (empty slots hidden)
    const pc = this.shell.app.player;
    if (pc) this.abilityBtns.forEach((b, i) => {
      const s = pc.abilities.slots[i];
      b.classList.toggle('hidden', !s);
      if (!s) return;
      const cool = !pc.abilities.ready(i);
      b.classList.toggle('cool', cool);
      b.classList.toggle('active', s.active > 0);
      const label = (s.cooldown > 0 && !dev.bool('game.noCooldowns') ? String(Math.ceil(s.cooldown)) : ABILITIES[s.id].glyph) + (s.charges !== null ? ` ·${s.charges}` : '');
      if (b.textContent !== label) b.textContent = label;
    });
  }
}
