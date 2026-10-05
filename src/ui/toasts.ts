// Swipe-away notifications for touch play: the HUD's crew messages and warnings become DOM toasts under
// the top panels (the canvas versions sit where thumbs and buttons are on a phone). A swipe sideways or up
// dismisses one before its timer runs out; a dismissed warning stays quiet for a while.

import type { Hud, Msg } from './hud';
import { msgLife } from './hud';
import { h } from './dom';

export class Toasts {
  readonly el: HTMLElement;
  /** on screen, keyed by source: a crew message object or a warning's text */
  private live = new Map<Msg | string, HTMLElement>();

  constructor(parent: HTMLElement, private hud: Hud) {
    this.el = h('div', { class: 't-toasts' });
    parent.append(this.el);
  }

  /** mirror the HUD's warnings (first) and up to `max` toasts in all into the column at `left`, `top`, `width` (CSS px) */
  sync(top: number, left: number, width: number, max: number) {
    const st = this.el.style;
    st.top = `${Math.round(top)}px`; st.left = `${Math.round(left)}px`; st.width = `${Math.round(width)}px`;
    const now = performance.now() / 1000, hud = this.hud;
    const want: (Msg | string)[] = [...hud.warnings.keys()];
    for (let i = hud.msgs.length - 1; i >= 0 && want.length < max; i--) {
      const m = hud.msgs[i];
      if (!m.gone && now - m.t < msgLife(m)) want.push(m);
    }
    want.length = Math.min(want.length, max);
    for (const [k, el] of this.live) if (!want.includes(k) && !el.classList.contains('out')) { this.live.delete(k); el.remove(); }
    want.forEach((k, i) => {
      let el = this.live.get(k);
      if (!el) { el = this.make(k); this.live.set(k, el); }
      if (this.el.children[i] !== el) this.el.insertBefore(el, this.el.children[i] ?? null);
    });
  }

  clear() { for (const el of this.live.values()) el.remove(); this.live.clear(); }

  private make(src: Msg | string): HTMLElement {
    const warn = typeof src === 'string';
    const el = h('div', { class: 'toast ' + (warn ? 'warn' : src.kind) }, warn ? src : src.text);
    if (!warn && src.color) el.style.color = src.color;
    // follow the finger sideways (or up); past the threshold it flies off, otherwise it springs back
    let id = -1, x0 = 0, y0 = 0, dx = 0, dy = 0;
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); e.preventDefault();
      id = e.pointerId; x0 = e.clientX; y0 = e.clientY; dx = dy = 0;
      el.setPointerCapture(id); el.classList.add('drag');
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      dx = e.clientX - x0; dy = Math.min(0, e.clientY - y0);
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      el.style.opacity = String(Math.max(0.2, 1 - (Math.abs(dx) - dy) / 180));
    });
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = -1; el.classList.remove('drag');
      if (Math.abs(dx) > 56 || dy < -32) this.dismiss(src, el, dx, dy);
      else { el.style.transform = ''; el.style.opacity = ''; }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return el;
  }

  private dismiss(src: Msg | string, el: HTMLElement, dx: number, dy: number) {
    if (typeof src === 'string') this.hud.dismissWarning(src); else src.gone = true;
    this.live.delete(src);
    el.classList.add('out');
    el.style.transform = dy < -32 && Math.abs(dx) < 56 ? 'translate(0, -60px)' : `translate(${Math.sign(dx || 1) * 420}px, ${dy}px)`;
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 200);
  }
}
