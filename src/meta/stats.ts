// The stat vocabulary shared by loot affixes, the captain skill tree, vessel upgrades and
// gameplay. Gameplay ONLY reads stats through these keys (via StatBlock), so any source can
// grant any of them. Values are additive within a key; `_pct` keys are percentage points
// (+10 means +10%), applied as multipliers (1 + sum/100) by gameplay.

export const STAT_KEYS = [
  // ---- survivability
  'hull_hp',              // flat hit points added to the hull
  'hull_hp_pct',
  'damage_taken_pct',     // negative is good
  'flooding_pct',         // flooding rate (negative is good)
  'repair_pct',           // damage-control speed
  'fire_resist_pct',      // fire damage/duration (negative is good, stored as positive resist)
  // ---- handling
  'max_speed_pct',
  'accel_pct',
  'turn_pct',
  // ---- signatures (lower is stealthier)
  'noise_pct',
  'visual_sig_pct',
  // ---- sensors
  'sonar_range_pct',      // ASDIC (escort) / hydrophone (U-boat) range
  'sonar_accuracy_pct',   // bearing & range error reduction
  'ping_rate_pct',        // faster ASDIC ping cycle / sweep
  'radar_range_pct',
  'lookout_range_pct',    // visual detection range
  'periscope_pct',        // periscope observation quality (U-boat TDC solution speed)
  // ---- guns
  'gun_damage_pct',
  'gun_reload_pct',
  'gun_accuracy_pct',
  'gun_range_pct',
  // ---- anti-submarine (escort)
  'dc_damage_pct',
  'dc_radius_pct',
  'dc_capacity',          // flat extra depth charges
  'dc_reload_pct',
  'dc_sink_pct',          // faster sinking charges
  'hedgehog_damage_pct',
  'hedgehog_capacity',    // flat extra salvos
  'star_shells',          // flat extra star shells
  'searchlight_pct',      // searchlight reach
  'ram_damage_pct',
  'convoy_aura_pct',      // merchants near you take less damage (percentage points)
  // ---- torpedoes (U-boat)
  'torpedo_damage_pct',
  'torpedo_speed_pct',
  'torpedo_range_pct',
  'torpedo_reload_pct',
  'torpedo_capacity',     // flat extra reloads carried
  'torpedo_dud_reduction',// percentage points removed from the dud chance
  'torpedo_wake_pct',     // wake visibility (negative is good)
  // ---- U-boat systems
  'battery_pct',          // battery capacity
  'battery_drain_pct',    // negative is good
  'recharge_pct',
  'dive_rate_pct',
  'test_depth_pct',
  'submerged_speed_pct',
  'surfaced_speed_pct',
  'decoy_capacity',       // flat extra decoys (Bold / Foxer)
  'decoy_duration_pct',
  // ---- general combat
  'crit_chance',          // flat percent chance to hit a vital compartment (x2 damage)
  'crit_damage_pct',
  'ability_cooldown_pct', // negative is good (cooldown reduction)
  'ability_power_pct',
  // ---- rewards
  'loot_find_pct',
  'funds_pct',
  'xp_pct',
] as const;

export type StatKey = (typeof STAT_KEYS)[number];

/** human labels and formatting for UI */
export const STAT_INFO: Record<StatKey, { label: string; good: 'up' | 'down'; unit: '%' | '' | 'hp' }> = {
  hull_hp: { label: 'Hull integrity', good: 'up', unit: 'hp' },
  hull_hp_pct: { label: 'Hull integrity', good: 'up', unit: '%' },
  damage_taken_pct: { label: 'Damage taken', good: 'down', unit: '%' },
  flooding_pct: { label: 'Flooding rate', good: 'down', unit: '%' },
  repair_pct: { label: 'Damage control speed', good: 'up', unit: '%' },
  fire_resist_pct: { label: 'Fire resistance', good: 'up', unit: '%' },
  max_speed_pct: { label: 'Top speed', good: 'up', unit: '%' },
  accel_pct: { label: 'Acceleration', good: 'up', unit: '%' },
  turn_pct: { label: 'Rudder response', good: 'up', unit: '%' },
  noise_pct: { label: 'Acoustic signature', good: 'down', unit: '%' },
  visual_sig_pct: { label: 'Visual signature', good: 'down', unit: '%' },
  sonar_range_pct: { label: 'Sonar range', good: 'up', unit: '%' },
  sonar_accuracy_pct: { label: 'Sonar accuracy', good: 'up', unit: '%' },
  ping_rate_pct: { label: 'Ping rate', good: 'up', unit: '%' },
  radar_range_pct: { label: 'Radar range', good: 'up', unit: '%' },
  lookout_range_pct: { label: 'Lookout range', good: 'up', unit: '%' },
  periscope_pct: { label: 'Periscope solution speed', good: 'up', unit: '%' },
  gun_damage_pct: { label: 'Gun damage', good: 'up', unit: '%' },
  gun_reload_pct: { label: 'Gun reload speed', good: 'up', unit: '%' },
  gun_accuracy_pct: { label: 'Gun accuracy', good: 'up', unit: '%' },
  gun_range_pct: { label: 'Gun range', good: 'up', unit: '%' },
  dc_damage_pct: { label: 'Depth charge damage', good: 'up', unit: '%' },
  dc_radius_pct: { label: 'Depth charge lethal radius', good: 'up', unit: '%' },
  dc_capacity: { label: 'Depth charges carried', good: 'up', unit: '' },
  dc_reload_pct: { label: 'Depth charge reload', good: 'up', unit: '%' },
  dc_sink_pct: { label: 'Depth charge sink rate', good: 'up', unit: '%' },
  hedgehog_damage_pct: { label: 'Hedgehog damage', good: 'up', unit: '%' },
  hedgehog_capacity: { label: 'Hedgehog salvos', good: 'up', unit: '' },
  star_shells: { label: 'Star shells', good: 'up', unit: '' },
  searchlight_pct: { label: 'Searchlight reach', good: 'up', unit: '%' },
  ram_damage_pct: { label: 'Ramming damage', good: 'up', unit: '%' },
  convoy_aura_pct: { label: 'Convoy protection aura', good: 'up', unit: '%' },
  torpedo_damage_pct: { label: 'Torpedo damage', good: 'up', unit: '%' },
  torpedo_speed_pct: { label: 'Torpedo speed', good: 'up', unit: '%' },
  torpedo_range_pct: { label: 'Torpedo range', good: 'up', unit: '%' },
  torpedo_reload_pct: { label: 'Tube reload speed', good: 'up', unit: '%' },
  torpedo_capacity: { label: 'Torpedoes carried', good: 'up', unit: '' },
  torpedo_dud_reduction: { label: 'Dud chance reduced', good: 'up', unit: '%' },
  torpedo_wake_pct: { label: 'Torpedo wake', good: 'down', unit: '%' },
  battery_pct: { label: 'Battery capacity', good: 'up', unit: '%' },
  battery_drain_pct: { label: 'Battery drain', good: 'down', unit: '%' },
  recharge_pct: { label: 'Recharge rate', good: 'up', unit: '%' },
  dive_rate_pct: { label: 'Dive rate', good: 'up', unit: '%' },
  test_depth_pct: { label: 'Test depth', good: 'up', unit: '%' },
  submerged_speed_pct: { label: 'Submerged speed', good: 'up', unit: '%' },
  surfaced_speed_pct: { label: 'Surfaced speed', good: 'up', unit: '%' },
  decoy_capacity: { label: 'Decoys carried', good: 'up', unit: '' },
  decoy_duration_pct: { label: 'Decoy duration', good: 'up', unit: '%' },
  crit_chance: { label: 'Vital hit chance', good: 'up', unit: '%' },
  crit_damage_pct: { label: 'Vital hit damage', good: 'up', unit: '%' },
  ability_cooldown_pct: { label: 'Ability cooldowns', good: 'down', unit: '%' },
  ability_power_pct: { label: 'Ability power', good: 'up', unit: '%' },
  loot_find_pct: { label: 'Salvage find', good: 'up', unit: '%' },
  funds_pct: { label: 'Bounty bonus', good: 'up', unit: '%' },
  xp_pct: { label: 'Experience', good: 'up', unit: '%' },
};

/** aggregated stats + keystone flags, read by gameplay */
export class StatBlock {
  readonly v: Partial<Record<StatKey, number>> = {};
  /** keystone flags from the captain tree (e.g. 'ks_silent_hunter') */
  readonly flags = new Set<string>();
  /** legendary powers: power id -> magnitude (summed if several sources) */
  readonly powers = new Map<string, number>();
  add(k: StatKey, n: number) { this.v[k] = (this.v[k] ?? 0) + n; }
  get(k: StatKey): number { return this.v[k] ?? 0; }
  /** multiplier for a _pct stat: 1 + value/100 (clamped so it never flips sign) */
  mul(k: StatKey): number { return Math.max(0.05, 1 + this.get(k) / 100); }
  has(flag: string) { return this.flags.has(flag); }
  power(id: string): number { return this.powers.get(id) ?? 0; }
  addPower(id: string, n: number) { this.powers.set(id, (this.powers.get(id) ?? 0) + n); }
  merge(o: StatBlock) {
    for (const k in o.v) this.add(k as StatKey, o.v[k as StatKey] ?? 0);
    for (const f of o.flags) this.flags.add(f);
    for (const [k, n] of o.powers) this.addPower(k, n);
  }
}
