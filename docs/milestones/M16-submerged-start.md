# M16 — U-boats start submerged

**Status:** see docs/PLAN.md · **Depends on:** M15 · **Size:** small

## Goal
User: "Make sure the U-boats always start submerged unless undocking from a port or it makes sense for the
U-boat to start not submerged." Also the new standard operating procedure: commit, push, open a PR, merge it
and delete the branch without asking (rollback if anything goes badly wrong).

## Read first
`src/game/mission.ts` (U-boat spawns), `src/game/vessel.ts` (`subPreStep`, depth getters),
`src/game/ai/uboat.ts`, `src/game/arenaConfig.ts`, `src/meta/contracts.ts` (`ARENA_SPEC`), `src/game/tutorial.ts`.

## Acceptance
- Player and AI U-boats (also wolfpack reinforcements) start at periscope depth with the scope up, except where
  a surfaced start makes sense; the U-boat lesson still starts surfaced (it teaches diving).
- typecheck, `npm test`, build; screenshots (WebGPU) with 0 page errors; fast-forwards of both sides.

## Notes (fill in when done)
**Done.**

A. The rule (`Mission` constructor, U-boat spawns). Every boat starts with its keel at its class's periscope
depth (13 m), periscope up and raised, so the player sees the convoy through the periscope from the first
second. On the surface only where a captain would be:
- leaving port: no mission starts in port yet; one that does sets `arena.uboatStart = surfaced`;
- the U-boat lesson (`TUTORIAL_ARENA.uboat` pins `surfaced`: diving is one of its steps);
- a dark night (darkness > 0.6) before the escorts carry radar (year < 1941), when the wolfpacks closed and
  attacked surfaced; the player hears why ("A dark night and the escorts have no radar: we close on the surface").
New arena setting `arena.uboatStart` (Arena → Mission → U-boats start): auto (the rule above, default) /
always submerged / surfaced; mirrored in `ARENA_SPEC` (the meta test keeps them in sync). Old saved contracts
without the key fall back to the arena store's value.
The player's boat starts on slow ahead submerged (quiet; about an hour of battery) and half ahead surfaced, as before.
The AI still decides its own depth every update (it surfaces to run in on dark nights or far from escorts),
so for AI boats the rule sets the opening moments only. Before: the player always started surfaced, AI boats
surfaced at night and at a 13 m hull depth by day, which put their keels at 17.7 m, below periscope range.
Spawns now convert: `submerged` is the hull origin depth, depth orders are keel depths (`keel - draft`).

B. Seeing the boat: by day a submerged hull is only a shadow, so the own-boat outline (`display.nightOutline`
auto, M15) now also draws, dashed, whenever the boat is submerged. A mission launched without a user gesture
(URL parameters) no longer asks for fullscreen (the browser refused and logged a warning; the first tap enters).

C. Verification (`?freeze=1` fast-forwards):
- U-boat side, 13:00 1942: all four boats at keel 13.0 m, scope up, at periscope depth; the player holds 12.4 m
  after 300 s on slow ahead with 91 % battery; periscope sightings of the whole convoy at 0 s.
- 02:00 1942 (radar): all start submerged; two AI boats chose to surface within 40 s (their transit logic).
- 02:00 1940 (no radar): all start surfaced; the crew line arrives at 1 s.
- U-boat lesson: surfaced, slow ahead, dive step unchanged; escort lesson: its boat holds at periscope depth.
- An idle U-boat player now survives 15 min on seeds 1941/7/42/1234 (undamaged, still at periscope depth);
  before, such a captain was sunk within 5–11 min.
- Escort side, idle player, 15 min, default night arena: merchants lost 3/1/0/2 on the same seeds (M14: 2/4/3/5,
  when night spawns started surfaced). Seed 42: the idle escort was torpedoed at 123 s by a boat that fired at 75 s,
  right after `ai.openingGrace`: boats already at periscope depth are ready the moment the grace ends.
- WebGPU desktop and phone screenshots (day start: depth 13 m, PERISCOPE UP, dashed outline), WebGL2 1940 night
  shot (surfaced, outline): 0 page errors. typecheck, `npm test` (17 pass), build.

D. Follow-ups: port departures need a harbor scene before `surfaced` has a mission to serve; the AI wolfpack's
pace against an idle escort shifted (above): tune with playtests.
