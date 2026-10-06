# M19 — Global illumination, noise flames, ground decals, and Pearl Harbor fitted to survey points

**Status:** see docs/PLAN.md · **Depends on:** M18 · **Size:** large

## Goal
The second pass at the M18 request (user): "Add more details to Pearl Harbor, check maps to verify it 1:1 accurate,
add more detail for the city, roads, hospitals, airfields, docks, smaller boats, cars, AA guns. Also use WebGPU to
really improve the effects, explosions and stuff … more detailed lighting and shadow, really go all out with compute
WebGPU and GL2 effects."

## Read first
`src/render/webgpu/passes/gi.ts` (and its twin `src/render/webgl2/passes/giPass.ts`), `src/render/webgpu/passes/lighting.ts`
(`giAt`), `src/render/webgpu/passes/decals.ts`, `src/render/webgpu/passes/fx.ts` (kind 11), `src/render/pack.ts`
(`packEmitters`, `packDecals`), `src/game/effects.ts` (`fireEmit`), `src/game/historic/pearlDetail.ts` (`PEARL_LAND`, the
anchors, `dressPearl`), `src/game/historic/pearlHarbor.ts` (berths, channels, Nevada), `src/game/historic/scenario.ts`
(`RouteAI`, `warp`).

## Acceptance
- Light that bounces: fires, explosions and lamps light the ground, hulls and buildings around them, blocked by tall
  structures, on both backends (compute on WebGPU), on dev settings, with debug views.
- Fires burn with animated flames, not only particles; bombs and strafing leave craters, scorch and pocks ashore.
- The Pearl Harbor shoreline and every placement re-fitted to the best positions obtainable; ships sortie and
  Nevada beaches without running aground or ramming.
- typecheck, `npm test`, build; WebGPU screenshots with 0 page errors (GI, flames, decals, the re-fitted areas), a
  WebGL2 smoke shot; full fast-forwards of Pearl Harbor (both sides) and Midway.

## Sources
Map services are still blocked in the container (OpenStreetMap, Overpass, USGS, NOAA, Esri, Wikipedia; only GitHub,
npm and PyPI answer; the npm `@geo-maps` coastlines are too coarse for a harbour). A second research pass found
survey-grade points in search results instead:
- USGS GNIS place points: Hospital Point 21.34874 N 157.96756 W, Bishop Point 21.33148/157.96850, Waipio Point
  21.34219/157.97207, McGrew Point 21.37624/157.94177, Pearl City Peninsula 21.37268/157.97044, Waipio Peninsula
  21.35833/157.98056, Merry Point Landing 21.35333/157.94583; the water points of Southeast Loch 21.35574/157.94889,
  Aiea Bay 21.37520/157.93731, East Loch 21.38083/157.95778 and the Ford Island Channel 21.35972/157.97250.
- Library of Congress HABS/HAER record points: Dry Docks 1, 2 and 3 (21.34984/157.95931, 21.34989/157.96079,
  21.35078/157.96142), Ford Island seaplane ramp S360 (21.35553/157.96600) and the 1933 ramps (21.35602/157.96310),
  Hangar 37 (21.36294/157.95850), the administration building (21.36114/157.96289), Hickam's Hangar 35
  (21.33285/157.96279), Hale Makai (21.33651/157.95809), the water tower (21.34257/157.96219), the Marine Barracks
  gate (21.35108/157.94597).
- Kept from M18: the Arizona, West Virginia, F-5 and Utah markers, the Navy Yard and Ford Island runway reference
  points, Lockwood Hall, Fort Kamehameha and its batteries, the Kamehameha Highway rail stations, the Waiau plant,
  the NOAA Halawa Landing station (21.3683/157.9400).
Still estimated (no point found): the 1941 lines where later fill moved the shore (Kuahua, the head of Magazine
Loch, Ford Island's west side, Waipio: drawn a little inside today's), Hickam's three smaller runways, the shop
grids, the AA pits, the tank farms (±200 m), the houses and streets of the towns (procedural).

## Notes (fill in when done)
**Done.**

A. 2D global illumination (`webgpu/passes/gi.ts`, `webgl2/passes/giPass.ts`). A grid (`light.giRes`, 128²–512²) over
the occluder window holds what emits and what blocks: hot effect particles (an additive pass of the GPU particle
buffer), omni lights as discs, the game's steady GI emitters (every fire registers one each frame, `FxSystem.emitters`,
packed like lights) and burning oil from the fluid sim's dye; walls are occluders taller than `light.giWall` (10 m:
bridges, towers, hangars block light, decks and houses let it pass). A jump flood turns the seeds into a
nearest-seed distance field; each texel sphere-traces `light.giRays` noise-rotated rays through it and gathers one
bounce per frame: emitters give their light, walls reflect (albedo × `light.giBounce`) what reached their face last
frame. History (`light.giHistory`) is reprojected as the window follows the camera. The lighting passes add GI
through a normalized 3×3 tent (walls hold no light of their own, so hulls and buildings borrow the glow of the open
water and ground beside them), banded with the direct light, plus firelight glinting off the waves. WebGPU runs it as
compute (compose, the JFA chain, trace); WebGL2 as fragment passes (an MRT compose, ping-pong JFA). Debug views
`gi` and `giSeeds` (Debug → View). Cost on SwiftShader at 256²: 108–192 ms, about 13 % of the frame; the
Performance preset turns it off, Cinematic runs 512² with 12 rays.

Light in the grid falls off as over a ground plane (`light.giReach`: half at 40 m), not as in flatland: with 1/d
falloff the 36 fires on Hickam's apron at 07:56 summed into a white glare over the whole field. The lighting pass
also rolls the total off toward a ceiling and weighs it less under a high sun. Each fire now throws its own pool.

B. Flames (FX kind 11, `FX.FLAME`). An upright quad standing on its base whose depth climbs toward its top, so a
tongue licks up in front of the hull or wall behind it. The fragment is a noise fire: fBm scrolling upward,
domain-warped by a second noise, shaped hot at the base, the heat stepped through the fire ramp in six bands with a
Bayer dither (pixel art). Every fire in view streams them (`fireEmit`), over the embers and smoke column of M18.

C. Ground decals (`scene.addDecal`, `webgpu/passes/decals.ts`, `webgl2/decalsGL.ts`): bomb craters (a dark pit, a lip
of thrown-up earth, scorch with radial streaks), scorch, the burnt-out char under a wreck, strafing pocks in a line.
Instanced flat quads drawn into the G-buffer after the stacks, albedo only (alpha blending that keeps the material
id; normals untouched), depth less-equal so they stay off hulls and buildings. Stepped, dithered coverage; up to 768
per mission (the oldest go first). Bombs ashore leave craters, Zeros' strafing runs lines of pocks, wrecked aircraft
their char, burning buildings scorch.

D. The shoreline re-fitted (`PEARL_LAND`, `SE_LOCH`, `QUARRY_LOCH`, `MAGAZINE_LOCH`). Against the survey points, M18's
outline had the main channel, Hospital Point and Hickam's shore 400–600 m too far east, the dry docks' waterfront
400 m too far north, Ford Island's south shore 180 m too far north and the tip of Pearl City peninsula 500 m too far
north. Now: Ford Island from the Battleship Row markers, the Utah memorial and the seaplane ramps; the Navy Yard,
Sub Base and Kuahua as one district with the dry docks opening north onto the waterfront and Hospital Point at its
GNIS point; Southeast Loch forking into Quarry Loch (Merry Point landing on its shore) and Magazine Loch; Aiea Bay and
McGrew Point; Pearl City's tip; Waipio from Waipio Point to the head of Middle Loch; the channel's east bank through
Bishop Point; Iroquois Point on the west.

E. Everything ashore re-placed on it (`dressPearl`). Dry Docks 1–3 at their HAER points running north–south (No. 1
with Pennsylvania, Cassin and Downes; No. 2 complete and dry; No. 3 half built), portal cranes and the hammerhead,
the 1010 Dock with Helena and Oglala alongside; the coal docks and their four minesweepers below Hospital Point; the
Naval Hospital facing the channel; Power Plant 149 and the shops with their trucks; the Marine Barracks by their gate;
Lockwood Hall, the escape tower, the sub piers with the PT boats; Merry Point's and both farms' tanks; Ford Island's
runway at 045, the hangar line along Hangars 37–79–54 with the tower, the apron and fourteen PBYs; Hickam's 7,048 ft
mat at 056, its three smaller runways, the hangar line from Hangar 35 at 055 with the operations building and tower,
26 B-18s, 12 B-17s and 12 A-20s on the apron, Hale Makai at the head of the mall to the water tower; Fort
Kamehameha's batteries; Pearl City, Aiea and Halawa, the Aiea sugar mill at its point, Waiau. The airfield strikes aim
at the new hangar lines and aprons; the AA sites and craft routes moved with the shore. About 18,300 placements; the
slice atlas is 56 % full.

F. Ships in the new harbour. Curtiss moved to her X-22 point in the North Channel, which put the destroyers' sortie
route 19 m from her: each one bumped her, was knocked off the route, overshot the next turn and pinned itself on the
Waipio bank, and Farragut finally broke loose across Hospital Point and sank. The North Channel route is now planned
over the land raster for sea room (Curtiss passed 230 m to the east, 200–400 m off every shore), and `RouteAI` wheels
over for a turn R tan(θ/2) before the point and eases off ahead of sharp turns. Nevada's last few hundred metres
are scripted like her walk out of F-8 (`Scenario.warp` with a curved path from her own speed): she swings to port
and lies bow-on to the bank below Hospital Point, stern out into the channel at 140°. Before, a battleship holed and
slowed to 5 kn could not answer her rudder for the 90° hook onto the old beach point and stopped mid-channel.

G. Fixes found on the way. Land tiles left a hairline of water at their seams: normals saw the tile edge as a wall
(VoxelModel `openEdges` looks up the nearest voxel inside instead), and adjacent tiles left a pixel gap on the grid
(tiles are now one 5 m cell wider than their pitch, so neighbours overlap with identical content).

H. Verification. typecheck, `npm test` (17 pass), build. WebGPU: Hickam at 07:56 burning (flames, craters, pocks, GI
pools), a night fire at sea (GI on the water), Nevada aground at Hospital Point at 08:57; frozen tours of the Navy
Yard, Hospital Point, Ford Island, the Sub Base and tank farms, Pearl City, Aiea, Hickam. WebGL2: Hickam burning.
All with 0 page errors (default-renderer runs show the documented headless WebGPU→WebGL2 fallback warning).
Full fast-forward 07:50 → 10:02 (escort side): Utah and Oklahoma capsize, Arizona's magazines at 08:06, California
and West Virginia sunk, Nevada aground at Hospital Point at 08:56, Shaw lost in the floating dock at 08:58 (history:
her magazine at 09:30), Downes lost in Dry Dock 1, Oglala capsizes alongside the 1010 Dock at 09:52 — the historical
list; Dale, Farragut and Aylwin sortie with
no contact; 28 of 62 parked aircraft destroyed, 19 Japanese aircraft down. Submarine side, idle 15 min: the midget
survives. Midway: 7,000 s with no errors.

Follow-ups: the dark smoke puffs' four-step dither reads as a checkerboard at zoom ≳ 2; GI frame cost on a real GPU is
unmeasured; re-trace against OSM or the 1941 charts if the network ever allows; the Ward prologue and more historic
battles are M20.
