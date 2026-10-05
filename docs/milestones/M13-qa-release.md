# M13 — Final QA, README, PR ready for review

**Status:** see docs/PLAN.md · **Depends on:** all · **Size:** small–medium

## Goal
Ship-quality prototype: no console errors, graceful fallbacks, documented controls and dev settings,
a README with screenshots, and the PR description ready for review.

## Steps
1. Full regression: both sides × 3 theaters × day/night, headless screenshots + `fastForward` runs to
   mission end; renderer `auto`/`webgpu`/`webgl2`/`gpufail=1`; viewport sizes 1920×1080, 1280×720,
   800×600, and a portrait mobile size with touch on; fullscreen toggle path exercised.
2. Error handling: WebGL2 missing → readable boot message; WebGPU device loss → WebGL2 switch;
   localStorage unavailable → settings/profile still work in memory.
3. `README.md`: what it is, how to run, controls (KBM, PS5 pad, touch), sides and mechanics overview,
   the dev settings categories, renderer notes (WebGPU primary, WebGL2 fallback), credits (my-3d2dge
   pixel font and techniques by the same author, Rapier), screenshots from `check-output/gallery`
   copied into `docs/img/` (keep them small).
4. `npm run build` succeeds; preview the production build headlessly once.
5. Update the draft PR description (summary, how to test, known limitations) and mark it ready only
   if the user asked for that; otherwise leave it as draft.

## Acceptance
All checks green, README renders, PR description updated.

## Commit
`Final QA pass, README and release notes`

## Notes (fill in when done)
**Done.** WebGPU is the reference for every check (WebGL2 best effort, per the user during M12).

A. Reproducible simulation. AI (escort and U-boat), sensors, convoy legs, abilities, aircraft, weapons
(gun scatter, duds, spawn positions, power procs, blast torque) and vessel damage rolls draw from the
mission's seeded `w.rng` (`arena.seed`) instead of the cosmetic `fx` stream; particles, lightning and audio
cues stay on `fx`. A `fastForward` from a `?freeze=1` start now replays exactly: same seed, different
`fxseed` → identical state hash and message log (before: 20,600 vs 16,600 GRT lost in the same 15 min).
This closes the "missions are not reproducible" known issue.

B. Error handling.
- No renderer at all (`?gpufail=1&glfail=1`): the boot screen says what is missing and what to try; boot
  errors are set as text, not HTML (they can echo URL parameters).
- WebGPU init failure (`?gpufail=1`) → WebGL2. Device loss mid-game (`?gpulose=3`, simulated: Chrome only
  exposes `destroy()`, which the loss handler deliberately ignores) → live switch to WebGL2 with an alert
  message; if WebGL2 also fails the loop stops behind the same boot message instead of throwing per frame.
- `localStorage` blocked (`tools/shot.mjs --init` makes it throw): port, settings, bindings and a mission
  all work in memory, 0 console errors.

C. Gameplay fix found by the regression runs: AI U-boats spawn 1.8–3.2 km ahead of the convoy, inside
torpedo range, and fired within ~20 s; an idle escort player was sunk at 117 s. New `ai.openingGrace`
(default 75 s): boats close in but hold fire; the same replay's first spread came at 199 s.

D. Build: `npm run build` passes (one 4.9 MB chunk, 1.86 MB gzipped, mostly Rapier's inlined WASM; Vite's
size warning is benign). `tools/shot.mjs --preview` serves `dist/`: the production build boots to the
title and runs a mission with 0 console errors.

E. README with controls (keyboard/mouse, PS5 pad, touch), sides, career, settings, renderer notes and
credits; seven 256-colour screenshots in `docs/img/` (~0.7 MB). Title subtitle keeps "1939–1945" together.

F. Phones: on a 390×844 portrait screen the HUD buffer was 195 px wide with panels over the touch buttons.
With the touch overlay active and the viewport taller than wide, a full-screen "turn your device sideways"
notice now holds the mission (`App.held`); landscape (844×390) fits the HUD and touch controls cleanly.
The port and menus reflow fine in portrait.

G. Regression (all WebGPU with `gpupresent=readback` unless noted, 0 console errors throughout; headless
`auto` and `?gpufail=1` log the expected canvas-present / forced-failure warnings and run on WebGL2):
- Renderer: `auto` → WebGL2 (headless), `webgpu`, `webgl2`, `gpufail=1` → WebGL2, `gpulose=3` → live
  switch, `gpufail=1&glfail=1` → boot message.
- Viewports 1920×1080, 1280×720, 800×600 (title, arena setup, mission, port), phone 390×844 and 844×390
  with touch, F11 fullscreen (enters fullscreen at 1280×720), storage blocked, production build (`--preview`).
- Missions run to the end from `?freeze=1` (seed 11, player idle, `check-output/m13/matrix/`):

| Side | Theater | 13:00 | 23:00 |
|---|---|---|---|
| Escort | North Atlantic | victory, 7/10 delivered, player alive | victory, 5/10, alive |
| Escort | Arctic | victory, 6/10, alive | defeat, 4/10, alive |
| Escort | Caribbean | victory, 7/10, alive | victory, 8/10, 1 U-boat sunk, alive |
| U-boat | North Atlantic | sunk at 5.5 min (pack sank 1) | sunk at 10.7 min (pack sank 1) |
| U-boat | Arctic | sunk at 5.3 min | sunk at 8.4 min (pack sank 3) |
| U-boat | Caribbean | sunk at 5.2 min | sunk at 6.2 min (pack sank 1) |

  An idle U-boat captain starts surfaced at full ahead toward the convoy and is found by aircraft and
  escorts within minutes; that is the intended pressure (dive, then attack), not a regression. Escort
  convoys lose 2–6 merchants with an idle player.

H. Follow-ups: playtest pacing (`ai.openingGrace`, U-boat side difficulty for new players); hardware test of
gamepad and touch; a bundled headline font needs the user's OK; the README screenshots are from M12/M13
headless runs (SwiftShader), so real GPUs look the same but run far faster.
