// Port hub: the captain's career between patrols. Header (rank, XP, funds, points) and tabs:
// Contracts, Shipyard, Armory, Captain (skill tree), Abilities, Records. Every action goes through the
// meta profile functions, then the career autosaves and the tab re-renders keeping focus by data-id.

import type { Shell } from '../shell';
import type { Career } from '../../game/career';
import { theaterById } from '../../game/theaters';
import { h, nav, type UiScreen } from '../dom';
import { button, hintBar, tabs } from '../widgets';
import { armoryTab } from './armory';
import { treeTab } from './skillTree';
import { abilitiesTab } from './portAbilities';
import {
  affixText, buyUpgrade, buyVessel, componentsFor, MAX_TIER, repair, repairCost, upgradeCost, VESSEL_OFFERS, vesselOffer,
  xpForLevel, LEVEL_CAP, type CaptainState, type Contract, type Faction, type StatKey,
} from '../../meta/index.ts';

export interface PortCtx {
  shell: Shell;
  career: Career;
  c: CaptainState;
  /** save + rebuild the current tab (focus restored by data-id) */
  changed(): void;
  /** help/detail line under the tab */
  setHelp(text: string): void;
}

export const money = (f: Faction, n: number) => (f === 'escort' ? '£' : 'RM ') + Math.round(n).toLocaleString('en-GB');
const FACTION_NAME: Record<Faction, string> = { escort: 'Royal Navy escort', uboat: 'U-boat arm' };
const TABS = ['Contracts', 'Shipyard', 'Armory', 'Captain', 'Abilities', 'Records'];

/** first visit: pick the side whose captain you play (both progress separately) */
export function factionScreen(shell: Shell, then: () => void): UiScreen {
  const career = shell.career;
  const card = (f: Faction, name: string, text: string) => {
    const c = career.captain(f);
    return nav(h('div', { class: 'side-card ' + f, 'data-help': text, on: { click: () => pick(f) } },
      h('div', { class: 'side-name' }, name), h('div', { class: 'side-sub' }, `${c.name} · Level ${c.level} · ${money(f, c.funds)}`),
      h('div', { class: 'side-text' }, text)), { accept: () => pick(f) });
  };
  const pick = (f: Faction) => { career.faction = f; shell.ui.pop(); then(); };
  const cards = [
    card('escort', 'THE ESCORT', 'Escort convoys across the Atlantic: deliver the merchants, hunt the wolfpacks, earn the Admiralty\'s bounties.'),
    card('uboat', 'THE U-BOAT', 'Patrol the convoy routes: sink tonnage, slip away from the escorts, return to the bunker with the spoils.'),
  ];
  cards[career.faction === 'uboat' ? 1 : 0].setAttribute('data-autofocus', '');
  const hints = hintBar(shell.app.input);
  const el = h('div', { class: 'screen center' },
    h('div', { class: 'panel wide' }, h('h1', null, 'Choose your command'),
      h('div', { class: 'sub' }, 'Each side has its own captain, ship, gear and career.'),
      h('div', { class: 'side-row' }, cards),
      h('div', { class: 'btn-row' }, button('Back', () => shell.ui.back(), 'btn')), hints.el));
  return { id: 'faction', el, update: () => hints.update() };
}

export function portScreen(shell: Shell): UiScreen {
  const career = shell.career;
  const faction = career.faction ?? 'escort';
  const header = h('div', { class: 'port-head' });
  const body = h('div', { class: 'port-body' });
  const help = h('div', { class: 'help' });
  let tabIndex = 0;
  const ctx: PortCtx = {
    shell, career, c: career.captain(faction),
    changed() { career.save(); render(); },
    setHelp(t) { help.textContent = t; },
  };
  const renderHeader = () => {
    const c = career.captain(faction);
    const need = xpForLevel(c.level);
    header.replaceChildren(
      h('div', { class: 'cap' }, h('div', { class: 'cap-name' }, c.name), h('div', { class: 'dim' }, `${FACTION_NAME[faction]} · ${vesselOffer(c.vessel.cls)?.name ?? c.vessel.cls}`)),
      h('div', { class: 'lvl' }, h('div', null, `Level ${c.level}`), h('div', { class: 'xpbar' }, h('div', { style: `width:${c.level >= LEVEL_CAP ? 100 : (c.xp / need) * 100}%` })),
        h('div', { class: 'dim small' }, c.level >= LEVEL_CAP ? 'max level' : `${c.xp.toLocaleString('en-GB')} / ${need.toLocaleString('en-GB')} XP`)),
      h('div', { class: 'res' }, h('div', { class: 'funds' }, money(faction, c.funds)),
        h('div', { class: 'dim small' }, `Skill points ${c.skillPoints} · Ability points ${c.abilityPoints}`)));
  };
  const render = () => {
    const focusId = shell.ui.focused?.getAttribute('data-id');
    renderHeader();
    help.textContent = '';
    const builders = [contractsTab, shipyardTab, armoryTab, treeTab, abilitiesTab, recordsTab];
    body.replaceChildren(builders[tabIndex](ctx));
    const again = focusId ? body.querySelector<HTMLElement>(`[data-id="${CSS.escape(focusId)}"]`) : null;
    if (again) shell.ui.focus(again, false);
    // the focused element was rebuilt away: continue in the new content
    else if (!shell.ui.focused?.isConnected) shell.ui.focusFirstIn(body);
  };
  const tab = tabs(TABS, (i) => { tabIndex = i; render(); if (!shell.ui.focused?.closest('.tabs')) shell.ui.focusFirstIn(body); });
  const hints = hintBar(shell.app.input, [['menuTabL', 'Prev tab'], ['menuTabR', 'Next tab']]);
  const el = h('div', { class: 'screen center port' },
    h('div', { class: 'panel port-panel' },
      h('div', { class: 'head' }, h('h1', null, faction === 'escort' ? 'Liverpool — Derby House' : 'Lorient — U-boat bunker'),
        h('div', { class: 'port-actions btn-row' },
          button('Switch side', () => shell.ui.replace(factionScreen(shell, () => shell.open('port'))), 'btn small'),
          button('Title', () => shell.ui.back(), 'btn small'))),
      header, tab.el, body, help, hints.el));
  return {
    id: 'port', el,
    onEnter() { tab.set(0); },
    onTab: (d) => tab.set(tab.index() + d),
    update: () => hints.update(),
  };
}

// ------------------------------------------------------------------ contracts
function contractsTab(ctx: PortCtx): HTMLElement {
  const { c } = ctx;
  if (!c.contracts.length) return h('div', { class: 'empty' }, 'No contracts on the board.');
  const cards = c.contracts.map((k) => contractCard(ctx, k));
  ctx.setHelp('Accept a contract to sail. Red modifiers make the patrol harder but pay and drop more.');
  return h('div', { class: 'contracts' }, cards);
}

const HOUR = (x: number) => `${String(Math.floor(x) % 24).padStart(2, '0')}:${String(Math.round((x % 1) * 60)).padStart(2, '0')}`;
const WEATHER_ICON: Record<string, string> = { clear: '☼', overcast: '☁', rain: '☂', storm: '⚡', fog: '≋', snow: '❄' };

function contractCard(ctx: PortCtx, k: Contract): HTMLElement {
  const hour = Number(k.arena['arena.hour']);
  const night = hour >= 20 || hour < 6;
  const weather = String(k.arena['arena.weather']);
  const bounty = k.mutators.reduce((a, m) => a * m.bountyMult, 1), loot = k.mutators.reduce((a, m) => a * m.lootMult, 1);
  const accept = () => ctx.shell.launchContract(k);
  return nav(h('div', { class: 'contract', 'data-id': 'contract-' + k.id, 'data-help': k.briefing, on: { click: accept } },
    h('div', { class: 'c-head' }, h('span', { class: 'c-title' }, k.title), h('span', { class: 'c-tier' }, `Tier ${k.tier}`)),
    h('div', { class: 'c-meta dim' }, `${theaterById(k.theater).name} · ${night ? '☾' : '☀'} ${HOUR(hour)} · ${WEATHER_ICON[weather] ?? ''} ${weather} · Bf ${Math.round(Number(k.arena['arena.seaState']))} · ${k.arena['arena.year']}`),
    h('div', { class: 'c-forces dim' }, `${k.arena['arena.convoy']} merchants · ${k.arena['arena.escorts']} escorts · ${k.arena['arena.uboats']} U-boats`),
    h('ul', { class: 'c-obj' }, k.objectives.map((o) => h('li', { class: o.optional ? 'opt' : 'main' }, o.label, o.optional && o.reward ? h('span', { class: 'rw' }, ` +${money(k.faction, o.reward)}`) : null))),
    k.mutators.length ? h('div', { class: 'c-mods' }, k.mutators.map((m) => h('div', { class: 'mod' }, `${m.name}: ${m.desc}`)),
      h('div', { class: 'mod-mult' }, `Bounty ×${bounty.toFixed(2)} · Loot ×${loot.toFixed(2)}`)) : null,
    h('div', { class: 'c-foot' }, h('span', null, `Bounty ${money(k.faction, k.baseBounty)}`), h('span', { class: 'accept' }, 'Accept ▶'))),
  { accept });
}

// ------------------------------------------------------------------ shipyard
function bonusText(b: Partial<Record<StatKey, number>>): string {
  return Object.entries(b).filter(([, v]) => v).map(([k, v]) => affixText({ stat: k as StatKey, value: v! })).join(', ') || '—';
}

function shipyardTab(ctx: PortCtx): HTMLElement {
  const c = ctx.c, f = c.faction;
  const rc = repairCost(c);
  const hull = h('div', { class: 'yard-block' },
    h('h2', null, 'Hull'),
    h('div', { class: 'row-line' }, h('span', null, `${vesselOffer(c.vessel.cls)?.name}: ${Math.round((1 - c.vessel.hullDamage) * 100)}% hull integrity`),
      button(rc > 0 ? `Repair ${money(f, rc)}` : 'No repairs needed', () => { if (repair(c)) ctx.changed(); }, 'btn small' + (rc <= 0 || c.funds < rc ? ' disabled' : ''),
        { 'data-id': 'repair', 'data-help': 'Damage you bring home is carried into the next patrol (the ship sails with less hull).' })));
  const comps = componentsFor(f).map((comp) => {
    const t = c.vessel.tiers[comp.id] ?? 0;
    const next = t + 1;
    const cost = next <= MAX_TIER ? upgradeCost(comp, next) : 0;
    const can = next <= MAX_TIER && c.funds >= cost;
    return h('div', { class: 'comp' },
      h('span', { class: 'comp-name' }, comp.name), h('span', { class: 'comp-tier' }, `${comp.tiers[t]} (${t}/${MAX_TIER})`),
      h('span', { class: 'comp-bonus dim' }, t ? bonusText(comp.bonus[t]) : 'stock'),
      button(next > MAX_TIER ? 'Max' : `→ ${comp.tiers[next]} ${money(f, cost)}`, () => { if (buyUpgrade(c, comp.id)) ctx.changed(); }, 'btn small' + (can ? '' : ' disabled'),
        { 'data-id': 'comp-' + comp.id, 'data-help': next > MAX_TIER ? `${comp.name} is fully upgraded.` : `Next tier: ${bonusText(comp.bonus[next])}` }));
  });
  const vessels = VESSEL_OFFERS.filter((v) => v.faction === f).map((v) => {
    const cur = v.id === c.vessel.cls, locked = c.level < v.minLevel;
    const label = cur ? 'In command' : locked ? `Level ${v.minLevel}` : `Buy ${money(f, v.price)}`;
    return h('div', { class: 'vessel' + (cur ? ' current' : '') },
      h('div', null, h('b', null, v.name), h('div', { class: 'dim small' }, v.desc)),
      button(label, () => ctx.shell.ui.confirm(`Buy the ${v.name}? Component upgrades transfer at half their tier.`, () => { if (buyVessel(c, v.id)) ctx.changed(); }),
        'btn small' + (cur || locked || c.funds < v.price ? ' disabled' : ''), { 'data-id': 'vessel-' + v.id, 'data-help': v.desc }));
  });
  return h('div', { class: 'yard' }, hull, h('div', { class: 'yard-block' }, h('h2', null, 'Components'), comps), h('div', { class: 'yard-block' }, h('h2', null, 'Vessels'), vessels));
}

// ------------------------------------------------------------------ records
function recordsTab(ctx: PortCtx): HTMLElement {
  const c = ctx.c, r = c.record, f = c.faction;
  const rows: [string, string][] = f === 'escort'
    ? [['Patrols', String(r.patrols)], ['U-boats sunk', String(r.kills)], ['Merchants delivered', String(r.delivered)], ['Merchants lost', String(r.lost)], ['Best patrol (U-boats)', String(r.best)]]
    : [['Patrols', String(r.patrols)], ['Ships sunk', String(r.kills)], ['Tonnage sunk', r.tonnage.toLocaleString('en-GB') + ' GRT'], ['Best patrol', r.best.toLocaleString('en-GB') + ' GRT']];
  rows.push(['Level', String(c.level)], ['Funds', money(f, c.funds)], ['Items carried', String(c.inventory.length)], ['Skill nodes', String(c.tree.length)]);
  return h('div', { class: 'records' },
    h('div', { class: 'stats' }, rows.map(([k, v]) => h('div', { class: 'stat' }, h('span', null, k), h('b', null, v)))),
    h('div', { class: 'btn-row' }, button('Reset career', () => ctx.shell.ui.confirm('Erase both captains and start over? This cannot be undone.', () => { ctx.career.reset(); ctx.c = ctx.career.captain(f); ctx.changed(); }),
      'btn small', { 'data-id': 'reset', 'data-help': 'Deletes the saved profile for both sides.' })));
}
