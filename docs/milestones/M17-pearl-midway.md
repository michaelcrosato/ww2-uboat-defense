# M17 — The navies at true scale: Pearl Harbor and Midway

**Status:** see docs/PLAN.md · **Depends on:** M16 · **Size:** large

## Goal
User: "Create to scale all of the ships in the navy. Start by recreating the Battle of Midway and Pearl Harbor, to
scale, historically accurate. A slight departure from our current plan, but our game seems ideal for this."

## Read first
`src/game/historic/` (all of it: `navy.ts`, `airRaid.ts`, `scenario.ts`, `land.ts`, `pearlHarbor.ts`, `midway.ts`,
`index.ts`), `src/art/navyArt.ts`, `src/game/mission.ts` (the `scenario` hook), `src/game/vessel.ts` (`moored`,
`leakControl`, `fragment`, the settle-on-the-bottom rule), `src/physics/physics.ts` (`addLandRects`, `addSeabed`).

## Acceptance
- USN (Dec 1941 / Jun 1942) and IJN (Jun 1942) classes at true length, beam and draft, recognisable from above.
- Pearl Harbor on the real harbour with the fleet at its berths and the two waves; Midway with the Kido Butai,
  Nautilus, Arashi and the US strikes. Both sides playable in each, with objectives and endings.
- typecheck, `npm test`, build; WebGPU screenshots with 0 page errors; fast-forwards of both battles and sides.

## Sources (positions are estimates)
Berths and shorelines: lat/lon from three surveyed anchors (Arizona Memorial 21.36500 N 157.95000 W, Pier F-5
21.36280 N 157.95410 W, the Ford Island centroid) and the 1941 berthing plans; expect ±150 m near Ford Island,
±300–500 m elsewhere. Timelines and orders of battle: the ships' action reports (Monaghan, Curtiss, Nevada,
Arizona) as collected by the Pearl Harbor History Associates and HyperWar, the NHHC chronologies, the accounts of the Midway carrier battle at pacificeagles.net and the National WWII
Museum, ussnautilus.org and pacificwrecks.com. Dimensions: navweaps, uboat.net warship pages, NavSource summaries.
The research subagent could only read search snippets (the network blocked the primary sites), so several
values carry "(est)" in the code comments.

## Notes (fill in when done)
**Done.**

A. Ships at true scale (`src/game/historic/navy.ts`, art in `src/art/navyArt.ts`). USN December 1941:
Nevada, Pennsylvania, Tennessee and Colorado battleship classes, Utah (target ship, timbered deck), Omaha,
Brooklyn and New Orleans cruisers, Farragut, Mahan and Wickes destroyers, Vestal, Neosho, Oglala, Curtiss,
Yorktown, the Narwhal-class Nautilus and the Type A midget submarine. IJN June 1942: Akagi, Kaga, Soryu,
Hiryu, Kongo, Tone, Nagara, Kagero and Yugumo. Length, beam and draft are the reference values (the
research corrections applied: Omaha draft 6.1, New Orleans 5.9, Vestal 142 × 18.3, Oglala 117.7 × 15.9 × 4.8
at 14 kn, Tone beam 18.5). Art is parametric (`warshipArt`, `carrierArt`): turrets by type and position, cage,
tripod and pagoda masts, carrier islands on the correct side, down-curved IJN funnels, flight-deck markings,
hinomaru; ships over 150 m use 1 m voxels so the atlas holds them. Six warplanes (B5N, D3A, A6M, SBD, TBD,
F4F) with their loads. `?scene=pacific` lines the classes up. The sides stay mechanical (`allied` = surface,
`axis` = submarine); `SpawnOpts.side` puts the IJN on `allied` at Midway. Contacts show hull types
("Battleship", "Carrier", "Midget submarine"…).

B. Engine pieces.
- `LandMap` (`historic/land.ts`): surveyed lat/lon polygons → 5 m raster → flat voxel tiles (ground plus a
  layer of lots, sheds, hangars, houses and trees) and merged static boxes (`Physics.addLandRects`), so art
  and shore agree. Berths are carved out of the mask: Pennsylvania lies in the slot of Drydock No. 1.
- Moorings (`Vessel.moored`, a damped spring; the player casts off by ringing for speed once the scenario
  allows it), `w.seabed` (a harbour bottom; wrecks stay; a flooded hull resting on it counts as sunk),
  `Vessel.leakControl` (Sunday-morning damage control at Pearl), scripted capsizes (`Vessel.capsize`,
  kinematic roll about the bilge to 150°: the buoyancy columns give a wide hull too much righting moment and a
  hull on the bottom cannot pivot under forces), counterflooding, walking a ship off her berth (`warp`),
  a shore pilot for every AI ship in a harbour.
- Capital ships (`cls.role`): torpedo flooding scales with size (bulges, many compartments), deck bomb
  bursts flood a fifth as much as hits below the waterline, no hp-based break-up or "structural failure"
  flooding (they burn for hours, sink by flooding or a magazine). Fire power is capped and each ship's fires
  share one light (a burning battle line had washed the screen out).
- `AirRaid` (`historic/airRaid.ts`): scheduled elements (torpedo, dive, level, fighter; ship or airfield
  targets), the historical hits assigned to particular planes when the element launches (shooting that
  plane down cancels its hit), misses that stay misses, torpedo drops only over a clear run of water, AA from
  every armed ship (`cls.aa`, crews closing up over the first minutes at Pearl), Arizona's magazine, fires
  ashore. Altitudes are compressed on screen; level bombs take their real fall time from 3,000 m.
- `Scenario` base (`historic/scenario.ts`): timeline on the historical clock, objectives in the coach panel
  (tagged with the clock), a tally in the top-left panel, endings. `arena.scenario` (+ `ARENA_SPEC`), a
  3072² slice atlas for scenarios, title screen → Historic Battles (`?menu=battles`).
- `fastForward` now clears particles, flashes and transient lights that the jump spawned but never aged.

C. The battles (seed 7, idle player, `?freeze=1` fast-forwards).
- Pearl Harbor, escort side (USS Monaghan), 07:50–10:02: torpedo planes from both sides of Ford Island at
  07:56–08:02, Oklahoma and West Virginia sink by 08:00 and Oklahoma rolls over at 08:04, Utah at 08:07;
  Arizona's magazine at 08:06; Nevada walks off F-8 at 08:40 and beaches at Hospital Point at 09:05
  (historically 09:10); second wave from 08:55; Shaw and Downes lost; Oglala rolls over at 09:52. Damaged
  and afloat: Tennessee, Maryland, California, Raleigh, Helena, Curtiss, Pennsylvania. 25 aircraft shot
  down (historically 29). Monaghan casts off on the first ring for speed after general quarters (08:00).
  The midget surfaces at 08:40 and fires wide of Curtiss and of Monaghan, as the reports say.
- Pearl Harbor, submarine side: the midget starts in the North Channel at periscope depth; Monaghan
  (AI) gets under way at 08:27 and lies listening mid-channel; the battle ends at 10:02, or four minutes
  after the second torpedo.
- Midway, escort side (Arashi), 08:10–10:35: the AI Nautilus closes submerged and fires at the force
  (seed 7: one hit in four; seed 42: two duds on Hiryu, the Mark 14 failing as it did against Kaga), the
  three torpedo squadrons die against the combat air patrol without hits (35 aircraft), Arashi is ordered
  back at 09:55, the dive bombers hit Kaga (4), Soryu (3) and Akagi (1) at 10:22–10:26; the carriers burn but
  float at 10:35; Hiryu is untouched.
- Midway, submarine side (Nautilus): an idle boat survives the hunt and the battle ends at 09:55 when Arashi
  breaks off ("withdrew"), as historically.

D. Compressions and liberties (documented in code): the Kido Butai keeps a box about 4 km across with the
screen 4.5 km out (sources: 4–10 km); its evasive legs keep it within a submarine's reach; Tangier is drawn
with the Curtiss hull; Shaw's floating dock is not drawn; the dry dock is flooded; Pearl's berth and shore
positions are estimates (±150 m near Ford Island); the AI destroyers inside the harbour lie at a listening
point instead of patrolling (the North Channel is narrower than their turning circle at speed).

E. Verification: typecheck, `npm test` (17 pass), build; WebGPU screenshots with 0 page errors (Battleship
Row at 07:50 and 08:15, Kaga at 10:22, battles menu, phone layout), a WebGL2 smoke shot (Midway, Nautilus),
the convoy arena and `?scene=pacific` unchanged.

F. Follow-ups (M18): more battles on this framework; a Ward prologue (06:37); Wheeler/Kaneohe and the
airfields' parked aircraft; the Midway afternoon (Hiryu's strikes on Yorktown, Hiryu hit at 17:03);
escort-AI behaviour in confined waters; damaged ships leaking oil slicks in harbour.
