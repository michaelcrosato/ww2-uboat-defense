# M10 — Port & progression UI, contracts → missions, loot drops, save/load

**Status:** see docs/PLAN.md · **Depends on:** M7, M9 · **Size:** large

## Goal
Close the loop: port hub → pick a contract (with mutators) → mission with the captain's stats and
abilities → loot drops from sunk ships (Diablo-style beams, labels, pickup) → after-action report
with bounty payout, XP, level-ups → spend in the shipyard, armory, skill tree and ability screens.

## Read first
`src/meta/index.ts` (+ the module headers), `src/meta/types.ts`, `src/app.ts` (`MissionHooks`,
`applyStats`), `src/game/mission.ts`, `src/game/weapons.ts` (`layLoot`, crates, `RARITY_BEAM`),
`src/ui/dom.ts` + an existing screen from M9 for style.

## Steps
1. Profile: load at boot (`profile.ts`), autosave after every change and after missions. Faction
   choice on entering the port (two captains, separate progress).
2. **Port hub** (`src/ui/screens/port.ts`) with tabs:
   - *Contracts*: cards from `captain.contracts` — title, theater, time/weather icons, objectives with
     rewards, mutators listed like PoE map mods (red text, bounty/loot multipliers), *Accept* starts the
     mission with `contract.arena` overrides, mutator arena overrides, `computeStats(captain, playerMutators)`
     as `MissionHooks.stats`, the captain's ability states + loadout. Enemy mutator stats are applied to
     AI vessels' `stats` in `Mission` (add a hook param).
   - *Shipyard*: repair (cost), component upgrade tiers with stat previews, vessel purchase/switch.
   - *Armory*: inventory grid + equipment slots; rarity-colored items; tooltip with affixes (tier pips,
     roll ranges), implicit, legendary power text, comparison with the equipped item; equip/unequip,
     salvage; shipyard re-roll of one affix (crafting) with cost.
   - *Captain*: skill tree on a `<canvas>` (pan/zoom with mouse drag/wheel and right stick; nodes
     colored by kind; allocated paths highlighted; hover tooltip; click/accept to allocate when
     `canAllocate`; refund with right-click / ✕ when `canRefund`; points counter).
   - *Abilities*: all faction abilities with rank, `describeAbility` text, rank-up with ability points,
     modifier choice at rank 3, six loadout slots (drag or select).
   - *Records*: career stats.
3. **Loot in missions**: on `sunk` (enemy of the player side, or merchants for U-boat players) call
   `rollDrops(rng, { faction, source, ilvl: contract tier or captain level, lootFind:
   stats.get('loot_find_pct') * dev.num('game.lootRate') })` and `world.projectiles.layLoot(x, y, item)`
   for each. Pickup already exists (`lootPicked` event) → HUD message in rarity color + sound;
   legendary/unique drops get a stronger beam and a screen flash.
4. **After-action report** (`screens/afterAction.ts`): typewriter-style patrol report — outcome,
   objectives met/failed (`evaluateContract`), payout breakdown, XP bar with level-ups, loot list
   revealed one by one (rarity colors). Then `applyMissionResult` and back to the port.
5. Title *Port* button enabled. Arena (free play) still exists and grants reduced XP/no contract.

## Acceptance
- Headless flow via `--steps`/`--eval`: open port, accept the first contract, `__app.fastForward(…)`
  until the mission ends, after-action shows payout, profile funds increase, an item lands in the
  inventory (force a drop via `?dev.game.lootRate=5` if needed). Screenshots of every port tab.
- Save/reload keeps the captain (reload the page in the test).
- typecheck + meta tests pass; 0 page errors.

## Commit
`Port and progression: contracts, shipyard, armory, skill tree, abilities, loot, after-action`

## Notes (fill in when done)
**Done.** What changed:
- `src/game/career.ts` (`Career`): loads/creates the profile at boot (`window.__shell.career`), autosaves after
  every change; `faction` stored in `profile.settings`. `contractMission(contract)` → overrides (contract arena,
  mutator arena, the captain's current hull class) + `MissionHooks` (`computeStats(captain, player mutators)`,
  enemy mutator `StatBlock`, loadout, ability states, carried hull damage, `onStart` loot hook).
  `attachLoot` rolls `rollDrops` on every enemy-side sinking (merchants count for U-boat captains; ilvl =
  `contractIlvl`, `mult = lootMult × game.lootRate`, `lootFind = loot_find_pct`), fans the crates around the
  wreck, legendary/unique → screen flash + rarity-coloured alert; pickups print "Recovered: …" in rarity colour.
  `finish(mission, freePlay)` builds the `MissionResult`, recovers crates still afloat (if the ship survived),
  calls `applyMissionResult` and saves.
- Meta: `applyMissionResult(…, opts)` gains `inMissionDrops` (no double sinking rolls) and `freePlay` (half XP, no
  pay/loot/board change); new `rerollItem(captain, uid, index, rng)` (cost, inventory or equipped). +1 test (17).
- Mission/App: `Mission(…, { enemyStats })` sets the stats of enemy warships; `MissionHooks.enemyStats`,
  `hullDamage` (ship sails with `1 − 0.6·damage` hull), `onStart`. HUD messages accept a `color`.
- UI: `screens/port.ts` (faction picker, hub header with XP bar/funds/points, tabs Contracts / Shipyard / Records),
  `armory.ts` (fitted slots, sorted stores grid, item card that follows focus via `onShow`, Equip / Unequip /
  Re-roll affix / Salvage menus via the new `Ui.choose`), `skillTree.ts` (canvas: pan/zoom/hover/click/right-click
  refund; keyboard/pad walk nodes through the new `NavHooks.move`, right stick pans), `portAbilities.ts` (rank up,
  rank-3 modifier choice, slot assignment, loadout bar), `afterAction.ts` (typed patrol report: outcome,
  objectives, payout breakdown, XP bar + promotions, loot one by one; first accept skips), `itemCard.ts`
  (tier pips, roll ranges, implicit, power, flavour, comparison vs equipped).
- Shell: title *Port* enabled; modes `career | arena | test` — contracts end in the after-action report, arena free
  play shows the summary plus half XP for that side's captain, URL test missions touch nothing. Abandoning a
  contract returns to the port. `?menu=port&faction=escort|uboat` for tests.

Acceptance (all 0 page errors, `check-output/m10/`): every port tab at 1280×720 (+ armory at 800×600); escort
contract accepted with Enter → `fastForward(2400)` → victory → after-action, funds 1500 → 3150, level 2, contract
reward item in stores; U-boat contract (player sunk) → defeat report; enemy U-boats destroyed → 6–15 crates with
beams + legendary alert → report lists 9 salvage items; reload keeps the captain (13 items, £4,998, same name);
skill tree allocation by keyboard (→, Enter → `uboat_wolf_s0`). `npm test` 17/17, typecheck, build.
