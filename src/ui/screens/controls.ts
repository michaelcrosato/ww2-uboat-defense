// Controls: every action with two keyboard/mouse slots and one gamepad slot. Accept on a slot starts a
// capture (next key, mouse button, wheel or pad button; Esc cancels, Delete clears); conflicts listed.

import type { Shell } from '../shell';
import { ACTION_LABELS, keyLabel, PS_GLYPHS, XBOX_GLYPHS, type Action } from '../../input/input';
import { h, nav, sfx, type UiScreen } from '../dom';
import { button, hintBar } from '../widgets';

const isPad = (c: string) => c.startsWith('Pad');

export function controlsScreen(shell: Shell): UiScreen {
  const inp = shell.app.input, ui = shell.ui;
  const actions = Object.keys(ACTION_LABELS) as Action[];
  const table = h('div', { class: 'list bind-table' });
  const conflicts = h('div', { class: 'conflicts' });
  const slots: { a: Action; pad: boolean; i: number; el: HTMLElement }[] = [];
  const padLabel = (c: string) => (inp.device === 'xbox' ? XBOX_GLYPHS : PS_GLYPHS)[c] ?? c;
  const lists = (a: Action) => ({ kb: inp.bindings[a].filter((c) => !isPad(c)), pad: inp.bindings[a].filter(isPad) });
  const sync = () => {
    for (const s of slots) {
      const l = lists(s.a), c = (s.pad ? l.pad : l.kb)[s.i];
      s.el.textContent = c ? (s.pad ? padLabel(c) : keyLabel(c)) : '—';
      s.el.classList.toggle('empty', !c);
    }
    const cf = inp.conflicts();
    conflicts.replaceChildren(...(cf.length ? [h('b', null, 'Conflicts: '), cf.join(' · ')] : [h('span', { class: 'dim' }, 'No conflicts.')]));
  };
  const assign = (a: Action, pad: boolean, i: number, code: string | null) => {
    const l = lists(a);
    const arr = pad ? l.pad : l.kb;
    if (code) arr[i] = code; else arr.splice(i, 1);
    inp.setBindings(a, [...l.kb, ...l.pad]);
    sync();
  };
  const capture = (a: Action, pad: boolean, i: number) => {
    const end = () => { inp.captureHandler = null; ui.capturing = false; modal.remove(); ui.autoFocus(); };
    const take = (code: string): boolean => {
      if (code === 'Escape') { sfx('ui_back'); end(); return true; }
      if (code === 'Delete') { assign(a, pad, i, null); sfx('ui_back'); end(); return true; }
      if (isPad(code) !== pad) { sfx('ui_error'); return true; }
      assign(a, pad, i, code); sfx('ui_click'); end();
      return true;
    };
    const modal = h('div', { class: 'modal' }, h('div', { class: 'modal-box panel' },
      h('p', null, `${ACTION_LABELS[a]} — ${pad ? 'press a gamepad button' : 'press a key or mouse button'}`),
      h('p', { class: 'dim' }, 'Esc cancels · Delete clears the slot')));
    // the overlay sits above the stage, so mouse buttons and the wheel are captured here
    modal.addEventListener('pointerdown', (e) => { e.preventDefault(); if (!pad) take('Mouse' + e.button); });
    modal.addEventListener('wheel', (e) => { e.preventDefault(); if (!pad) take(e.deltaY < 0 ? 'WheelUp' : 'WheelDown'); }, { passive: false });
    modal.addEventListener('contextmenu', (e) => e.preventDefault());
    el.append(modal);
    ui.capturing = true;
    // swallow the accept press that opened the capture
    setTimeout(() => { if (ui.capturing) inp.captureHandler = take; }, 120);
  };
  for (const a of actions) {
    const cells: HTMLElement[] = [];
    for (const [pad, n] of [[false, 2], [true, 1]] as [boolean, number][]) {
      for (let i = 0; i < n; i++) {
        const el = nav(h('button', { class: 'slot' + (pad ? ' pad' : ''), 'data-help': `${ACTION_LABELS[a]}: ${pad ? 'gamepad' : 'keyboard / mouse'} slot ${i + 1}` }),
          { accept: () => capture(a, pad, i) });
        el.addEventListener('click', () => capture(a, pad, i));
        slots.push({ a, pad, i, el });
        cells.push(el);
      }
    }
    table.append(h('div', { class: 'bind-row' + (a.startsWith('menu') ? ' menu' : '') }, h('span', { class: 'label' }, ACTION_LABELS[a]), cells));
  }
  const hints = hintBar(inp);
  let lastDev = inp.device;
  const el = h('div', { class: 'screen center' },
    h('div', { class: 'panel wide controls' },
      h('h1', null, 'Controls'),
      h('div', { class: 'bind-row head' }, h('span', { class: 'label' }, 'Action'), h('span', null, 'Key 1'), h('span', null, 'Key 2'), h('span', null, 'Pad')),
      table, conflicts,
      h('div', { class: 'btn-row' },
        button('Back', () => ui.back(), 'btn'),
        button('Reset all', () => ui.confirm('Reset every binding to the default layout?', () => { inp.resetBindings(); sync(); }), 'btn')),
      hints.el));
  sync();
  return {
    id: 'controls', el,
    onExit() { inp.captureHandler = null; ui.capturing = false; },
    // pad glyphs follow the last-used device
    update() { hints.update(); if (inp.device !== lastDev) { lastDev = inp.device; sync(); } },
  };
}
