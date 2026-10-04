# M2 — WebGPU bootstrap: device, canvas, fallback chain, present pass

**Status:** see docs/PLAN.md · **Depends on:** M1 · **Size:** medium

## Goal
`createBackend` tries WebGPU first and falls back to WebGL2. The WebGPU backend initializes the
device and canvas, renders a world-anchored test pattern through a full WGSL port of the post
chain (bloom, grade, vignette, grain, scanlines, integer-scaled present with sub-pixel shift),
handles resize and device loss. The real scene arrives in M3–M5.

## Read first
`docs/WEBGPU_PORTING.md` (all of it), `src/render/types.ts`, `src/render/backend.ts`,
`src/render/screen.ts`, `src/render/webgl2/passes/postPass.ts`, `src/render/webgl2/renderer.ts`
(only `render()` top + post section), `src/app.ts`.

## Steps
1. `src/render/webgpu/device.ts`: `async initGpu(canvas): Promise<GpuContext>` →
   `{ adapter, device, context, format, features: string[], adapterName, hasTimestamps }`.
   Request `float32-filterable` / `timestamp-query` only if available. Wrap init + all pipeline
   creation in `pushErrorScope('validation')`; check `getCompilationInfo()` for every module and throw
   with the first error line (so failures trigger the fallback). Hook `device.lost` and
   `uncapturederror` → set `ctx.lost = reason`.
2. `src/render/webgpu/targets.ts`: `createTarget(device, format, w, h, extraUsage)` returning
   `{ texture, view, w, h }`; shared samplers `nearest` and `linear` (clamp-to-edge); `Ubo` helper
   (`Float32Array` + `GPUBuffer` + `write()`).
3. `src/render/webgpu/wgsl/common.ts`: WGSL chunks `CAMERA_WGSL` (frame uniforms struct `Frame`:
   cam, tilt, buf, pixOff — with the y-flip rules from the porting guide), `DITHER_WGSL` (bayer8/bayer4
   with `var` tables, `ditherHere(pos)`), `fmod`. Same function names as the GLSL chunks.
4. `src/render/webgpu/passes/post.ts`: WGSL ports of `BRIGHT_FS`, `BLUR_FS`, `PRESENT_FS` (present
   renders into `context.getCurrentTexture()`; device pixel = `position.xy`, no y inversion).
   Half-res bloom targets `rgba16float`.
5. `src/render/webgpu/renderer.ts`: `WebGPUBackend implements RenderBackend`. For M2, `render()`
   draws a **test pattern** into the lit target (`rgba16float`, buffer size `cam.bw × cam.bh`):
   world-anchored 10 m checkerboard (use `pixToWorld` so it scrolls with the camera exactly like the
   ocean), a 100 m grid in a brighter color, and a few bright pixels (>1.0) so bloom is visible; then
   post. Keep ≤ 2 frames in flight. `stats` filled with zeros; `info.kind = 'webgpu'`.
6. `src/render/backend.ts` fallback chain: for `auto`/`webgpu` try WebGPU (any throw → log a warning
   with the reason, `screen.replaceCanvas()`, create WebGL2). `?gpufail=1` throws inside `initGpu`
   (test hook). Expose `backend.info` in the FPS overlay text, e.g. `60 fps · WebGPU (SwiftShader)`.
7. Device loss at runtime: App checks `backend.lost` each frame → dispose, replace canvas, create
   WebGL2, `resetSims()`, show a HUD message "Renderer switched to WebGL2".
8. Resize: targets recreated lazily when `cam.bw/bh` change; canvas size follows `Screen` (pw × ph).

## Acceptance
- `npm run probe:gpu` reports an adapter.
- `/?renderer=webgpu&hour=13` → screenshot shows a crisp checkerboard scrolling with the camera,
  integer-scaled (each game pixel an S×S block), vignette/grain visible, no page errors; HUD overlay
  still drawn on top; FPS text says WebGPU.
- `/?renderer=webgl2` → full game exactly as before.
- `/?renderer=auto` (headless) → WebGPU selected (console info).
- `/?renderer=webgpu&gpufail=1` → falls back to WebGL2 with the full game, a warning in the console.
- Resizing the viewport (`--w 900 --h 600` run) still produces crisp pixels.

## Pitfalls
- `format` from `getPreferredCanvasFormat()` is usually `bgra8unorm`: the present pipeline target
  format must match it.
- Don't call `getContext('webgpu')` on a canvas that already has a WebGL2 context (and vice versa).
- `writeBuffer` sizes must be multiples of 4 bytes; uniform buffers need `UNIFORM | COPY_DST` usage.

## Commit
`Add WebGPU backend bootstrap with WebGL2 fallback and WGSL post chain`

## Notes (fill in when done)
Done. `?renderer=webgpu&gpupresent=readback` renders the world-anchored test pattern through the WGSL
post chain (`check-output/m2-webgpu.png`): 10 m checker, 100 m grid (120 × 110 internal px at zoom 1.2 /
tilt 24°), bloomed HDR crossings, vignette + grain, crisp 2×2 game pixels, HUD on top, FPS text
`10 fps WebGPU (SwiftShader)`. A frozen shot puts a grid crossing exactly where `cam.toScreen` predicts
(±0.5 device px). 900×600 also crisp. `?gpufail=1` and plain `?renderer=webgpu` (headless present probe
fails) both fall back to the full WebGL2 game with a console warning. Simulated runtime loss
(`__app.backend.g.lost = '…'`) swaps to WebGL2 mid-mission with the HUD message. WebGL2 frozen shots are
still pixel-identical to the M1 baselines.

What changed
- `src/render/webgpu/`: `device.ts` (`initGpu`: optional features, `lost` from `device.lost` +
  `uncapturederror`, present probe; `shaderModule` throws on the first WGSL error with the source line;
  `validated` wraps pipeline creation in a validation error scope), `targets.ts` (`createTarget`,
  `resizeTarget`, samplers, `Ubo`, `TU`/`BU` usage constants), `wgsl/common.ts` (`FULLSCREEN_WGSL`,
  `CAMERA_WGSL` with `Frame` at group 0 binding 0 + `writeFrame`, `MATH_WGSL` (`fmod`, `hash12`),
  `DITHER_WGSL`), `passes/post.ts` (`PostPassGPU`: bright, blur H/V with separate UBOs, present),
  `passes/testPattern.ts`, `renderer.ts` (`WebGPUBackend`, ≤ 2 frames in flight, lazy lit target).
- `src/render/common/post.ts`: `postParams()` used by both backends (grade map, shift, settings).
- `backend.ts`: fallback chain, `fallbackToWebGL2`, `backendLabel`, `WEBGPU_DEFAULT`. `RenderBackend.lost`.
- `App` checks `backend.lost` every frame and swaps to WebGL2 (`resetSims`, HUD alert message).

Decisions / deviations
- `auto` → WebGL2 until M6 (the acceptance line "auto → WebGPU" is deferred to M6 step 5): during M2–M5
  WebGPU draws an incomplete scene and must not become the default.
- Headless present is broken in this Chromium build (see PLAN decisions log) → present probe at init +
  `?gpupresent=readback` test path (renders into an `rgba8unorm` texture, `copyTextureToBuffer`, maps,
  `putImageData`; at most one readback in flight).
- Bind groups use `layout: 'auto'`; fine while every binding is statically used by its entry point. M3+
  passes that share layouts across pipelines should switch to explicit layouts.

Follow-ups
- M3: replace `TestPatternPass` with water G-buffer + lighting; keep `Frame` at group 0 binding 0.
- M6: flip `WEBGPU_DEFAULT`; GPU timing via `timestamp-query` (`g.hasTimestamps`).
