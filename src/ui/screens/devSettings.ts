// Dev settings: a tab per group of DEV_DEFS, presets, per-group reset and a label search. Changes
// apply live (stores notify their systems); the panel sits on the right so the game stays visible.

import type { Shell } from '../shell';
import { dev, DEV_DEFS } from '../../core/devSettings';
import { h, nav, type UiScreen } from '../dom';
import { bindRows, button, helpPanel, hintBar, renderSetting, tabs, RELOAD_KEYS, type SettingRow } from '../widgets';

export function devScreen(shell: Shell, startTab?: string): UiScreen {
  const groups = dev.groups();
  const rows: SettingRow[] = DEV_DEFS.filter((d) => !d.hidden).map((d) => renderSetting(dev, d));
  const list = h('div', { class: 'list' });
  const reloadNote = h('div', { class: 'reload-note hidden' }, 'Renderer changes apply after a reload. ',
    button('Reload now', () => location.reload(), 'btn small'));
  let query = '';
  const show = () => {
    const q = query.trim().toLowerCase();
    const vis = q ? rows.filter((r) => r.def.label.toLowerCase().includes(q) || r.def.key.toLowerCase().includes(q))
      : rows.filter((r) => r.def.group === groups[tab.index()]);
    list.replaceChildren(...vis.map((r) => r.el));
    if (!vis.length) list.append(h('div', { class: 'empty' }, 'No setting matches.'));
    tab.el.classList.toggle('muted', !!q);
    list.scrollTop = 0;
  };
  const tab = tabs(groups, () => { if (query) { query = ''; search.value = ''; } show(); shell.ui.focusFirstIn(list); });
  const search = h('input', { type: 'search', placeholder: 'Search settings…', class: 'search' });
  search.addEventListener('input', () => { query = search.value; show(); });
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); search.blur(); } });
  const searchBox = nav(h('div', { class: 'search-wrap', 'data-help': 'Filter every group by label. Enter or Esc returns to the list.' }, search),
    { accept: () => search.focus() });
  searchBox.addEventListener('click', () => search.focus());
  const presets = h('div', { class: 'presets' }, h('span', { class: 'label' }, 'Presets'),
    dev.presets.map((p) => button(p.label, () => dev.applyPreset(p.id), 'btn small', { 'data-help': p.help ?? '' })));
  const hints = hintBar(shell.app.input, [['menuTabL', 'Prev tab'], ['menuTabR', 'Next tab']]);
  const el = h('div', { class: 'screen side-right' },
    h('div', { class: 'panel tall dev' },
      h('div', { class: 'head' }, h('h1', null, 'Dev Settings'), searchBox),
      presets,
      tab.el,
      list,
      reloadNote,
      h('div', { class: 'help-slot' }),
      h('div', { class: 'btn-row' },
        button('Back', () => shell.ui.back(), 'btn'),
        button('Reset group', () => {
          const g = groups[tab.index()];
          shell.ui.confirm(`Reset every “${g}” setting to its default?`, () => dev.reset(g));
        }, 'btn', { 'data-help': 'Restore this tab\'s defaults.' })),
      hints.el));
  el.querySelector('.help-slot')!.replaceWith(helpPanel(el, 'Changes apply immediately and are saved.'));
  const bootValues = new Map([...RELOAD_KEYS].map((k) => [k, dev.get(k)]));
  const syncReload = () => reloadNote.classList.toggle('hidden', ![...bootValues].some(([k, v]) => dev.get(k) !== v));
  let off: () => void = () => {};
  return {
    id: 'dev', el,
    onEnter() {
      const a = bindRows(dev, rows), b = dev.onChange(syncReload);
      off = () => { a(); b(); };
      const i = startTab ? groups.findIndex((g) => g.toLowerCase() === startTab.toLowerCase()) : 0;
      tab.set(Math.max(0, i));
      syncReload();
    },
    onExit() { off(); },
    onTab: (d) => tab.set(tab.index() + d),
    update: () => hints.update(),
  };
}
