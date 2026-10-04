// Equipment: base types per slot and faction (each with an implicit affix), tiered affix pools with
// item-level gating, Diablo-style rarities, legendary powers (gameplay hooks by id) and fixed uniques.
// Everything random goes through a seeded Rng so drops and crafting are reproducible.

import type { Affix, Faction, Item, LegendaryPower, Rarity, Slot } from './types.ts';
import { STAT_INFO, StatBlock, type StatKey } from './stats.ts';
import type { Rng } from '../core/math.ts';

// ------------------------------------------------------------------ slots
export const SLOTS: Record<Faction, Slot[]> = {
  escort: ['hull', 'engine', 'sonar', 'guns', 'asw', 'countermeasures', 'electronics', 'officer', 'mascot'],
  uboat: ['hull', 'diesels', 'battery', 'hydrophones', 'torpedoes', 'deckgun', 'countermeasures', 'electronics', 'officer', 'mascot'],
};
export const SLOT_NAMES: Record<Slot, string> = {
  hull: 'Hull', engine: 'Engine', sonar: 'ASDIC', guns: 'Guns', asw: 'Anti-submarine', countermeasures: 'Countermeasures',
  electronics: 'Electronics', officer: 'Officer', mascot: 'Mascot', diesels: 'Diesels', battery: 'Battery',
  hydrophones: 'Hydrophones', torpedoes: 'Torpedoes', deckgun: 'Deck gun',
};

// ------------------------------------------------------------------ affix tiers
/** T1 (best) … T5; min item level for each tier */
export const TIER_ILVL = [40, 28, 16, 8, 1];
/** fraction of the stat's top value covered by each tier [lo, hi] */
const TIER_FRAC: [number, number][] = [[0.8, 1], [0.6, 0.8], [0.42, 0.6], [0.26, 0.42], [0.12, 0.26]];

interface AffixStat { top: number; flat?: boolean; prefix: string; suffix: string }
/** top (T1 max) magnitude; sign follows STAT_INFO.good (good-down stats roll negative) */
export const AFFIX_STATS: Partial<Record<StatKey, AffixStat>> = {
  hull_hp: { top: 400, flat: true, prefix: 'Armoured', suffix: 'of the Bulkhead' },
  hull_hp_pct: { top: 22, prefix: 'Reinforced', suffix: 'of Riveted Plate' },
  damage_taken_pct: { top: 14, prefix: 'Hardened', suffix: 'of the Iron Ribs' },
  flooding_pct: { top: 25, prefix: 'Watertight', suffix: 'of Shored Hatches' },
  repair_pct: { top: 30, prefix: 'Drilled', suffix: 'of Damage Control' },
  fire_resist_pct: { top: 30, prefix: 'Fireproof', suffix: 'of the Hose Party' },
  max_speed_pct: { top: 12, prefix: 'Racing', suffix: 'of the Flank Bell' },
  accel_pct: { top: 25, prefix: 'Eager', suffix: 'of the Quick Boiler' },
  turn_pct: { top: 25, prefix: 'Nimble', suffix: 'of the Hard Rudder' },
  noise_pct: { top: 16, prefix: 'Hushed', suffix: 'of Silent Running' },
  visual_sig_pct: { top: 18, prefix: 'Dazzled', suffix: 'of the Grey Sea' },
  sonar_range_pct: { top: 24, prefix: 'Keen', suffix: 'of the Long Ping' },
  sonar_accuracy_pct: { top: 30, prefix: 'Precise', suffix: 'of True Bearings' },
  ping_rate_pct: { top: 25, prefix: 'Rapid', suffix: 'of the Recorder' },
  radar_range_pct: { top: 30, prefix: 'Centimetric', suffix: 'of the Magnetron' },
  lookout_range_pct: { top: 25, prefix: 'Watchful', suffix: 'of the Crow\'s Nest' },
  periscope_pct: { top: 30, prefix: 'Sharp', suffix: 'of the Attack Scope' },
  gun_damage_pct: { top: 25, prefix: 'Heavy', suffix: 'of Lyddite' },
  gun_reload_pct: { top: 22, prefix: 'Swift', suffix: 'of the Loading Drill' },
  gun_accuracy_pct: { top: 25, prefix: 'Ranging', suffix: 'of the Director' },
  gun_range_pct: { top: 18, prefix: 'Long', suffix: 'of High Elevation' },
  dc_damage_pct: { top: 28, prefix: 'Amatol', suffix: 'of Torpex' },
  dc_radius_pct: { top: 22, prefix: 'Wide', suffix: 'of the Pattern' },
  dc_capacity: { top: 10, flat: true, prefix: 'Laden', suffix: 'of Full Racks' },
  dc_reload_pct: { top: 25, prefix: 'Quick', suffix: 'of the Thrower Crew' },
  dc_sink_pct: { top: 30, prefix: 'Weighted', suffix: 'of the Fast Sink' },
  hedgehog_damage_pct: { top: 28, prefix: 'Spigot', suffix: 'of the Hedgehog' },
  hedgehog_capacity: { top: 3, flat: true, prefix: 'Stocked', suffix: 'of Spare Bombs' },
  star_shells: { top: 4, flat: true, prefix: 'Bright', suffix: 'of Starlight' },
  searchlight_pct: { top: 30, prefix: 'Blazing', suffix: 'of the Arc Lamp' },
  ram_damage_pct: { top: 40, prefix: 'Ramming', suffix: 'of the Iron Bow' },
  convoy_aura_pct: { top: 15, prefix: 'Shepherd\'s', suffix: 'of the Flock' },
  torpedo_damage_pct: { top: 25, prefix: 'Hammering', suffix: 'of the Warhead' },
  torpedo_speed_pct: { top: 18, prefix: 'Fleet', suffix: 'of the Fast Eel' },
  torpedo_range_pct: { top: 25, prefix: 'Far-running', suffix: 'of the Long Eel' },
  torpedo_reload_pct: { top: 25, prefix: 'Tireless', suffix: 'of the Torpedo Room' },
  torpedo_capacity: { top: 3, flat: true, prefix: 'Packed', suffix: 'of Extra Eels' },
  torpedo_dud_reduction: { top: 12, prefix: 'Reliable', suffix: 'of the Pistol Fix' },
  torpedo_wake_pct: { top: 25, prefix: 'Wakeless', suffix: 'of Electric Eels' },
  battery_pct: { top: 25, prefix: 'Deep-cell', suffix: 'of the Battery Room' },
  battery_drain_pct: { top: 18, prefix: 'Frugal', suffix: 'of Creep Speed' },
  recharge_pct: { top: 30, prefix: 'Charging', suffix: 'of the Diesel Watch' },
  dive_rate_pct: { top: 25, prefix: 'Plunging', suffix: 'of the Alarm Dive' },
  test_depth_pct: { top: 18, prefix: 'Deep', suffix: 'of the Crush Line' },
  submerged_speed_pct: { top: 18, prefix: 'Slippery', suffix: 'of the Silent Screw' },
  surfaced_speed_pct: { top: 14, prefix: 'Running', suffix: 'of the Surface Dash' },
  decoy_capacity: { top: 3, flat: true, prefix: 'Bubbling', suffix: 'of Pillenwerfer' },
  decoy_duration_pct: { top: 35, prefix: 'Lingering', suffix: 'of the Bold Cloud' },
  crit_chance: { top: 8, prefix: 'Vital', suffix: 'of the Keel Shot' },
  crit_damage_pct: { top: 40, prefix: 'Ruinous', suffix: 'of the Magazine' },
  ability_cooldown_pct: { top: 14, prefix: 'Practised', suffix: 'of the Drill Book' },
  ability_power_pct: { top: 18, prefix: 'Masterful', suffix: 'of the Old Hand' },
  loot_find_pct: { top: 30, prefix: 'Scavenging', suffix: 'of Flotsam' },
  funds_pct: { top: 20, prefix: 'Mercenary', suffix: 'of the Prize Court' },
  xp_pct: { top: 18, prefix: 'Seasoned', suffix: 'of the Long Watch' },
};

/** which stats can roll on each slot (faction-specific pools; shared slots differ by faction) */
const POOLS: Record<Faction, Partial<Record<Slot, StatKey[]>>> = {
  escort: {
    hull: ['hull_hp', 'hull_hp_pct', 'damage_taken_pct', 'flooding_pct', 'fire_resist_pct', 'repair_pct', 'ram_damage_pct'],
    engine: ['max_speed_pct', 'accel_pct', 'turn_pct', 'noise_pct', 'ram_damage_pct', 'fire_resist_pct'],
    sonar: ['sonar_range_pct', 'sonar_accuracy_pct', 'ping_rate_pct', 'crit_chance', 'ability_power_pct'],
    guns: ['gun_damage_pct', 'gun_reload_pct', 'gun_accuracy_pct', 'gun_range_pct', 'crit_chance', 'crit_damage_pct', 'star_shells'],
    asw: ['dc_damage_pct', 'dc_radius_pct', 'dc_capacity', 'dc_reload_pct', 'dc_sink_pct', 'hedgehog_damage_pct', 'hedgehog_capacity', 'crit_damage_pct'],
    countermeasures: ['damage_taken_pct', 'visual_sig_pct', 'noise_pct', 'searchlight_pct', 'star_shells', 'ability_cooldown_pct'],
    electronics: ['radar_range_pct', 'sonar_accuracy_pct', 'lookout_range_pct', 'searchlight_pct', 'ping_rate_pct', 'ability_cooldown_pct'],
    officer: ['repair_pct', 'ability_cooldown_pct', 'ability_power_pct', 'convoy_aura_pct', 'xp_pct', 'funds_pct', 'gun_accuracy_pct'],
    mascot: ['loot_find_pct', 'funds_pct', 'xp_pct', 'crit_chance', 'convoy_aura_pct', 'lookout_range_pct'],
  },
  uboat: {
    hull: ['hull_hp', 'hull_hp_pct', 'damage_taken_pct', 'flooding_pct', 'test_depth_pct', 'repair_pct'],
    diesels: ['surfaced_speed_pct', 'accel_pct', 'recharge_pct', 'noise_pct', 'turn_pct'],
    battery: ['battery_pct', 'battery_drain_pct', 'submerged_speed_pct', 'recharge_pct', 'noise_pct'],
    hydrophones: ['sonar_range_pct', 'sonar_accuracy_pct', 'periscope_pct', 'lookout_range_pct', 'crit_chance'],
    torpedoes: ['torpedo_damage_pct', 'torpedo_speed_pct', 'torpedo_range_pct', 'torpedo_reload_pct', 'torpedo_capacity', 'torpedo_dud_reduction', 'torpedo_wake_pct', 'crit_damage_pct'],
    deckgun: ['gun_damage_pct', 'gun_reload_pct', 'gun_accuracy_pct', 'gun_range_pct', 'crit_chance'],
    countermeasures: ['decoy_capacity', 'decoy_duration_pct', 'visual_sig_pct', 'noise_pct', 'dive_rate_pct', 'ability_cooldown_pct'],
    electronics: ['sonar_accuracy_pct', 'periscope_pct', 'radar_range_pct', 'visual_sig_pct', 'ability_cooldown_pct'],
    officer: ['repair_pct', 'dive_rate_pct', 'ability_cooldown_pct', 'ability_power_pct', 'xp_pct', 'funds_pct', 'torpedo_reload_pct'],
    mascot: ['loot_find_pct', 'funds_pct', 'xp_pct', 'crit_chance', 'battery_drain_pct', 'visual_sig_pct'],
  },
};
export function affixPool(faction: Faction, slot: Slot): StatKey[] { return POOLS[faction][slot] ?? []; }

// ------------------------------------------------------------------ bases
export interface ItemBase {
  id: string; name: string; slot: Slot; faction: Faction; minIlvl: number;
  implicit: { stat: StatKey; min: number; max: number };
}
const B = (faction: Faction, slot: Slot, id: string, name: string, minIlvl: number, stat: StatKey, min: number, max: number): ItemBase =>
  ({ id, name, slot, faction, minIlvl, implicit: { stat, min, max } });

export const BASES: ItemBase[] = [
  // ---- escort
  B('escort', 'hull', 'e_hull_plating', 'Riveted Plating', 1, 'hull_hp', 60, 120),
  B('escort', 'hull', 'e_hull_bulge', 'Anti-torpedo Bulge', 10, 'damage_taken_pct', -6, -3),
  B('escort', 'hull', 'e_hull_bow', 'Strengthened Bow', 18, 'ram_damage_pct', 15, 30),
  B('escort', 'hull', 'e_hull_frames', 'Welded Frames', 30, 'hull_hp_pct', 6, 12),
  B('escort', 'engine', 'e_eng_triple', 'Triple-expansion Engine', 1, 'accel_pct', 5, 10),
  B('escort', 'engine', 'e_eng_turbine', 'Geared Turbine', 12, 'max_speed_pct', 3, 6),
  B('escort', 'engine', 'e_eng_twin', 'Twin-screw Conversion', 24, 'turn_pct', 8, 14),
  B('escort', 'sonar', 'e_son_123', 'Type 123 ASDIC', 1, 'sonar_range_pct', 4, 8),
  B('escort', 'sonar', 'e_son_144', 'Type 144 ASDIC', 14, 'sonar_accuracy_pct', 8, 14),
  B('escort', 'sonar', 'e_son_147', 'Type 147 Depth-finding ASDIC', 30, 'ping_rate_pct', 8, 14),
  B('escort', 'guns', 'e_gun_4in', '4-inch BL Mk IX', 1, 'gun_damage_pct', 4, 8),
  B('escort', 'guns', 'e_gun_pom', '2-pdr Pom-pom', 8, 'gun_reload_pct', 6, 10),
  B('escort', 'guns', 'e_gun_oerlikon', '20 mm Oerlikon', 16, 'gun_accuracy_pct', 8, 12),
  B('escort', 'guns', 'e_gun_qf', '4-inch QF Mk XVI', 30, 'gun_range_pct', 6, 10),
  B('escort', 'asw', 'e_asw_rails', 'Depth Charge Rails', 1, 'dc_capacity', 2, 4),
  B('escort', 'asw', 'e_asw_kgun', 'K-gun Throwers', 10, 'dc_radius_pct', 6, 10),
  B('escort', 'asw', 'e_asw_hedgehog', 'Hedgehog Mounting', 20, 'hedgehog_damage_pct', 8, 14),
  B('escort', 'asw', 'e_asw_squid', 'Squid Mortar', 34, 'dc_damage_pct', 10, 16),
  B('escort', 'countermeasures', 'e_cm_foxer', 'Foxer Noisemaker', 1, 'noise_pct', -6, -3),
  B('escort', 'countermeasures', 'e_cm_smoke', 'Smoke Canisters', 10, 'visual_sig_pct', -8, -4),
  B('escort', 'countermeasures', 'e_cm_snowflake', 'Snowflake Rockets', 22, 'star_shells', 1, 2),
  B('escort', 'electronics', 'e_el_286', 'Type 286 Radar', 1, 'radar_range_pct', 6, 12),
  B('escort', 'electronics', 'e_el_271', 'Type 271 Centimetric Radar', 16, 'lookout_range_pct', 8, 14),
  B('escort', 'electronics', 'e_el_hfdf', 'HF/DF Set', 28, 'sonar_accuracy_pct', 8, 14),
  B('escort', 'officer', 'e_off_navigator', 'Navigating Officer', 1, 'turn_pct', 5, 9),
  B('escort', 'officer', 'e_off_asw', 'ASW Specialist', 10, 'dc_reload_pct', 6, 12),
  B('escort', 'officer', 'e_off_first', 'First Lieutenant', 20, 'repair_pct', 10, 16),
  B('escort', 'officer', 'e_off_gunnery', 'Gunnery Officer', 30, 'gun_damage_pct', 6, 10),
  B('escort', 'mascot', 'e_mas_cat', 'Ship\'s Cat', 1, 'loot_find_pct', 5, 10),
  B('escort', 'mascot', 'e_mas_dog', 'Wardroom Terrier', 12, 'xp_pct', 4, 8),
  B('escort', 'mascot', 'e_mas_parrot', 'Bosun\'s Parrot', 26, 'funds_pct', 5, 10),
  // ---- u-boat
  B('uboat', 'hull', 'u_hull_pressure', 'Pressure Hull Section', 1, 'hull_hp', 50, 100),
  B('uboat', 'hull', 'u_hull_saddle', 'Saddle Tanks', 12, 'dive_rate_pct', 6, 10),
  B('uboat', 'hull', 'u_hull_thick', 'Thickened Pressure Hull', 26, 'test_depth_pct', 5, 9),
  B('uboat', 'diesels', 'u_die_mag', 'MAN Diesels', 1, 'surfaced_speed_pct', 3, 6),
  B('uboat', 'diesels', 'u_die_gw', 'Germaniawerft Diesels', 12, 'recharge_pct', 8, 14),
  B('uboat', 'diesels', 'u_die_super', 'Supercharged Diesels', 28, 'accel_pct', 8, 14),
  B('uboat', 'battery', 'u_bat_afa', 'AFA Battery Bank', 1, 'battery_pct', 5, 10),
  B('uboat', 'battery', 'u_bat_double', 'Double Battery Bank', 16, 'submerged_speed_pct', 5, 9),
  B('uboat', 'battery', 'u_bat_elektro', 'Elektroboot Cells', 32, 'battery_drain_pct', -8, -4),
  B('uboat', 'hydrophones', 'u_hyd_ghg', 'GHG Hydrophone Array', 1, 'sonar_range_pct', 5, 9),
  B('uboat', 'hydrophones', 'u_hyd_kdb', 'KDB Rotating Hydrophone', 14, 'sonar_accuracy_pct', 8, 14),
  B('uboat', 'hydrophones', 'u_hyd_scope', 'Attack Periscope', 26, 'periscope_pct', 10, 16),
  B('uboat', 'torpedoes', 'u_tor_g7a', 'G7a Steam Torpedoes', 1, 'torpedo_speed_pct', 4, 8),
  B('uboat', 'torpedoes', 'u_tor_g7e', 'G7e Electric Torpedoes', 10, 'torpedo_wake_pct', -14, -8),
  B('uboat', 'torpedoes', 'u_tor_fat', 'FAT Pattern-running Torpedoes', 22, 'torpedo_range_pct', 8, 14),
  B('uboat', 'torpedoes', 'u_tor_pistol', 'Improved Magnetic Pistols', 34, 'torpedo_dud_reduction', 4, 8),
  B('uboat', 'deckgun', 'u_gun_88', '8.8 cm SK C/35', 1, 'gun_damage_pct', 4, 8),
  B('uboat', 'deckgun', 'u_gun_flak', '2 cm Flak Vierling', 14, 'gun_reload_pct', 8, 12),
  B('uboat', 'deckgun', 'u_gun_105', '10.5 cm SK C/32', 28, 'gun_range_pct', 6, 10),
  B('uboat', 'countermeasures', 'u_cm_bold', 'Bold Launcher', 1, 'decoy_capacity', 1, 2),
  B('uboat', 'countermeasures', 'u_cm_alberich', 'Alberich Hull Coating', 18, 'noise_pct', -7, -4),
  B('uboat', 'countermeasures', 'u_cm_aphrodite', 'Aphrodite Balloons', 30, 'decoy_duration_pct', 12, 20),
  B('uboat', 'electronics', 'u_el_metox', 'Metox Receiver', 1, 'visual_sig_pct', -6, -3),
  B('uboat', 'electronics', 'u_el_naxos', 'Naxos Receiver', 16, 'radar_range_pct', 8, 14),
  B('uboat', 'electronics', 'u_el_tdc', 'Torpedo Data Computer', 26, 'periscope_pct', 8, 14),
  B('uboat', 'officer', 'u_off_wo', 'First Watch Officer', 1, 'torpedo_reload_pct', 5, 9),
  B('uboat', 'officer', 'u_off_chief', 'Chief Engineer', 12, 'dive_rate_pct', 8, 12),
  B('uboat', 'officer', 'u_off_navi', 'Obersteuermann', 24, 'sonar_accuracy_pct', 6, 10),
  B('uboat', 'mascot', 'u_mas_dog', 'Boat\'s Dachshund', 1, 'loot_find_pct', 5, 10),
  B('uboat', 'mascot', 'u_mas_horseshoe', 'Lucky Horseshoe', 12, 'crit_chance', 1, 2),
  B('uboat', 'mascot', 'u_mas_accordion', 'Battered Accordion', 26, 'xp_pct', 4, 8),
];
export const BASE_BY_ID = new Map(BASES.map((b) => [b.id, b]));

// ------------------------------------------------------------------ legendary powers
export interface PowerDef { id: string; faction: Faction; name: string; min: number; max: number; text: string; slots?: Slot[] }
export const POWERS: PowerDef[] = [
  // escort
  { id: 'pow_echo_marks', faction: 'escort', name: 'Echo-Marker\'s', min: 10, max: 25, text: 'U-boats caught by your ASDIC take {v}% more damage for 6 s.', slots: ['sonar', 'electronics', 'officer'] },
  { id: 'pow_chain_charges', faction: 'escort', name: 'Chain-Reaction', min: 12, max: 30, text: 'Depth charges have a {v}% chance to set off a second detonation nearby.', slots: ['asw', 'officer'] },
  { id: 'pow_proximity_hedgehog', faction: 'escort', name: 'Proximity-fused', min: 20, max: 45, text: 'Hedgehog bombs that miss still burst near the bottom for {v}% damage.', slots: ['asw'] },
  { id: 'pow_flare_aura', faction: 'escort', name: 'Lantern-bearer\'s', min: 10, max: 25, text: 'While a star shell burns overhead, nearby merchants take {v}% less damage.', slots: ['countermeasures', 'electronics', 'guns'] },
  { id: 'pow_ram_shield', faction: 'escort', name: 'Battering', min: 15, max: 35, text: 'After ramming, take {v}% less damage for 10 s.', slots: ['hull', 'engine'] },
  { id: 'pow_auto_ping', faction: 'escort', name: 'Gun-layer\'s', min: 4, max: 10, text: 'Every {v} gun hits fire a free ASDIC ping.', slots: ['guns', 'sonar'] },
  { id: 'pow_convoy_heal', faction: 'escort', name: 'Shepherd\'s', min: 1, max: 3, text: 'Merchants within 600 m repair {v}% hull per 10 s.', slots: ['officer', 'mascot', 'hull'] },
  { id: 'pow_night_guns', faction: 'escort', name: 'Night-fighting', min: 15, max: 35, text: '+{v}% gun reload speed in darkness.', slots: ['guns', 'officer'] },
  // u-boat
  { id: 'pow_split_torpedo', faction: 'uboat', name: 'Twin-eel', min: 10, max: 25, text: 'Torpedoes that hit have a {v}% chance to release a second warhead run.', slots: ['torpedoes'] },
  { id: 'pow_silent_crit', faction: 'uboat', name: 'Assassin\'s', min: 15, max: 35, text: 'While silent running, +{v}% vital hit chance.', slots: ['torpedoes', 'officer', 'battery'] },
  { id: 'pow_ghost_decoy', faction: 'uboat', name: 'Phantom', min: 20, max: 45, text: 'Decoys mimic your signature {v}% more convincingly.', slots: ['countermeasures'] },
  { id: 'pow_hunter_reload', faction: 'uboat', name: 'Hunter\'s', min: 15, max: 35, text: 'Sinking a ship reloads one tube {v}% faster.', slots: ['torpedoes', 'officer'] },
  { id: 'pow_deep_armor', faction: 'uboat', name: 'Abyssal', min: 10, max: 30, text: 'Take {v}% less damage while below the thermal layer.', slots: ['hull', 'battery'] },
  { id: 'pow_battery_vamp', faction: 'uboat', name: 'Leeching', min: 4, max: 10, text: 'Each torpedo hit restores {v}% battery.', slots: ['battery', 'torpedoes'] },
  { id: 'pow_magnetic_master', faction: 'uboat', name: 'Magnetic', min: 10, max: 30, text: 'Under-keel detonations deal +{v}% damage and never dud.', slots: ['torpedoes', 'electronics'] },
  { id: 'pow_wolf_howl', faction: 'uboat', name: 'Howling', min: 15, max: 40, text: 'After a Wolfpack Signal, run {v}% quieter for 20 s.', slots: ['officer', 'electronics', 'mascot'] },
];
export const POWER_BY_ID = new Map(POWERS.map((p) => [p.id, p]));

export function powerText(def: PowerDef, value: number): string { return def.text.replace('{v}', String(value)); }
function makePower(def: PowerDef, value: number): LegendaryPower { return { id: def.id, value, text: powerText(def, value) }; }

// ------------------------------------------------------------------ uniques
export interface UniqueDef {
  id: string; name: string; base: string; flavor: string; minIlvl: number;
  affixes: { stat: StatKey; value: number }[];
  power: { id: string; value: number };
}
export const UNIQUES: UniqueDef[] = [
  // escort
  { id: 'un_grey_shepherd', name: 'The Grey Shepherd', base: 'e_off_first', minIlvl: 12, flavor: '"Not one ship lost on my watch." — a captain\'s boast, kept.', affixes: [{ stat: 'convoy_aura_pct', value: 15 }, { stat: 'hull_hp_pct', value: 12 }], power: { id: 'pow_convoy_heal', value: 4 } },
  { id: 'un_bulldog_bow', name: 'Bulldog\'s Bow', base: 'e_hull_bow', minIlvl: 18, flavor: 'Stem bars doubled and doubled again.', affixes: [{ stat: 'damage_taken_pct', value: -8 }, { stat: 'hull_hp', value: 250 }], power: { id: 'pow_ram_shield', value: 45 } },
  { id: 'un_oscillator', name: 'Whispering Oscillator', base: 'e_son_144', minIlvl: 14, flavor: 'Its operator swore it could hear the U-boat breathe.', affixes: [{ stat: 'sonar_range_pct', value: 25 }, { stat: 'ping_rate_pct', value: 15 }], power: { id: 'pow_echo_marks', value: 32 } },
  { id: 'un_drumfire', name: 'Drumfire Racks', base: 'e_asw_rails', minIlvl: 10, flavor: 'Fourteen charges, one long roll of thunder.', affixes: [{ stat: 'dc_sink_pct', value: 25 }, { stat: 'dc_reload_pct', value: 20 }], power: { id: 'pow_chain_charges', value: 38 } },
  { id: 'un_hedgerow', name: 'The Hedgerow', base: 'e_asw_hedgehog', minIlvl: 20, flavor: 'Twenty-four spigots, a ring of splashes, then silence — or a bang.', affixes: [{ stat: 'dc_radius_pct', value: 15 }, { stat: 'hedgehog_capacity', value: 3 }], power: { id: 'pow_proximity_hedgehog', value: 55 } },
  { id: 'un_lamplighter', name: 'Lamplighter\'s Mount', base: 'e_cm_snowflake', minIlvl: 22, flavor: 'Turn night into day over the whole convoy.', affixes: [{ stat: 'lookout_range_pct', value: 20 }, { stat: 'searchlight_pct', value: 30 }], power: { id: 'pow_flare_aura', value: 32 } },
  { id: 'un_midnight_layer', name: 'Midnight Layer', base: 'e_off_gunnery', minIlvl: 30, flavor: 'Best gunlayer in the group, worst sleeper.', affixes: [{ stat: 'gun_accuracy_pct', value: 25 }, { stat: 'crit_chance', value: 6 }], power: { id: 'pow_night_guns', value: 45 } },
  { id: 'un_tally_ho', name: 'Tally-Ho', base: 'e_gun_4in', minIlvl: 8, flavor: 'Every hit rings the ASDIC hut\'s bell.', affixes: [{ stat: 'gun_accuracy_pct', value: 15 }, { stat: 'gun_reload_pct', value: 15 }], power: { id: 'pow_auto_ping', value: 3 } },
  // u-boat
  { id: 'un_grey_wolf', name: 'Grey Wolf\'s Fangs', base: 'u_tor_g7e', minIlvl: 10, flavor: 'No wake, no warning, no second chance.', affixes: [{ stat: 'torpedo_damage_pct', value: 25 }, { stat: 'torpedo_speed_pct', value: 12 }], power: { id: 'pow_split_torpedo', value: 32 } },
  { id: 'un_iron_lung', name: 'Iron Lung', base: 'u_bat_double', minIlvl: 16, flavor: 'The batteries never seem to run down. Nobody asks why.', affixes: [{ stat: 'battery_pct', value: 30 }, { stat: 'battery_drain_pct', value: -12 }], power: { id: 'pow_battery_vamp', value: 14 } },
  { id: 'un_abyss_plate', name: 'Abyss Plate', base: 'u_hull_thick', minIlvl: 26, flavor: 'Rated for depths the shipyard refused to put in writing.', affixes: [{ stat: 'damage_taken_pct', value: -8 }, { stat: 'hull_hp_pct', value: 15 }], power: { id: 'pow_deep_armor', value: 40 } },
  { id: 'un_silent_night', name: 'Silent Night', base: 'u_off_wo', minIlvl: 8, flavor: 'Rubber-soled boots and orders by hand signal.', affixes: [{ stat: 'noise_pct', value: -15 }, { stat: 'crit_damage_pct', value: 30 }], power: { id: 'pow_silent_crit', value: 45 } },
  { id: 'un_will_o_wisp', name: 'Will-o\'-the-Wisp', base: 'u_cm_bold', minIlvl: 6, flavor: 'The escorts chased it for an hour.', affixes: [{ stat: 'noise_pct', value: -10 }, { stat: 'decoy_duration_pct', value: 40 }], power: { id: 'pow_ghost_decoy', value: 55 } },
  { id: 'un_huntsman', name: 'The Huntsman', base: 'u_off_navi', minIlvl: 24, flavor: 'Plots the next target before the last one has gone under.', affixes: [{ stat: 'torpedo_reload_pct', value: 25 }, { stat: 'periscope_pct', value: 20 }], power: { id: 'pow_hunter_reload', value: 45 } },
  { id: 'un_lodestone', name: 'Lodestone Pistol', base: 'u_tor_pistol', minIlvl: 34, flavor: 'Finally, a magnetic pistol that works.', affixes: [{ stat: 'torpedo_range_pct', value: 15 }, { stat: 'torpedo_damage_pct', value: 20 }], power: { id: 'pow_magnetic_master', value: 40 } },
  { id: 'un_pack_leader', name: 'Pack Leader\'s Accordion', base: 'u_mas_accordion', minIlvl: 26, flavor: 'Played on the bridge the night before every attack.', affixes: [{ stat: 'loot_find_pct', value: 15 }, { stat: 'ability_power_pct', value: 15 }], power: { id: 'pow_wolf_howl', value: 50 } },
];
export const UNIQUE_BY_ID = new Map(UNIQUES.map((u) => [u.id, u]));

// ------------------------------------------------------------------ rolling
const RARE_A = ['Grey', 'Iron', 'Storm', 'Night', 'Salt', 'Black', 'Silent', 'Cold', 'Bitter', 'Wolf', 'Sea', 'Dread', 'Hollow', 'Foam', 'Rust', 'Ember'];
const RARE_B = ['Widow', 'Sentinel', 'Lance', 'Shroud', 'Warden', 'Fang', 'Requiem', 'Tide', 'Vigil', 'Harrow', 'Bane', 'Gale', 'Keel', 'Reckoning', 'Lament', 'Herald'];

/** default rarity weights (loot.ts adjusts them by source and loot find) */
export const BASE_RARITY_WEIGHTS: Record<Rarity, number> = { common: 60, magic: 28, rare: 10, legendary: 1.6, unique: 0.4 };

const sign = (k: StatKey) => (STAT_INFO[k].good === 'down' ? -1 : 1);
const round = (k: StatKey, v: number) => (AFFIX_STATS[k]?.flat || STAT_INFO[k].unit === '' ? Math.round(v) : Math.round(v * 10) / 10);

/** best tier allowed at this item level (1 = T1) */
export function maxTierFor(ilvl: number): number {
  for (let t = 1; t <= 5; t++) if (ilvl >= TIER_ILVL[t - 1]) return t;
  return 5;
}

/** tier value range for a stat, already signed */
export function tierRange(stat: StatKey, tier: number): [number, number] {
  const a = AFFIX_STATS[stat]!, [lo, hi] = TIER_FRAC[tier - 1], s = sign(stat);
  let min = round(stat, a.top * lo), max = round(stat, a.top * hi);
  if (a.flat || STAT_INFO[stat].unit === '') { min = Math.max(1, min); max = Math.max(min, max); }
  return s > 0 ? [min, max] : [-max, -min];
}

function rollAffix(rng: Rng, stat: StatKey, ilvl: number): Affix {
  // tiers above the gate are possible; better tiers are rarer
  const best = maxTierFor(ilvl);
  const tiers = [];
  for (let t = best; t <= 5; t++) tiers.push(t);
  const tier = rng.weighted(tiers, (t) => 1 + (t - best) * 0.8);
  const [min, max] = tierRange(stat, tier);
  return { stat, tier, min, max, value: round(stat, rng.range(min, max)) };
}

let uidCounter = 0;
function uid(rng: Rng) { return 'it' + Math.floor(rng.next() * 2 ** 31).toString(36) + (uidCounter++).toString(36); }

export function salvageValue(rarity: Rarity, ilvl: number): number {
  const r = { common: 10, magic: 25, rare: 70, legendary: 220, unique: 300 }[rarity];
  return Math.round(r * (1 + ilvl * 0.08));
}

function rarityAffixCount(rng: Rng, rarity: Rarity): number {
  switch (rarity) {
    case 'common': return rng.int(0, 1);
    case 'magic': return rng.int(1, 2);
    case 'rare': return rng.int(3, 4);
    case 'legendary': return 3;
    default: return 0;
  }
}

function nameFor(rng: Rng, base: ItemBase, rarity: Rarity, affixes: Affix[], power?: PowerDef): string {
  if (rarity === 'legendary' && power) return `${power.name} ${base.name}`;
  if (rarity === 'rare') return `${rng.pick(RARE_A)} ${rng.pick(RARE_B)} ${base.name}`;
  if (rarity === 'magic' && affixes.length) {
    const pre = AFFIX_STATS[affixes[0].stat]!.prefix;
    const suf = affixes[1] ? ' ' + AFFIX_STATS[affixes[1].stat]!.suffix : '';
    return `${pre} ${base.name}${suf}`;
  }
  return base.name;
}

export interface RollOpts { faction: Faction; ilvl: number; rarity?: Rarity; slot?: Slot; lootFind?: number }

/** weighted rarity roll; lootFind (percentage points) shifts weight toward the rarer grades */
export function rollRarity(rng: Rng, lootFind = 0, weights: Record<Rarity, number> = BASE_RARITY_WEIGHTS): Rarity {
  const f = 1 + Math.max(0, lootFind) / 100;
  const w: Record<Rarity, number> = { common: weights.common / f, magic: weights.magic, rare: weights.rare * f, legendary: weights.legendary * f * f, unique: weights.unique * f * f };
  return rng.weighted(['common', 'magic', 'rare', 'legendary', 'unique'] as Rarity[], (r) => w[r]);
}

export function rollItem(rng: Rng, o: RollOpts): Item {
  const ilvl = Math.max(1, Math.round(o.ilvl));
  let rarity = o.rarity ?? rollRarity(rng, o.lootFind);
  if (rarity === 'unique') {
    const pool = UNIQUES.filter((u) => {
      const b = BASE_BY_ID.get(u.base)!;
      return b.faction === o.faction && u.minIlvl <= ilvl && (!o.slot || b.slot === o.slot);
    });
    if (pool.length) return makeUnique(rng, rng.pick(pool), ilvl);
    rarity = 'legendary';
  }
  const bases = BASES.filter((b) => b.faction === o.faction && b.minIlvl <= ilvl && (!o.slot || b.slot === o.slot));
  const base = bases.length ? rng.pick(bases) : BASES.find((b) => b.faction === o.faction && (!o.slot || b.slot === o.slot))!;
  const imp = base.implicit;
  const impV = round(imp.stat, rng.range(imp.min, imp.max) * (1 + Math.min(ilvl, 50) / 100));
  const implicit: Affix = { stat: imp.stat, value: impV, tier: 0, min: imp.min, max: imp.max };
  const pool = affixPool(o.faction, base.slot).filter((s) => s !== imp.stat);
  const n = Math.min(pool.length, rarityAffixCount(rng, rarity));
  const affixes: Affix[] = [];
  const left = [...pool];
  for (let i = 0; i < n; i++) {
    const s = left.splice(Math.floor(rng.next() * left.length), 1)[0];
    affixes.push(rollAffix(rng, s, ilvl));
  }
  let power: LegendaryPower | undefined, pdef: PowerDef | undefined;
  if (rarity === 'legendary') {
    const fits = POWERS.filter((p) => p.faction === o.faction && (!p.slots || p.slots.includes(base.slot)));
    pdef = rng.pick(fits.length ? fits : POWERS.filter((p) => p.faction === o.faction));
    const q = Math.min(1, ilvl / 50);
    power = makePower(pdef, Math.round(rng.range(pdef.min, pdef.min + (pdef.max - pdef.min) * (0.5 + 0.5 * q))));
  }
  return {
    uid: uid(rng), base: base.id, name: nameFor(rng, base, rarity, affixes, pdef), slot: base.slot, faction: o.faction,
    rarity, ilvl, implicit, affixes, power, value: salvageValue(rarity, ilvl), rerolls: 0,
  };
}

export function makeUnique(rng: Rng, u: UniqueDef, ilvl: number): Item {
  const base = BASE_BY_ID.get(u.base)!;
  const imp = base.implicit;
  const implicit: Affix = { stat: imp.stat, value: round(imp.stat, imp.max * (1 + Math.min(ilvl, 50) / 100)), tier: 0, min: imp.min, max: imp.max };
  const affixes: Affix[] = u.affixes.map((a) => ({ stat: a.stat, value: a.value, tier: 1, min: a.value, max: a.value }));
  const pdef = POWER_BY_ID.get(u.power.id)!;
  return {
    uid: uid(rng), base: base.id, name: u.name, slot: base.slot, faction: base.faction, rarity: 'unique', ilvl,
    implicit, affixes, power: makePower(pdef, u.power.value), uniqueId: u.id, flavor: u.flavor,
    value: salvageValue('unique', ilvl), rerolls: 0,
  };
}

/** shipyard re-roll price for the next re-roll of this item */
export function rerollCost(item: Item): number {
  const r = { common: 40, magic: 80, rare: 160, legendary: 400, unique: 800 }[item.rarity];
  return Math.round(r * (1 + item.ilvl / 20) * Math.pow(1.6, item.rerolls ?? 0));
}

/** re-roll affix `index` into a different stat of the slot pool (uniques cannot be re-rolled) */
export function rerollAffix(item: Item, index: number, rng: Rng): Item {
  if (item.rarity === 'unique' || index < 0 || index >= item.affixes.length) return item;
  const taken = new Set(item.affixes.map((a) => a.stat));
  if (item.implicit) taken.add(item.implicit.stat);
  const pool = affixPool(item.faction, item.slot).filter((s) => !taken.has(s) || s === item.affixes[index].stat);
  const stat = rng.pick(pool);
  const affixes = item.affixes.slice();
  affixes[index] = rollAffix(rng, stat, item.ilvl);
  return { ...item, affixes, rerolls: (item.rerolls ?? 0) + 1 };
}

export function itemStats(item: Item): StatBlock {
  const s = new StatBlock();
  if (item.implicit) s.add(item.implicit.stat, item.implicit.value);
  for (const a of item.affixes) s.add(a.stat, a.value);
  if (item.power) s.addPower(item.power.id, item.power.value);
  return s;
}

/** short human line for an affix, e.g. "+12% Sonar range" */
export function affixText(a: { stat: StatKey; value: number }): string {
  const info = STAT_INFO[a.stat];
  const v = Math.abs(a.value) % 1 ? a.value.toFixed(1) : String(a.value);
  return `${a.value >= 0 ? '+' : ''}${v}${info.unit === '%' ? '%' : info.unit === 'hp' ? ' hp' : ''} ${info.label}`;
}
