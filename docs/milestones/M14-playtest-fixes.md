# M14 — Playtest fixes: U-boat stability, bearing display, tutorial

**Status:** see docs/PLAN.md · **Depends on:** M13 · **Size:** medium

## Goal
First playtest on the live build (user, U-boat side): "The U-boat is rolling in circles when the game
starts, it's very difficult to see anything, all of these lines. We need a tutorial. And we need to figure
out what to do with all these lines." Fix the boat, make the passive-sonar picture readable, and teach a
new captain both sides.

## Read first
`src/physics/hydro.ts`, `src/game/sensors.ts`, `src/ui/hud.ts` (`worldOverlays`), `src/game/player.ts`,
`src/app.ts`, `src/ui/shell.ts`.

## Acceptance
- A surfaced and a dived U-boat float upright and hold their heading with the rudder amidships (all three
  types, calm and rough seas); diving, depth keeping and surfacing still work.
- The default HUD shows a readable bearing picture (no screen-filling fans of lines).
- Title → Tutorial → either side runs a guided mission whose steps complete from real game state; the
  lesson can be skipped step by step or ended; finishing it is remembered.
- typecheck, `npm test`, WebGPU screenshots with 0 page errors, one WebGL2 smoke shot, fast-forward runs.

## Notes (fill in when done)
**Done.**

A. The spinning U-boat was a capsized one. Every U-boat (player and AI, surfaced or dived) rolled over
within ~2 s of spawning and kept barrel-rolling at ±85°, which dragged the heading round ~5°/s and cut the
speed to ~3 kn ("green water over the bow" the whole time). Cause: in `HullHydro.apply` the `right` axis lived
in the scratch vector `tmp2`, which the propeller and trim offsets overwrite before the submarine block reads
`right` again, so the self-righting pitch torque and the dive-plane pitch torque were applied about a vector
pointing aft along the hull, i.e. as a roll torque. Surface ships never run that block, which is why only
U-boats rolled (static righting arm of the Type VII is GM ≈ 2.4 m; it was never the hull form). Fix: `right`
gets its own scratch vector.
With the pitch torques finally acting on pitch, a second latent bug showed: dived, the buoyancy of the
columns acts 2.7 m (4 % of the length) aft of a mass centred amidships (the bow is finer than the stern), and
the boats nosed down 35–57° under water. Subs now carry their centre of mass under the submerged centre of
buoyancy (`HullHydro.comX`, computed from the columns), as a trimmed boat does. Results (Type VII, default sea):
surfaced ±2° pitch and roll, 9 kn at half ahead / 13.5 kn at full (was 3.6 kn); dive to 13 m in ~60 s at
−2…−9° pitch, to 60 m at ≤ 9° bow-down, surfacing ~10 s. Type IX (default sea) and Type XXI (sea state 7)
behave alike (the XXI dives up to 24° bow-down at its higher submerged speed). Surface ships are unchanged (0–3° roll).

B. Balance after the fix (idle player, `?freeze=1` fast-forwards). AI U-boats now sail and dive properly, so
the wolfpack is more dangerous: escort side, 15 min, seeds 1941/7/42/1234 lose 2/4/3/5 merchants (before the fix
3/1/2/3); full crossings end in victory on 3 of 4 seeds (seed 1234: defeat, 7 lost). U-boat side with an idle
player: sunk at 281 s (before 254 s), the pack sinking 3 merchants meanwhile (before 0). Left as is; see
Known issues.

C. Bearing lines. Each contact kept six bearing lines from the last ~1.7 s (a new one every 0.2 s), every
listener of the side contributed (the whole wolfpack), and the HUD drew all of them 3.2 km long: hundreds of
jittery dashed lines, rasterized pixel by pixel far off-screen. Now (`display.bearings`, Settings → Display):
- `ring` (default): only the player's own hydrophones show, as one tick per heard contact on a faint ring
  around the boat (a world circle, so ticks point along true bearings; brighter and longer for the aimed
  contact), plus one ray, out to the far side of the estimate, for the contact under the reticle or locked.
- `lines`: one ray per contact from your boat (latest bearing only). `all`: the old picture (every listener),
  now clipped to the screen. `off`.
- HF/DF bearings stay drawn from every listener (rare, and their cross is the point).
Sensors record the listener on each `BearingLine` (`by`) and keep the latest bearing per listener in
`Contact.heard`; contact estimation and cross-fixing are unchanged. `pxLineClip` clips world rays to the
buffer. The "green water" warning no longer fires for U-boats (their casing is always awash; the sound and
spray stay), and the compass course marker `▾` is in the pixel font now (it drew a `?`).

D. Tutorial (`src/game/tutorial.ts`, picker `src/ui/screens/tutorial.ts`). Title → Tutorial (first and
focused until a lesson was flown or dismissed; `localStorage` `wolfpack.tutorial.v1`) → U-boat or Escort.
The mission is an ordinary arena battle with every arena key pinned (`TUTORIAL_ARENA`: 10:00, clear,
sea state 2.5, 6 merchants in 2 columns at 7 kn, no aircraft; U-boat lesson: 1 AI escort, no wolfpack;
escort lesson: no AI escorts, 1 U-boat), the player takes 40 % damage (`tutorialStats`) and earns no XP.
A coach panel under the compass shows the step, the instruction with the current device's keys picked out
(keyboard/mouse, PS/Xbox glyphs, touch button labels; mouse-only or unbound steps are left out) and the skip
hint. Steps complete from world state (telegraph rung up, 25° turned or 5 s of hard rudder, dived below
10 m, periscope up, target locked or aimed at, range under 1600 m, torpedo fired, hit, below the layer;
escort: periscope sighting planted and refreshed, closed to 1100 m, under 12 kn, first own echo, first charge,
U-boat damaged, sunk or 3 min), then tick off with a ✓ after a minimum reading time; info steps advance on
their own. Enter (`tutorialNext`, rebindable) or the pause menu (Skip tutorial step / End tutorial) skips.
The escort lesson's U-boat starts 1.3 km off the bow and loiters at periscope depth holding its fire
(`World.holdFire`) until the attack-run step; `Mission.holdVictory` keeps the battle going after it is sunk
until the closing words are read. `?tutorial=uboat|escort` and `?menu=tutorial` are test hooks.
Scripted fast-forward walkthroughs: U-boat 13 steps in ~6 min of game time (torpedo hit, merchant sunk, boat
undamaged, completion stored); escort 11 steps in ~4 min (U-boat sunk after the attack-run step, no merchant
lost). Live runs confirmed keys and Enter drive the panel in the real frame loop.

E. Verification: typecheck, `npm test` (17 pass), WebGPU (`gpupresent=readback`) screenshots of the U-boat
start before/after, ring / lines / locked-target modes, tutorial panel on both sides with keyboard, PS pad and
touch prompts, title, picker and pause menus (0 page errors); WebGL2 tutorial smoke shot (0 errors).

F. Follow-ups: tune AI U-boat lethality vs. the escort side after playtests (B); `arena.difficulty` is declared
and set by contracts but nothing reads it; the HUD FPS readout sums capped frame times, so below 10 fps it
still says 10; the full-moon glitter makes default night scenes busy (art call for the user); the tutorial was
not played on real gamepads or touch screens.
