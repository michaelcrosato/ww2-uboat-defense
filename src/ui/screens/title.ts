// Title screen over the attract-mode backdrop, and the credits page.

import type { Shell } from '../shell';
import { h, type UiScreen } from '../dom';
import { button, hintBar } from '../widgets';

export function titleScreen(shell: Shell): UiScreen {
  const hints = hintBar(shell.app.input);
  const el = h('div', { class: 'screen title-screen' },
    h('div', { class: 'title-col' },
      h('div', { class: 'game-title' }, 'WOLFPACK', h('span', { class: 'amp' }, '&'), 'ESCORT'),
      h('div', { class: 'game-sub' }, 'Convoy war in the Atlantic, ', h('span', { class: 'nowrap' }, '1939–1945')),
      h('div', { class: 'menu-list' },
        button('Arena', () => shell.open('arena'), 'btn big', { 'data-autofocus': true, 'data-help': 'Customise a convoy battle and play it as the escort or the U-boat.' }),
        button('Port', () => shell.open('port'), 'btn big', { 'data-help': 'The captain\'s career: contracts, loot, the shipyard and the skill tree.' }),
        button('Settings', () => shell.open('settings'), 'btn', { 'data-help': 'Display, audio and controller options.' }),
        button('Controls', () => shell.open('controls'), 'btn', { 'data-help': 'Rebind keys, mouse buttons and gamepad buttons.' }),
        button('Dev Settings', () => shell.open('dev'), 'btn', { 'data-help': 'Every renderer, water, physics and gameplay knob. Also F1 during a mission.' }),
        button('Credits', () => shell.open('credits'), 'btn')),
    ),
    h('div', { class: 'stamp' }, 'RESTRICTED'),
    hints.el);
  return { id: 'title', el, onBack: () => true, update: () => hints.update() };
}

export function creditsScreen(shell: Shell): UiScreen {
  const el = h('div', { class: 'screen center' },
    h('div', { class: 'panel credits' },
      h('h1', null, 'Credits'),
      h('p', null, 'A prototype of top-down naval combat in the Battle of the Atlantic.'),
      h('p', null, 'Ships, water, light, sound and music are generated procedurally in code: voxel hulls sliced into sprite stacks, a Gerstner ocean with GPU wave and fluid simulations, deferred pixel lighting and a Web Audio synthesiser.'),
      h('p', null, 'Physics by the Rapier engine (Dimforge, Apache-2.0). 5×7 pixel font adapted from the my-3d2dge project.'),
      h('p', { class: 'dim' }, 'Ship and boat names are fictional. No political symbols are depicted.'),
      h('div', { class: 'btn-row' }, button('Back', () => shell.ui.back(), 'btn', { 'data-autofocus': true }))));
  return { id: 'credits', el };
}
