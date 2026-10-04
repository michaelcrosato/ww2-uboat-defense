// Armory tab: equipment slots, inventory grid and an item card that follows the focus (with a
// comparison against the equipped item). Accept opens Equip / Unequip / Re-roll / Salvage.

import type { PortCtx } from './port';
import { money } from './port';
import { h, nav, onShow } from '../dom';
import { itemCard } from '../itemCard';
import { affixText, equip, INVENTORY_CAP, rerollCost, rerollItem, salvage, SLOT_NAMES, SLOTS, unequip, type Item, type Slot } from '../../meta/index.ts';

const RARITY_ORDER = { unique: 0, legendary: 1, rare: 2, magic: 3, common: 4 };

export function armoryTab(ctx: PortCtx): HTMLElement {
  const { c, shell } = ctx;
  const ui = shell.ui;
  const detail = h('div', { class: 'armory-detail' });
  const show = (it: Item | undefined, slot: Slot) => {
    const eq = c.equipped[slot];
    detail.replaceChildren(itemCard(it, it && eq && eq.uid !== it.uid ? eq : undefined, it && eq?.uid === it.uid ? 'Equipped' : undefined));
    if (it && eq && eq.uid !== it.uid) detail.append(itemCard(eq, undefined, 'Equipped'));
  };
  const reroll = (it: Item) => {
    if (it.rarity === 'unique' || !it.affixes.length) { ui.choose('Uniques and commons without affixes cannot be re-rolled.', []); return; }
    const cost = rerollCost(it);
    ui.choose(`Re-roll one affix of ${it.name} for ${money(c.faction, cost)}:`, it.affixes.map((a, i) => ({
      label: affixText(a), disabled: c.funds < cost,
      run: () => { if (rerollItem(c, it.uid, i, ctx.career.rng)) ctx.changed(); },
    })));
  };
  const slotCell = (slot: Slot) => {
    const it = c.equipped[slot];
    const el = nav(h('div', { class: 'eq-slot' + (it ? ' ' + it.rarity : ' empty'), 'data-id': 'slot-' + slot },
      h('span', { class: 'eq-name' }, SLOT_NAMES[slot]), h('span', { class: 'eq-item' }, it ? it.name : '—')),
    { accept: () => act() });
    const act = () => {
      if (!it) return;
      ui.choose(it.name, [
        { label: 'Unequip', run: () => { if (unequip(c, slot)) ctx.changed(); }, disabled: c.inventory.length >= INVENTORY_CAP },
        { label: 'Re-roll an affix…', run: () => reroll(it), disabled: it.rarity === 'unique' || !it.affixes.length },
      ]);
    };
    el.addEventListener('click', act);
    onShow(el, () => show(it, slot));
    return el;
  };
  const invCell = (it: Item) => {
    const act = () => ui.choose(it.name, [
      { label: `Equip (${SLOT_NAMES[it.slot]})`, run: () => { if (equip(c, it.uid)) ctx.changed(); } },
      { label: 'Re-roll an affix…', run: () => reroll(it), disabled: it.rarity === 'unique' || !it.affixes.length },
      { label: `Salvage for ${money(c.faction, it.value)}`, run: () => { salvage(c, it.uid); ctx.changed(); } },
    ]);
    const el = nav(h('div', { class: 'inv-cell ' + it.rarity, 'data-id': 'item-' + it.uid, title: it.name },
      h('span', { class: 'inv-slot' }, SLOT_NAMES[it.slot].slice(0, 4)), h('span', { class: 'inv-name' }, it.name)), { accept: act });
    el.addEventListener('click', act);
    onShow(el, () => show(it, it.slot));
    return el;
  };
  const inv = [...c.inventory].sort((a, b) => RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity] || a.slot.localeCompare(b.slot) || b.ilvl - a.ilvl);
  const root = h('div', { class: 'armory' },
    h('div', { class: 'eq-col' }, h('h2', null, 'Fitted'), SLOTS[c.faction].map(slotCell)),
    h('div', { class: 'inv-col' }, h('h2', null, `Stores ${c.inventory.length}/${INVENTORY_CAP}`),
      inv.length ? h('div', { class: 'inv-grid' }, inv.map(invCell)) : h('div', { class: 'empty' }, 'Nothing in stores. Sink ships and recover the crates they leave behind.')),
    detail);
  // onShow: the card follows focus (mouse hover focuses too)
  detail.replaceChildren(h('div', { class: 'item-card empty' }, 'Select an item to inspect it.'));
  ctx.setHelp('Accept on an item: equip, re-roll an affix at the shipyard, or salvage it for funds.');
  return root;
}
