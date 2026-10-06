// Historic battles picker (M17): each battle with its date and setting, and one card per side naming the
// ship the player commands.

import type { Shell } from '../shell';
import { h, nav, type UiScreen } from '../dom';
import { button, hintBar } from '../widgets';
import { BATTLES } from '../../game/historic';

export function battlesScreen(shell: Shell): UiScreen {
  const hints = hintBar(shell.app.input);
  const blocks = BATTLES.map((b, bi) => {
    const card = (side: 'escort' | 'uboat') => {
      const who = side === 'escort' ? b.escort : b.uboat;
      const go = () => shell.launchBattle(b.id, side);
      return nav(h('div', { class: 'side-card ' + side, 'data-help': `${b.name}: ${who}.`, 'data-autofocus': bi === 0 && side === 'escort' ? '' : undefined, on: { click: go } },
        h('div', { class: 'side-name' }, side === 'escort' ? 'SURFACE' : 'SUBMARINE'),
        h('div', { class: 'side-text' }, who)),
      { accept: go });
    };
    return h('div', { class: 'battle' },
      h('h2', null, b.name, h('span', { class: 'battle-date' }, b.date)),
      h('div', { class: 'sub' }, b.blurb),
      h('div', { class: 'side-row' }, card('escort'), card('uboat')));
  });
  const el = h('div', { class: 'screen center' },
    h('div', { class: 'panel wide' },
      h('h1', null, 'Historic Battles'),
      h('div', { class: 'sub' }, 'Every ship at true scale on the real geography, with the historical order of battle and timeline. What you do changes the battle; what you leave alone happens as it did.'),
      blocks,
      h('div', { class: 'btn-row' }, button('Back', () => shell.ui.back(), 'btn')),
      hints.el));
  return { id: 'battles', el, update: () => hints.update() };
}
