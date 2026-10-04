// Abilities tab: every ability of the side with rank pips and lock state; the selected one shows its
// resolved description, rank-up, the rank-3 modifier choice and slot assignment; the six-slot loadout bar.

import type { PortCtx } from './port';
import { h, nav, onShow } from '../dom';
import { button } from '../widgets';
import {
  abilitiesFor, canRankUp, computeStats, describeAbility, LOADOUT_SIZE, MODIFIER_RANK, rankUpAbility, resolveAbility, setLoadout, setModifier,
  type AbilityDef, type AbilityId,
} from '../../meta/index.ts';

let selected: AbilityId | null = null;

export function abilitiesTab(ctx: PortCtx): HTMLElement {
  const { c, shell } = ctx;
  const ui = shell.ui;
  const stats = computeStats(c);
  const defs = abilitiesFor(c.faction);
  if (!selected || !defs.some((d) => d.id === selected)) selected = defs[0].id;
  const detail = h('div', { class: 'ab-detail' });
  const rankOf = (d: AbilityDef) => c.abilities[d.id]?.rank ?? 0;
  const pips = (d: AbilityDef) => '■'.repeat(rankOf(d)) + '□'.repeat(d.maxRank - rankOf(d));
  const assign = (d: AbilityDef) => ui.choose(`Put ${d.name} on the ability bar:`, Array.from({ length: LOADOUT_SIZE }, (_, i) => ({
    label: `Slot ${i + 1}: ${c.loadout[i] ? defs.find((x) => x.id === c.loadout[i])?.name ?? c.loadout[i] : 'empty'}`,
    run: () => {
      const lo = c.loadout.map((x) => (x === d.id ? null : x));
      lo[i] = d.id;
      if (setLoadout(c, lo)) ctx.changed();
    },
  })));
  const showDetail = (d: AbilityDef) => {
    const st = c.abilities[d.id];
    const res = resolveAbility(d, st ?? { rank: 1 }, stats);
    const locked = c.level < d.unlockLevel;
    const mods = (st?.rank ?? 0) >= MODIFIER_RANK ? d.modifiers.map((m) => button((st?.modifier === m.id ? '● ' : '○ ') + m.name, () => { if (setModifier(c, d.id, st?.modifier === m.id ? undefined : m.id)) ctx.changed(); },
      'btn small' + (st?.modifier === m.id ? ' primary' : ''), { 'data-id': `mod-${d.id}-${m.id}`, 'data-help': m.desc })) : [];
    detail.replaceChildren(
      h('div', { class: 'ab-name' }, `${d.glyph} ${d.name}`), h('div', { class: 'dim' }, d.flavor),
      h('div', { class: 'ab-desc' }, describeAbility(d, res)),
      h('div', { class: 'dim small' }, `Rank ${st?.rank ?? 0}/${d.maxRank} · cooldown ${Math.round(res.cooldown)} s${res.charges !== undefined ? ` · ${res.charges} uses` : ''}${d.minYear ? ` · from ${d.minYear}` : ''}`),
      h('div', { class: 'btn-row left' },
        button(st ? 'Rank up (1 point)' : locked ? `Unlocks at level ${d.unlockLevel}` : 'Learn (1 point)', () => { if (rankUpAbility(c, d.id)) ctx.changed(); },
          'btn small' + (canRankUp(c, d.id) ? '' : ' disabled'), { 'data-id': 'rank-' + d.id, 'data-help': `Ability points: ${c.abilityPoints}` }),
        button('Assign to slot…', () => assign(d), 'btn small' + (st ? '' : ' disabled'), { 'data-id': 'assign-' + d.id })),
      mods.length ? h('div', { class: 'ab-mods' }, h('div', { class: 'dim small' }, `Rank ${MODIFIER_RANK} upgrade (choose one):`), mods)
        : h('div', { class: 'dim small' }, `At rank ${MODIFIER_RANK}: ${d.modifiers.map((m) => m.name).join(' or ')}`));
  };
  const rows = defs.map((d) => {
    const locked = c.level < d.unlockLevel;
    const el = nav(h('div', { class: 'ab-row' + (rankOf(d) ? '' : ' unlearned') + (locked ? ' locked' : '') + (d.id === selected ? ' selected' : ''), 'data-id': 'ab-' + d.id },
      h('span', { class: 'ab-glyph' }, d.glyph), h('span', { class: 'ab-n' }, d.name), h('span', { class: 'ab-pips' }, locked ? `Lv ${d.unlockLevel}` : pips(d))),
    { accept: () => { selected = d.id; ctx.changed(); } });
    el.addEventListener('click', () => { selected = d.id; ctx.changed(); });
    onShow(el, () => { selected = d.id; showDetail(d); });
    return el;
  });
  const bar = h('div', { class: 'loadout' }, Array.from({ length: LOADOUT_SIZE }, (_, i) => {
    const id = c.loadout[i];
    const d = id ? defs.find((x) => x.id === id) : undefined;
    return button(`${i + 1}  ${d ? d.glyph + ' ' + d.name : '—'}`, () => {
      if (!id) return;
      ui.choose(`Slot ${i + 1}`, [{ label: 'Clear slot', run: () => { const lo = [...c.loadout]; lo[i] = null; if (setLoadout(c, lo)) ctx.changed(); } }]);
    }, 'btn small slot-btn', { 'data-id': 'lo-' + i, 'data-help': 'Ability bar slot. Accept to clear; assign from the list.' });
  }));
  showDetail(defs.find((d) => d.id === selected)!);
  ctx.setHelp(`Ability points: ${c.abilityPoints}. Select an ability to rank it up, pick its upgrade or put it on the bar.`);
  return h('div', { class: 'abilities' }, h('div', { class: 'ab-list' }, rows), h('div', { class: 'ab-side' }, detail, h('h2', null, 'Ability bar'), bar));
}
