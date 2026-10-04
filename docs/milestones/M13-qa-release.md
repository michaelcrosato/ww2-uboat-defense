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
