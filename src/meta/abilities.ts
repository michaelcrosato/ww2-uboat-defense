// Active abilities for both captains. Gameplay handlers read the resolved `params` by EXACTLY
// these names; values are per rank (index 0 = rank 1). Modifiers unlock at rank 3.

import type { AbilityDef, AbilityId, AbilityState, Faction } from './types.ts';
import type { StatBlock, StatKey } from './stats.ts';

export const MAX_RANK = 5;
/** rank at which one of the two modifiers can be chosen */
export const MODIFIER_RANK = 3;
/** cooldown reduction is capped at 60% (multiplier floor) */
export const MIN_COOLDOWN_MULT = 0.4;
export const MIN_COOLDOWN_S = 1;

/** params that are whole counts: rounded after modifiers/power */
const COUNT_PARAMS = new Set(['charges', 'bombs', 'rockets', 'sorties', 'torpedoes', 'boats', 'decoys']);
/** params kept inside sane bounds after modifiers/power */
const CLAMP_PARAMS: Record<string, [number, number]> = {
  solution_quality: [0, 1],
  density: [0, 1],
  damage_reduction: [0, 0.9],
  noise_mult: [0.05, 1],
  accuracy_deg: [0.5, 90],
  extinguish: [0, 1],
};
/** fractional params shown as percentages in descriptions */
const PCT_PARAMS = new Set(['speed_bonus', 'accuracy_bonus', 'damage_reduction', 'repair_frac', 'solution_quality', 'density']);
/** flat capacity stats that add uses to an ability's per-mission charges */
const CHARGE_STATS: Partial<Record<AbilityId, StatKey>> = {
  star_shell: 'star_shells',
  hedgehog: 'hedgehog_capacity',
  bold_decoy: 'decoy_capacity',
  aphrodite: 'decoy_capacity',
};

export const ABILITIES: Record<AbilityId, AbilityDef> = {
  // ---------------------------------------------------------------- escort
  asdic_sweep: {
    id: 'asdic_sweep', faction: 'escort', name: 'ASDIC Sweep', glyph: '◎', unlockLevel: 1, maxRank: 5,
    flavor: 'The steady "ping… ping…" of the Western Approaches: an echo is a U-boat until proven a whale.',
    desc: 'Sweep a {arc}° arc with the ASDIC oscillator at {range_mult}× normal range. Echoes stay plotted for {reveal_s} s.',
    cooldown: [14, 13, 12, 11, 10],
    params: { arc: [60, 75, 90, 105, 120], range_mult: [1.15, 1.25, 1.35, 1.45, 1.6], reveal_s: [4, 5, 6, 7, 8] },
    powerParams: ['range_mult', 'reveal_s'],
    modifiers: [
      { id: 'asdic_narrow', name: 'Narrow Beam', desc: 'Concentrate the oscillator: half the arc, +0.4× range.', effects: { arc: { mul: 0.5 }, range_mult: { add: 0.4 } } },
      { id: 'asdic_rapid', name: 'Rapid Transmission', desc: '-40% cooldown, but echoes fade 25% sooner.', effects: { cooldown: { mul: 0.6 }, reveal_s: { mul: 0.75 } } },
    ],
  },
  dc_pattern: {
    id: 'dc_pattern', faction: 'escort', name: 'Depth Charge Pattern', glyph: '⁂', unlockLevel: 1, maxRank: 5,
    flavor: 'Rails and throwers together: a diamond of Amatol set to burst around the boat below.',
    desc: 'Roll and throw a {charges}-charge pattern spread over {spread_m} m. Charges deal {damage_mult}× damage.',
    cooldown: [22, 21, 20, 19, 18],
    params: { charges: [5, 6, 7, 8, 10], spread_m: [40, 45, 50, 55, 60], damage_mult: [1, 1.1, 1.2, 1.3, 1.45] },
    powerParams: ['damage_mult'],
    modifiers: [
      { id: 'dc_ten_pattern', name: 'Ten-Charge Pattern', desc: 'The full Admiralty pattern: +3 charges in a 25% wider diamond, 25% longer reload.', effects: { charges: { add: 3 }, spread_m: { mul: 1.25 }, cooldown: { mul: 1.25 } } },
      { id: 'dc_heavy', name: 'Mk VII Heavy', desc: 'Weighted charges sink fast and hit hard: +35% damage, one fewer charge.', effects: { damage_mult: { mul: 1.35 }, charges: { add: -1 } } },
    ],
  },
  hedgehog: {
    id: 'hedgehog', faction: 'escort', name: 'Hedgehog', glyph: '✱', unlockLevel: 5, minYear: 1942, maxRank: 5,
    flavor: 'Ahead-throwing spigot mortar: contact-fused bombs that only burst on a hit, so ASDIC contact is never lost.',
    desc: 'Fire {bombs} contact bombs in a {ring_m} m ring, {range_m} m ahead of the bow. Each hit deals {damage_mult}× damage.',
    cooldown: [16, 15, 14, 13, 12],
    charges: [6, 7, 8, 9, 10],
    params: { bombs: [16, 18, 20, 22, 24], ring_m: [35, 37, 39, 41, 43], range_m: [200, 210, 220, 235, 250], damage_mult: [1, 1.1, 1.2, 1.3, 1.45] },
    powerParams: ['damage_mult'],
    modifiers: [
      { id: 'hh_wide', name: 'Wide Ring', desc: 'Splay the spigots: 40% wider ring, -15% damage.', effects: { ring_m: { mul: 1.4 }, damage_mult: { mul: 0.85 } } },
      { id: 'hh_rapid', name: 'Rapid Reload Crews', desc: '-35% cooldown, 4 fewer bombs per salvo.', effects: { cooldown: { mul: 0.65 }, bombs: { add: -4 } } },
    ],
  },
  star_shell: {
    id: 'star_shell', faction: 'escort', name: 'Star Shell', glyph: '✦', unlockLevel: 1, maxRank: 5,
    flavor: 'A 4-inch illuminating round on a parachute. Every surfaced U-boat dreads the sudden white noon.',
    desc: 'Burst a star shell that lights a {radius_m} m circle at {intensity}× brightness for {duration_s} s.',
    cooldown: [8, 8, 7, 7, 6],
    charges: [3, 4, 4, 5, 6],
    params: { duration_s: [20, 24, 28, 32, 36], radius_m: [350, 380, 410, 440, 480], intensity: [1, 1.1, 1.2, 1.3, 1.4] },
    powerParams: ['duration_s', 'radius_m', 'intensity'],
    modifiers: [
      { id: 'ss_parachute', name: 'Slow Parachutes', desc: 'Flares drift down 60% longer, 15% dimmer.', effects: { duration_s: { mul: 1.6 }, intensity: { mul: 0.85 } } },
      { id: 'ss_brilliant', name: 'Brilliant Burst', desc: '+35% radius and +0.3× brightness, burns 25% shorter.', effects: { radius_m: { mul: 1.35 }, intensity: { add: 0.3 }, duration_s: { mul: 0.75 } } },
    ],
  },
  flank_speed: {
    id: 'flank_speed', faction: 'escort', name: 'Flank Speed', glyph: '»', unlockLevel: 2, maxRank: 5,
    flavor: '"Emergency full ahead!" The stokers earn their tot of rum tonight.',
    desc: 'Ring down for emergency full ahead: +{speed_bonus}% speed for {duration_s} s.',
    cooldown: [30, 28, 26, 24, 22],
    params: { speed_bonus: [0.15, 0.18, 0.21, 0.24, 0.28], duration_s: [8, 9, 10, 11, 12] },
    powerParams: ['speed_bonus', 'duration_s'],
    modifiers: [
      { id: 'fs_sprint', name: 'Safety Valves Lashed', desc: '+12% more speed, lasts 30% shorter.', effects: { speed_bonus: { add: 0.12 }, duration_s: { mul: 0.7 } } },
      { id: 'fs_endurance', name: 'Steam Discipline', desc: 'Lasts 50% longer at 15% less speed.', effects: { duration_s: { mul: 1.5 }, speed_bonus: { mul: 0.85 } } },
    ],
  },
  smoke_screen: {
    id: 'smoke_screen', faction: 'escort', name: 'Smoke Screen', glyph: '≈', unlockLevel: 4, maxRank: 5,
    flavor: 'Black funnel smoke and chemical floats: hide the convoy from the periscope until dawn.',
    desc: 'Lay a smoke screen ({density}% opaque) that hangs for {duration_s} s, blinding periscopes and lookouts.',
    cooldown: [45, 42, 40, 38, 35],
    params: { duration_s: [25, 28, 31, 34, 38], density: [0.6, 0.65, 0.7, 0.75, 0.8] },
    powerParams: ['duration_s'],
    modifiers: [
      { id: 'sm_funnel', name: 'Funnel Smoke', desc: 'Lingers 50% longer but 20% thinner.', effects: { duration_s: { mul: 1.5 }, density: { mul: 0.8 } } },
      { id: 'sm_chemical', name: 'Chemical Floats', desc: '+15% opacity and -15% cooldown.', effects: { density: { add: 0.15 }, cooldown: { mul: 0.85 } } },
    ],
  },
  snowflake: {
    id: 'snowflake', faction: 'escort', name: 'Snowflake', glyph: '❄', unlockLevel: 13, minYear: 1941, maxRank: 5,
    flavor: 'Illuminating rockets fired on a radar bearing. The whole sea lit up like a ballroom.',
    desc: 'Fire {rockets} Snowflake rockets, turning night into day within {radius_m} m for {duration_s} s.',
    cooldown: [20, 19, 18, 17, 16],
    charges: [2, 2, 3, 3, 4],
    params: { duration_s: [30, 34, 38, 42, 46], radius_m: [500, 550, 600, 650, 700], rockets: [4, 5, 6, 7, 8] },
    powerParams: ['duration_s', 'radius_m'],
    modifiers: [
      { id: 'sf_raspberry', name: 'Raspberry Drill', desc: 'The whole group fires together: +4 rockets, burns 20% shorter.', effects: { rockets: { add: 4 }, duration_s: { mul: 0.8 } } },
      { id: 'sf_magnesium', name: 'Magnesium Flares', desc: 'Burn 50% longer over a 10% smaller area.', effects: { duration_s: { mul: 1.5 }, radius_m: { mul: 0.9 } } },
    ],
  },
  creeping_attack: {
    id: 'creeping_attack', faction: 'escort', name: 'Creeping Attack', glyph: '⋯', unlockLevel: 7, maxRank: 5,
    flavor: 'One ship holds the contact and coaches; the other creeps in at five knots, unheard, and drops.',
    desc: 'For {duration_s} s your depth charges and Hedgehog are {accuracy_bonus}% more accurate against a held ASDIC contact.',
    cooldown: [60, 57, 54, 51, 48],
    params: { duration_s: [20, 22, 24, 26, 28], accuracy_bonus: [0.25, 0.3, 0.35, 0.4, 0.5] },
    powerParams: ['duration_s', 'accuracy_bonus'],
    modifiers: [
      { id: 'ca_plaster', name: 'Plaster Attack', desc: 'Ships in line abreast: +15% accuracy, 25% shorter.', effects: { accuracy_bonus: { add: 0.15 }, duration_s: { mul: 0.75 } } },
      { id: 'ca_patient', name: 'Patient Stalk', desc: 'Lasts 50% longer at 20% less accuracy.', effects: { duration_s: { mul: 1.5 }, accuracy_bonus: { mul: 0.8 } } },
    ],
  },
  huff_duff: {
    id: 'huff_duff', faction: 'escort', name: 'Huff-Duff', glyph: '⌖', unlockLevel: 11, minYear: 1941, maxRank: 5,
    flavor: 'High-frequency direction finding: every shadowing report a U-boat sends home betrays its bearing.',
    desc: 'Listen on the HF/DF set for {window_s} s. Every U-boat that transmits is plotted to within {accuracy_deg}°.',
    cooldown: [40, 37, 34, 31, 28],
    params: { window_s: [15, 18, 21, 24, 28], accuracy_deg: [12, 10, 8, 6, 4] },
    powerParams: ['window_s'],
    modifiers: [
      { id: 'hd_cross', name: 'Cross-Bearing', desc: 'Two sets triangulate: bearing error halved, window 20% shorter.', effects: { accuracy_deg: { mul: 0.5 }, window_s: { mul: 0.8 } } },
      { id: 'hd_watch', name: 'Continuous Watch', desc: 'Listen 60% longer; 10% longer cooldown.', effects: { window_s: { mul: 1.6 }, cooldown: { mul: 1.1 } } },
    ],
  },
  ram: {
    id: 'ram', faction: 'escort', name: 'Ram', glyph: '▲', unlockLevel: 9, maxRank: 5,
    flavor: 'Crude, costly and utterly final: a thousand tons of escort through a pressure hull.',
    desc: 'Brace for collision for {brace_s} s: ramming deals {damage_mult}× damage and you take {damage_reduction}% less collision damage.',
    cooldown: [50, 47, 44, 41, 38],
    params: { damage_mult: [1.5, 1.7, 1.9, 2.1, 2.4], brace_s: [3, 3.5, 4, 4.5, 5], damage_reduction: [0.3, 0.35, 0.4, 0.45, 0.5] },
    powerParams: ['damage_mult'],
    modifiers: [
      { id: 'ram_stem', name: 'Reinforced Stem', desc: '+0.6× ramming damage, 20% shorter brace.', effects: { damage_mult: { add: 0.6 }, brace_s: { mul: 0.8 } } },
      { id: 'ram_stations', name: 'Collision Stations', desc: '+20% collision damage reduction and +2 s brace.', effects: { damage_reduction: { add: 0.2 }, brace_s: { add: 2 } } },
    ],
  },
  air_support: {
    id: 'air_support', faction: 'escort', name: 'Air Support', glyph: '✈', unlockLevel: 16, minYear: 1941, maxRank: 5,
    flavor: 'ASV-radar aircraft over the convoy: a U-boat that sees wings must dive and lose the chase.',
    desc: 'Call {sorties} air sortie(s) that patrol for {duration_s} s, each carrying {bombs} depth bombs.',
    cooldown: [90, 85, 80, 75, 70],
    charges: [1, 1, 2, 2, 3],
    params: { sorties: [1, 1, 2, 2, 3], duration_s: [40, 45, 50, 55, 60], bombs: [2, 2, 3, 3, 4] },
    powerParams: ['duration_s'],
    modifiers: [
      { id: 'air_hunter', name: 'Hunter-Killer Flight', desc: '+1 sortie, patrols 20% shorter.', effects: { sorties: { add: 1 }, duration_s: { mul: 0.8 } } },
      { id: 'air_vlr', name: 'Very Long Range', desc: 'Loiters 60% longer with one fewer bomb.', effects: { duration_s: { mul: 1.6 }, bombs: { add: -1 } } },
    ],
  },
  foxer: {
    id: 'foxer', faction: 'escort', name: 'Foxer', glyph: '∿', unlockLevel: 19, minYear: 1943, maxRank: 5,
    flavor: 'Rattling steel pipes towed astern. Deafening for your own ASDIC, irresistible to a Zaunkönig.',
    desc: 'Stream the Foxer noisemaker for {duration_s} s; acoustic torpedoes home on it instead of your screws.',
    cooldown: [60, 55, 50, 45, 40],
    params: { duration_s: [30, 35, 40, 45, 50] },
    powerParams: ['duration_s'],
    modifiers: [
      { id: 'fx_quick', name: 'Quick Streaming Gear', desc: '-30% cooldown, 15% shorter.', effects: { cooldown: { mul: 0.7 }, duration_s: { mul: 0.85 } } },
      { id: 'fx_heavy', name: 'Heavy Pipes', desc: '+20 s duration.', effects: { duration_s: { add: 20 } } },
    ],
  },
  // ---------------------------------------------------------------- u-boat
  crash_dive: {
    id: 'crash_dive', faction: 'uboat', name: 'Crash Dive', glyph: '▼', unlockLevel: 1, maxRank: 5,
    flavor: '"Alarm!" Lookouts tumble down the hatch and the bow tips under in thirty seconds.',
    desc: 'Flood the tanks: dive {dive_mult}× faster for {duration_s} s.',
    cooldown: [30, 28, 26, 24, 22],
    params: { dive_mult: [1.5, 1.65, 1.8, 1.95, 2.1], duration_s: [8, 9, 10, 11, 12] },
    powerParams: ['dive_mult', 'duration_s'],
    modifiers: [
      { id: 'cd_drill', name: 'Alarm Drill', desc: '-30% cooldown, 20% shorter.', effects: { cooldown: { mul: 0.7 }, duration_s: { mul: 0.8 } } },
      { id: 'cd_negative', name: 'Flood Negative', desc: '+0.6× dive rate, 25% shorter.', effects: { dive_mult: { add: 0.6 }, duration_s: { mul: 0.75 } } },
    ],
  },
  torpedo_spread: {
    id: 'torpedo_spread', faction: 'uboat', name: 'Torpedo Spread', glyph: '⋔', unlockLevel: 1, maxRank: 5,
    flavor: 'A Fächerschuss from the bow tubes: at least one eel should find a hull in the column.',
    desc: 'Fire a fan of {torpedoes} torpedoes, {spread_deg}° apart. Each deals {damage_mult}× damage.',
    cooldown: [20, 19, 18, 17, 16],
    params: { torpedoes: [2, 3, 3, 4, 4], spread_deg: [6, 7, 8, 9, 10], damage_mult: [1, 1.05, 1.1, 1.15, 1.25] },
    powerParams: ['damage_mult'],
    modifiers: [
      { id: 'ts_fan', name: 'Full Fan', desc: '+2 torpedoes, 40% wider spread, 20% longer cooldown.', effects: { torpedoes: { add: 2 }, spread_deg: { mul: 1.4 }, cooldown: { mul: 1.2 } } },
      { id: 'ts_tight', name: 'Tight Salvo', desc: 'Half the spread, +0.25× damage.', effects: { spread_deg: { mul: 0.5 }, damage_mult: { add: 0.25 } } },
    ],
  },
  silent_running: {
    id: 'silent_running', faction: 'uboat', name: 'Silent Running', glyph: '∅', unlockLevel: 1, maxRank: 5,
    flavor: 'Auxiliary machinery stopped, men in socks, nobody speaks above a whisper.',
    desc: 'Rig for silent running for {duration_s} s: noise ×{noise_mult}, speed capped at {speed_cap_kn} kn.',
    cooldown: [40, 38, 36, 34, 32],
    params: { noise_mult: [0.6, 0.55, 0.5, 0.45, 0.4], speed_cap_kn: [3, 3.5, 4, 4.5, 5], duration_s: [30, 35, 40, 45, 50] },
    powerParams: ['duration_s'],
    modifiers: [
      { id: 'sr_creep', name: 'Silent Creep', desc: 'Noise a further 25% lower; speed cap 25% lower.', effects: { noise_mult: { mul: 0.75 }, speed_cap_kn: { mul: 0.75 } } },
      { id: 'sr_slippers', name: 'Felt Slippers', desc: 'Lasts 60% longer.', effects: { duration_s: { mul: 1.6 } } },
    ],
  },
  bold_decoy: {
    id: 'bold_decoy', faction: 'uboat', name: 'Bold Decoy', glyph: '◌', unlockLevel: 7, minYear: 1942, maxRank: 5,
    flavor: 'Calcium hydride from the Pillenwerfer: a fizzing cloud that sings back to ASDIC like a hull.',
    desc: 'Eject {decoys} Bold capsule(s); the bubble cloud returns false echoes for {duration_s} s.',
    cooldown: [25, 24, 23, 22, 20],
    charges: [3, 3, 4, 4, 5],
    params: { duration_s: [25, 30, 35, 40, 45], decoys: [1, 1, 1, 2, 2] },
    powerParams: ['duration_s'],
    modifiers: [
      { id: 'bd_cluster', name: 'Capsule Cluster', desc: '+1 decoy, each 20% shorter.', effects: { decoys: { add: 1 }, duration_s: { mul: 0.8 } } },
      { id: 'bd_slow', name: 'Slow-Dissolving Mix', desc: 'Decoys last 60% longer.', effects: { duration_s: { mul: 1.6 } } },
    ],
  },
  wolfpack_call: {
    id: 'wolfpack_call', faction: 'uboat', name: 'Wolfpack Signal', glyph: 'W', unlockLevel: 11, maxRank: 5,
    flavor: 'A short signal to headquarters: "Convoy in sight." Somewhere over the horizon, diesels start.',
    desc: 'Signal the pack: {boats} boat(s) converge on your contact and attack for {duration_s} s.',
    cooldown: [120, 110, 100, 95, 90],
    charges: [1, 1, 1, 2, 2],
    params: { boats: [1, 1, 2, 2, 3], duration_s: [60, 70, 80, 90, 100] },
    powerParams: ['duration_s'],
    modifiers: [
      { id: 'wp_pack', name: 'Pack Tactics', desc: '+1 boat answers, 20% longer cooldown.', effects: { boats: { add: 1 }, cooldown: { mul: 1.2 } } },
      { id: 'wp_keeper', name: 'Contact Keeper', desc: 'The pack stays 50% longer; -15% cooldown.', effects: { duration_s: { mul: 1.5 }, cooldown: { mul: 0.85 } } },
    ],
  },
  deck_gun: {
    id: 'deck_gun', faction: 'uboat', name: 'Deck Gun Action', glyph: '⊕', unlockLevel: 3, maxRank: 5,
    flavor: 'Why waste an eel on a straggler? Gun crew to the casing, ready-use lockers open.',
    desc: 'Man the deck gun for {duration_s} s: {rate_mult}× rate of fire, {damage_mult}× damage.',
    cooldown: [35, 33, 31, 29, 27],
    params: { duration_s: [15, 17, 19, 21, 24], rate_mult: [1.2, 1.3, 1.4, 1.5, 1.6], damage_mult: [1, 1.1, 1.2, 1.3, 1.4] },
    powerParams: ['duration_s', 'damage_mult'],
    modifiers: [
      { id: 'dg_lockers', name: 'Ready-Use Lockers', desc: 'Lasts 50% longer, 10% slower fire.', effects: { duration_s: { mul: 1.5 }, rate_mult: { mul: 0.9 } } },
      { id: 'dg_ap', name: 'Armour-Piercing Shells', desc: '+0.35× damage, 15% slower fire.', effects: { damage_mult: { add: 0.35 }, rate_mult: { mul: 0.85 } } },
    ],
  },
  emergency_blow: {
    id: 'emergency_blow', faction: 'uboat', name: 'Emergency Blow', glyph: '⇑', unlockLevel: 5, maxRank: 5,
    flavor: 'High-pressure air roars into every tank. Whatever waits on the surface, it beats the bottom.',
    desc: 'Blow all main ballast: rise {rise_mult}× faster.',
    cooldown: [90, 80, 70, 65, 60],
    charges: [1, 1, 1, 2, 2],
    params: { rise_mult: [2, 2.25, 2.5, 2.75, 3] },
    powerParams: ['rise_mult'],
    modifiers: [
      { id: 'eb_reserve', name: 'Reserve Air Bottles', desc: '-40% cooldown.', effects: { cooldown: { mul: 0.6 } } },
      { id: 'eb_violent', name: 'Blow Everything', desc: '+1× rise rate.', effects: { rise_mult: { add: 1 } } },
    ],
  },
  deep_dive: {
    id: 'deep_dive', faction: 'uboat', name: 'Deep Dive', glyph: '⇓', unlockLevel: 9, maxRank: 5,
    flavor: 'Rivets pop like pistol shots below 200 metres. The charges are set too shallow anyway.',
    desc: 'Take her deep: go {depth_m} m beyond test depth for {duration_s} s.',
    cooldown: [60, 56, 52, 48, 44],
    params: { depth_m: [40, 50, 60, 70, 80], duration_s: [20, 24, 28, 32, 36] },
    powerParams: ['depth_m', 'duration_s'],
    modifiers: [
      { id: 'dd_crush', name: 'Below Crush Margin', desc: '+40 m deeper, 30% shorter.', effects: { depth_m: { add: 40 }, duration_s: { mul: 0.7 } } },
      { id: 'dd_trim', name: 'Perfect Trim', desc: 'Stay deep 50% longer.', effects: { duration_s: { mul: 1.5 } } },
    ],
  },
  periscope_scan: {
    id: 'periscope_scan', faction: 'uboat', name: 'Periscope Observation', glyph: '⊙', unlockLevel: 2, maxRank: 5,
    flavor: '"Up periscope." Range, bearing, angle on the bow — the Vorhaltrechner does the rest.',
    desc: 'Raise the attack periscope for {duration_s} s: firing solutions reach {solution_quality}% quality.',
    cooldown: [18, 17, 16, 15, 14],
    params: { duration_s: [6, 7, 8, 9, 10], solution_quality: [0.5, 0.6, 0.7, 0.8, 0.9] },
    powerParams: ['duration_s'],
    modifiers: [
      { id: 'ps_attack', name: 'Attack Periscope', desc: '+10% solution quality, raised 30% shorter.', effects: { solution_quality: { add: 0.1 }, duration_s: { mul: 0.7 } } },
      { id: 'ps_sky', name: 'Sky Search', desc: 'Raised 60% longer, -10% cooldown.', effects: { duration_s: { mul: 1.6 }, cooldown: { mul: 0.9 } } },
    ],
  },
  zaunkoenig: {
    id: 'zaunkoenig', faction: 'uboat', name: 'Zaunkönig', glyph: '↯', unlockLevel: 14, minYear: 1943, maxRank: 5,
    flavor: 'The G7es "wren": an acoustic homing torpedo that hunts the beat of an escort\'s screws.',
    desc: 'Fire {torpedoes} acoustic torpedo(es) that home on screw noise within {seek_range_m} m, dealing {damage_mult}× damage.',
    cooldown: [30, 28, 26, 24, 22],
    charges: [2, 2, 3, 3, 4],
    params: { torpedoes: [1, 1, 1, 2, 2], seek_range_m: [300, 350, 400, 450, 500], damage_mult: [1, 1.1, 1.2, 1.3, 1.4] },
    powerParams: ['seek_range_m', 'damage_mult'],
    modifiers: [
      { id: 'zk_improved', name: 'Improved Seeker', desc: 'A Foxer-resistant head: +40% seek range.', effects: { seek_range_m: { mul: 1.4 } } },
      { id: 'zk_pair', name: 'Paired Shot', desc: '+1 torpedo, -15% damage each.', effects: { torpedoes: { add: 1 }, damage_mult: { mul: 0.85 } } },
    ],
  },
  snorkel: {
    id: 'snorkel', faction: 'uboat', name: 'Schnorchel', glyph: '⌇', unlockLevel: 20, minYear: 1944, maxRank: 5,
    flavor: 'Diesels breathing through a mast at periscope depth. Ears pop, the air stinks, but the boat lives.',
    desc: 'Raise the Schnorchel: run diesels at periscope depth for {duration_s} s, recharging {recharge_mult}× faster.',
    cooldown: [45, 42, 40, 38, 35],
    params: { recharge_mult: [1.5, 1.75, 2, 2.25, 2.5], duration_s: [30, 35, 40, 45, 50] },
    powerParams: ['recharge_mult', 'duration_s'],
    modifiers: [
      { id: 'sn_coated', name: 'Absorbent Head Coating', desc: 'Safe to snort 50% longer.', effects: { duration_s: { mul: 1.5 } } },
      { id: 'sn_wide', name: 'Wide-Bore Mast', desc: '+0.75× recharge rate, 20% shorter.', effects: { recharge_mult: { add: 0.75 }, duration_s: { mul: 0.8 } } },
    ],
  },
  aphrodite: {
    id: 'aphrodite', faction: 'uboat', name: 'Aphrodite', glyph: '◇', unlockLevel: 16, minYear: 1943, maxRank: 5,
    flavor: 'Hydrogen balloons trailing foil strips on a weighted line: a dozen radar "U-boats" in the dark.',
    desc: 'Release {decoys} radar-decoy balloon(s) that draw radar contacts for {duration_s} s.',
    cooldown: [40, 38, 36, 34, 32],
    charges: [2, 2, 3, 3, 4],
    params: { decoys: [1, 2, 2, 3, 3], duration_s: [40, 45, 50, 55, 60] },
    powerParams: ['duration_s'],
    modifiers: [
      { id: 'ap_swarm', name: 'Balloon Swarm', desc: '+2 decoys, each 25% shorter.', effects: { decoys: { add: 2 }, duration_s: { mul: 0.75 } } },
      { id: 'ap_buoy', name: 'Spar-Buoy Reflectors', desc: 'Decoys last 60% longer.', effects: { duration_s: { mul: 1.6 } } },
    ],
  },
  // ---------------------------------------------------------------- shared
  damage_control: {
    id: 'damage_control', faction: 'both', name: 'Damage Control', glyph: '✚', unlockLevel: 1, maxRank: 5,
    flavor: 'Shoring timbers, hammocks in the leaks, a bucket chain to the fire. Every crew learns it the hard way.',
    desc: 'Damage-control parties restore {repair_frac}% hull integrity; from rank 3 they also put out fires.',
    cooldown: [60, 55, 50, 45, 40],
    params: { repair_frac: [0.08, 0.1, 0.12, 0.14, 0.16], extinguish: [0, 0, 1, 1, 1] },
    powerParams: ['repair_frac'],
    modifiers: [
      { id: 'dmg_shoring', name: 'Shoring Parties', desc: '+8% hull restored, 15% longer cooldown.', effects: { repair_frac: { add: 0.08 }, cooldown: { mul: 1.15 } } },
      { id: 'dmg_drill', name: 'Fire & Flood Drill', desc: '-30% cooldown, 15% less hull restored.', effects: { cooldown: { mul: 0.7 }, repair_frac: { mul: 0.85 } } },
    ],
  },
};

export const ABILITY_IDS = Object.keys(ABILITIES) as AbilityId[];

/** abilities a captain of this faction can learn, in unlock order */
export function abilitiesFor(faction: Faction): AbilityDef[] {
  return ABILITY_IDS.map((id) => ABILITIES[id])
    .filter((d) => d.faction === faction || d.faction === 'both')
    .sort((a, b) => a.unlockLevel - b.unlockLevel || a.name.localeCompare(b.name));
}

/** tech gate: can this ability be used in a mission set in `year`? */
export function abilityAvailableIn(def: AbilityDef, year: number): boolean {
  return def.minYear === undefined || year >= def.minYear;
}

export interface ResolvedAbility {
  cooldown: number;
  /** uses per mission (undefined = unlimited, cooldown only) */
  charges?: number;
  params: Record<string, number>;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Final numbers for one ability: rank values, then the chosen modifier (add, then multiply),
 * then ability_power_pct on powerParams and ability_cooldown_pct on the cooldown.
 * Capacity stats (star_shells, hedgehog_capacity, decoy_capacity) add charges.
 */
export function resolveAbility(def: AbilityDef, state: AbilityState, stats?: StatBlock): ResolvedAbility {
  const rank = Math.min(def.maxRank, Math.max(1, Math.round(state.rank || 1)));
  const i = rank - 1;
  let cooldown = def.cooldown[i];
  let charges = def.charges ? def.charges[i] : undefined;
  const params: Record<string, number> = {};
  for (const k in def.params) params[k] = def.params[k][i];

  const mod = rank >= MODIFIER_RANK && state.modifier ? def.modifiers.find((m) => m.id === state.modifier) : undefined;
  if (mod) {
    for (const k in mod.effects) {
      const e = mod.effects[k];
      if (k === 'cooldown') cooldown = (cooldown + (e.add ?? 0)) * (e.mul ?? 1);
      else if (k in params) params[k] = (params[k] + (e.add ?? 0)) * (e.mul ?? 1);
    }
  }

  if (stats) {
    const power = stats.mul('ability_power_pct');
    for (const k of def.powerParams ?? []) if (k in params) params[k] *= power;
    cooldown *= Math.max(MIN_COOLDOWN_MULT, 1 + stats.get('ability_cooldown_pct') / 100);
    const capStat = CHARGE_STATS[def.id];
    if (charges !== undefined && capStat) charges += Math.max(0, Math.round(stats.get(capStat)));
  }

  for (const k in params) {
    let v = params[k];
    if (COUNT_PARAMS.has(k)) v = Math.max(1, Math.round(v));
    const c = CLAMP_PARAMS[k];
    if (c) v = Math.min(c[1], Math.max(c[0], v));
    if (k === 'extinguish') v = Math.round(v);
    params[k] = r3(v);
  }
  return { cooldown: r3(Math.max(MIN_COOLDOWN_S, cooldown)), charges, params };
}

function fmtParam(k: string, v: number): string {
  const n = PCT_PARAMS.has(k) ? v * 100 : v;
  return String(Math.round(n * 100) / 100);
}

/** fill the description template with resolved values ({cooldown} and {charges} also work) */
export function describeAbility(def: AbilityDef, resolved: ResolvedAbility): string {
  return def.desc.replace(/\{(\w+)\}/g, (m, k: string) => {
    if (k === 'cooldown') return fmtParam(k, resolved.cooldown);
    if (k === 'charges' && !(k in resolved.params)) return resolved.charges !== undefined ? String(resolved.charges) : '∞';
    return k in resolved.params ? fmtParam(k, resolved.params[k]) : m;
  });
}
