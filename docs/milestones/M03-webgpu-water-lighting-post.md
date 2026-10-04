# M3 — WebGPU water G-buffer, lighting (sun/moon/ambient) and post

**Status:** see docs/PLAN.md · **Depends on:** M2 · **Size:** large (biggest shader port)

## Goal
The WebGPU backend renders the ocean exactly like WebGL2: Gerstner swell with parallax, capillary
detail, palette tones with world-anchored dithering, whitecaps, underwater compositing hook, oil /
foam / bioluminescence / burning-oil hooks (sim textures bound as 1×1 zeros until M5), deferred
lighting with sun, moon, ambient, light-band quantization, fog, glints and sky reflection.
Ships, particles and dynamic lights come in M4.

## Read first
`docs/WEBGPU_PORTING.md`, `src/render/webgl2/passes/waterPass.ts`, `src/render/webgl2/passes/lightingPass.ts`,
`src/render/webgl2/glsl/common.ts`, `src/render/webgl2/glsl/ocean.ts`, the water + lighting section of
`src/render/webgl2/renderer.ts` (uniform values you must replicate), `src/water/ocean.ts` (`pack`).

## Steps
1. WGSL chunks in `src/render/webgpu/wgsl/`: `NOISE_WGSL` (hash12, hash22, vnoise, fbm, cellular),
   `OCEAN_WGSL` (`oceanSample(p) -> OceanOut { h, n, jac }`, `oceanHeight`, `ringHeight`; waves in a
   uniform struct `Ocean { a: array<vec4f,16>, b: array<vec4f,16>, rings: array<vec4f,8>, count: vec4f }`),
   `GBUF_WGSL` (output struct, `MAT_*` constants). Keep the GLSL math identical (same constants).
2. Targets: G-buffer `rgba8unorm` (albedo + material/255) + `rgba16float` (n.xy, z, emissive) +
   `depth24plus`; underwater color `rgba8unorm` + `rgba16float` + depth (cleared only for now);
   occluder `rgba16float` (cleared to (-50,0,0,0)); lit `rgba16float`.
3. Water pass (`passes/water.ts`): fullscreen triangle, port of the water FS 1:1. All texture reads
   via `textureSampleLevel(…, 0.0)` or `textureLoad`. Bind: Frame UBO, Ocean UBO, Water UBO (ramp as
   `array<vec4f,8>`, foam/murk colors, clarity, hs, contrast, detail, crestFoam, time, wind, parallax,
   sim rect, sim cell, simOn, bio, ice, rippleScale), wave + dye textures (1×1 zero placeholders),
   under + underD textures. Writes both MRT targets and `frag_depth` (`depthCompare: 'always'`).
4. Lighting pass (`passes/lighting.ts`): port of the lighting FS. Lights come from a read-only storage
   buffer (`array<LightGpu, 64>`, 4×vec4f each, same layout as `packLights`); count = 0 in M3 but the
   loop must exist. Occluder sampled with the linear sampler (`.ra` = height, smoke). Debug views
   (`debug.view` albedo/normal/height/light) must work.
5. Wire into `WebGPUBackend.render`: frame UBO from the camera (`origin`, `ix/iy`, zoom, tilt),
   `ocean.pack(origin)`, environment light colors exactly as the WebGL2 backend computes them
   (factor the uniform computation into a shared CPU helper in `src/render/common/frameUniforms.ts`
   used by BOTH backends so values cannot drift).
6. Remove the M2 test pattern (keep it behind `?testpattern=1` for debugging).

## Acceptance (use sims off in both backends so only M3 features are compared)
- `/?renderer=webgpu&freeze=1&fxseed=1&seed=7&hour=13&dev.water.sim=false&dev.water.fluid=false`
  vs the same URL with `renderer=webgl2`: the ocean (swell bands, dither pattern, whitecaps, glints)
  looks the same. Ships will be missing in WebGPU (M4) — compare open-water areas.
- Same comparison at `hour=23` (moon glitter path, dark palette) and `hour=7` (warm low sun).
- `?dev.debug.view=normal` / `height` / `albedo` render sensible images on WebGPU.
- Tilt check: `?dev.camera.tilt=0` and `=45` both render without seams; parallax displacement visible at 45.
- 0 page errors; `npm run typecheck` passes.

## Pitfalls
- `textureSample` inside `if` / loops is a WGSL validation error → always `textureSampleLevel`.
- Frame/clip y-flip and depth mapping (porting guide §1). If the image is upside down or the swell
  scrolls the wrong way when the camera moves, the flip is wrong.
- Ramp colors are vec3 in GLSL — pack as vec4 in WGSL uniforms.

## Commit
`WebGPU: water G-buffer, deferred lighting and post at parity with WebGL2`

## Notes (fill in when done)
