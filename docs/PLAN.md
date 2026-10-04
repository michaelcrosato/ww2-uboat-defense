# Wolfpack & Escort — milestone plan

The game is built in self-contained milestones. Each one fits a single agent session; clear the
context between milestones and tell the next session: **"Continue the plan in docs/PLAN.md."**
The protocol is in `CLAUDE.md` ("Resume protocol"). Milestone details live in `docs/milestones/`.

**Rendering direction (decided):** WebGPU is the primary renderer; WebGL2 is the fallback. Both
backends consume the same backend-agnostic scene data and must produce visually equivalent frames.
WebGPU additionally runs the water simulations as compute shaders.

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
| M9 | Menus & UI shell: title, arena setup, dev settings, pause, controls, touch | TODO | [M09](milestones/M09-menus-ui-shell.md) |
| M10 | Port & progression UI, contracts → missions, loot drops, save/load | TODO | [M10](milestones/M10-port-progression.md) |
| M11 | Gameplay completion & tuning, dev-settings wiring audit, weather visuals | TODO | [M11](milestones/M11-gameplay-tuning.md) |
| M12 | Visual polish, ship art expansion, performance | TODO | [M12](milestones/M12-visual-polish.md) |
| M13 | Final QA, README, PR ready for review | TODO | [M13](milestones/M13-qa-release.md) |

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

## Known issues (keep this list current)
- U-boat AI cannot get ahead of the convoy while submerged (transit aims at a point that runs away). → M11
- Escort AI lingers in `reacquire` on stale, large-error hydrophone contacts. → M11
- `reinforce` world event (Wolfpack Signal) is emitted but Mission does not spawn boats. → M11
- Air patrol scheduling from `arena.aircraft` not implemented (only the Air Support ability). → M11
- Loot crates are never dropped by sinking ships (needs M7 loot) → M10.
- Searchlight beam haze is visible in daylight (scale haze by darkness). → M11
- Water swell bands look streaky at some sea states (tone dominated by long swell). → M12
- Islands use metal material; should be land with its own look. → M11/M12
- Many dev settings are declared but not wired (audit table in M11).
- Legendary powers with no gameplay hook yet: pow_flare_aura, pow_ram_shield, pow_convoy_heal, pow_silent_crit,
  pow_ghost_decoy, pow_hunter_reload; keystone flag ks_shepherd is stat-only. → M11
- Camera does not snap after `fastForward` (tests only; `?freeze=1` frames do settle it). → M11
- Debug perf lines (`debug.perf`) overlap the ability bar on narrow screens (debug only). → M9
- Burning hulls leak "burning oil" over their whole force-raster quad, giving a rectangular fire slick
  around the ship (both backends; `fire` term in the force FS needs a footprint-shaped falloff). → M11
- WebGL2: with `water.sim` on and `water.fluid` off the water pass samples an unbound dye texture (GL returns
  (0,0,0,1) → dye.a = 1 = "burning oil" inside the sim window). WebGPU binds a zero texture. → M11 (verify + fix)
- Headless runs simulate only ~2–5 s of game time per 15 s real time (WebGPU gets further than WebGL2), so
  live screenshots differ in particle counts / wake age; use `?scene=lookdev` / `tools/compare.mjs` for parity.
