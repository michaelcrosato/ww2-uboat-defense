// Schema-driven widgets: one row per SettingDef (toggle, slider, cycling select, colour), plus
// buttons, tabs and a help panel. Rows are nav items; left/right adjusts, accept toggles/cycles.

import type { ConfigStore, SettingDef } from '../core/config';
import { h, nav } from './dom';

export interface SettingRow { el: HTMLElement; def: SettingDef; sync(): void }

/** settings that only take effect after a reload */
export const RELOAD_KEYS = new Set(['display.renderer']);

function fmtValue(def: SettingDef, v: number | string | boolean): string {
  if (def.type === 'bool') return v ? 'ON' : 'OFF';
  if (def.type === 'select') return def.options.find((o) => o.value === v)?.label ?? String(v);
  if (def.type === 'range') {
    const n = Number(v);
    if (def.fmt) return def.fmt(n);
    const dec = def.step < 1 ? Math.min(3, Math.max(0, Math.ceil(-Math.log10(def.step) - 1e-9))) : 0;
    return n.toFixed(dec) + (def.unit ? (def.unit.length > 1 && def.unit !== '°' ? ' ' : '') + def.unit : '');
  }
  return String(v);
}

export function renderSetting(store: ConfigStore, def: SettingDef): SettingRow {
  const val = h('span', { class: 'val' });
  let control: HTMLElement;
  let sync: () => void;
  const set = (v: number | string | boolean) => store.set(def.key, v);
  let adjust: ((dir: number) => void) | undefined;
  let accept: (() => void) | undefined;
  if (def.type === 'bool') {
    control = h('span', { class: 'toggle' }, h('span', { class: 'knob' }));
    sync = () => { const on = store.bool(def.key); control.classList.toggle('on', on); val.textContent = on ? 'ON' : 'OFF'; };
    adjust = () => set(!store.bool(def.key));
    accept = () => set(!store.bool(def.key));
  } else if (def.type === 'range') {
    const inp = h('input', { type: 'range', min: String(def.min), max: String(def.max), step: String(def.step), class: 'slider' });
    inp.addEventListener('input', () => set(Number(inp.value)));
    control = inp;
    sync = () => { const v = store.num(def.key); inp.value = String(v); val.textContent = fmtValue(def, v); inp.style.setProperty('--fill', ((v - def.min) / (def.max - def.min || 1)) * 100 + '%'); };
    // big ranges (seed, year…) step faster when held; at least one step per press
    adjust = (dir) => {
      const span = (def.max - def.min) / def.step;
      const k = span > 200 ? Math.ceil(span / 100) : 1;
      const v = Math.round((store.num(def.key) + dir * def.step * k - def.min) / def.step) * def.step + def.min;
      set(Math.min(def.max, Math.max(def.min, +v.toFixed(6))));
    };
  } else if (def.type === 'select') {
    const prev = h('span', { class: 'arrow' }, '◀'), next = h('span', { class: 'arrow' }, '▶');
    const cyc = (dir: number) => {
      const i = def.options.findIndex((o) => o.value === store.str(def.key));
      set(def.options[(i + dir + def.options.length) % def.options.length].value);
    };
    prev.addEventListener('click', (e) => { e.stopPropagation(); cyc(-1); });
    next.addEventListener('click', (e) => { e.stopPropagation(); cyc(1); });
    control = h('span', { class: 'cycle' }, prev, val, next);
    sync = () => { val.textContent = fmtValue(def, store.str(def.key)); };
    adjust = cyc;
    accept = () => cyc(1);
  } else {
    const inp = h('input', { type: 'color', class: 'color' });
    inp.addEventListener('input', () => set(inp.value));
    control = inp;
    sync = () => { inp.value = store.str(def.key); val.textContent = store.str(def.key); };
    accept = () => inp.click();
  }
  const label = h('span', { class: 'label' }, def.label, RELOAD_KEYS.has(def.key) ? h('span', { class: 'note' }, ' (reload)') : null);
  const right = def.type === 'select' ? control : h('span', { class: 'ctl' }, control, val);
  const row = nav(h('div', { class: 'row setting', 'data-key': def.key, 'data-help': def.help ?? '' }, label, right), { adjust, accept });
  if (def.type === 'bool') row.addEventListener('click', () => accept!());
  if (def.type === 'select') row.addEventListener('click', () => accept!());
  const full = () => {
    sync();
    if (def.showIf) row.classList.toggle('hidden', !store.bool(def.showIf));
    row.classList.toggle('changed', store.get(def.key) !== def.def);
  };
  full();
  return { el: row, def, sync: full };
}

/** rows for a store, kept in sync while the screen lives; returns an unsubscribe */
export function bindRows(store: ConfigStore, rows: SettingRow[]): () => void {
  return store.onChange(() => { for (const r of rows) r.sync(); });
}

export function button(label: string, onClick: () => void, cls = 'btn', extra: Record<string, unknown> = {}): HTMLButtonElement {
  return nav(h('button', { class: cls, on: { click: onClick }, ...extra }, label));
}

/** help/tooltip panel that follows the focused element's data-help */
export function helpPanel(screen: HTMLElement, fallback = ''): HTMLElement {
  const el = h('div', { class: 'help' }, fallback);
  screen.addEventListener('navfocus', (e) => {
    const t = (e as CustomEvent<HTMLElement>).detail;
    el.textContent = t.getAttribute('data-help') || fallback;
  });
  return el;
}

/** a tab bar; returns the bar and a setter */
export function tabs(names: string[], onPick: (i: number) => void): { el: HTMLElement; set(i: number): void; index(): number } {
  let cur = 0;
  const btns = names.map((n, i) => nav(h('button', { class: 'tab', on: { click: () => api.set(i) } }, n)));
  const el = h('div', { class: 'tabs' }, h('span', { class: 'tab-hint' }, 'Q'), btns, h('span', { class: 'tab-hint' }, 'E'));
  const api = {
    el,
    set(i: number) {
      cur = (i + names.length) % names.length;
      btns.forEach((b, j) => b.classList.toggle('active', j === cur));
      onPick(cur);
    },
    index: () => cur,
  };
  return api;
}

/** footer hint line with glyphs for the active device (refreshed by the screen's update) */
export function hintBar(input: import('../input/input').Input, extra: [import('../input/input').Action, string][] = []): { el: HTMLElement; update(): void } {
  const el = h('div', { class: 'hints' });
  let last = '';
  const update = () => {
    const pad = input.usingPad;
    const parts: string[] = [pad ? `${input.glyph('menuUp')}${input.glyph('menuDown')} Navigate` : '↑↓←→ Navigate',
      `${input.glyph('menuAccept')} Select`, `${input.glyph('menuBack')} Back`];
    for (const [a, label] of extra) parts.push(`${input.glyph(a)} ${label}`);
    const s = parts.join('  ·  ');
    if (s !== last) { el.textContent = s; last = s; }
  };
  update();
  return { el, update };
}
