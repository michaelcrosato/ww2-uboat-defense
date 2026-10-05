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
| M13 | Final QA, README, PR ready for review | IN PROGRESS | [M13](milestones/M13-qa-release.md) |

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
- Arctic pack ice is visual only (ragged floes since M12, but no drag or collisions for ships).
- U-boat kills by AI escorts are still rare (1 in 6 autopilot patrols); fine historically, revisit after playtests.
- Headless runs simulate only ~2–5 s of game time per 15 s real time (WebGPU gets further than WebGL2), so
  live screenshots differ in particle counts / wake age; use `?scene=lookdev` / `tools/compare.mjs` for parity.
- Menus: gamepad navigation is code-complete but untested on hardware (headless cannot simulate pads); the
  touch overlay was only checked visually with `?dev.controls.touch=on` (no real touch device).
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
- `ai.openingGrace` (75 s) keeps AI U-boats from firing at the start; with an idle player the first attacks
  now come after ~3 min. Tune with playtests (U-boat AI pacing in general has only had headless testing).
