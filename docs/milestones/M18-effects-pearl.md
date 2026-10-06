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

## Sources (positions are estimates unless marked surveyed)
The container's network blocks every map service (OpenStreetMap, Overpass, USGS, NOAA, Esri) and the primary
history sites, so "1:1 against maps" was not possible. A research pass read search snippets instead: Wikipedia
infoboxes, HMDB markers, NPS and NHHC pages, the Pearl Harbor Aviation Museum, aviation.hawaii.gov (Hickam's 1941
runways), the FAA AIP, fortwiki (Fort Kamehameha's batteries), the Living New Deal (Lockwood Hall), Historic
Hawaii. Surveyed points used to correct the M17 shoreline: Arizona Memorial 21.36500 N 157.95000 W (the F-7 berth
is within 6 m), Arizona and West Virginia shore markers, the F-5 marker 21.36280 N 157.95410 W, the Utah memorial
21.36887 N 157.96207 W, the Navy Yard reference 21.35111 N 157.95694 W, Lockwood Hall 21.35423 N 157.94122 W, the
Ford Island runway reference 21.36489 N 157.95976 W, Hangar 79 21.3600 N 157.9617 W, the Hickam landmark point,
Fort Kamehameha and Batteries Jackson and Selfridge, the rail stations along Kamehameha Highway (Makalapa, Halawa,
Kalauao, Waiawa), the Waiau plant, Aiea Bay and the Pearl City and Waipio reference points. Dimensions: Drydocks 1
and 2 (1,002 × 138 ft, 1,000 × 147 ft), Hickam's runways (7,048 × 800 ft and three of 4,725, 4,025 and 4,630 ×
250 ft), the escape tower (136 ft), Hickam's water tower (171 ft), Ford Island's tower (158 ft, top unfinished on
7 December), the 26 tanks of the lower and upper farms (one painted as a building in each).

## Notes (fill in when done)
**Done.**

A. GPU effect particles (`src/render/fx.ts`). Game code bursts particles of eleven kinds (fire, ember, spark,
smoke, flash, water plume, debris, steam, flak, shock ring, dust) into a CPU staging buffer; each frame the
backend uploads the new runs into a ring of slots (65 536 on WebGPU, 16 384 on WebGL2) and integrates every live
slot: buoyancy that fades with age, drag, gravity, curl-noise turbulence, wind coupling, the water plane (sparks
die on it, debris floats). WebGPU does it in a compute pass (`webgpu/passes/fx.ts`), WebGL2 with transform
feedback between two buffers (`webgl2/fxGL.ts`), the same table of motion constants (`FX_MOTION`). One draw after
lighting into the HDR buffer with premultiplied blending: fire and sparks write no alpha and add light, smoke and
spray cover; a fireball puff slides from one to the other as it cools into smoke lit by the scene. Particles are
depth-tested against the G-buffer, sizes snap to buffer pixels and translucency is four dithered steps, so it stays
pixel art. Smoke kinds also go into the occluder map: smoke columns cast long shadows. The particle sim keeps game
time even when slow frames are skipped (its own `fxDt`, substeps of ≤ 0.1 s): the frame-skip guard had capped it to
a quarter speed headless.

B. Post and light. Shockwave rings (a radial displacement band), heat haze above fires (noise shimmer in a rising
plume), a chromatic split on big flashes, light shafts (a half-resolution radial blur of the bright buffer toward
up to four explosion glows), camera trauma feeding the camera shake. Heightmap ambient occlusion in both lighting
passes (`light.ao`, 8 taps of the occluder map): contact shadows at a hull's foot, under bridges, between the
nested destroyers, in streets between buildings. All of it on dev settings (Effects group: particles, density,
intensity, distortion, haze, chroma, shafts).

C. Recipes (`src/game/effects.ts`). Surface explosions: a flash, a fireball that rolls into smoke, embers on
turbulence, stretched sparks, debris that glows and floats, a water plume (or, ashore, earth and a dust skirt), a
shock ring, a glow for the shafts, camera trauma; the CPU particles stay as a lighter base. Underwater blasts: a
dome bursting into a column, a ring of spray racing out, hanging steam. Big guns' muzzle flashes push a small
shockwave. `magazineBlast` (Arizona, 08:06): a white flash, a fireball climbing hundreds of metres, burning
debris, two shockwaves across the harbour, a smoke column that stands for a minute. `flakBurst`: black 5-inch
bursts with an orange core. `fireEmit`: every ship fire and fire ashore streams flames, embers and a smoke column
and registers a heat-haze source (only fires in view get the haze slots).

D. The shoreline (`PEARL_LAND` in `historic/pearlDetail.ts`). The M17 outline put Kalauao and Waimalu stations
in the water (East Loch's north shore lay ~1 km too far north), the Pearl City reference point in Middle Loch, the
northern half of Waipio peninsula under water, Makalapa, the main gate and both tank farms in a strip of water
east of the Navy Yard, and Southeast Loch did not exist. Corrected: the north shore now runs Aiea Bay → Kalauao →
Waimalu → Waiau; Pearl City is wider on its Middle Loch side; Waipio reaches the head of Middle Loch; the land
east of the yard is filled; Southeast Loch is carved between the yard and the Sub Base. Ford Island had the right
area (441 acres) in the wrong place: the east seawall now stands ~35 m inboard of Battleship Row's inboard hulls
(the shore markers), the north-west shore by the Utah memorial; Detroit, Raleigh, Utah and Tangier moved ~65 m
north-west so the Utah memorial stands in front of her hull.

E. Ashore (`historic/pearlDetail.ts`, art in `src/art/shoreArt.ts`, 1 m voxels for buildings, 0.5 m for vehicles,
craft and aircraft). Roads (Kamehameha Highway along its stations, the yards' and towns' street grids, Ford
Island's ring road), the OR&L railway, runways, aprons, lawns and parade grounds are painted into the ground
grid once, then the buildings keep off them. Navy Yard: Drydock 1 with Pennsylvania, the new Drydock 2 (flooded)
across the approach pier, the hammerhead crane beside No. 1, portal cranes on the docks and the 1010 Dock, a grid
of monitor-roof, sawtooth and gable shops and storehouses with trucks and cars along them, Power Plant 149 with
three smoking stacks, the coal docks with Bobolink, Vireo, Turkey and Rail nested alongside, the Marine Barracks
round their parade ground, officers' quarters, Merry Point's tanks. Hospital Point: the Naval Hospital (two
storeys, a main block with three wards behind it and a portico on the channel), its lawn, tennis courts and staff
quarters. Submarine Base: Lockwood Hall, the striped escape tower and the chapel beside it, barracks and shops,
three piers in Southeast Loch with PT-20 to PT-25 and YR-20 at S-13; the lower (16) and upper (10) tank farms on
their berms. Ford Island: the runway, apron, Hangars 37, 79 and 54, Hangar 6 and the seaplane ramps, fourteen
PBYs, the unfinished tower, barracks, Nob Hill's officers' houses, the chiefs' bungalows, its fuel tank, mooring
quays inboard of the battleships. Hickam: the main runway and the three smaller ones, the apron, the hangar line
(Hangar 35 and the paired hangars, the operations building), 26 B-18s, 12 B-17s and 12 A-20s wingtip to wingtip,
Hale Makai (spine and wings), the parade mall and water tower, the housing. Fort Kamehameha's batteries and
quarters. Pearl City (streets of bungalows, the Pan Am base and pier), Aiea (houses round the sugar mill and its
chimney), Halawa, the Waiau plant. Trees by district: palms on the bases and shores, shade trees in towns,
kiawe in the scrub. About 14 000 placements, culled round the view in 250 m cells (`World.addScenery`, `World.view`).

F. Life (`historic/harborLife.ts`). 380 cars, trucks and buses on the roads (keeping right, turning at road
ends); launches on the ferry and liberty runs, whaleboats and a launch along Battleship Row from 08:10, Hoga
leaving the 1010 Dock at 08:45 and YG-17 from 08:25 playing fire hoses on the burning ships (water arcs from
the GPU particles), each under way pushing a wake into the water sim and giving way to ships; boats moored at
the piers; chimney smoke.

G. The raid ashore (`AirRaid`). Land AA: machine-gun pits at the Navy Yard (Marines, from 08:12), the Sub Base and
Ford Island (07:58–08:00), Hickam's Battery D of the 97th Coast Artillery and Fort Kamehameha's 3-inch guns
(08:12–08:25) fire tracers and flak and shoot planes down with the ships' AA rules. Bombs ashore wreck the parked
aircraft within reach (burnt-out models) and set hangars and barracks burning; Zeros strafe airfields (dust, a
chance to wreck a plane). The airfield strikes aim at the hangars and the parked rows instead of anywhere within
a circle.

H. Fixes found on the way. The land colliders had 2 m seams: every merged box was shrunk by a metre on every
side (slack for hulls lying alongside a quay), so neighbouring boxes left a channel, and the idle midget (1.85 m
beam) slipped into one north of Aiea and slid through the land and out past the raster's edge. Slack now goes
only on sides that face open water along their whole length; the land is watertight (Midway's atoll too). With
the north-west berths in their surveyed places the player's midget, left at Slow ahead on its old heading, rammed
Raleigh and Detroit within six minutes: it now starts creeping (10 %) on a course along the channel toward East
Loch, the way round Ford Island to Battleship Row, and a boat left alone noses into a bank unharmed.

I. Verification. typecheck, `npm test` (17 pass), build. WebGPU: explosion kinds and recipes (arena, live), the
magazine blast in the scenario, Hickam at 07:56 with wrecks burning, Battleship Row at 08:26 (Oklahoma capsized,
YG-17's hose, a whaleboat), the Navy Yard, Hospital Point, Ford Island, the Sub Base, Pearl City, Aiea, Hickam
(frozen tours), Midway and the title screen; WebGL2: explosions and the Navy Yard; all with 0 page errors.
Full fast-forward 07:50 → 10:02 (seed 7): Utah and Oklahoma capsize, Arizona's magazines at 08:06, West Virginia,
Shaw and Oglala lost, Nevada beached at Hospital Point, 23 Japanese aircraft down (history: 29), 26 of the 57 parked
aircraft destroyed and 11 buildings set burning (before the strikes aimed at the hangars and parked rows: 3 of 57).
Submarine side, idle: the midget creeps up the channel, stops against the north bank at 08:40 and lies there
unharmed until the raid ends at 10:02 (M17's idle boat also survived).

Follow-ups: re-trace the shoreline and every estimated layout against OSM and the 1941 charts once the network
allows; burnt-out building models; effect particles are skipped by `fastForward`; real-GPU frame times; the
Pearl Harbor prologue with USS Ward (06:37) is in M19.
