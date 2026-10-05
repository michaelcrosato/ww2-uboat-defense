# M12 — Visual polish, ship art expansion, performance

**Status:** see docs/PLAN.md · **Depends on:** M6 (both backends final) · **Size:** medium–large

## Goal
Make it look like rich pixel art at every zoom level and theater, add the missing vessel art, and
hit 60 fps at 1080p on a mid-range GPU with WebGPU (and a reasonable rate on WebGL2).

## Read first
`src/art/shipBuilder.ts`, `src/art/ships.ts`, the water pass (both backends), `src/game/theaters.ts`,
`src/render/common/frameUniforms.ts` (from M3).

## Steps
1. **Water look-dev**: per theater and sea state 1/4/7, day/dusk/night — reduce the streaky long-swell
   banding (blend tone from slopes + crest compression more than raw height, add large-scale
   "cat's paw" wind patches), check foam lace density, moon glitter path, bioluminescence color.
   Keep GLSL and WGSL in sync; run the M6 compare after every shader change.
2. **Ships**: more deck detail and contrast (hatches, vents, rails, boats, guns readable at zoom 1),
   pennant-style hull markings on the tilted sides, rust streaks; new classes: Liberty ship, ore
   carrier, escort carrier (with Swordfish on deck), rescue ship, armed trawler, Black Swan sloop.
   Add them to `VESSELS` and the convoy/escort pools (escort carrier enables the carrier air patrols).
3. **Damage & sinking**: progressive damage decals, listing smoke, and optional "breaking in two":
   when a hull's HP drops below −60 % during sinking, replace the body with two bodies (fore/aft)
   using the existing slice `clipX0/clipX1` instance fields and half the buoyancy columns each.
4. **Aircraft art** at higher detail; muzzle flashes and tracers readable at night.
5. **Performance**: profile both backends (`debug.perf`), cap shadow ray steps by light importance,
   cull stack instances outside the view (+ margin for shadows), reduce particle overdraw; document
   numbers for the default arena at 1280×720 and 1920×1080 in Notes. Tune the `performance` preset.

## Acceptance
A gallery of screenshots (theaters × time of day, zoom 0.5/1.2/3, both backends) in
`check-output/gallery/`; M6 compare still passes; frame-time table in Notes.

## Commit
`Visual polish: water look-dev, new ship classes, damage/breakup, performance`

## Notes (fill in when done)
**Done.** WebGPU is the reference for every check below; per the user (mid-M12) WebGL2 is a best-effort
fallback — it still compiles, runs and got every shader change, but no further parity or performance work.

A. Water look-dev (GLSL + WGSL identical)
- Tone: the raw swell height is compressed (`hn / (1 + |hn|)`, hn = height / 0.8·Hs) so long swells no
  longer paint broad streaky bands; large drifting cat's-paw patches (`fbm(p·0.006 + wind·t·0.0035)`) scale
  the capillary roughness (glassy in light airs, rough under gusts) and nudge the tone ±3 %.
- `Ocean` folds wind components shorter than 6 m back to 4.5–6 m (amplitude ≤ 0.12/k): at Bf 1 they were
  sub-pixel and read as per-pixel noise. CPU buoyancy uses the same component list.
- Arctic ice: domain-warped ragged floes with bright rims (were round polka dots); still visual only.
- Moon glitter: an orthographic view has a single view vector, so specular from it can't form a path;
  moon glints on water use a virtual observer mirrored from the moon (Blinn exponent 900), which lays a
  glitter patch around the view centre that stretches toward a low moon.
- Night: ambient floor 0.07/0.085/0.12 (visual only); light bands quantize only the direct light, the flat
  ambient stays smooth (no dither speckle in dark scenes or on the coarse 3 m coast voxels).

B. Ships (`shipBuilder.ts` helpers `hullNumber`, `vent`, `carley`, `scramblingNets`, `parkedBiplane`)
- Pennant numbers on the vertical hull sides (D27 destroyer, K19 corvette, K95 frigate, U45 sloop, T27
  trawler, D12 carrier; readable from zoom ≈ 3), vents, Carley floats, scrambling nets, darker deck lines.
- New classes in `VESSELS`: `sloop` (Black Swan, sold at 24,000 from level 10, arena option), `trawler`
  (armed trawler, arena option), `escortcarrier` (hangar, flight deck, two lifts, island, two parked
  Swordfish), `liberty`, `orecarrier`, `rescue`. `merchantPool(year)` (Liberty ships from 1942) and
  `escortPool(year)` feed the convoy and AI escorts.
- The escort carrier sails astern on the centre column when `arena.aircraft = carrier` (from 1941); air
  cover launches from her deck and stops (radio message) if she is lost; U-boat AI counts her as a convoy
  target. A rescue ship joins convoys of ≥ 6 merchants (`RescueAI`: drops out for lifeboats within
  2.5 km, then rejoins; 45 survivors picked up in the test run).

C. Damage & sinking
- Up to two hit centres per ship (`Vessel.recordHit`) feed the stack shaders (`STACK_FLOATS` = 24, `hits`):
  scorched plating and shell holes cluster around the hits, light grime elsewhere; listing ships trail
  wound smoke; waterline foam is limited to hull sides (no speckle on U-boat casings).
- `game.breakup` (default on): a hull driven below −60 % HP splits at the worst hit. The fore half becomes
  a dead fragment `Vessel` (same pose, clip range `clipX0/X1`, its share of buoyancy columns, mass by
  volume, centre of mass shifted toward the cut, local flooding near the cut); both halves get charred
  break edges and founder (pull-under after 20 s) and are removed once fully submerged.

D. Aircraft & night combat
- Swordfish, Catalina and Liberator rebuilt (`roundel`, `prop`, `seaScheme`). Airborne stacks (flag 16)
  write no occluder (they cast tower streaks); instead a flattened decal shadow is offset along the sun
  (or a moon above 0.12 intensity) when it is above ~9° and the aircraft is within 600 m.
- Tracers are short glowing streaks (a dot every 1.6 m over 0.05 s of flight, hot head) instead of dots.
- `?scene=fleet`: every class lined up, AI frozen, three frozen aircraft (art review).

E. Performance (both backends unless noted)
- Stacks and particles are culled to the occluder window (view + 180 m shadow margin): 779 → 69 slice
  instances, ~800 → ~70 particles in the default arena.
- Shadow rays: sun/moon marches stop where the ray climbs past the tallest occluder or smoke
  (`occTop` from the packers; steps shrink with the ray); point lights get a step budget from their CPU
  importance rank (top 4 full, others √score share ≥ 30 %) and their attenuation at the pixel; contributions
  < 0.004 skip the march.
- Water parallax: one cheap step on the undisplaced swell + one exact step instead of three exact ones
  (identical image within 0.004/255 even at sea state 7, zoom 3).
- Stack fragments above the highest possible crest (`seaTop`) skip the per-fragment swell evaluation.
- `display.particles` (new) thins smoke/spray/debris; the cinematic/balanced/performance presets now set
  the same 12 keys (switching never leaves another preset's values behind); performance drops water
  parallax and spawns 60 % of cosmetic particles.

Frame times: headless Chromium, **SwiftShader** (CPU-emulated GPU) on a 4-core VM, internal 640×360,
mean frame interval over 12 s, seed 7, 13:00, balanced preset unless noted. Absolute numbers say nothing
about a real GPU (none is available here); they show relative cost. CPU: 0.34–0.39 ms per 60 Hz
simulation step with 17 vessels; ~4 ms render + HUD per frame.

| Scene | Backend | 1280×720 before → after | 1920×1080 before → after |
|---|---|---|---|
| Default arena, live | WebGPU | 507 → 485 ms | 525 → 497 ms |
| Default arena, live | WebGL2 | 701 → 630 ms | 742 → 646 ms |
| Default arena, frozen (no sims) | WebGPU | 336 → 301 ms | — |
| Default arena, frozen (no sims) | WebGL2 | 535 → 446 ms | — |
| Default arena, performance preset | WebGPU | — | 315 ms |
| Default arena, performance preset | WebGL2 | — | 434 ms |

WebGPU pass split before the changes (timestamp queries, 1280×720): sims 167, occluder 50, under 63,
G-buffer 446, lighting 222, present 47 ms; water parallax alone was ~180 ms of the G-buffer and sun
shadows ~57 ms of lighting.

F. UI known issues
- `display.hudScale` Large: the HUD canvas has its own whole-number device-pixel scale (S+1, ≥ 4/3 S)
  instead of a half-size 320×180 buffer; the ability bar steps right of the status panel (and depth gauge)
  and the FPS line moves above it when the HUD is narrow.
- Touch overlay: the HUD's ability bar hides while the finger-sized touch buttons show glyph, cooldown
  seconds and charges.
- Skill tree: minimap (click/drag to jump), legend overlay, larger minimum node size, two-column layout
  down to 640 px wide (800×600 shows the node details again).
- Headline font: Linux narrow faces added to the fallback chain (headless still falls back to sans).

G. Slice atlas (`SliceAtlas`): skyline bottom-left packing (≈ 82 % efficient, the shelves wasted ~30 %),
`reset()` at every mission start (no build-up over a session; islands cached by name used to keep a
previous mission's radius), and an overflow now drops a model's top layers with a console warning
instead of throwing. The US East Coast reuses four coast chunk models: with the new classes it
overflowed the atlas and the mission failed to start. Fill with everything at once (24 merchants of
every class, carrier, 8 + 8 warships, lighthouse, 1943): 80 % (89 % on the US East Coast).

H. Verification: `npm run typecheck`, `npm test` (17 pass), `node tools/compare.mjs` passes at 13:00
and 23:00 (mean 0.136/255 at night) after every shader change; `tools/shot.mjs` gained an `until:<js>`
step (wait for a page condition, e.g. `until:window.__lookdevDone`).
