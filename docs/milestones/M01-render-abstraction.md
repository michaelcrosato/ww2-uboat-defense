# M1 — Render abstraction refactor (no visual change)

**Status:** see docs/PLAN.md · **Depends on:** M0 · **Size:** medium (mostly mechanical moves)

## Goal
Make the game talk to a backend-agnostic `RenderScene` and put the existing WebGL2 renderer behind
a `RenderBackend` interface, so M2+ can add a WebGPU backend without touching game code.
The rendered image must not change.

## Read first
`CLAUDE.md`, `docs/PLAN.md` (target architecture), `src/gfx/renderer.ts`, `src/gfx/spriteStack.ts`,
`src/gfx/particles.ts`, `src/gfx/lights.ts`, `src/water/waveSim.ts` (`rasterForces`), `src/app.ts`,
`src/game/world.ts`. Then `grep -rn "renderer\.\|\.lights\.add\|w\.hulls\|w\.splats" src/game`.

## Steps
1. **Determinism + test hooks (do this first, before moving code).**
   - Add `reseed(seed)` to `Rng` (`src/core/math.ts`) and reseed `fx` from the URL `?fxseed=` (default random).
   - In `src/main.ts`: URL params starting with `dev.` set dev settings transiently
     (`dev.set(key, value, false)` — add a `persist=false` path so tests never write localStorage),
     e.g. `?dev.water.sim=false&dev.light.bloom=0`.
   - `?freeze=1`: App renders but never steps the world, sims or particles (time stays 0).
   - Capture baselines: `/?freeze=1&fxseed=1&seed=7&hour=13` and the same with `hour=23`
     → `check-output/m1-before-day.png`, `check-output/m1-before-night.png`.
2. **Create `src/render/` and move files** (use `git mv` to keep history):
   - `src/gfx/camera.ts` → `src/render/camera.ts`; `src/gfx/screen.ts` → `src/render/screen.ts`
     (add `replaceCanvas(): HTMLCanvasElement` that swaps in a fresh `<canvas id="game">`; needed by M2).
   - `src/gfx/gl.ts`, `renderer.ts`, `passes/*`, `shaders/common.ts`, `spriteStack.ts` →
     `src/render/webgl2/` (rename shaders dir to `glsl/`). `src/water/waveSim.ts`, `fluidSim.ts` →
     `src/render/webgl2/water/`. Keep `src/water/ocean.ts`, `simWindow.ts`, `simInputs.ts` where they are.
   - Move the `OCEAN_GLSL` string from `src/water/ocean.ts` to `src/render/webgl2/glsl/ocean.ts`
     (ocean.ts becomes CPU-only).
   - Delete the unused `SimInputs` class and `SIM_INPUTS_GLSL` from `src/water/simInputs.ts`
     (confirm with grep); keep the `HullInput` / `SplatInput` types.
3. **Split CPU data from GL objects:**
   - `src/render/materials.ts`: `MAT` ids and `PK` particle kinds (GLSL `MAT_GLSL` stays in webgl2).
   - `src/render/lights.ts`: `Light` type + CPU `LightList` (`list`, `clear`, `add`) +
     `packLights(list, ox, oy, view, max, reachMul) → { data: Float32Array(MAX_LIGHTS*16), count }`
     (move the culling/sorting/packing logic out of `LightList.upload`). `MAX_LIGHTS = 64` lives here.
   - `src/render/particles.ts`: `ParticleSystem` = everything CPU from `Particles` (arrays, `spawn`,
     `update`, `impacts`, `wind`, `DEFAULTS`). `src/render/pack.ts`: `packParticles(ps, ox, oy, time, out)`
     (the body of `Particles.upload`, 12 floats/particle). GL VAO/VBO/programs → `webgl2/particlesGL.ts`.
   - `src/render/scene.ts`: `StackInstance` type + `RenderScene` class:
     `atlas: SliceAtlas`, `stacks: StackInstance[]`, `particles: ParticleSystem`, `lights: LightList`,
     `hulls: HullInput[]`, `splats: SplatInput[]`, `beginFrame()` (clears stacks, lights, hulls).
   - `pack.ts`: `packStacks(stacks, ox, oy, out)` (20 floats per slice instance, from
     `SpriteStackRenderer.build`) and `packForces(hulls, splats, winOx, winOy, dtScale, out)` (from
     `WaveSim.rasterForces`). Use a growable Float32Array helper (`ensure(out, n)`).
4. **Interface:** `src/render/types.ts` with `RenderBackend`, `BackendInfo`, `FrameParams`
   (exactly as in docs/PLAN.md; FrameParams = the old `FrameInputs` minus hulls/splats, which now come
   from the scene). The WebGL2 renderer class becomes `WebGL2Backend implements RenderBackend`;
   `render(scene, f)` is the old `frame()` body reading `scene.*`; `resetSims()` replaces
   `simNeedsReset = true`.
5. **Factory:** `src/render/backend.ts` → `async createBackend(screen, pref)`. In M1 it always returns
   `WebGL2Backend` (log `info` if `webgpu` was requested). Add dev setting `display.renderer`
   (`auto` | `webgpu` | `webgl2`, default `auto`, group Display, help: "WebGPU with WebGL2 fallback;
   change needs reload") and URL `?renderer=`.
6. **Game code uses the scene:** `World` gets `scene: RenderScene` instead of `renderer`
   (`w.scene.stacks.push`, `w.scene.particles.spawn`, `w.scene.atlas.add`, `w.scene.lights.add`,
   `w.scene.hulls`, `w.scene.splats`). `Mission`, `Projectiles`, `Aircraft`, `Vessel`, effects: same.
   `App` owns `scene` + `backend`; HUD perf line reads `backend.stats`. `src/game` must not import
   anything from `src/render/webgl2`.
7. Delete the empty `src/gfx/` directory. Update the file map + render pipeline paths in `CLAUDE.md`.

## Acceptance
- `npm run typecheck` passes; `grep -rn "render/webgl2" src/game src/ui src/meta` returns nothing.
- `check-output/m1-after-{day,night}.png` (same URLs as step 1) are visually identical to the
  "before" images (look at both pairs; they should be pixel-identical or differ only in the FPS text).
- Normal mode: `/?hour=23` screenshot shows ships, wake foam, lights; 0 page errors.
- `__app.fastForward(200)` still runs (convoy advances, no exceptions).

## Pitfalls
- Import cycles: `src/render/*` may `import type` from `src/game` (Environment, Theater) but never values.
- `ParticleSystem` is also used by gameplay (spawn); keep its API identical to avoid touching callers twice.
- `Projectiles` builds its small models in the constructor via the atlas — it now needs `scene.atlas`.

## Out of scope
Any WebGPU code, visual changes, shader edits.

## Commit
`Refactor renderer behind RenderBackend; backend-agnostic RenderScene` (+ bullets).

## Notes (fill in when done)
Done. Frozen test shots are **pixel-identical** before/after (`check-output/m1-{before,after}-{day,night}.png`,
0 px differ), normal night play shows ships, wake foam, searchlight beam and star shell, and
`__app.fastForward(200)` advances the convoy (~550 m) without errors.

What changed
- `src/render/`: `types.ts` (`RenderBackend`, `BackendInfo`, `BackendStats`, `FrameParams`), `scene.ts`
  (`RenderScene` + `StackInstance`), `backend.ts` (`createBackend`, `parseBackendPref`; always WebGL2 for now),
  `materials.ts` (`MAT`, `PK`), `lights.ts` (`Light`, CPU `LightList`, `packLights`, `MAX_LIGHTS`,
  `LIGHT_FLOATS`), `particles.ts` (CPU `ParticleSystem`), `pack.ts` (`packStacks` 20 floats/slice,
  `packParticles` 12 floats, `packForces` 20 floats, `ensure`, type `F32`), `camera.ts`, `screen.ts`
  (+ `replaceCanvas()`).
- `src/render/webgl2/`: `WebGL2Backend` (old `Renderer.frame` → `render(scene, f)`; `resetSims()`; owns the
  light texture and staging buffers), `particlesGL.ts`, `spriteStack.ts` (takes packed data via
  `InstanceBatch.set`, atlas passed to `uploadAtlas`), `glsl/common.ts`, `glsl/ocean.ts` (`OCEAN_GLSL`, moved out
  of `water/ocean.ts`), `water/{waveSim,fluidSim}.ts` (`rasterForces(data, count)`).
- Deleted the unused `SimInputs` class and `SIM_INPUTS_GLSL`; `src/gfx/` is gone.
- Game: `World(scene)`; `w.scene.{stacks.push, lights, particles.spawn, atlas.add, hulls, splats}`; `world.lights.add`
  wrapper kept. `App(screen, backend)` owns `scene`; `main.ts` builds `Screen`, awaits `createBackend`.
  HUD perf line reads `backend.stats`; FPS text shows the backend kind (`20 fps webgl2`).
- Dev setting `display.renderer` (auto | webgpu | webgl2) + URL `?renderer=`.

Decisions
- Test hooks in `main.ts`: `?fxseed=`, `?dev.<key>=` (transient: `dev.set(k, v, false)`), `?freeze=1`. Under
  freeze the camera is updated with a huge dt so it settles at once — otherwise its smoothing depended on
  how many frames ran before the shot (that made the first baselines differ by ~2 px).
- `Mission` now calls `env.update(0)` after `env.apply`, so sun/sky are valid before the first step (a frozen
  frame was otherwise lit with the default environment). In normal play this only affects the first frame.
- `Input` listens on `screen.root` (#stage) instead of the canvas so `replaceCanvas()` won't orphan its
  pointer listeners (#hud has `pointer-events: none`, so events still arrive the same way).
- `RenderScene.beginFrame()` clears stacks, lights and hulls; splats persist until a frame with `simDt > 0`
  consumes them (same as before). One `RenderScene` per App; the atlas keeps growing across missions (as before).
- If a backend sees a different atlas object than last frame it re-uploads it (for the M2 fallback swap).

Follow-ups
- M2: `createBackend` fallback chain; use `screen.replaceCanvas()` before the WebGL2 attempt.
- `?dev.*` values are transient, but any later persisted `dev.set` saves the whole diff (incl. them); fine for tests.
