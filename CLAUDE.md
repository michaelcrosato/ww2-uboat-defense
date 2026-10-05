# Wolfpack & Escort — agent guide

WWII top-down pixel-art naval combat prototype (browser). Two playable sides in one customizable
arena: **The Escort** (Allied escorts defending a convoy) and **The U-Boat** (Kriegsmarine boat
attacking it). Rapier 3D physics, GPU water simulation, deferred lighting with occluder shadows,
Diablo IV / PoE2-style progression (skill tree, loot, abilities, contracts).

## Resume protocol (read this first, every session)

This project is built milestone by milestone, with a context clear between milestones.

1. Open `docs/PLAN.md`. Find the first milestone whose status is `TODO` (or `IN PROGRESS`).
2. Read ONLY that milestone's file in `docs/milestones/` plus the files it lists under "Read first".
   Don't read the whole codebase; use the file map below and `grep`.
3. Set it to `IN PROGRESS` in `docs/PLAN.md`, implement it, run its acceptance checks, and look at
   the screenshots you produce.
4. Set it to `DONE` in `docs/PLAN.md`, write the milestone's "Notes" (what changed, decisions,
   follow-ups), update "Known issues" in PLAN.md, commit, push, and stop. One milestone per session.
5. `main` is the production branch: Vercel deploys it to https://ww2-uboat-defense.vercel.app, and it is
   the repository's default branch. Work on the session's feature branch (start it from the latest
   `main`), then open a PR into `main`; finished work must reach `main` or nobody can play it. PR #1
   (M1–M13 on `claude/cool-bell-er7u0y`) was merged into `main`.

## Commands

```bash
npm install                 # once (deps are pinned exactly; do not bump versions)
npm run dev                 # Vite dev server on :5173
npm run typecheck           # tsc --noEmit (TypeScript 7, strict) — must pass before every commit (*.test.ts excluded)
npm test                    # node --test src/meta/meta.test.ts (meta layer unit tests)
npm run build               # typecheck + production build to dist/
npm run probe:gpu           # confirms headless Chromium exposes WebGPU (it does, via SwiftShader)
node tools/compare.mjs --hour 13      # WebGPU vs WebGL2 parity on the look-dev scene (optional now, see WebGPU-first; ~2 min)
node tools/shot.mjs --url "/?hour=13" --wait 6000 --out check-output/x.png \
   [--eval "<js returning JSON>"] [--steps "key:KeyW:800,wait:500,click:640:360"] [--w 1280 --h 720]
```

`tools/shot.mjs` starts Vite in-process, opens the preinstalled Chromium (`/opt/pw-browsers/chromium`,
Playwright 1.56.1, flags enable WebGPU + SwiftShader WebGL2), prints console errors, saves a PNG.
Exit code 1 on page errors. Headless SwiftShader is slow (~2–10 fps): to test long gameplay spans use
the fast-forward hook in `--eval`: `__app.fastForward(300)` runs 300 s of simulation without
rendering and returns the message log. `window.__app` is the App instance (mission, world, player).
Started from `?freeze=1` (the frame loop never steps the world) a fast-forward is **reproducible**: all
gameplay randomness draws from the seeded `w.rng` (`arena.seed`), cosmetic effects from `fx`. Keep it that
way: never use `fx` or `Math.random` for anything that changes the simulation.
More shot options: `--steps "...,eval:<uri-encoded js>,until:<uri-encoded js>[:ms]"` (wait for a page
condition, e.g. `until:window.__lookdevDone`), `--init "<js>"` (runs before the page's own code, e.g. to
block `localStorage`), `--preview` (serves the production build in `dist/`; run `npm run build` first).
Editing files under `src/` while shots run hot-reloads the open pages and spoils those runs.

URL parameters override any arena setting for testing: `/?side=uboat&hour=2&weather=fog&seaState=6`
(keys from `src/game/arenaConfig.ts` without the `arena.` prefix).
Without arena params the game opens the title screen (attract mode behind it). `?menu=title|arena|dev|settings|
controls|credits|pause|end` (+ `&tab=Lighting`) opens a screen directly; `window.__shell` is the UI shell (`__shell.career` = profile).
`?menu=port&faction=escort|uboat` opens the port for a side. Test hooks: `?dev.<key>=<v>` sets a
dev setting without persisting it (e.g. `?dev.water.sim=false&dev.display.showFps=false`),
`?fxseed=1` seeds the cosmetic RNG, `?freeze=1` renders without ever stepping world/sims/particles
(camera settles at once), `?renderer=webgpu|webgl2|auto` picks the backend (`auto` = WebGPU, WebGL2 fallback).
**Headless WebGPU needs `&gpupresent=readback`**: presenting to a canvas loses the device in headless
SwiftShader, so without it WebGPU init fails its present probe and falls back to WebGL2. `?gpufail=1`
forces the WebGPU init to fail (fallback test); `?glfail=1` makes WebGL2 fail too (with `?gpufail=1`: the
no-renderer boot message); `?gpulose=<s>` reports a WebGPU device loss after s seconds (live switch to
WebGL2). `?scene=lookdev` builds the deterministic comparison scene
(fixed spawns, 40 fixed-dt frames, then frozen, HUD hidden, `window.__lookdevDone`; wait for it with the
`until:window.__lookdevDone` step). `?scene=fleet` lines up every vessel class for art review. `?dev.debug.perf=true`
shows CPU ms, sim steps and per-pass GPU ms (timestamp queries) above the FPS. Reproducible shot:
`/?freeze=1&fxseed=1&seed=7&hour=13&dev.display.showFps=false` (pixel-identical across runs).

## Architecture (file map)

| Area | Files | Notes |
|---|---|---|
| Boot / loop | `src/main.ts`, `src/app.ts` | App owns screen, renderer, input, HUD, mission; fixed-step sim (`phys.hz`), tempo × time compression |
| Config | `src/core/config.ts`, `src/core/devSettings.ts`, `src/game/arenaConfig.ts` | Schema-driven stores (`dev.num/bool/str`, `dev.on(key, fn)`); every knob persists and will auto-generate UI |
| Math/events | `src/core/math.ts`, `src/core/events.ts` | world space: x east, y south, z up (m); heading: forward=(cos h, sin h), grows clockwise; `Rng` seeded; `fx` cosmetic RNG |
| Render API | `src/render/types.ts` (`RenderBackend`, `FrameParams`), `scene.ts` (`RenderScene`, `StackInstance`), `backend.ts` (`createBackend`), `camera.ts`, `screen.ts`, `lights.ts` (`LightList`, `packLights` + shadow step budget), `particles.ts` (CPU `ParticleSystem`), `pack.ts` (stack/particle/force packers, `STACK_FLOATS` = 24, culling to the occluder window), `materials.ts` (`MAT`, `PK`) | game code fills `RenderScene` only; never imports a backend |
| WebGL2 backend | `src/render/webgl2/renderer.ts` (`WebGL2Backend`), `gl.ts`, `spriteStack.ts`, `particlesGL.ts`, `passes/*`, `glsl/{common,ocean}.ts`, `water/{waveSim,fluidSim}.ts` | see "Render pipeline" below |
| WebGPU backend | `src/render/webgpu/renderer.ts` (`WebGPUBackend`), `device.ts` (init, present probe, `shaderModule`, `validated`), `targets.ts` (`TU`/`BU` usage flags, targets, samplers, `Ubo`), `wgsl/{common,ocean}.ts`, `passes/{water,stacks,particles,lighting,debug,post,testPattern}.ts`, `sims/{kernels,waterSims}.ts` (force raster + compute wave/fluid/dye) | Shared CPU uniforms for both backends: `src/render/common/{frameUniforms,post}.ts` |
| Water | `src/water/ocean.ts` (CPU Gerstner; GLSL twin in `render/webgl2/glsl/ocean.ts`), `simWindow.ts`, `simInputs.ts` (`HullInput`/`SplatInput` types) | CPU `Ocean.height()` drives buoyancy; GPU sims are cosmetic |
| Art | `src/art/voxel.ts` (VoxelModel, SliceAtlas: 2048² skyline-packed, reset per mission), `shipBuilder.ts`, `ships.ts` | procedural voxel ships → horizontal slices → sprite stacking; ~80–89 % atlas fill with every class at once |
| Physics | `src/physics/physics.ts` (Rapier world, groups, queries), `hydro.ts` (buoyancy columns, drag, thrust, rudder, ballast) | `@dimforge/rapier3d-compat` **0.21.0 pinned** |
| Game | `src/game/world.ts` (hub + event bus), `vessel.ts`, `vesselClasses.ts`, `weapons.ts`, `effects.ts`, `sensors.ts`, `convoy.ts`, `ai/escort.ts`, `ai/uboat.ts`, `aircraft.ts`, `mission.ts` (spawns, air cover, reinforcements, theater scenery), `player.ts`, `abilities.ts`, `environment.ts`, `theaters.ts`, `weatherFx.ts` (rain/snow), `lookdev.ts` (`?scene=lookdev` / `?scene=fleet`) | AI and HUD read only the side's contact picture (fog of war); `debug.ai` shows AI state strings |
| Meta | `src/meta/stats.ts` (STAT_KEYS + StatBlock), `types.ts` (Item, Contract, MissionResult, CaptainState…), `abilities.ts` (25 abilities + `resolveAbility`), `items.ts` (bases, affix tiers, powers, uniques, `rollItem`, `rerollAffix`), `loot.ts` (`rollDrops`), `tree.ts` (both 85-node trees), `economy.ts` (vessels, components, XP), `contracts.ts` (mutators, `generateContracts`, `evaluateContract`, `ARENA_SPEC`), `profile.ts` (captain ops, save/load), `index.ts` | pure logic, Node-runnable; tests `npm test` (`src/meta/meta.test.ts`) |
| UI | `src/ui/hud.ts` (pixel HUD on a 2D canvas), `pixelFont.ts` (5×7 font from my-3d2dge), `style.css`, `dom.ts` (`h()`, `Ui` screen stack + spatial focus nav), `widgets.ts` (`renderSetting` from schemas), `shell.ts` (boot flow, hotkeys, attract mode), `screens/*`, `touch.ts` | port hub `screens/port.ts` (+ `armory`, `skillTree`, `portAbilities`, `afterAction`), `itemCard.ts`; career glue `src/game/career.ts` |
| Input | `src/input/input.ts` | actions + rebindable bindings, gamepad (PS5 glyphs), rumble |
| Audio | `src/audio/audio.ts` (`audio` engine: play/loop/music/environment/underwater), `sounds.ts` (48 synths + 11 loops), `music.ts` (procedural stems), `dsp.ts` (noise/IR banks, Patch), `mixer.ts` (buses, limiter), `lab.html`/`lab.ts` (self-test); `src/game/audioBridge.ts` (events → sounds) | lab: `node tools/shot.mjs --url /src/audio/lab.html --wait 2000 --eval "window.__audioTest"` |

### Render pipeline (per frame; identical pass order in `src/render/webgpu/renderer.ts` and `src/render/webgl2/renderer.ts`)
WebGPU is the default (`auto`), WebGL2 the fallback (init failure, canvas-present probe failure or runtime
device loss → `fallbackToWebGL2`). Both read the same CPU-side uniforms (`render/common/*`) and packers
(`render/pack.ts`); parity can be checked with `tools/compare.mjs` (see Commands), but WebGPU is the product
target: see **WebGPU-first** under Coding conventions.
1. Water sims: force raster (hull footprints + splats as instanced quads → 3 force textures) →
   wave equation (h,v) → stable fluids (velocity, pressure, vorticity) → dye advection
   (RGBA16F: foam, bioluminescence, oil, burning oil). WebGPU: compute kernels; WebGL2: fragment passes.
   Sim window follows the camera in whole cells.
2. Occluder heightmap: top-down render of sprite-stack slices (R = max height via MAX blend,
   A = smoke density via ADD blend) — drives soft shadows.
3. Underwater pass: submerged parts → color + depth-below-surface (composited by the water pass).
4. G-buffer: fullscreen water (writes depth) → sprite stacks → particles. RT0 = albedo + material id,
   RT1 = normal.xy, world height z, emissive. Materials: `src/render/materials.ts` (`MAT`) + `MAT_GLSL`.
5. Lighting: ambient + sun + moon + up to 64 point/spot lights (storage buffer / float texture), heightmap-marched
   soft shadows, searchlight beam haze, water glints/sky reflection, light-band quantization.
6. Post: bloom (half res) → grade/vignette/grain/scanlines → integer-scaled present with the camera's
   sub-pixel shift (pixel grid anchored to the world).

Conventions (WGSL equivalents in `docs/WEBGPU_PORTING.md`): internal passes treat `gl_FragCoord.xy` as buffer pixels **y-down** (GL passes write
`clip.y = by/bh*2-1`); shader world positions are relative to the render origin (snapped camera
center) for precision; the CPU folds the origin into wave phases (`Ocean.pack`). The camera is an
oblique orthographic projection (`src/render/camera.ts`): `by = (y*cosT - z*sinT)*zoom`.

### Gameplay data flow
`App.frame` → `PlayerControl.update` (orders) → N × (`World.step`: AI → `Vessel.preStep` (hydro forces)
→ projectiles → `physics.step` → sensors → collisions; `Mission.update`) → `World.submit` (fills
`world.scene`: stacks, lights, particles, hulls/splats) → `RenderBackend.render(scene, params)` → `Hud.draw`.
Events (`world.bus`): `sunk`, `damaged`, `torpedoFired`, `torpedoHit`, `ping`, `echo`, `explosion`,
`message`, `lootPicked`, `dcDrop`, `gunFired`, `splash`, `starShell`, `reinforce`, …

## Coding conventions
- TypeScript strict, ES modules, named exports, 2-space indent, single quotes, semicolons.
- Comments explain intent (why), concise; match the density of surrounding code.
- No new runtime dependencies without the user's approval. Never bump pinned versions.
- Every new tunable goes into `DEV_DEFS` (or `ARENA_DEFS`) — never hard-code a magic toggle; every
  declared setting must actually be wired (see M11 audit).
- `src/meta/*` must stay runnable by Node directly (type stripping): explicit `.ts` import
  extensions, no enums/namespaces/parameter properties; tests with `node --test src/meta/meta.test.ts`.
- **WebGPU-first** (user decision, M12): WebGPU is the target that matters. WebGL2 is a best-effort fallback:
  keep it compiling and running (port shader changes when it is cheap, same chunk names), but don't spend time
  on WebGL2 parity, visuals or performance; glitches or slower frames there are acceptable.
- No real persons' names on items/characters; no Nazi political symbols. Hull numbers/class names are fine.

## Verification checklist (before every commit)
1. `npm run typecheck` passes.
2. A headless screenshot of the relevant scene(s) with 0 page errors, and you looked at it.
3. For renderer work: WebGPU screenshots (`?renderer=webgpu&gpupresent=readback`); one WebGL2 smoke shot with
   0 page errors is enough (no WebGL2 parity work, see WebGPU-first).
4. For gameplay work: `__app.fastForward(…)` run with a sensible message log.
5. Commit message: imperative summary + bullet body, ending with the attribution lines required by
   the session (Co-Authored-By / Claude-Session) if your harness provides them.
