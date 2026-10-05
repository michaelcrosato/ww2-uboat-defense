// DOM UI layer: element helper, a screen stack and spatial focus navigation shared by mouse,
// keyboard and gamepad. Focus is our own (`.focused` on a `[data-nav]` element), never the browser's,
// so Enter/Space reach the game input layer exactly once and gamepads drive the same path.

import type { Input, Action } from '../input/input';
import { audio } from '../audio/audio';

type Child = Node | string | number | null | undefined | false | Child[];
type Props = Record<string, unknown> & { class?: string; style?: string; on?: Record<string, (e: Event) => void> };

/** tiny hyperscript: h('div', { class: 'row', on: { click } }, 'text', child) */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const k in props) {
      const v = props[k];
      if (v === undefined || v === null || v === false) continue;
      if (k === 'on') for (const ev in v as Record<string, () => void>) el.addEventListener(ev, (v as Record<string, (e: Event) => void>)[ev]);
      else if (k === 'class') el.className = String(v);
      else if (k === 'style') el.setAttribute('style', String(v));
      else if (k.startsWith('data-') || k === 'role' || k === 'title' || k === 'for' || k.startsWith('aria-')) el.setAttribute(k, v === true ? '' : String(v));
      else (el as unknown as Record<string, unknown>)[k] = v;
    }
  }
  append(el, children);
  return el;
}
export function append(el: HTMLElement, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}

export interface UiScreen {
  el: HTMLElement;
  /** screen name (`title`, `pause`, …) for popTo and tests */
  id: string;
  onEnter?(): void;
  onExit?(): void;
  /** return true to stay (handled); default pops the screen */
  onBack?(): boolean | void;
  update?(dt: number): void;
  /** tabs: -1 / +1 */
  onTab?(dir: number): void;
  /** keep the screen below visible (pause → dev settings shows the game, not the pause box) */
  overlay?: boolean;
}

/** per-element behaviour beyond a click: left/right adjust, custom accept */
export interface NavHooks {
  adjust?: (dir: number) => void;
  accept?: () => void;
  /** custom directional movement inside the element (canvas); return false to leave it */
  move?: (dx: number, dy: number) => boolean;
}
const hooks = new WeakMap<HTMLElement, NavHooks>();
export function nav<T extends HTMLElement>(el: T, hk: NavHooks = {}): T {
  el.setAttribute('data-nav', '');
  hooks.set(el, hk);
  return el;
}

/** detail panels: run `f` whenever this element gets focus (screens dispatch it from navfocus) */
const showHooks = new WeakMap<HTMLElement, () => void>();
export function onShow(el: HTMLElement, f: () => void) { showHooks.set(el, f); }
export function runShow(el: HTMLElement) { showHooks.get(el)?.(); }

export function sfx(id: 'ui_click' | 'ui_hover' | 'ui_back' | 'ui_error') { audio.play(id); }

const DIRS: Record<string, [number, number]> = { menuUp: [0, -1], menuDown: [0, 1], menuLeft: [-1, 0], menuRight: [1, 0] };
const REPEAT_DELAY = 0.38, REPEAT_RATE = 0.075;

export class Ui {
  readonly root: HTMLElement;
  stack: UiScreen[] = [];
  focused: HTMLElement | null = null;
  /** time each held direction has been down (auto-repeat) */
  private held: Record<string, number> = {};
  /** a modal capture (rebinding) owns the input */
  capturing = false;

  constructor(root: HTMLElement, private input: Input) {
    this.root = root;
    // never let the browser keep DOM focus on buttons (Enter/Space would click twice)
    root.addEventListener('focusin', (e) => {
      const t = e.target as HTMLElement;
      if (!(t instanceof HTMLInputElement && (t.type === 'text' || t.type === 'search'))) t.blur();
    });
    root.addEventListener('pointerover', (e) => {
      const t = (e.target as HTMLElement).closest('[data-nav]') as HTMLElement | null;
      if (t && t !== this.focused && this.top?.el.contains(t)) this.focus(t, false);
    });
  }

  get top(): UiScreen | null { return this.stack[this.stack.length - 1] ?? null; }
  get active() { return this.stack.length > 0; }

  push(s: UiScreen) {
    const prev = this.top;
    if (prev && !s.overlay) prev.el.classList.add('hidden');
    this.stack.push(s);
    this.root.append(s.el);
    s.onEnter?.();
    this.autoFocus();
  }
  pop() {
    const s = this.stack.pop();
    if (!s) return;
    s.onExit?.();
    s.el.remove();
    const t = this.top;
    if (t) { t.el.classList.remove('hidden'); this.autoFocus(); }
    else this.focused = null;
  }
  replace(s: UiScreen) { this.pop(); this.push(s); }
  clear() { while (this.stack.length) this.pop(); }
  /** pop until a screen with this id is on top (or the stack is empty) */
  popTo(id: string) { while (this.top && this.top.id !== id) this.pop(); }

  autoFocus() {
    const t = this.top;
    if (!t) return;
    const keep = this.focused && t.el.contains(this.focused) && this.visible(this.focused) ? this.focused : null;
    const el = keep ?? (t.el.querySelector('[data-autofocus]') as HTMLElement | null) ?? this.items()[0] ?? null;
    if (el) this.focus(el, false);
  }

  /** focus the first nav item inside a container (a freshly filled list) unless focus is already in the tab bar */
  focusFirstIn(container: HTMLElement) {
    if (this.focused?.closest('.tabs') && this.top?.el.contains(this.focused)) return;
    const el = [...container.querySelectorAll<HTMLElement>('[data-nav]')].find((e) => this.visible(e));
    if (el) this.focus(el, false);
  }

  focus(el: HTMLElement, sound = true) {
    if (this.focused === el) return;
    this.focused?.classList.remove('focused');
    this.focused = el;
    el.classList.add('focused');
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (sound) sfx('ui_hover');
    this.top?.el.dispatchEvent(new CustomEvent('navfocus', { detail: el }));
    runShow(el);
  }

  private visible(el: HTMLElement) {
    if (el.closest('.hidden')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  items(): HTMLElement[] {
    const t = this.top;
    if (!t) return [];
    // a modal inside the screen confines navigation
    const scope = (t.el.querySelector('.modal') as HTMLElement | null) ?? t.el;
    return [...scope.querySelectorAll<HTMLElement>('[data-nav]')].filter((e) => this.visible(e));
  }

  /** nearest item in a direction: distance along the axis plus a penalty for drifting off it */
  move(dx: number, dy: number): boolean {
    const list = this.items();
    if (!list.length) return false;
    const cur = this.focused && list.includes(this.focused) ? this.focused : null;
    if (!cur) { this.focus(list[0]); return true; }
    const a = cur.getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best: HTMLElement | null = null, bs = Infinity;
    for (const el of list) {
      if (el === cur) continue;
      const b = el.getBoundingClientRect();
      // edge-to-edge along the axis so wide rows and narrow buttons compare fairly
      const along = dx ? (dx > 0 ? b.left - a.right : a.left - b.right) : (dy > 0 ? b.top - a.bottom : a.top - b.bottom);
      const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      const centre = dx ? (cx - ax) * dx : (cy - ay) * dy;
      if (along < -4 && centre <= 4) continue;
      if (centre <= 0) continue;
      // overlap on the cross axis is free; otherwise penalise the gap
      const cross = dx ? Math.max(0, Math.max(b.top, a.top) - Math.min(b.bottom, a.bottom)) : Math.max(0, Math.max(b.left, a.left) - Math.min(b.right, a.right));
      const s = Math.max(0, along) + cross * 2.5 + Math.abs(dx ? cy - ay : cx - ax) * 0.05;
      if (s < bs) { bs = s; best = el; }
    }
    if (best) { this.focus(best); return true; }
    return false;
  }

  accept() {
    const el = this.focused;
    if (!el) return;
    if ((el as HTMLButtonElement).disabled || el.classList.contains('disabled')) { sfx('ui_error'); return; }
    const hk = hooks.get(el);
    sfx('ui_click');
    if (hk?.accept) hk.accept(); else el.click();
  }

  back() {
    const t = this.top;
    if (!t) return;
    const modal = t.el.querySelector('.modal');
    if (modal) { modal.remove(); sfx('ui_back'); this.autoFocus(); return; }
    if (t.onBack?.()) return;
    sfx('ui_back');
    this.pop();
  }

  private repeat(a: Action, dt: number): boolean {
    const inp = this.input;
    if (inp.pressed(a)) { this.held[a] = 0; return true; }
    if (!inp.down(a)) { delete this.held[a]; return false; }
    const t0 = this.held[a] ?? 0, t1 = t0 + dt;
    this.held[a] = t1;
    if (t1 < REPEAT_DELAY) return false;
    return Math.floor((t1 - REPEAT_DELAY) / REPEAT_RATE) > Math.floor(Math.max(0, t0 - REPEAT_DELAY) / REPEAT_RATE);
  }

  /** per frame (after input.update): route menu actions to the top screen */
  update(dt: number) {
    const t = this.top;
    if (!t) return;
    t.update?.(dt);
    if (this.capturing || this.top !== t) return;
    const inp = this.input;
    // left stick also navigates (edge-triggered via the d-pad style repeat on thresholds)
    for (const a of Object.keys(DIRS) as Action[]) {
      if (!this.repeat(a, dt)) continue;
      const [dx, dy] = DIRS[a];
      const hk = this.focused ? hooks.get(this.focused) : undefined;
      if (dx && hk?.adjust) { hk.adjust(dx); sfx('ui_hover'); continue; }
      if (hk?.move?.(dx, dy)) continue;
      this.move(dx, dy);
    }
    this.stickNav(dt);
    if (inp.pressed('menuTabL')) t.onTab?.(-1);
    if (inp.pressed('menuTabR')) t.onTab?.(1);
    if (inp.pressed('menuAccept')) this.accept();
    else if (inp.pressed('menuBack')) this.back();
  }

  private stickT = 0;
  private stickNav(dt: number) {
    const inp = this.input;
    const x = inp.lx, y = inp.ly;
    if (Math.hypot(x, y) < 0.55) { this.stickT = 0; return; }
    this.stickT -= dt;
    if (this.stickT > 0) return;
    this.stickT = this.stickT < -1 ? REPEAT_DELAY : 0.16;
    const horiz = Math.abs(x) > Math.abs(y);
    const hk = this.focused ? hooks.get(this.focused) : undefined;
    if (horiz && hk?.adjust) { hk.adjust(Math.sign(x)); return; }
    if (hk?.move?.(horiz ? Math.sign(x) : 0, horiz ? 0 : Math.sign(y))) return;
    this.move(horiz ? Math.sign(x) : 0, horiz ? 0 : Math.sign(y));
  }

  /** modal list of choices inside the top screen (last one is focused when `cancel` is given) */
  choose(text: string, options: { label: string; run: () => void; disabled?: boolean; cls?: string }[], cancel = 'Cancel') {
    const t = this.top;
    if (!t) return;
    const close = () => { m.remove(); this.autoFocus(); };
    const btns = options.map((o) => nav(h('button', { class: 'btn' + (o.disabled ? ' disabled' : '') + (o.cls ? ' ' + o.cls : ''), on: { click: () => { if (o.disabled) return; close(); o.run(); } } }, o.label)));
    const no = nav(h('button', { class: 'btn', on: { click: close } }, cancel));
    const m = h('div', { class: 'modal' }, h('div', { class: 'modal-box panel' }, h('p', null, text), h('div', { class: 'menu-list' }, btns, no)));
    t.el.append(m);
    this.focus(btns.find((b) => !b.classList.contains('disabled')) ?? no, false);
  }

  /** modal yes/no inside the top screen */
  confirm(text: string, onYes: () => void, yes = 'Yes', no = 'Cancel') {
    const t = this.top;
    if (!t) return;
    const close = () => { m.remove(); this.autoFocus(); };
    const m = h('div', { class: 'modal' },
      h('div', { class: 'modal-box panel' },
        h('p', null, text),
        h('div', { class: 'btn-row' },
          nav(h('button', { class: 'btn', on: { click: () => { close(); onYes(); } } }, yes)),
          nav(h('button', { class: 'btn', 'data-autofocus': true, on: { click: close } }, no)))));
    t.el.append(m);
    const f = m.querySelector('[data-autofocus]') as HTMLElement;
    this.focus(f, false);
  }
}

/** bring the boot screen back with an error message (set as text: messages can echo URL parameters) */
export function showFatal(text: string) {
  const err = document.createElement('div');
  err.className = 'boot-err';
  err.textContent = text;
  document.getElementById('boot-msg')?.replaceChildren(err);
  document.getElementById('boot')?.classList.remove('gone');
}
