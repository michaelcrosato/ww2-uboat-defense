# M8 — Procedural audio engine + game integration

**Status:** see docs/PLAN.md · **Depends on:** nothing for the engine; integration touches `src/app.ts` · **Size:** large

## Goal
All sound synthesized with Web Audio (no audio files, no deps): spatial one-shots, environment loops,
adaptive music, a submerged-listener mode, wired to world events and dev volume settings.

## Read first
`src/audio/dsp.ts` and `src/audio/mixer.ts` (written by an interrupted agent: review them first — keep
what is sound, fix or rewrite the rest), `src/core/devSettings.ts` (`audio.*` keys),
`src/game/world.ts` (`WorldEvents`), `src/input/input.ts` (`onGesture` for audio unlock).

## Engine API — `src/audio/audio.ts` (export singleton `audio` and class `AudioEngine`)
```ts
type SoundId = 'asdic_ping' | 'asdic_echo' | 'hydrophone_contact' | 'depth_charge_splash' | 'depth_charge_boom' | 'underwater_boom_far'
  | 'surface_explosion' | 'torpedo_hit' | 'torpedo_launch' | 'torpedo_run' | 'gun_heavy' | 'gun_light' | 'shell_whistle' | 'shell_splash'
  | 'hedgehog_launch' | 'hedgehog_hit' | 'star_shell_pop' | 'hull_creak' | 'hull_groan' | 'crush_rumble' | 'dive_alarm' | 'telegraph_bell'
  | 'blow_ballast' | 'flood_vents' | 'ramming_crunch' | 'metal_impact' | 'splash_small' | 'splash_big' | 'wave_slap' | 'loot_drop'
  | 'loot_legendary' | 'level_up' | 'ui_click' | 'ui_hover' | 'ui_back' | 'ui_error' | 'contract_complete' | 'radio_static' | 'morse_burst'
  | 'aircraft_pass' | 'whistle_signal' | 'bubbles' | 'decoy_fizz' | 'klaxon' | 'ship_sinking' | 'fire_crackle';
type LoopId = 'sea' | 'rain' | 'wind' | 'engine_steam' | 'engine_diesel' | 'engine_electric' | 'cavitation' | 'fire' | 'underwater' | 'hydrophone_noise';
interface PlayOpts { x?: number; y?: number; vol?: number; pitch?: number; delay?: number; doppler?: number; underwater?: boolean }
interface LoopHandle { set(p: { vol?: number; pitch?: number; x?: number; y?: number; filter?: number }): void; stop(fade?: number): void }
class AudioEngine {
  unlock(): void;                       // safe to call repeatedly; called on the first user gesture
  readonly ready: boolean;
  setListener(x: number, y: number, zoom?: number): void;
  setUnderwater(amount: number): void;  // 0..1 muffles everything (player U-boat below periscope depth)
  play(id: SoundId, opts?: PlayOpts): void;
  loop(id: LoopId, opts?: PlayOpts): LoopHandle;
  setMusic(state: 'off' | 'menu' | 'calm' | 'tension' | 'combat' | 'victory' | 'defeat'): void;
  setEnvironment(e: { seaState: number; rain: number; wind: number; night: number }): void;
  update(dt: number): void;
}
```
Requirements: never throw without an AudioContext; voice cap (~48); volumes follow `audio.master/sfx/
ambience/music` live and `audio.chatter` gates radio/morse/whistles; distance attenuation (big booms
audible at 2–3 km) and stereo pan; heavy explosions = low sine thump + filtered noise + generated
reverb tail. `asdic_ping` = the iconic pure ~1.2–1.6 kHz ping with long watery decay; `asdic_echo`
pitch follows `doppler` (>1 closing). Crash-dive klaxon, telegraph bell, hull creaks/groans below test
depth. Loops: sea varies with sea state, steam turbine whine with speed, diesel chug, electric hum,
cavitation hiss, underwater pressure ambience, hydrophone hiss. Music: minimal, moody, period-
flavoured procedural stems (detuned saw pads, timpani hits in combat, slow modal menu melody,
heartbeat pulse for tension), 3 s crossfades, cheap on CPU. No copyrighted melodies.

## Lab + self-test
`src/audio/lab.html` + `lab.ts`: buttons for every sound/loop, plus an automated test that renders
each SoundId (and ~1.5 s of each LoopId) through an `OfflineAudioContext` using the same synth code
(synth functions accept any `BaseAudioContext` + destination), checks no NaN, RMS above a small
threshold, peak ≤ 1.0 after the limiter; `window.__audioTest` resolves to `[{ id, rms, peak, ok }]`.
Run: `node tools/shot.mjs --url /src/audio/lab.html --wait 15000 --eval "window.__audioTest" --out check-output/audio-lab.png`.

## Game integration (`src/game/audioBridge.ts`, created by App per mission)
- `input.onGesture` → `audio.unlock()`; listener follows the camera center; `setUnderwater` from the
  player U-boat keel depth (> 15 m → 1).
- Events → sounds: `ping` (player's own pings loud, others by distance; U-boat player hears pings
  hitting the hull louder), `echo` (doppler from the echo), `gunFired` (`gun_heavy` ≥ 100 mm else
  `gun_light`), `dcDrop` (`depth_charge_splash`), `explosion` (underwater → `depth_charge_boom` /
  far variant by distance; surface → `surface_explosion`), `torpedoFired` (`torpedo_launch`; a
  `torpedo_run` loop that follows torpedoes near the listener), `torpedoHit` (`torpedo_hit` or
  `metal_impact` for duds), `sunk` (`ship_sinking`), `hullCreak` (`hull_creak`/`hull_groan`),
  `lootPicked` (`loot_drop` or `loot_legendary` for legendary/unique), `starShell` (`star_shell_pop`),
  `splash` (`splash_small`/`big`), crash dive ability → `dive_alarm`, telegraph changes →
  `telegraph_bell`, radio `message`s with kind `radio` → `radio_static`.
- Loops: player engine (steam for escorts; diesel surfaced / electric submerged for U-boats) with
  pitch from speed, cavitation when the sub cavitates, sea/rain/wind from the environment, fires near
  the listener. Music state: calm by default, tension when enemy contacts are near or pings heard,
  combat on recent explosions/firing, victory/defeat at mission end, menu outside missions.

## Acceptance
Lab self-test: every sound ok, 0 console errors; in game `/?hour=23` with the debug log showing
audio events mapped (add `?dev.debug.perf=true` line "voices N"); `npm run typecheck` passes.

## Commit
`Procedural audio engine, lab self-test and game integration`

## Notes (fill in when done)
