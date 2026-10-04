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
