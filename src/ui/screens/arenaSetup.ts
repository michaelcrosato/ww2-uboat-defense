// Arena setup: side picker cards plus every ARENA_DEFS setting, grouped by tab; Randomize, Reset, Launch.

import type { Shell } from '../shell';
import { arena, ARENA_DEFS } from '../../game/arenaConfig';
import { h, nav, type UiScreen } from '../dom';
import { bindRows, button, helpPanel, hintBar, renderSetting, tabs, type SettingRow } from '../widgets';

const SIDES = [
  { id: 'escort', name: 'THE ESCORT', sub: 'Royal Navy · Allied escort group', text: 'Command a destroyer, corvette or frigate. Hunt the wolfpack with ASDIC, depth charges and Hedgehog while the merchants run the gauntlet.' },
  { id: 'uboat', name: 'THE U-BOAT', sub: 'Kriegsmarine · U-boat arm', text: 'Command a Type VII, IX or XXI boat. Shadow the convoy, slip past the screen and attack at periscope depth or on the surface at night.' },
];

export function arenaScreen(shell: Shell): UiScreen {
  const groups = arena.groups();
  const rows: SettingRow[] = ARENA_DEFS.filter((d) => !d.hidden && d.key !== 'arena.side').map((d) => renderSetting(arena, d));
  const list = h('div', { class: 'list' });
  const cards = SIDES.map((s) => nav(h('div', { class: 'side-card ' + s.id, 'data-help': s.text, on: { click: () => arena.set('arena.side', s.id) } },
    h('div', { class: 'side-name' }, s.name), h('div', { class: 'side-sub' }, s.sub), h('div', { class: 'side-text' }, s.text)),
  { accept: () => arena.set('arena.side', s.id) }));
  const syncSide = () => {
    const side = arena.str('arena.side');
    cards.forEach((c, i) => c.classList.toggle('active', SIDES[i].id === side));
    for (const r of rows) {
      if (r.def.key === 'arena.escortClass') r.el.classList.toggle('hidden', side !== 'escort');
      if (r.def.key === 'arena.uboatClass') r.el.classList.toggle('hidden', side !== 'uboat');
    }
  };
  const tab = tabs(groups, (i) => {
    list.replaceChildren(...rows.filter((r) => r.def.group === groups[i]).map((r) => r.el));
    syncSide();
    if (!shell.ui.focused?.classList.contains('side-card')) shell.ui.focusFirstIn(list);
  });
  const randomize = () => {
    const vals: Record<string, number | string | boolean> = {};
    for (const d of ARENA_DEFS) {
      if (d.key === 'arena.side' || d.hidden) continue;
      if (d.type === 'bool') vals[d.key] = Math.random() < 0.5;
      else if (d.type === 'select') vals[d.key] = d.options[Math.floor(Math.random() * d.options.length)].value;
      else if (d.type === 'range') {
        // keep the random battles playable: forces around their defaults, everything else anywhere
        const lo = d.group === 'Forces' ? Math.max(d.min, d.def * 0.5) : d.min, hi = d.group === 'Forces' ? Math.min(d.max, d.def * 1.6 + 1) : d.max;
        vals[d.key] = Math.round((lo + Math.random() * (hi - lo) - d.min) / d.step) * d.step + d.min;
      }
    }
    arena.setMany(vals);
  };
  const help = h('div', null);
  const hints = hintBar(shell.app.input, [['menuTabL', 'Tabs']]);
  const launch = button('Launch ▶', () => shell.launch(), 'btn primary', { 'data-help': 'Start the battle with these settings.' });
  const el = h('div', { class: 'screen center' },
    h('div', { class: 'panel wide arena' },
      h('h1', null, 'Arena'),
      h('div', { class: 'side-row' }, cards),
      tab.el,
      list,
      help,
      h('div', { class: 'btn-row' },
        button('Back', () => shell.ui.back(), 'btn'),
        button('Reset', () => shell.ui.confirm('Reset every arena setting to its default?', () => arena.reset()), 'btn', { 'data-help': 'Restore the default arena.' }),
        button('Randomize', randomize, 'btn', { 'data-help': 'Roll a random theater, weather and force mix (keeps your side).' }),
        launch),
      hints.el));
  help.replaceWith(helpPanel(el, 'Choose a side, then tune the battle. Settings are remembered.'));
  cards[arena.str('arena.side') === 'uboat' ? 1 : 0].setAttribute('data-autofocus', '');
  let off: () => void = () => {};
  return {
    id: 'arena', el,
    onEnter() { const a = bindRows(arena, rows), b = arena.onChange(syncSide); off = () => { a(); b(); }; tab.set(0); },
    onExit() { off(); },
    onTab: (d) => tab.set(tab.index() + d),
    update: () => hints.update(),
  };
}
