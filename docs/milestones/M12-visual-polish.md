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
