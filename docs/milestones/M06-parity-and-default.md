# M6 — Backend parity, regression test, WebGPU as default

**Status:** see docs/PLAN.md · **Depends on:** M5 · **Size:** medium

## Goal
Prove the two backends render the same image, make WebGPU the default (`auto`), add GPU timing to
the perf overlay, and leave the docs describing the final architecture.

## Read first
`docs/PLAN.md` (target architecture), `src/render/backend.ts`, `src/app.ts`, `tools/shot.mjs`.

## Steps
1. Deterministic look-dev scene `?scene=lookdev`: no AI, no mission timer; spawns a fixed set
   (destroyer with searchlight on, burning freighter, tanker, Type VII at periscope depth, surfaced
   Type VII, a star shell flare, a lifeboat, two loot crates of different rarity, a Catalina) at fixed
   positions; `fx` reseeded; the world stepped a fixed number of fixed-dt steps (e.g. 240 × 1/60 s,
   identical for both backends) so particles and sims have content; then frozen. Camera fixed.
   Parameters: `hour`, `theater`, `seaState` still apply.
2. `tools/compare.mjs`: renders the lookdev scene with both backends (reuse the shot.mjs launch code;
   two pages), screenshots, loads both PNGs into a page canvas, computes mean absolute difference per
   channel and the share of pixels differing by > 24/255, writes `check-output/compare-diff.png`
   (amplified difference) and prints a JSON summary. Exit 1 if mean diff > 3/255 or share > 4 %.
3. Run it for `hour=13`, `hour=23`, `hour=7` and fix discrepancies until it passes (dither phase,
   flips, uniform mismatches are the usual causes). Document the final numbers in Notes.
4. Perf overlay (`debug.perf`): CPU frame ms, sim/step counts, and on WebGPU per-pass GPU ms via
   `timestamp-query` when available (resolve into a buffer, read back every ~30 frames).
5. Ensure `display.renderer=auto` → WebGPU when available, WebGL2 otherwise; the dev menu entry shows
   the active backend; changing it prompts a reload (M9 builds the menu, but the setting must work via
   localStorage/URL now).
6. Update `CLAUDE.md` (render pipeline section → both backends, file map paths) and the decisions log.

## Acceptance
- `node tools/compare.mjs --hour 13` (and 23, 7) passes thresholds; diff image looked at.
- Default URL `/` uses WebGPU headless; `/?renderer=webgl2` still perfect.
- `?dev.debug.perf=true` shows GPU timings on WebGPU.

## Commit
`Backend parity test, WebGPU default renderer, GPU timing overlay`

## Notes (fill in when done)
