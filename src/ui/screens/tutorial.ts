// Tutorial picker: one guided lesson per side, flown as a gentle arena battle with a coach panel.

import type { Shell } from '../shell';
import { h, nav, type UiScreen } from '../dom';
import { button, hintBar } from '../widgets';
import { tutorialsDone, type TutorialSide } from '../../game/tutorial';

const LESSONS: { id: TutorialSide; name: string; text: string }[] = [
  { id: 'uboat', name: 'THE U-BOAT', text: 'Helm and telegraph, hydrophones, diving, the periscope, locking a target, firing torpedoes and going deep to shake off the escort.' },
  { id: 'escort', name: 'THE ESCORT', text: 'Helm and telegraph, running down a periscope sighting, ASDIC pings, depth-charge attacks, Hedgehog and the other escort tools.' },
];

export function tutorialScreen(shell: Shell): UiScreen {
  const done = tutorialsDone();
  const hints = hintBar(shell.app.input);
  const cards = LESSONS.map((l) => nav(h('div', { class: 'side-card ' + l.id, 'data-help': l.text, on: { click: () => shell.launchTutorial(l.id) } },
    h('div', { class: 'side-name' }, l.name),
    h('div', { class: 'side-sub' }, done[l.id] ? 'About 10 minutes · completed' : 'About 10 minutes'),
    h('div', { class: 'side-text' }, l.text)),
  { accept: () => shell.launchTutorial(l.id) }));
  // suggest the side the player has not flown yet
  cards[done.uboat && !done.escort ? 1 : 0].setAttribute('data-autofocus', '');
  const el = h('div', { class: 'screen center' },
    h('div', { class: 'panel wide' },
      h('h1', null, 'Tutorial'),
      h('div', { class: 'sub' }, 'A guided battle in calm daylight. The panel under the compass says what to do next and ticks each step off as you do it.'),
      h('div', { class: 'side-row' }, cards),
      h('div', { class: 'btn-row' }, button('Back', () => shell.ui.back(), 'btn')),
      hints.el));
  return { id: 'tutorial', el, update: () => hints.update() };
}
