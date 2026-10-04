# M7 — Meta layer: items, loot, skill trees, economy, contracts, profile

**Status:** see docs/PLAN.md · **Depends on:** nothing (renderer-independent) · **Size:** large

## Goal
Pure-logic progression layer (Diablo IV / Path of Exile 2 inspired) with unit tests. The UI comes in
M10. `src/meta/abilities.ts` (all 25 abilities + `resolveAbility`) already exists and is used by
gameplay — keep its exports stable.

## Read first (binding contracts — implement against them, don't change them except to ADD optional fields)
`src/meta/stats.ts` (STAT_KEYS, StatBlock with flags + powers), `src/meta/types.ts`, `src/meta/abilities.ts`
(style reference), `src/game/arenaConfig.ts` (valid arena keys/ranges for contracts),
`src/game/theaters.ts` (theater ids), `src/core/math.ts` (use `Rng` for ALL randomness).

## Rules for src/meta
Node runs these files directly: explicit `.ts` extensions in relative imports, only erasable
TypeScript (no enums, namespaces, parameter properties, decorators), `import type` for types.
No DOM except a guarded localStorage wrapper with an in-memory fallback. Fictional names only for
uniques/characters; period flavour (Admiralty patterns, Western Approaches; GHG, KDB, Metox,
Bold/Pillenwerfer, Zaunkönig, Schnorchel); no political symbols.

## Modules
1. `items.ts` — 3–6 bases per slot per faction (period names, an implicit affix each); affix pools per
   slot with tiers T1 (best)…T5 and item-level gating; rarity rules (common 0–1 affix, magic 1–2,
   rare 3–4, legendary 3 + legendary power, unique fixed); prefix/suffix naming (rares: two-word
   evocative names); salvage value; `rollItem(rng, { faction, ilvl, rarity?, slot?, lootFind? })`;
   `rerollAffix(item, index, rng)` (shipyard crafting; increments `rerolls`, rising cost);
   `itemStats(item) => StatBlock`. Legendary power ids (gameplay hooks already implemented — use
   these exact ids; choose value ranges; write `text` templates):
   escort `pow_echo_marks` (+X% damage to pinged targets), `pow_chain_charges` (X% chance of a second
   detonation), `pow_proximity_hedgehog` (missed Hedgehog bombs deal X%), `pow_flare_aura`,
   `pow_ram_shield`, `pow_auto_ping` (every X gun hits → free ping), `pow_convoy_heal`,
   `pow_night_guns` (+X% reload at night); u-boat `pow_split_torpedo` (X% chance), `pow_silent_crit`,
   `pow_ghost_decoy`, `pow_hunter_reload`, `pow_deep_armor` (X% less damage below the layer),
   `pow_battery_vamp` (X% battery per hit), `pow_magnetic_master` (+X% under-keel, no duds),
   `pow_wolf_howl` (X% quieter after Wolfpack Signal). ~8 uniques per faction (fixed name, flavour,
   fixed affixes, boosted power).
2. `loot.ts` — `rollDrops(rng, { faction, source: 'merchant'|'tanker'|'escort'|'uboat'|'contract'|'boss', ilvl, lootFind, mult }) => Item[]`
   with D4-like rarity weights; `RARITY_COLORS` (common #c8c8c8, magic #6f9cff, rare #ffd84a,
   legendary #ff8c2a, unique #c9a46a).
3. `tree.ts` — `ESCORT_TREE`, `UBOAT_TREE` (type `SkillTree`): PoE-style constellation, start at (0,0),
   4 branches (escort: Hunter / Shepherd / Gunnery / Seamanship; u-boat: Wolf / Ghost / Iron Coffin /
   Raider), 70–90 nodes each, small (+1 stat), notables (2–3 stats, named), cross-links, keystones at
   branch ends with these exact flags (gameplay reads them):
   escort `ks_hunter_killer`, `ks_shepherd`, `ks_iron_bow`, `ks_star_gazer`, `ks_silent_listener`,
   `ks_gunnery_school`; u-boat `ks_silent_hunter`, `ks_iron_coffin`, `ks_night_surface`,
   `ks_one_torpedo`, `ks_wolf_leader`, `ks_ghost` (descriptions: see the comments in
   `src/game/*.ts` where each flag is used — `grep -rn "ks_" src/game`). Layout coords in
   [-1000, 1000], min spacing ~60, symmetric links. `canAllocate`, `canRefund` (stays connected to
   start), `treeStats(tree, allocated) => StatBlock`.
4. `economy.ts` — vessel classes and prices (escort: corvette starter, destroyer, frigate; u-boat:
   type7 starter, type9, type21 — ids match `src/game/vesselClasses.ts`), COMPONENTS per faction
   (escort: hull, engine, sonar, guns, asw, electronics; u-boat: hull, diesels, battery, hydrophones,
   torpedoes, deckgun) with tiers 0–5 ("Mk I…Mk V" / Kriegsmarine designations), cost curves,
   per-tier StatBlock bonuses; `repairCost(captain)`, `upgradeCost(component, tier)`,
   `xpForLevel(level)` (cap 50), level-up grants (1 skill + 1 ability point per level, bonus every 5),
   `componentStats(vessel) => StatBlock`.
5. `contracts.ts` — ≥ 16 mutators (PoE map-mod style: experienced escorts +25% enemy sonar range,
   heavy weather, moonless, escort carrier present, wolfpack of 6, fast convoy, torpedo crisis +15%
   duds, stragglers, thermal layer, air gap, …) with arena overrides and/or enemy/player stat mods,
   `bountyMult`, `lootMult`; `generateContracts(rng, captain, count = 4)` (briefing text, theater,
   FULL valid `arena` config — every key valid per arenaConfig ranges/options, `arena.side` matching
   the faction — tier scaling with level, main + optional objectives with rewards);
   `evaluateContract(contract, result, stats) => { success, payout, breakdown[], xp, objectives[] }`
   (escort: tonnage delivered, U-boats sunk, survivors, optional objectives; u-boat: per GRT with
   tanker/escort bonuses; `funds_pct`, `xp_pct`, mutator `bountyMult` apply; defeat handled).
6. `profile.ts` — `newProfile()`, `newCaptain(faction)` (starter vessel, a few common items equipped,
   starting abilities on the loadout: escort dc_pattern, asdic_sweep, star_shell, damage_control;
   u-boat torpedo_spread, crash_dive, silent_running, damage_control), `computeStats(captain, extra?)`
   (level base + components + equipped items + tree + extra), `applyMissionResult(profile, faction,
   contract | null, result, rng)` (funds, XP, levels, record, hull damage, loot into inventory with a
   cap of 60, refresh contracts), `equip/unequip/salvage`, `allocateNode/refundNode`,
   `rankUpAbility` (respects maxRank + unlockLevel), `setModifier` (rank ≥ 3), `setLoadout`, `repair`,
   `buyUpgrade`, `buyVessel`, save/load (`localStorage` key `wolfpack.profile.v1`, version number,
   migration hook, in-memory fallback).
7. `index.ts` — re-exports.

## Tests — `src/meta/meta.test.ts` (`node --test src/meta/meta.test.ts`)
Every AbilityDef has params arrays of length maxRank and modifiers reference existing params;
`resolveAbility` math; 2000 random items valid (stat keys in STAT_KEYS, tiers in range, rarity affix
counts, non-empty names, powers of the right faction); trees: symmetric links, all reachable,
all six keystone flags per faction, no overlaps; `canRefund` keeps connectivity; 200 contracts per
faction with only valid arena keys/values and the right side; `evaluateContract` pays more for better
results and handles defeat; profile: computeStats sane, applyMissionResult levels up and adds loot,
save/load round-trip (in-memory), equip/unequip moves items.

## Acceptance
`node --test src/meta/meta.test.ts` passes; `npm run typecheck` passes.

## Commit
`Meta layer: items, loot, skill trees, economy, contracts, profile + tests`

## Notes (fill in when done)
