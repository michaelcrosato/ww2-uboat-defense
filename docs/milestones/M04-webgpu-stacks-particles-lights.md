# M4 — WebGPU sprite stacks, particles, dynamic lights + occluder shadows

**Status:** see docs/PLAN.md · **Depends on:** M3 · **Size:** large

## Goal
Everything except the water simulations renders on WebGPU at parity with WebGL2: voxel ships (hull +
rotating mounts), damage charring, lamp emissive, x-ray own sub, aircraft ground-shadow decals,
underwater compositing of submerged parts, waterline foam, particles (spray, mist, smoke, fire,
sparks, debris, tracers, flashes, deck wash), the occluder heightmap with smoke density, and up to
64 dynamic point/spot lights with soft occluder shadows, searchlight beam haze and flare halos.

## Read first
`docs/WEBGPU_PORTING.md`, `src/render/webgl2/spriteStack.ts`, `src/render/webgl2/particlesGL.ts`,
`src/render/pack.ts`, `src/render/lights.ts`, the occluder/underwater/G-buffer section of
`src/render/webgl2/renderer.ts`, `src/art/voxel.ts` (`SliceAtlas` data layout).

## Steps
1. Atlas: two `rgba8unorm` 2048² textures (albedo, normal+material) uploaded with
   `queue.writeTexture` when `scene.atlas.dirty` (then clear the flag; the WebGL2 backend clears it
   too — make the dirty flag per-backend, e.g. a version counter each backend remembers).
2. Stack instance buffer: vertex buffer (`stepMode: 'instance'`, 5 × `float32x4` attributes, 80-byte
   stride) filled from `packStacks`; grow by doubling. Quad corner from `vertex_index` (triangle strip).
3. Three stack pipelines (port the GLSL 1:1, including flags: 1 lamps on, 2 x-ray, 4 shadow decal,
   8 flatten; clip range; damage pattern; waterline foam):
   - **occluder**: world-aligned ortho (y-flip rule), targets the occluder texture with the MAX/ADD
     blend state from the porting guide, no depth.
   - **under**: MRT (color + depth-below-surface) with `frag_depth = dep/400`, `depthCompare: 'less'`.
   - **gbuf**: into the G-buffer after the water pass, `depthCompare: 'less'`, depth write on.
4. Particles: instance buffer from `packParticles` (3 × `float32x4`); render as quads (6 vertices from
   `vertex_index`), pixel size `clamp(size_m * zoom, 1, maxPx)` converted to clip offsets; circular
   discard + dithered alpha exactly as the GLSL FS. Two pipelines: G-buffer and occluder smoke
   (alpha-additive into the occluder `.a`, MAX on color with -50 so heights are untouched).
5. Lights: `packLights` → storage buffer each frame; lighting shader loop already exists from M3 —
   enable shadows (`shadowTo` marching through the occluder map), spot cones, beams and halos.
6. Debug view `occluder` (and keep albedo/normal/height/light) on WebGPU.
7. `stats` (stack instances, particles, lights) reported like WebGL2.

## Acceptance (sims off in both backends: `dev.water.sim=false&dev.water.fluid=false`)
- `/?freeze=1&fxseed=1&seed=7&hour=23` WebGPU vs WebGL2: same ships, searchlights/fires (if present
  at t=0), same shadow shapes. Then a live run (`/?hour=23&seed=7`, wait 8 s) on both: ships move,
  funnel smoke, bow spray, muzzle flashes and tracers when firing (use `--steps` to hold the mouse
  button, e.g. `move:900:300,click:900:300`).
- Day run `/?hour=13&side=uboat` on WebGPU: own U-boat visible as an x-ray silhouette when submerged
  (`--steps "key:KeyE:300"` a few times to order depth), periscope rendering.
- Occluder debug view shows ship footprints; shadows from a star shell fall away from it.
- 0 page errors; typecheck passes.

## Pitfalls
- WebGPU has no point sprites — quads only.
- Blend state `max` requires `srcFactor/dstFactor = 'one'`.
- Instance attribute locations must match the WGSL `@location`s; mount quaternions are composed on
  the CPU (no change).

## Commit
`WebGPU: sprite stacks, particles, dynamic lights and occluder shadows`

## Notes (fill in when done)
