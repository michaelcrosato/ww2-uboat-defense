# M11 — Gameplay completion & tuning, dev-settings wiring audit, weather visuals

**Status:** see docs/PLAN.md · **Depends on:** M10 (works earlier too, but loot/mutators need it) · **Size:** large

## Goal
Fix every known gameplay issue, wire every declared dev setting, add weather visuals and theater
specials, and tune the arena so a mission plays well from both sides in 10–15 minutes.

## Read first
`docs/PLAN.md` (Known issues), `src/game/ai/uboat.ts`, `src/game/ai/escort.ts`, `src/game/mission.ts`,
`src/game/aircraft.ts`, `src/game/vessel.ts` (`submit`), `src/physics/hydro.ts` (`retune`),
`src/core/devSettings.ts`.

## A. Known issues
1. **U-boat transit AI** (`UboatAI.doTransit`): compute the boat's along-track `a` and cross-track `c`
   relative to the convoy estimate. If `a > 300` (ahead): move slowly to a station on the track's
   flank (`|c| ≈ 700–1000 m`, chosen side) at periscope depth and wait (low noise) until a target is
   in range → `setup`. If `a ≤ 300`: if dark or no escort within 2.5 km → surface and run ahead at
   full surface speed ("end-around"); else attack opportunistically whatever passes in range, or wait
   submerged for the next pass. Battery management: surface to recharge when safe.
2. **Escort AI**: drop `reacquire`/`investigate` when the contact error exceeds ~1200 m or after the
   timeout; hand back to station; cap hunters per contact (exists) and keep 1 escort always screening.
3. **Reinforcements**: handle the `reinforce` event in `Mission` (spawn N AI U-boats at the arena
   edge ahead of the convoy, join the wolfpack).
4. **Air patrols** from `arena.aircraft`: none / gap (a patrol every ~4 min for ~90 s, not over the
   mid-arena "air gap" third) / carrier (Swordfish every ~2 min) / heavy (always one aircraft up).
5. Searchlight + beam haze scale with darkness (no daytime beams); star shells pointless by day (AI
   only fires at night).
6. Islands: land material id (`MAT.LAND`) with its own lighting (no specular), collision already exists.
7. `fastForward` snaps the camera to the player afterwards.
8. Survivors loop: rescued counts reported in the result; AI escorts optionally rescue when no
   contacts nearby (setting-gated).

## B. Dev-settings wiring audit (generated 2026-10 — re-run the audit script in Notes before starting)
These keys are declared in `DEV_DEFS` but nothing reads them yet; wire each one:

| Key | Wire to |
|---|---|
| `display.hudScale` | HUD draw scale (2 = double-size pixel font and panels) |
| `camera.roll` | camera bob from the player's roll/pitch (`vessel.attitude()`) |
| `phys.waveForces` | `HullHydro.retune({ waves })` for every vessel (flat-water buoyancy when off) |
| `phys.buoyancy` | column counts per hull (coarse 6×2, normal 8×3, fine 12×4) at spawn |
| `phys.handling` | `retune` multipliers: authentic (accel 1, turn 1), arcade (2, 1.8), twitchy (3, 3) |
| `phys.heel` | `retune({ heelMul })` |
| `game.lootRate` | multiplier in `rollDrops` lootFind (M10) |
| `audio.master/sfx/ambience/music/chatter` | M8 audio engine (verify) |
| `controls.touch` | M9 touch overlay (verify) |
| `debug.colliders` | HUD overlay drawing each vessel's convex hull outline (from `hullPoints`) |
| `debug.buoyancy` | HUD dots at buoyancy columns colored by submerged fraction |
| `debug.sensors` | HUD circles: ASDIC/hydrophone/lookout ranges for the player, ASDIC beam wedges for all escorts |

Audit script (paste into a shell to list unwired keys):
```bash
python3 - <<'EOF'
import re,os
keys=re.findall(r"key: '([a-z]+\.[A-Za-z]+)'",open('src/core/devSettings.ts').read())
blob=''.join(open(os.path.join(r,f)).read() for r,_,fs in os.walk('src') for f in fs if f.endswith('.ts') and f!='devSettings.ts')
print([k for k in keys if "'"+k+"'" not in blob])
EOF
```

## C. Weather & theater visuals
- Rain: screen-space streaks in the HUD layer or particles + tiny random ripples (splats) on the sim;
  rain loop audio. Snow: drifting `PK.SNOW` particles around the camera. Fog: stronger haze + bigger
  light halos. Storm: lightning flashes (env already computes `lightning`) + heavy sea.
- Arctic: pack ice exists in the water shader (`uIce`); make ice floes also block ships (cheap: sample
  the same noise on the CPU in `Vessel.preStep` and add drag) or leave visual-only and document.
- US East Coast: coastline + city glow along one arena edge (a long low island strip with lamp
  voxels and a few strong warm lights) so ships are silhouetted.
- Lighthouse option (`arena.lighthouse`): island with a rotating beam (spot light + beam haze).

## D. Balance pass
Run 3 seeds per side with `fastForward` and record outcomes in Notes: the escort side should usually
lose 1–4 merchants against a 3-boat pack on defaults; the U-boat player should be able to sink 1–3
ships with a decent chance of being hunted. Tune AI skill/aggression defaults, torpedo damage, depth
charge lethal radius and ASDIC ranges accordingly (document every changed number).

## Acceptance
Audit script prints `[]`; screenshots for rain/snow/fog/storm/arctic/east-coast/lighthouse; balance
table in Notes; typecheck passes; 0 page errors.

## Commit
`Gameplay completion: AI fixes, air patrols, reinforcements, settings wiring, weather visuals`

## Notes (fill in when done)
