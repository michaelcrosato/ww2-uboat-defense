# Wolfpack & Escort — milestone plan

The game is built in self-contained milestones. Each one fits a single agent session; clear the
context between milestones and tell the next session: **"Continue the plan in docs/PLAN.md."**
The protocol is in `CLAUDE.md` ("Resume protocol"). Milestone details live in `docs/milestones/`.

**Rendering direction (decided):** WebGPU is the primary renderer; WebGL2 is the fallback. Both
backends consume the same backend-agnostic scene data. WebGPU additionally runs the water simulations as
compute shaders. **Update (user, during M12): WebGPU-first** — WebGL2 is best effort: keep it compiling
and running, but WebGL2 parity, visuals and performance are no longer verified or optimized.

## Status board

| # | Milestone | Status | File |
|---|---|---|---|
| M0 | WebGL2 prototype + handoff docs (baseline) | DONE | — |
| M1 | Render abstraction refactor (backend-agnostic scene, WebGL2 behind an interface) | DONE | [M01](milestones/M01-render-abstraction.md) |
| M2 | WebGPU bootstrap: device, canvas, fallback chain, present pass | DONE | [M02](milestones/M02-webgpu-bootstrap.md) |
| M3 | WebGPU water G-buffer, lighting (sun/moon/ambient) and post | DONE | [M03](milestones/M03-webgpu-water-lighting-post.md) |
| M4 | WebGPU sprite stacks, particles, dynamic lights + occluder shadows | DONE | [M04](milestones/M04-webgpu-stacks-particles-lights.md) |
| M5 | WebGPU water sims as compute shaders | DONE | [M05](milestones/M05-webgpu-compute-sims.md) |
| M6 | Backend parity, regression test, WebGPU as default | DONE | [M06](milestones/M06-parity-and-default.md) |
| M7 | Meta layer: items, loot, skill trees, economy, contracts, profile | DONE | [M07](milestones/M07-meta-layer.md) |
| M8 | Procedural audio engine + game integration | DONE | [M08](milestones/M08-audio.md) |
| M9 | Menus & UI shell: title, arena setup, dev settings, pause, controls, touch | DONE | [M09](milestones/M09-menus-ui-shell.md) |
| M10 | Port & progression UI, contracts → missions, loot drops, save/load | DONE | [M10](milestones/M10-port-progression.md) |
| M11 | Gameplay completion & tuning, dev-settings wiring audit, weather visuals | DONE | [M11](milestones/M11-gameplay-tuning.md) |
| M12 | Visual polish, ship art expansion, performance | DONE | [M12](milestones/M12-visual-polish.md) |
| M13 | Final QA, README, PR ready for review | DONE | [M13](milestones/M13-qa-release.md) |
| M14 | Playtest fixes: capsizing U-boats, bearing-line clutter, tutorial for both sides | DONE | [M14](milestones/M14-playtest-fixes.md) |
| M15 | Mobile: fullscreen game mode, portrait 9:16, touch layout and assists, swipeable toasts, night outline | DONE | [M15](milestones/M15-mobile.md) |
| M16 | U-boats start submerged (surfaced only where it makes sense: port, diving lesson, pre-radar night) | DONE | [M16](milestones/M16-submerged-start.md) |
| M17 | The navies at true scale: USN/IJN classes, carrier air strikes, real harbour geography; Pearl Harbor and Midway | DONE | [M17](milestones/M17-pearl-midway.md) |
| M18 | GPU effects (compute particles, shockwaves, heat haze, light shafts, heightmap AO) and Pearl Harbor ashore in detail (corrected shoreline, roads, Navy Yard, hospital, airfields, tank farms, towns, parked aircraft, AA, traffic, harbour craft) | DONE | [M18](milestones/M18-effects-pearl.md) |
| M19 | 2D global illumination (JFA + ray-marched bounce light, compute on WebGPU), noise-shader flames, ground decals (craters, scorch, strafing); Pearl Harbor re-fitted to survey-grade points (GNIS, HABS/HAER) and re-placed; sortie routes and Nevada's beaching | DONE | [M19](milestones/M19-gi-pearl-survey.md) |
| M20 | More historic battles on the M17 framework (candidates: Coral Sea, Savo Island, the Denmark Strait / Bismarck, convoy PQ 17, the River Plate); Pearl Harbor prologue with USS Ward (06:37) | TODO | (write the milestone file first) |

Order matters for M1→M6 (renderer). M7 and M8 are independent of the renderer and may be done
before M1 if preferred; M9 needs nothing else; M10 needs M7 + M9; M11 needs M10; M12/M13 last.

Model guidance: every milestone is written to be executable by Sonnet 5.5 (or Opus at medium
effort). The renderer milestones (M3–M5) are the most technical; their files contain explicit
porting notes, and `docs/WEBGPU_PORTING.md` lists the GLSL→WGSL rules and pitfalls.

## Target render architecture (end of M6)

```
src/render/
  types.ts         RenderBackend interface, BackendInfo, FrameParams
  scene.ts         RenderScene: atlas (CPU), stacks[], particles (CPU sim), lights, hulls[], splats[]
  backend.ts       createBackend(screen, pref): WebGPU → WebGL2 fallback chain, fresh canvas per attempt
  camera.ts        (moved from src/gfx) oblique camera, backend-agnostic
  pack.ts          CPU packers shared by both backends: stacks, particles, lights, forces
  materials.ts     MAT ids + particle kinds (shared constants)
  common/          frameUniforms.ts: per-frame uniform values computed once for both backends (M3)
  webgl2/          the current GL renderer, moved: gl.ts, renderer.ts, passes/, glsl/, waveSim.ts, fluidSim.ts
  webgpu/          device.ts, targets.ts, uniforms.ts, renderer.ts, passes/, wgsl/, sims/ (compute)
```
Game code (`src/game/*`) talks only to `RenderScene`; it never imports a backend.

`RenderBackend` (implemented by both backends):
```ts
interface RenderBackend {
  readonly info: { kind: 'webgpu' | 'webgl2'; adapter: string; computeSims: boolean; features: string[] };
  readonly stats: { stackInstances: number; particles: number; lights: number; gpuMs?: number };
  resize(): void;
  render(scene: RenderScene, f: FrameParams): void;   // whole frame incl. present
  resetSims(): void;                                   // new mission / camera teleport
  dispose(): void;
}
```
Backend selection: dev setting `display.renderer` (`auto` | `webgpu` | `webgl2`) and URL
`?renderer=`. `auto` tries WebGPU (adapter → device → pipeline compile) and falls back to WebGL2
on any failure or later device loss. The active backend shows in the FPS overlay and dev menu.

## Decisions log
- 2026-10: Rapier 3D (not 2D): the world is 3D (buoyancy, depth, sinking), rendered top-down.
- 2026-10: Two hand-written shader sets (GLSL + WGSL) instead of runtime translation (no heavy deps).
  Parity is enforced by the M6 regression tool.
- 2026-10: WebGPU particles are instanced quads (WebGPU has no point size); WebGL2 keeps gl_PointSize.
- 2026-10: Headless WebGPU verified: Chromium 1194 + `--enable-unsafe-webgpu` on an http://localhost
  page exposes a SwiftShader adapter with compute, float32-filterable, float32-blendable, timestamps.
- 2026-10 (M2): but **presenting to a canvas** (`getCurrentTexture`) loses the device headless ("A valid
  external Instance reference no longer exists"), with every flag set tried. WebGPU init runs a one-frame
  present probe and falls back to WebGL2 if it fails; headless tests use `?gpupresent=readback`
  (frame copied to a 2D canvas). Real browsers use the normal canvas path.
- 2026-10 (M2): `auto` stayed on WebGL2 until the WebGPU backend rendered the full scene.
- 2026-10 (M6): `auto` → WebGPU (`WEBGPU_DEFAULT = true`). Parity on the look-dev scene: mean abs diff
  0.12–0.27/255 and 0.04–0.20 % of pixels over 24/255 at hours 13/7/23 (thresholds 3/255 and 4 %).
- 2026-10 (M14, after the first live playtest): the HUD draws only the player's own hydrophone bearings by
  default (ticks on a ring around the boat + a ray to the aimed contact); the full every-listener picture is
  the `all` option of `display.bearings`. New captains are steered to a guided tutorial from the title screen.
- 2026-10 (M15, user playtest on a phone): touch is its own layout, not a copy of the desktop one (desktop stays
  primary and unchanged). Portrait 9:16 is the main phone orientation; missions go fullscreen in the held
  orientation and the back gesture pauses. What needs mouse precision is automated on touch
  (`controls.autoAttack` touch by default: target picking, auto guns and pings, charge depths from the plot).
  The player's own hull is outlined after dark on every platform (`display.nightOutline`).
- 2026-10 (M16, user): U-boats start submerged at periscope depth, surfaced only where it makes sense (leaving
  port, the diving lesson, a dark night before the escorts carry radar); `arena.uboatStart` overrides.
- 2026-10 (M16, user): standard operating procedure: commit → push → PR → merge it yourself, no permission
  needed; rollback if anything goes badly wrong. Merged and closed is enough: the head branch stays (sessions
  cannot delete branches, GitHub answers 403).

- 2026-10 (M17, user): "create to scale all of the ships in the navy … start by recreating Midway and Pearl
  Harbor, to scale, historically accurate" — a departure from the convoy-only plan. Historic battles are
  scenarios on top of the arena (`arena.scenario`), with the side mapping kept mechanical (`allied` = surface
  force, `axis` = submarine force) so the escort/U-boat player code serves both navies. Battles replay history
  where the player does not intervene: element hits are assigned to aircraft up front and cancelled if that
  plane is shot down; capsizes are scripted at their historical times once enough water is in the hull.

- 2026-10 (M18, user): "use WebGPU to really improve the effects … go all out with compute WebGPU and GL2 effects".
  A second particle layer (`render/fx.ts`) runs on the GPU (WebGPU compute, WebGL2 transform feedback) over the
  CPU particles, which stay for what must be lit in the G-buffer; post distortion (shockwaves, heat haze,
  chromatic flash), light shafts, camera trauma and heightmap AO are all on dev settings (Effects, Lighting).
- 2026-10 (M18, user): "check maps to verify it 1:1 accurate". The container's network blocks every map source
  (OSM, Overpass, USGS, NOAA, Esri, Wikipedia); the shoreline was corrected against the surveyed points the
  research could read in search snippets (stations, memorials, markers) and the rest is estimated (listed with
  confidence in the M18 notes).
- 2026-10 (M19, same request, second pass): light now bounces. A 2D GI grid over the occluder window (jump-flood
  distance field, ray-marched gather with one bounce per frame, temporal history) on WebGPU compute and WebGL2
  fragment passes; light in it falls off as over a ground plane (`light.giReach`), because flatland's 1/d summed a
  field of fires into one glare. Fires burn with noise-shader flame quads; bombs and strafing leave ground decals.
- 2026-10 (M19): the map is fitted to survey-grade points found in search results (USGS GNIS place and water points,
  Library of Congress HABS/HAER record points, the markers and stations of M18); map services are still blocked.
  Where the game's ships cannot physically follow history in the corrected harbour, the scenario scripts the move
  (Nevada's swing onto the bank at Hospital Point, like her walk out of F-8) rather than bending the geography.
- 2026-10 (after M19, user): "free scroll around the map and view what is going on". The free camera (C / L3, which
  existed with only a middle drag and the right stick) now pans with the arrow keys (`Input.suppress` hands them
  from the helm to the camera; WASD keeps steering), screen-edge scrolling, a one-finger drag on touch (LOOK / SHIP
  button), zooms toward the cursor (`Camera.anchor`) and out to `camera.freeMinZoom` (0.1 px/m: all of Pearl
  Harbor); the HUD names the mode and its keys, marks the view on the plot and points back to the own ship.

## Known issues (keep this list current)
- Arctic pack ice is visual only (ragged floes since M12, but no drag or collisions for ships).
- U-boat kills by AI escorts are still rare (none in the M14 fast-forwards); fine historically, revisit after playtests.
- Since M14 the AI U-boats no longer capsize, so the wolfpack is deadlier: an idle escort player loses 2–5 merchants
  per 15 min (was 1–3) and 1 of 4 full crossings ended in defeat. Retune AI U-boat lethality after playtests.
- `arena.difficulty` is declared and set by contracts, but no gameplay code reads it.
- The HUD FPS readout sums capped frame times (≤ 0.1 s), so below 10 fps it still shows 10 (headless runs).
- Default night scenes (23:00, full moon) are busy with moon glitter around the boat; an art call for the user.
- The tutorial's gamepad and touch prompts were checked on screen only (no hardware), like the rest of the pad/touch UI.
- Touch play (M15) was tested with Chromium's phone emulation and CDP touch events (tap, swipe, hold, pinch)
  at six phone and tablet sizes, never on a real device. iOS Safari has no element fullscreen or orientation
  lock (Add to Home Screen gives the chrome-less app), and its edge-swipe back is untested.
- The touch assists (auto guns, auto pings, FIRE picking the target) are untuned by playtests; they make the
  escort side easier on touch than with a mouse. `controls.touch` auto also shows the touch layout on
  touch-screen laptops (Settings → Controls → Touch controls: Off).
- Headless runs simulate only ~2–5 s of game time per 15 s real time (WebGPU gets further than WebGL2), so
  live screenshots differ in particle counts / wake age; use `?scene=lookdev` / `tools/compare.mjs` for parity.
- Menus: gamepad navigation is code-complete but untested on hardware (headless cannot simulate pads).
- The headline font (`--font-head`: Impact…, Linux narrow faces since M12) is not installed headless, so
  screenshots show the sans fallback; a bundled stencil webfont would need the user's OK (asset).
- Crates still afloat when a contract ends are recovered automatically if the ship survived (keeps
  fast-forward tests and short sessions rewarding); revisit if pickup should matter more.
- Hull pennant numbers are only readable from zoom ≈ 3 (sub-pixel at the default 1.2).
- Aircraft cast a ground shadow decal only while the sun (or a bright moon) is above ~9°; airborne stacks
  write no occluder, so a low sun gives them no shadow at all.
- Slice atlas (2048²) reaches ~80 % (89 % on the US East Coast) with every vessel class in one mission;
  further big classes need a larger atlas or lower-resolution merchants (overflow drops top layers + warns).
- Frame times were measured on SwiftShader only (no GPU in the container); real-GPU numbers are unknown.
- WebGL2 is best effort (user decision): it receives shader changes but is not parity-checked any more.
- Key taps shorter than one frame can merge in slow headless runs (two taps → one press); real browsers are fine.
- Only fast-forwards from a `?freeze=1` start are reproducible; live play depends on frame timing and input.
- `ai.openingGrace` (75 s) keeps AI U-boats from firing at the start. Since M16 the boats start at periscope
  depth, so the first attacks can come right after it (seed 42: an idle escort torpedoed at 123 s); idle escort
  losses over 15 min fell to 0–3 merchants. Tune with playtests (U-boat AI pacing has only had headless testing).
- No mission starts in port yet, so `arena.uboatStart = surfaced` (a port departure) only serves the U-boat lesson.
- Historic battles: the network blocks every map service (OSM, Overpass, USGS, NOAA, Esri) and the primary history
  sites. Since M19 Pearl Harbor's shores, docks, hangars and berths are fitted to survey-grade points (USGS GNIS,
  HABS/HAER records, memorial and pier markers, rail stations; listed in the M19 notes), between them the lines are
  interpolated. Where later fill moved the shore (Kuahua, the head of Magazine Loch, Ford Island's west side, Waipio)
  the 1941 line is an estimate a little inside today's. Re-trace against OSM or the 1941 charts if they become reachable.
- Pearl Harbor ashore: still estimated — the Navy Yard and Sub Base shop grids, Hickam's three smaller runways
  (headings unknown), the AA positions, the tank farms (±200 m), the craft routes. Houses, streets and trees in the
  towns are procedural.
- Pearl Harbor ashore holds ~18,300 scenery placements (culled round the view in 250 m cells); SwiftShader
  needs 1.4–1.6 s of GPU time per frame over the Navy Yard (heightmap AO alone doubles the lighting pass there),
  so headless shots need ~9 s to settle. Real-GPU frame times are unmeasured.
- 2D GI (M19) costs 108–192 ms per frame on SwiftShader at 256² (~13 % of the frame); real-GPU cost unmeasured. The
  Performance preset turns it off.
- Dark smoke puffs use four dithered alpha steps (M18 look); at zoom ≳ 2 the young puffs over a fire read as small
  black checkerboards.
- Effect particles (M18) are not simulated by `fastForward` (cosmetic, cleared after a jump) and live only on the
  GPU, so a slow headless frame rate shows fewer of them in flight than a real browser.
- Historic battles: AI escorts were written for open ocean. Inside Pearl Harbor they are held at a listening
  point and a shore pilot keeps them off the banks; a player midget that lies still near a bank can still
  draw a hunting destroyer aground. The capital ships at Midway use their own formation-keeping AI.
- The Midway screen destroyers sometimes bump each other while two of them hunt the same contact.
- Historic battles run at real time (2–2.5 h of game time); time compression (up to 16×) makes them
  playable, but headless runs only covered them with fast-forwards. Performance with ~25 big ships and land
  tiles on a real GPU is unmeasured; the 3072² atlas is ~38 MB per texture (two textures).
