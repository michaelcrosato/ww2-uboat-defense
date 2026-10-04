// Every experimental knob in the prototype. The Dev Settings menu is generated from this list,
// values persist in localStorage, and systems subscribe to the keys they use.

import { ConfigStore, opts, type Preset, type SettingDef } from './config';

const pct = (v: number) => Math.round(v * 100) + '%';

export const DEV_DEFS: SettingDef[] = [
  // ---------------------------------------------------------------- Display
  { key: 'display.pixelScale', group: 'Display', label: 'Pixel size', type: 'select', def: 'auto',
    options: opts(['auto', 'Auto (target height)'], ['1', '1x'], ['2', '2x'], ['3', '3x'], ['4', '4x'], ['5', '5x'], ['6', '6x']),
    help: 'How many screen pixels each game pixel covers. Auto picks a whole number that gives roughly the target height.' },
  { key: 'display.targetHeight', group: 'Display', label: 'Auto target height', type: 'range', def: 360, min: 180, max: 720, step: 10, unit: 'px' },
  { key: 'display.showFps', group: 'Display', label: 'Show FPS', type: 'bool', def: true },
  { key: 'display.vignette', group: 'Display', label: 'Vignette', type: 'range', def: 0.35, min: 0, max: 1, step: 0.05, fmt: pct },
  { key: 'display.grade', group: 'Display', label: 'Color grade', type: 'select', def: 'theater',
    options: opts(['theater', 'Theater palette'], ['neutral', 'Neutral'], ['newsreel', 'Newsreel (sepia)'], ['technicolor', 'Technicolor'], ['uboat', 'Red battle lights'], ['mono', 'Monochrome film']) },
  { key: 'display.scanlines', group: 'Display', label: 'CRT scanlines', type: 'range', def: 0, min: 0, max: 1, step: 0.05, fmt: pct },
  { key: 'display.grain', group: 'Display', label: 'Film grain', type: 'range', def: 0.15, min: 0, max: 1, step: 0.05, fmt: pct },
  { key: 'display.renderer', group: 'Display', label: 'Renderer', type: 'select', def: 'auto',
    options: opts(['auto', 'Auto'], ['webgpu', 'WebGPU'], ['webgl2', 'WebGL2']),
    help: 'WebGPU with WebGL2 fallback; change needs reload.' },
  { key: 'display.weather', group: 'Display', label: 'Rain & snow effects', type: 'bool', def: true },
  { key: 'display.hudScale', group: 'Display', label: 'HUD text size', type: 'select', def: '1', options: opts(['1', 'Normal'], ['2', 'Large']) },

  // ---------------------------------------------------------------- Camera
  { key: 'camera.tilt', group: 'Camera', label: 'Camera tilt', type: 'range', def: 24, min: 0, max: 50, step: 1, unit: '°',
    help: '0 = straight down. Tilting reveals hull sides and superstructure height (sprite stacking).' },
  { key: 'camera.zoom', group: 'Camera', label: 'Default zoom', type: 'range', def: 1.2, min: 0.2, max: 4, step: 0.05, unit: 'px/m' },
  { key: 'camera.follow', group: 'Camera', label: 'Follow stiffness', type: 'range', def: 3.5, min: 0.5, max: 12, step: 0.5 },
  { key: 'camera.lookAhead', group: 'Camera', label: 'Look ahead', type: 'range', def: 0.35, min: 0, max: 1, step: 0.05, fmt: pct,
    help: 'Shift the view toward where you are heading / aiming.' },
  { key: 'camera.shake', group: 'Camera', label: 'Screen shake', type: 'range', def: 1, min: 0, max: 2, step: 0.1, fmt: pct },
  { key: 'camera.roll', group: 'Camera', label: 'Ship motion sickness', type: 'bool', def: false,
    help: 'Camera bobs with your own ship\'s roll and pitch.' },

  // ---------------------------------------------------------------- Water
  { key: 'water.swell', group: 'Water', label: 'Ocean swell (Gerstner)', type: 'bool', def: true },
  { key: 'water.waveCount', group: 'Water', label: 'Wave components', type: 'range', def: 12, min: 2, max: 16, step: 1 },
  { key: 'water.choppiness', group: 'Water', label: 'Choppiness', type: 'range', def: 0.6, min: 0, max: 0.95, step: 0.05 },
  { key: 'water.ampScale', group: 'Water', label: 'Wave height scale', type: 'range', def: 1, min: 0, max: 2.5, step: 0.05, fmt: pct },
  { key: 'water.parallax', group: 'Water', label: 'Wave displacement (tilted view)', type: 'bool', def: true },
  { key: 'water.detail', group: 'Water', label: 'Capillary ripples', type: 'range', def: 0.5, min: 0, max: 1.5, step: 0.05, fmt: pct },
  { key: 'water.crestFoam', group: 'Water', label: 'Whitecaps', type: 'range', def: 1, min: 0, max: 2, step: 0.05, fmt: pct },
  { key: 'water.contrast', group: 'Water', label: 'Water tone contrast', type: 'range', def: 1, min: 0.2, max: 2, step: 0.05, fmt: pct },
  { key: 'water.reflection', group: 'Water', label: 'Sky reflection', type: 'range', def: 1, min: 0, max: 3, step: 0.1, fmt: pct },
  { key: 'water.sim', group: 'Water', label: 'Interactive wave sim', type: 'bool', def: true,
    help: 'GPU wave-equation heightfield: bow waves, wakes, explosion rings.' },
  { key: 'water.simRes', group: 'Water', label: 'Wave sim resolution', type: 'select', def: '768', options: opts(['384', '384²'], ['512', '512²'], ['768', '768²'], ['1024', '1024²']) },
  { key: 'water.simCell', group: 'Water', label: 'Wave sim cell size', type: 'range', def: 1, min: 0.5, max: 3, step: 0.25, unit: 'm' },
  { key: 'water.waveSpeed', group: 'Water', label: 'Ripple speed (wake angle)', type: 'range', def: 5.5, min: 1, max: 14, step: 0.5, unit: 'm/s',
    help: 'Lower = narrower V wakes. Real Kelvin wakes are ~19.5°.' },
  { key: 'water.simDamping', group: 'Water', label: 'Ripple damping', type: 'range', def: 0.25, min: 0, max: 2, step: 0.05 },
  { key: 'water.hullPush', group: 'Water', label: 'Hull displacement', type: 'range', def: 1, min: 0, max: 3, step: 0.1, fmt: pct },
  { key: 'water.rippleScale', group: 'Water', label: 'Ripple visual strength', type: 'range', def: 1, min: 0, max: 3, step: 0.1, fmt: pct },
  { key: 'water.fluid', group: 'Water', label: 'Turbulent wake (fluid sim)', type: 'bool', def: true,
    help: 'Stable-fluids velocity field advects foam, bioluminescence and oil; hulls are moving obstacles.' },
  { key: 'water.fluidRes', group: 'Water', label: 'Fluid resolution', type: 'select', def: '256', options: opts(['128', '128²'], ['192', '192²'], ['256', '256²'], ['384', '384²']) },
  { key: 'water.vorticity', group: 'Water', label: 'Vorticity (swirl)', type: 'range', def: 0.6, min: 0, max: 3, step: 0.05 },
  { key: 'water.pressureIters', group: 'Water', label: 'Pressure iterations', type: 'range', def: 18, min: 4, max: 60, step: 1 },
  { key: 'water.foamDecay', group: 'Water', label: 'Foam lifetime', type: 'range', def: 1, min: 0.2, max: 4, step: 0.1, fmt: pct },
  { key: 'water.foamAmount', group: 'Water', label: 'Wake foam amount', type: 'range', def: 1, min: 0, max: 3, step: 0.1, fmt: pct },
  { key: 'water.bio', group: 'Water', label: 'Bioluminescence', type: 'select', def: 'theater', options: opts(['theater', 'By theater'], ['off', 'Off'], ['on', 'Strong']) },
  { key: 'water.clarity', group: 'Water', label: 'Underwater visibility', type: 'range', def: 1, min: 0, max: 3, step: 0.05, fmt: pct },
  { key: 'water.splashes', group: 'Water', label: 'Splashes & spray', type: 'bool', def: true },
  { key: 'water.deckWash', group: 'Water', label: 'Green water over decks', type: 'bool', def: true },
  { key: 'water.waterline', group: 'Water', label: 'Waterline foam on hulls', type: 'bool', def: true },

  // ---------------------------------------------------------------- Lighting
  { key: 'light.enabled', group: 'Lighting', label: 'Dynamic lights', type: 'bool', def: true },
  { key: 'light.reach', group: 'Lighting', label: 'Light reach', type: 'range', def: 1, min: 0.2, max: 3, step: 0.05, fmt: pct,
    help: 'Multiplies the radius of every light (searchlights, flares, fires, flashes).' },
  { key: 'light.strength', group: 'Lighting', label: 'Light strength', type: 'range', def: 1, min: 0, max: 3, step: 0.05, fmt: pct },
  { key: 'light.ambient', group: 'Lighting', label: 'Ambient fill', type: 'range', def: 1, min: 0, max: 3, step: 0.05, fmt: pct,
    help: 'Sky light everywhere. Turn down for pitch-black nights.' },
  { key: 'light.shadows', group: 'Lighting', label: 'Occluder shadows', type: 'bool', def: true },
  { key: 'light.softness', group: 'Lighting', label: 'Shadow softness', type: 'range', def: 0.45, min: 0, max: 1, step: 0.05, fmt: pct },
  { key: 'light.shadowSteps', group: 'Lighting', label: 'Shadow ray steps', type: 'range', def: 28, min: 6, max: 64, step: 1 },
  { key: 'light.shadowRes', group: 'Lighting', label: 'Occluder map resolution', type: 'select', def: '1024', options: opts(['512', '512²'], ['1024', '1024²'], ['2048', '2048²']) },
  { key: 'light.celestialShadows', group: 'Lighting', label: 'Sun & moon shadows', type: 'bool', def: true },
  { key: 'light.bands', group: 'Lighting', label: 'Light bands (pixel quantize)', type: 'range', def: 7, min: 0, max: 24, step: 1,
    help: '0 = smooth lighting. Low values give a posterized pixel-art look.' },
  { key: 'light.dither', group: 'Lighting', label: 'Band dithering', type: 'range', def: 1, min: 0, max: 1, step: 0.05, fmt: pct },
  { key: 'light.beams', group: 'Lighting', label: 'Searchlight beams (haze)', type: 'range', def: 0.8, min: 0, max: 2.5, step: 0.05, fmt: pct },
  { key: 'light.specular', group: 'Lighting', label: 'Water glints', type: 'range', def: 1, min: 0, max: 3, step: 0.05, fmt: pct },
  { key: 'light.bloom', group: 'Lighting', label: 'Glow / bloom', type: 'range', def: 0.6, min: 0, max: 2, step: 0.05, fmt: pct },
  { key: 'light.fog', group: 'Lighting', label: 'Fog & haze', type: 'range', def: 1, min: 0, max: 3, step: 0.05, fmt: pct },
  { key: 'light.maxLights', group: 'Lighting', label: 'Max lights', type: 'range', def: 48, min: 4, max: 64, step: 1 },

  // ---------------------------------------------------------------- Physics
  { key: 'phys.tempo', group: 'Physics', label: 'Simulation tempo', type: 'range', def: 1.5, min: 0.25, max: 4, step: 0.05, unit: 'x',
    help: 'Sim seconds per real second. 1 = real time. Naval combat at 1x is slow; 1.5-2 keeps authenticity with pace.' },
  { key: 'phys.hz', group: 'Physics', label: 'Physics rate', type: 'select', def: '60', options: opts(['30', '30 Hz'], ['60', '60 Hz'], ['120', '120 Hz']) },
  { key: 'phys.waveForces', group: 'Physics', label: 'Waves move ships', type: 'bool', def: true },
  { key: 'phys.buoyancy', group: 'Physics', label: 'Buoyancy columns', type: 'select', def: 'normal', options: opts(['coarse', 'Coarse (fast)'], ['normal', 'Normal'], ['fine', 'Fine']) },
  { key: 'phys.handling', group: 'Physics', label: 'Handling', type: 'select', def: 'arcade', options: opts(['authentic', 'Authentic (slow, heavy)'], ['arcade', 'Arcade-assisted'], ['twitchy', 'Twitchy']) },
  { key: 'phys.heel', group: 'Physics', label: 'Heel in turns', type: 'range', def: 1, min: 0, max: 3, step: 0.1, fmt: pct },
  { key: 'phys.ramming', group: 'Physics', label: 'Ramming damage', type: 'range', def: 1, min: 0, max: 3, step: 0.1, fmt: pct },

  // ---------------------------------------------------------------- Gameplay
  { key: 'game.fogOfWar', group: 'Gameplay', label: 'Fog of war', type: 'bool', def: true, help: 'Submerged enemies are hidden unless detected.' },
  { key: 'game.asdic', group: 'Gameplay', label: 'ASDIC model', type: 'select', def: 'authentic', options: opts(['authentic', 'Authentic beam sweep'], ['arcade', 'Arcade 360° pulse']) },
  { key: 'game.autoDepth', group: 'Gameplay', label: 'U-boat depth assist', type: 'bool', def: true, help: 'Planes and trim hold the ordered depth for you.' },
  { key: 'game.tdc', group: 'Gameplay', label: 'Torpedo aiming', type: 'select', def: 'assisted', options: opts(['assisted', 'TDC assisted (lead shown)'], ['manual', 'Manual (no lead)'], ['auto', 'Auto-solution on lock']) },
  { key: 'game.duds', group: 'Gameplay', label: 'Torpedo dud rate', type: 'range', def: 0.05, min: 0, max: 0.5, step: 0.01, fmt: pct, help: 'The 1940 torpedo crisis was real.' },
  { key: 'game.aimAssist', group: 'Gameplay', label: 'Aim assist (gamepad)', type: 'range', def: 0.6, min: 0, max: 1, step: 0.05, fmt: pct },
  { key: 'game.playerDamage', group: 'Gameplay', label: 'Damage taken', type: 'range', def: 1, min: 0, max: 3, step: 0.05, fmt: pct },
  { key: 'game.enemyDamage', group: 'Gameplay', label: 'Damage dealt', type: 'range', def: 1, min: 0.25, max: 4, step: 0.05, fmt: pct },
  { key: 'game.god', group: 'Gameplay', label: 'Invulnerable', type: 'bool', def: false },
  { key: 'game.infiniteAmmo', group: 'Gameplay', label: 'Unlimited ammo', type: 'bool', def: false },
  { key: 'game.noCooldowns', group: 'Gameplay', label: 'No ability cooldowns', type: 'bool', def: false },
  { key: 'game.breakup', group: 'Gameplay', label: 'Ships break in two', type: 'bool', def: true, help: 'A hull pounded far past zero while still afloat splits into two sinking halves.' },
  { key: 'game.lootRate', group: 'Gameplay', label: 'Loot drop rate', type: 'range', def: 1, min: 0, max: 5, step: 0.1, fmt: pct },
  { key: 'game.maxCompression', group: 'Gameplay', label: 'Max time compression', type: 'select', def: '8', options: opts(['1', 'None'], ['4', '4x'], ['8', '8x'], ['16', '16x']) },

  // ---------------------------------------------------------------- AI
  { key: 'ai.skill', group: 'AI', label: 'AI skill', type: 'range', def: 0.6, min: 0, max: 1, step: 0.05, fmt: pct },
  { key: 'ai.escortAggro', group: 'AI', label: 'Escort aggression', type: 'range', def: 0.6, min: 0, max: 1, step: 0.05, fmt: pct },
  { key: 'ai.uboatAggro', group: 'AI', label: 'U-boat aggression', type: 'range', def: 0.6, min: 0, max: 1, step: 0.05, fmt: pct },
  { key: 'ai.freeze', group: 'AI', label: 'Freeze AI', type: 'bool', def: false },
  { key: 'ai.rescue', group: 'AI', label: 'AI escorts rescue survivors', type: 'bool', def: true, help: 'Idle escorts with no contact nearby stop for lifeboats.' },
  { key: 'ai.screen', group: 'AI', label: 'Escorts kept screening', type: 'range', def: 1, min: 0, max: 3, step: 1, help: 'AI escorts that never leave the convoy to hunt.' },

  // ---------------------------------------------------------------- Audio
  { key: 'audio.master', group: 'Audio', label: 'Master volume', type: 'range', def: 0.7, min: 0, max: 1, step: 0.05, fmt: pct },
  { key: 'audio.sfx', group: 'Audio', label: 'Effects', type: 'range', def: 0.8, min: 0, max: 1, step: 0.05, fmt: pct },
  { key: 'audio.ambience', group: 'Audio', label: 'Sea ambience', type: 'range', def: 0.6, min: 0, max: 1, step: 0.05, fmt: pct },
  { key: 'audio.music', group: 'Audio', label: 'Music', type: 'range', def: 0.4, min: 0, max: 1, step: 0.05, fmt: pct },
  { key: 'audio.chatter', group: 'Audio', label: 'Radio & crew chatter', type: 'bool', def: true },

  // ---------------------------------------------------------------- Controls
  { key: 'controls.scheme', group: 'Controls', label: 'Steering scheme', type: 'select', def: 'helm',
    options: opts(['helm', 'Helm: A/D rudder, W/S telegraph'], ['direct', 'Direct: steer toward stick/keys']) },
  { key: 'controls.mouseSteer', group: 'Controls', label: 'Right-click sets course', type: 'bool', def: true },
  { key: 'controls.deadzone', group: 'Controls', label: 'Stick deadzone', type: 'range', def: 0.18, min: 0.05, max: 0.4, step: 0.01 },
  { key: 'controls.rumble', group: 'Controls', label: 'Gamepad rumble', type: 'bool', def: true },
  { key: 'controls.glyphs', group: 'Controls', label: 'Button prompts', type: 'select', def: 'auto', options: opts(['auto', 'Auto'], ['kbm', 'Keyboard & mouse'], ['ps', 'PlayStation'], ['xbox', 'Xbox']) },
  { key: 'controls.touch', group: 'Controls', label: 'Touch controls', type: 'select', def: 'auto', options: opts(['auto', 'Auto'], ['on', 'Always'], ['off', 'Off']) },

  // ---------------------------------------------------------------- Debug
  { key: 'debug.view', group: 'Debug', label: 'Buffer view', type: 'select', def: 'final',
    options: opts(['final', 'Final image'], ['albedo', 'Albedo'], ['normal', 'Normals'], ['height', 'Height'], ['light', 'Light only'], ['occluder', 'Occluder map'], ['wave', 'Wave sim'], ['fluid', 'Fluid velocity'], ['foam', 'Foam/bio/oil']) },
  { key: 'debug.colliders', group: 'Debug', label: 'Physics colliders', type: 'bool', def: false },
  { key: 'debug.buoyancy', group: 'Debug', label: 'Buoyancy columns', type: 'bool', def: false },
  { key: 'debug.sensors', group: 'Debug', label: 'Sensor ranges & beams', type: 'bool', def: false },
  { key: 'debug.ai', group: 'Debug', label: 'AI intent', type: 'bool', def: false },
  { key: 'debug.reveal', group: 'Debug', label: 'Reveal all (no fog of war)', type: 'bool', def: false },
  { key: 'debug.perf', group: 'Debug', label: 'Performance overlay', type: 'bool', def: false },
];

export const DEV_PRESETS: Preset[] = [
  { id: 'cinematic', label: 'Cinematic', help: 'Everything on, big sims, soft shadows.', values: {
    'water.simRes': '1024', 'water.fluidRes': '384', 'light.shadowSteps': 40, 'light.shadowRes': '2048', 'light.bloom': 0.9, 'light.beams': 1.2, 'display.grain': 0.2 } },
  { id: 'balanced', label: 'Balanced', help: 'Defaults.', values: {
    'water.simRes': '768', 'water.fluidRes': '256', 'light.shadowSteps': 28, 'light.shadowRes': '1024', 'light.bloom': 0.6 } },
  { id: 'performance', label: 'Performance', help: 'Low-end GPUs and laptops.', values: {
    'water.simRes': '384', 'water.fluidRes': '128', 'water.pressureIters': 8, 'light.shadowSteps': 12, 'light.shadowRes': '512', 'water.waveCount': 8, 'light.bloom': 0, 'light.maxLights': 24 } },
  { id: 'authentic', label: 'Authentic sim', help: 'Real-time, heavy handling, authentic ASDIC and manual torpedoes.', values: {
    'phys.tempo': 1, 'phys.handling': 'authentic', 'game.asdic': 'authentic', 'game.tdc': 'manual', 'game.duds': 0.15, 'game.autoDepth': false } },
  { id: 'arcade', label: 'Arcade', help: 'Fast, forgiving, 360° sonar pulses.', values: {
    'phys.tempo': 2, 'phys.handling': 'twitchy', 'game.asdic': 'arcade', 'game.tdc': 'auto', 'game.duds': 0, 'game.autoDepth': true } },
];

export const dev = new ConfigStore('wolfpack.dev.v1', DEV_DEFS, DEV_PRESETS);
