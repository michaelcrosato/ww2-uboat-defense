# M5 — WebGPU water simulations as compute shaders

**Status:** see docs/PLAN.md · **Depends on:** M4 · **Size:** large

## Goal
Port the interactive water to WebGPU with compute shaders: force raster (render pass), wave-equation
heightfield, stable-fluids surface current with vorticity confinement, dye advection (foam,
bioluminescence, oil, burning oil), and whole-cell window scrolling. Visual behaviour must match the
WebGL2 sims (bow waves, V wakes, explosion rings, swirling foam wakes, glowing bio wakes at night).

## Read first
`docs/WEBGPU_PORTING.md` (§2 formats), `src/render/webgl2/water/waveSim.ts`,
`src/render/webgl2/water/fluidSim.ts`, `src/water/simWindow.ts`, `src/render/pack.ts` (`packForces`),
the sim section of `src/render/webgl2/renderer.ts` (`applySimSizes`, follow/shift order, dev keys).

## Steps
1. `src/render/webgpu/sims/forces.ts`: render pass into three `rgba16float` targets at wave-sim
   resolution, additive blending, instanced quads from `packForces` (port FORCE_VS/FS; y-flip rule).
2. `sims/wave.ts`: state textures `rgba16float` (r = h, g = v) ping-pong; compute pipeline
   `@workgroup_size(8, 8)`: read neighbours with `textureLoad` (clamped), write with
   `textureStore`. Substeps from the CFL rule exactly as WebGL2 (`maxDt = 0.45*cell/c`); impulses only
   in the first substep (bind a zero texture for later substeps or pass a uniform flag).
3. `sims/fluid.ts`: velocity `rgba16float` ping-pong (sampled with the linear sampler in compute via
   `textureSampleLevel`), curl/divergence/pressure `r32float` (`textureLoad` only), dye `rgba16float`
   at wave resolution. Passes: advect velocity (+ obstacles + push from force textures), curl,
   vorticity, divergence, Jacobi × `water.pressureIters`, gradient subtract, dye advect (decay rates,
   burning-oil rule, sources × dt). Same constants as GLSL.
4. Window shift: a compute "copy with offset" kernel used for wave, velocity, pressure and dye with
   the same quantization (`win.quant`) and the same clearing rules on large jumps.
5. Bind the real sim textures in the water pass and the stack `waterAt()` lookup; debug views
   `wave`, `fluid`, `foam` on WebGPU.
6. Respect all water dev settings (`water.sim`, `water.fluid`, `simRes`, `simCell`, `waveSpeed`,
   `simDamping`, `hullPush`, `foamAmount`, `vorticity`, `pressureIters`, `foamDecay`, `fluidRes`) —
   changing resolution live must rebuild textures + bind groups.

## Acceptance
- Live `/?renderer=webgpu&hour=13&seed=7` (wait 10 s) vs `renderer=webgl2`: the player's destroyer
  leaves a V wake, bow wave and a foam trail of the same character; `?dev.debug.view=wave` and `foam`
  look alike in both backends.
- Night `/?hour=23&theater=caribbean`: bioluminescent wakes glow on WebGPU.
- A depth-charge test: `--steps "key:Space:200,wait:4000"` drops a charge; ring wave + foam dome
  appear on both backends.
- Changing `dev.water.simRes` (URL) to 1024 works on WebGPU; frame time noted in Notes.
- 0 page errors; typecheck passes.

## Pitfalls
- `rg16float` is not a storage format — use `rgba16float` for anything written by compute.
- Sampling in compute must use `textureSampleLevel` (no implicit derivatives).
- Barriers are implicit between dispatches in separate compute passes; keep each kernel in its own
  `beginComputePass()` or sequence dispatches carefully.

## Commit
`WebGPU: compute-shader water simulations (waves, fluid, dye)`

## Notes (fill in when done)
