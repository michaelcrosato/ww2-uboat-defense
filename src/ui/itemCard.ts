// Item tooltip card (Diablo-style): rarity-coloured name, base/slot/ilvl, implicit, affixes with tier
// pips and roll range, legendary power, flavour, salvage value; optional stat comparison vs another item.

import { h } from './dom';
import { affixText, BASE_BY_ID, itemStats, RARITY_COLORS, SLOT_NAMES, STAT_INFO, type Affix, type Item, type StatKey } from '../meta/index.ts';

const RARITY_LABEL = { common: 'Common', magic: 'Magic', rare: 'Rare', legendary: 'Legendary', unique: 'Unique' };

/** five pips, filled by quality (T1 = best); implicits carry no tier */
function pips(tier: number): string { const t = Math.min(5, Math.max(1, Math.round(tier) || 5)); return '◆'.repeat(6 - t) + '◇'.repeat(t - 1); }

function affixLine(a: Affix, cls = 'affix'): HTMLElement {
  const range = a.min !== a.max ? ` [${a.min}–${a.max}]` : '';
  const tiered = a.tier >= 1 && a.tier <= 5;
  return h('div', { class: cls }, tiered ? h('span', { class: 'pips', title: `Tier ${a.tier}` }, pips(a.tier)) : null, tiered ? ' ' : null, affixText(a), h('span', { class: 'range' }, range));
}

export function itemCard(item: Item | undefined, compare?: Item, title?: string): HTMLElement {
  if (!item) return h('div', { class: 'item-card empty' }, title ? h('div', { class: 'card-title' }, title) : null, 'Empty slot');
  const col = RARITY_COLORS[item.rarity];
  const base = BASE_BY_ID.get(item.base);
  const el = h('div', { class: 'item-card ' + item.rarity, style: `--rc:${col}` },
    title ? h('div', { class: 'card-title' }, title) : null,
    h('div', { class: 'item-name' }, item.name),
    h('div', { class: 'item-sub' }, `${RARITY_LABEL[item.rarity]} ${base?.name ?? ''} · ${SLOT_NAMES[item.slot]} · ilvl ${item.ilvl}`),
    item.implicit ? affixLine(item.implicit, 'affix implicit') : null,
    item.implicit && item.affixes.length ? h('div', { class: 'sep' }) : null,
    item.affixes.map((a) => affixLine(a)),
    item.power ? h('div', { class: 'power' }, item.power.text) : null,
    item.flavor ? h('div', { class: 'flavor' }, item.flavor) : null,
    h('div', { class: 'item-foot' }, `Salvage ${item.value}`, item.rerolls ? ` · re-rolled ×${item.rerolls}` : ''));
  if (compare && compare.uid !== item.uid) el.append(diff(item, compare));
  return el;
}

/** stat differences if `item` replaced `other` */
function diff(item: Item, other: Item): HTMLElement {
  const a = itemStats(item).v, b = itemStats(other).v;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as StatKey[]);
  const rows: HTMLElement[] = [];
  for (const k of keys) {
    const d = Math.round(((a[k] ?? 0) - (b[k] ?? 0)) * 10) / 10;
    if (!d) continue;
    const better = STAT_INFO[k].good === 'up' ? d > 0 : d < 0;
    rows.push(h('div', { class: better ? 'up' : 'down' }, (better ? '▲ ' : '▼ ') + affixText({ stat: k, value: d })));
  }
  return h('div', { class: 'compare' }, h('div', { class: 'card-title' }, 'If equipped instead of ' + other.name), rows.length ? rows : h('div', { class: 'dim' }, 'No stat change'));
}
