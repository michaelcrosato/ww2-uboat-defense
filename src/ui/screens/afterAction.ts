// After-action report: a typewritten patrol report revealed line by line — outcome, objectives, payout
// breakdown, XP with level-ups, then the loot one item at a time. Accept skips to the end; Continue
// returns to the port (the result was already applied and saved by Career.finish).

import type { Shell } from '../shell';
import type { Debrief } from '../../game/career';
import { h, type UiScreen } from '../dom';
import { button, hintBar } from '../widgets';
import { money } from './port';
import { RARITY_COLORS, xpForLevel, LEVEL_CAP } from '../../meta/index.ts';

const OUTCOME: Record<string, string> = { victory: 'PATROL SUCCESSFUL', defeat: 'PATROL FAILED', sunk: 'SHIP LOST', withdrew: 'BROKE OFF THE ATTACK' };
const LINE_T = 0.16;

export function afterActionScreen(shell: Shell, d: Debrief): UiScreen {
  const f = d.faction, s = d.summary, c = shell.career.captain(f);
  const lines: HTMLElement[] = [];
  const L = (cls: string, ...kids: (string | HTMLElement | null)[]) => { const el = h('div', { class: 'rl ' + cls }, ...kids); lines.push(el); return el; };
  L('r-title', d.contract ? d.contract.title : 'Arena — free patrol');
  L('r-outcome ' + d.outcome, OUTCOME[d.outcome] ?? d.outcome.toUpperCase());
  if (d.reason) L('dim', d.reason);
  if (s.evaluation) {
    L('r-head', 'OBJECTIVES');
    for (const o of s.evaluation.objectives) L(o.achieved ? 'ok' : 'fail', `${o.achieved ? '✔' : '✘'} ${o.objective.label}${o.objective.optional ? ' (optional)' : ''}`, h('span', { class: 'dim' }, `  [${Math.round(o.value).toLocaleString('en-GB')}]`));
    L('r-head', 'PAYMENT');
    for (const b of s.evaluation.breakdown) L('pay', h('span', null, b.label), h('b', { class: b.amount < 0 ? 'neg' : '' }, money(f, b.amount)));
  } else if (d.freePlay) L('dim', 'Free patrol: no contract pay, half experience, no salvage kept.');
  L('pay total', h('span', null, 'Total paid'), h('b', null, money(f, s.payout)));
  L('r-head', 'EXPERIENCE');
  const xpLine = L('xp', h('span', null, `+${s.xp.toLocaleString('en-GB')} XP`));
  const bar = h('div', { class: 'xpbar' }, h('div'));
  xpLine.append(bar);
  for (let i = 0; i < s.levelsGained; i++) L('levelup', `★ PROMOTED — Level ${d.before.level + i + 1} (+skill & ability points)`);
  if (s.loot.length) {
    L('r-head', `SALVAGE (${s.loot.length})`);
    for (const it of s.loot) L('loot', h('span', { style: `color:${RARITY_COLORS[it.rarity]}` }, it.name), h('span', { class: 'dim' }, `  ${it.rarity} · ilvl ${it.ilvl}`));
    if (s.salvaged) L('dim', `Stores full: ${money(f, s.salvaged)} of salvage sold off.`);
  }
  for (const el of lines) el.classList.add('pending');
  let shown = 0, t = 0;
  const reveal = (n: number) => { for (; shown < Math.min(n, lines.length); shown++) lines[shown].classList.remove('pending'); };
  const setBar = (k: number) => {
    // fill from the old XP to the new, through any level-ups
    const need = xpForLevel(c.level);
    const end = c.level >= LEVEL_CAP ? 1 : c.xp / need;
    const start = s.levelsGained ? 0 : d.before.xp / need;
    (bar.firstChild as HTMLElement).style.width = (start + (end - start) * k) * 100 + '%';
  };
  setBar(0);
  const hints = hintBar(shell.app.input);
  // first press skips the typing, the second continues
  const cont = button('Continue ▶', () => { if (!done()) { reveal(lines.length); t = 1e3; return; } shell.ui.pop(); shell.open('port'); }, 'btn primary', { 'data-autofocus': true });
  const el = h('div', { class: 'screen center dim' },
    h('div', { class: 'panel report' }, h('h1', null, 'Patrol Report'), h('div', { class: 'report-body' }, lines), h('div', { class: 'btn-row' }, cont), hints.el));
  const done = () => shown >= lines.length;
  return {
    id: 'afterAction', el,
    onBack: () => { if (!done()) { reveal(lines.length); setBar(1); } return true; },
    update(dt) {
      hints.update();
      t += dt;
      if (!done()) {
        reveal(Math.floor(t / LINE_T) + 1);
        lines[shown - 1]?.scrollIntoView({ block: 'nearest' });
        if (shown > lines.indexOf(xpLine)) setBar(Math.min(1, (t - lines.indexOf(xpLine) * LINE_T) / 1.2));
      } else setBar(Math.min(1, (t - lines.indexOf(xpLine) * LINE_T) / 1.2));
    },
  };
}
