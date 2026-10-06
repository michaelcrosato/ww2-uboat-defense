# M18 — GPU effects, lighting, and Pearl Harbor ashore in detail

**Status:** see docs/PLAN.md · **Depends on:** M17 · **Size:** large

## Goal
User: "Add more details to Pearl Harbor, check maps to verify it 1:1 accurate, add more detail for the city, roads,
hospitals, airfields, docks, smaller boats, cars, AA guns. Also use WebGPU to really improve the effects,
explosions and stuff … create flashy effects, more detailed lighting and shadow, really go all out with compute
WebGPU and GL2 effects."

## Read first
`src/render/fx.ts`, `src/render/webgpu/passes/fx.ts`, `src/render/webgl2/fxGL.ts`, `src/render/common/post.ts`,
`src/game/effects.ts`, `src/game/historic/pearlDetail.ts`, `src/game/historic/harborLife.ts`, `src/art/shoreArt.ts`,
`src/game/historic/land.ts` (paint grid, carves, `addLand`), `src/game/world.ts` (`addScenery`, `view`, the scenery grid).

## Acceptance
- Explosions, fires, flak, splashes and muzzle flashes layered with GPU particles (compute on WebGPU, transform
  feedback on WebGL2); shockwave distortion, heat haze, chromatic flash, light shafts, camera shake; heightmap AO.
- Pearl Harbor ashore: corrected shoreline, roads and railway, runways and aprons, the Navy Yard, the Naval
  Hospital, the Submarine Base, tank farms, Ford Island, Hickam, Fort Kamehameha, Pearl City and Aiea; parked
  aircraft that bombs destroy, AA positions that fire, cars, harbour craft, moored boats.
- typecheck, `npm test`, build; WebGPU screenshots (live and frozen) with 0 page errors; a WebGL2 smoke shot;
  a full fast-forward of Pearl Harbor.

## Notes (fill in when done)
(written at the end of the milestone)
