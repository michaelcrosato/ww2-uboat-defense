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
5. Branch: `claude/cool-bell-er7u0y` (push with `git push -u origin claude/cool-bell-er7u0y`).
   The repo started empty, so this branch is currently the remote's only (default) branch and no PR
   exists yet. Don't create other branches unless the user asks; if a `main` base branch appears
   later, open a draft PR from this branch and keep pushing to it.

## Commands

```bash
npm install                 # once (deps are pinned exactly; do not bump versions)
npm run dev                 # Vite dev server on :5173
npm run typecheck           # tsc --noEmit (TypeScript 7, strict) — must pass before every commit
npm run build               # typecheck + production build to dist/
npm run probe:gpu           # confirms headless Chromium exposes WebGPU (it does, via SwiftShader)
node tools/shot.mjs --url "/?hour=13" --wait 6000 --out check-output/x.png \
   [--eval "<js returning JSON>"] [--steps "key:KeyW:800,wait:500,click:640:360"] [--w 1280 --h 720]
```

`tools/shot.mjs` starts Vite in-process, opens the preinstalled Chromium (`/opt/pw-browsers/chromium`,
Playwright 1.56.1, flags enable WebGPU + SwiftShader WebGL2), prints console errors, saves a PNG.
Exit code 1 on page errors. Headless SwiftShader is slow (~10 fps): to test long gameplay spans use
the fast-forward hook in `--eval`: `__app.fastForward(300)` runs 300 s of simulation without
rendering and returns the message log. `window.__app` is the App instance (mission, world, player).

URL parameters override any arena setting for testing: `/?side=uboat&hour=2&weather=fog&seaState=6`
(keys from `src/game/arenaConfig.ts` without the `arena.` prefix). Test hooks: `?dev.<key>=<v>` sets a
dev setting without persisting it (e.g. `?dev.water.sim=false&dev.display.showFps=false`),
`?fxseed=1` seeds the cosmetic RNG, `?freeze=1` renders without ever stepping world/sims/particles
(camera settles at once), `?renderer=webgpu|webgl2|auto` picks the backend (`auto` = WebGL2 until M6).
**Headless WebGPU needs `&gpupresent=readback`**: presenting to a canvas loses the device in headless
SwiftShader, so without it WebGPU init fails its present probe and falls back to WebGL2. `?gpufail=1`
forces the WebGPU init to fail (fallback test). Reproducible shot:
`/?freeze=1&fxseed=1&seed=7&hour=13&dev.display.showFps=false` (pixel-identical across runs).

## Architecture (file map)

| Area | Files | Notes |
|---|---|---|
| Boot / loop | `src/main.ts`, `src/app.ts` | App owns screen, renderer, input, HUD, mission; fixed-step sim (`phys.hz`), tempo × time compression |
| Config | `src/core/config.ts`, `src/core/devSettings.ts`, `src/game/arenaConfig.ts` | Schema-driven stores (`dev.num/bool/str`, `dev.on(key, fn)`); every knob persists and will auto-generate UI |
| Math/events | `src/core/math.ts`, `src/core/events.ts` | world space: x east, y south, z up (m); heading: forward=(cos h, sin h), grows clockwise; `Rng` seeded; `fx` cosmetic RNG |
| Render API | `src/render/types.ts` (`RenderBackend`, `FrameParams`), `scene.ts` (`RenderScene`, `StackInstance`), `backend.ts` (`createBackend`), `camera.ts`, `screen.ts`, `lights.ts` (`LightList`, `packLights`), `particles.ts` (CPU `ParticleSystem`), `pack.ts` (stack/particle/force packers), `materials.ts` (`MAT`, `PK`) | game code fills `RenderScene` only; never imports a backend |
| WebGL2 backend | `src/render/webgl2/renderer.ts` (`WebGL2Backend`), `gl.ts`, `spriteStack.ts`, `particlesGL.ts`, `passes/*`, `glsl/{common,ocean}.ts`, `water/{waveSim,fluidSim}.ts` | see "Render pipeline" below |
| WebGPU backend | `src/render/webgpu/renderer.ts` (`WebGPUBackend`), `device.ts` (init, present probe, `shaderModule`, `validated`), `targets.ts` (`TU`/`BU` usage flags, targets, samplers, `Ubo`), `wgsl/{common,ocean}.ts`, `passes/{water,lighting,post,testPattern}.ts` | stacks/particles = M4, compute sims = M5. Shared CPU uniforms for both backends: `src/render/common/{frameUniforms,post}.ts` |
| Water | `src/water/ocean.ts` (CPU Gerstner; GLSL twin in `render/webgl2/glsl/ocean.ts`), `simWindow.ts`, `simInputs.ts` (`HullInput`/`SplatInput` types) | CPU `Ocean.height()` drives buoyancy; GPU sims are cosmetic |
| Art | `src/art/voxel.ts` (VoxelModel, SliceAtlas), `shipBuilder.ts`, `ships.ts` | procedural voxel ships → horizontal slices → sprite stacking |
| Physics | `src/physics/physics.ts` (Rapier world, groups, queries), `hydro.ts` (buoyancy columns, drag, thrust, rudder, ballast) | `@dimforge/rapier3d-compat` **0.21.0 pinned** |
| Game | `src/game/world.ts` (hub + event bus), `vessel.ts`, `vesselClasses.ts`, `weapons.ts`, `effects.ts`, `sensors.ts`, `convoy.ts`, `ai/escort.ts`, `ai/uboat.ts`, `aircraft.ts`, `mission.ts`, `player.ts`, `abilities.ts`, `environment.ts`, `theaters.ts` | AI and HUD read only the side's contact picture (fog of war) |
| Meta | `src/meta/stats.ts` (STAT_KEYS + StatBlock), `types.ts` (Item, Contract, MissionResult, CaptainState…), `abilities.ts` (all 25 ability defs + `resolveAbility`) | remaining meta modules = milestone M7 |
| UI | `src/ui/hud.ts` (pixel HUD on a 2D canvas), `pixelFont.ts` (5×7 font from my-3d2dge), `style.css` | DOM menus = milestones M9/M10 |
| Input | `src/input/input.ts` | actions + rebindable bindings, gamepad (PS5 glyphs), rumble |
| Audio | `src/audio/dsp.ts`, `mixer.ts` (partial) | engine completion = milestone M8 |

### Render pipeline (per frame, `src/render/webgl2/renderer.ts`)
1. Water sims: force raster (hull footprints + splats as instanced quads → 3 force textures) →
   wave equation (RG16F h,v) → stable fluids (velocity, pressure, vorticity) → dye advection
   (RGBA16F: foam, bioluminescence, oil, burning oil). Sim window follows the camera in whole cells.
2. Occluder heightmap: top-down render of sprite-stack slices (R = max height via MAX blend,
   A = smoke density via ADD blend) — drives soft shadows.
3. Underwater pass: submerged parts → color + depth-below-surface (composited by the water pass).
4. G-buffer: fullscreen water (writes depth) → sprite stacks → particles. RT0 = albedo + material id,
   RT1 = normal.xy, world height z, emissive. Materials: `src/render/materials.ts` (`MAT`) + `MAT_GLSL`.
5. Lighting: ambient + sun + moon + up to 64 point/spot lights (float texture), heightmap-marched
   soft shadows, searchlight beam haze, water glints/sky reflection, light-band quantization.
6. Post: bloom (half res) → grade/vignette/grain/scanlines → integer-scaled present with the camera's
   sub-pixel shift (pixel grid anchored to the world).

Conventions: internal passes treat `gl_FragCoord.xy` as buffer pixels **y-down** (GL passes write
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
- Shader changes must keep the WebGL2 and WebGPU versions in sync (same chunk names, same math).
- No real persons' names on items/characters; no Nazi political symbols. Hull numbers/class names are fine.

## Verification checklist (before every commit)
1. `npm run typecheck` passes.
2. A headless screenshot of the relevant scene(s) with 0 page errors, and you looked at it.
3. For renderer work: screenshots with `?renderer=webgpu` AND `?renderer=webgl2` (once M2 lands).
4. For gameplay work: `__app.fastForward(…)` run with a sensible message log.
5. Commit message: imperative summary + bullet body, ending with the attribution lines required by
   the session (Co-Authored-By / Claude-Session) if your harness provides them.
