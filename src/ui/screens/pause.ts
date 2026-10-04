// Pause menu over a running mission (the shell keeps the simulation halted while it is open).

import type { Shell } from '../shell';
import { h, type UiScreen } from '../dom';
import { button, hintBar } from '../widgets';

export function pauseScreen(shell: Shell): UiScreen {
  const hints = hintBar(shell.app.input);
  const m = shell.app.mission;
  const side = m?.side === 'axis' ? 'U-boat' : 'Escort';
  const el = h('div', { class: 'screen center dim' },
    h('div', { class: 'panel pause' },
      h('h1', null, 'Paused'),
      h('div', { class: 'sub' }, `${side} · ${Math.floor((m?.elapsed ?? 0) / 60)} min in action`),
      h('div', { class: 'menu-list' },
        button('Resume', () => shell.ui.pop(), 'btn big', { 'data-autofocus': true }),
        button('Dev Settings', () => shell.open('dev'), 'btn'),
        button('Settings', () => shell.open('settings'), 'btn'),
        button('Controls', () => shell.open('controls'), 'btn'),
        button('Restart mission', () => shell.ui.confirm('Restart this mission from the beginning?', () => shell.restart()), 'btn'),
        button('Abandon to title', () => shell.ui.confirm('Abandon the mission and return to the title?', () => shell.abandon()), 'btn')),
      hints.el));
  return { id: 'pause', el, update: () => hints.update() };
}
