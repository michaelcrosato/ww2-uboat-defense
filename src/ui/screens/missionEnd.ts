// Mission summary (until the port/debrief flow of M10): outcome and the mission's result numbers.

import type { Shell } from '../shell';
import type { Mission } from '../../game/mission';
import { h, type UiScreen } from '../dom';
import { button, hintBar } from '../widgets';

const OUTCOME: Record<string, string> = { victory: 'VICTORY', defeat: 'DEFEAT', sunk: 'LOST WITH ALL HANDS', withdrew: 'WITHDREW' };

export function missionEndScreen(shell: Shell, m: Mission): UiScreen {
  const r = m.result();
  const mins = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const pct = (x: number) => Math.round(x * 100) + '%';
  const lines: [string, string][] = r.side === 'escort' ? [
    ['Merchants delivered', `${r.merchantsTotal - r.merchantsLost} / ${r.merchantsTotal}`],
    ['Tonnage delivered', r.tonnageDelivered.toLocaleString() + ' GRT'],
    ['Tonnage lost', r.tonnageLost.toLocaleString() + ' GRT'],
    ['U-boats sunk', String(r.uboatsSunk)], ['U-boats damaged', String(r.uboatsDamaged)],
    ['ASDIC pings', String(r.pingsUsed)], ['Depth charges dropped', String(r.depthChargesDropped)],
    ['Survivors rescued', String(r.survivorsRescued)],
  ] : [
    ['Tonnage sunk', r.tonnageSunk.toLocaleString() + ' GRT'], ['Ships sunk', String(r.shipsSunk.length)],
    ['Escorts sunk', String(r.escortsSunk)],
    ['Torpedoes fired', String(r.torpedoesFired)], ['Torpedo hits', `${r.torpedoHits}${r.torpedoesFired ? ` (${pct(r.torpedoHits / r.torpedoesFired)})` : ''}`],
  ];
  lines.push(['Time in action', mins(r.durationSec)], ['Hull damage', pct(r.playerHullDamage)], ['Loot recovered', String(r.lootCollected.length)]);
  const hints = hintBar(shell.app.input);
  const el = h('div', { class: 'screen center dim' },
    h('div', { class: 'panel end ' + r.outcome },
      h('div', { class: 'outcome' }, OUTCOME[r.outcome] ?? r.outcome.toUpperCase()),
      h('div', { class: 'sub' }, m.overReason ?? ''),
      h('div', { class: 'stats' }, lines.map(([k, v]) => h('div', { class: 'stat' }, h('span', null, k), h('b', null, v)))),
      r.shipsSunk.length ? h('div', { class: 'sunk-list dim' }, r.shipsSunk.map((s) => `${s.name} (${s.grt.toLocaleString()})`).join(' · ')) : null,
      h('div', { class: 'btn-row' },
        button('Again', () => shell.restart(), 'btn primary', { 'data-autofocus': true }),
        button('Arena setup', () => { shell.abandon(); shell.open('arena'); }, 'btn'),
        button('Title', () => shell.abandon(), 'btn')),
      hints.el));
  return { id: 'end', el, onBack: () => true, update: () => hints.update() };
}
