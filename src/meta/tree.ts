// Captain skill trees: a Path-of-Exile style constellation per faction. The start sits at (0,0);
// four branches radiate diagonally, each a spine of small nodes with notables, two side arms and
// keystones at the far ends; bridges join neighbouring branches so builds can mix themes.
// The layout is generated from the branch definitions below (deterministic, no randomness).

import type { Faction, SkillTree, TreeNode } from './types.ts';
import { StatBlock, type StatKey } from './stats.ts';

type S = { stat: StatKey; value: number };
interface Keystone { id: string; name: string; flag: string; desc: string; stats?: S[] }
interface Notable { name: string; stats: S[] }
interface Branch {
  name: string;
  /** small-node stats cycle through this list */
  small: S[];
  notables: [Notable, Notable, Notable, Notable];
  /** spine end keystone and optional left-arm keystone */
  keystones: [Keystone] | [Keystone, Keystone];
}

const s = (stat: StatKey, value: number): S => ({ stat, value });

const ESCORT: Branch[] = [
  {
    name: 'Hunter',
    small: [s('sonar_range_pct', 4), s('dc_damage_pct', 5), s('sonar_accuracy_pct', 5), s('dc_radius_pct', 4), s('ping_rate_pct', 4), s('hedgehog_damage_pct', 5), s('dc_reload_pct', 5), s('dc_sink_pct', 6)],
    notables: [
      { name: 'Asdic Hut Discipline', stats: [s('sonar_range_pct', 8), s('sonar_accuracy_pct', 10)] },
      { name: 'Creeping Attack', stats: [s('dc_damage_pct', 12), s('dc_sink_pct', 10), s('noise_pct', -4)] },
      { name: 'Spigot Mortar Drill', stats: [s('hedgehog_damage_pct', 14), s('hedgehog_capacity', 1)] },
      { name: 'Full Pattern', stats: [s('dc_capacity', 4), s('dc_radius_pct', 8)] },
    ],
    keystones: [
      { id: 'hunter_killer', name: 'Hunter-Killer', flag: 'ks_hunter_killer', desc: 'Depth charges and Hedgehog bombs deal 30% more damage.' },
      { id: 'silent_listener', name: 'Silent Listener', flag: 'ks_silent_listener', desc: 'Your ASDIC never transmits, but you hear U-boats at twice the range.' },
    ],
  },
  {
    name: 'Shepherd',
    small: [s('convoy_aura_pct', 3), s('hull_hp_pct', 4), s('repair_pct', 6), s('lookout_range_pct', 5), s('damage_taken_pct', -2), s('searchlight_pct', 6), s('radar_range_pct', 5), s('hull_hp', 60)],
    notables: [
      { name: 'Commodore\'s Trust', stats: [s('convoy_aura_pct', 6), s('funds_pct', 6)] },
      { name: 'Damage Control School', stats: [s('repair_pct', 15), s('flooding_pct', -10)] },
      { name: 'Western Approaches', stats: [s('lookout_range_pct', 10), s('radar_range_pct', 10)] },
      { name: 'Rescue Ship', stats: [s('hull_hp_pct', 8), s('xp_pct', 6)] },
    ],
    keystones: [
      { id: 'shepherd', name: 'Shepherd', flag: 'ks_shepherd', desc: 'Merchants near you take 25% less damage; you are 10% slower.', stats: [s('convoy_aura_pct', 25), s('max_speed_pct', -10)] },
      { id: 'star_gazer', name: 'Star Gazer', flag: 'ks_star_gazer', desc: 'Star shells burn twice as long, but your searchlight is removed.' },
    ],
  },
  {
    name: 'Gunnery',
    small: [s('gun_damage_pct', 5), s('gun_reload_pct', 4), s('gun_accuracy_pct', 5), s('gun_range_pct', 4), s('crit_chance', 1), s('crit_damage_pct', 8), s('star_shells', 1), s('ability_power_pct', 3)],
    notables: [
      { name: 'Director Control', stats: [s('gun_accuracy_pct', 12), s('gun_range_pct', 8)] },
      { name: 'Quick-firing Drill', stats: [s('gun_reload_pct', 12), s('gun_damage_pct', 6)] },
      { name: 'Vital Spot', stats: [s('crit_chance', 3), s('crit_damage_pct', 20)] },
      { name: 'Illumination Party', stats: [s('star_shells', 2), s('searchlight_pct', 12)] },
    ],
    keystones: [
      { id: 'gunnery_school', name: 'Gunnery School', flag: 'ks_gunnery_school', desc: 'Guns deal 40% more damage; you carry 30% fewer depth charges.' },
    ],
  },
  {
    name: 'Seamanship',
    small: [s('max_speed_pct', 3), s('turn_pct', 5), s('accel_pct', 5), s('ram_damage_pct', 8), s('flooding_pct', -5), s('fire_resist_pct', 6), s('ability_cooldown_pct', -2), s('hull_hp', 60)],
    notables: [
      { name: 'Full Ahead Both', stats: [s('max_speed_pct', 6), s('accel_pct', 10)] },
      { name: 'Hard a-Starboard', stats: [s('turn_pct', 14), s('damage_taken_pct', -3)] },
      { name: 'Old Hand', stats: [s('ability_cooldown_pct', -6), s('ability_power_pct', 6)] },
      { name: 'Fire Party', stats: [s('fire_resist_pct', 15), s('repair_pct', 10)] },
    ],
    keystones: [
      { id: 'iron_bow', name: 'Iron Bow', flag: 'ks_iron_bow', desc: 'Ramming deals triple damage and you take half damage from collisions.' },
    ],
  },
];

const UBOAT: Branch[] = [
  {
    name: 'Wolf',
    small: [s('torpedo_damage_pct', 5), s('torpedo_reload_pct', 4), s('torpedo_speed_pct', 4), s('torpedo_range_pct', 5), s('torpedo_dud_reduction', 2), s('periscope_pct', 6), s('crit_chance', 1), s('crit_damage_pct', 8)],
    notables: [
      { name: 'Fan Shot', stats: [s('torpedo_damage_pct', 10), s('torpedo_reload_pct', 8)] },
      { name: 'Pistol Experts', stats: [s('torpedo_dud_reduction', 5), s('crit_chance', 2)] },
      { name: 'Attack Periscope', stats: [s('periscope_pct', 15), s('torpedo_range_pct', 8)] },
      { name: 'Eels Aplenty', stats: [s('torpedo_capacity', 1), s('torpedo_speed_pct', 6)] },
    ],
    keystones: [
      { id: 'wolf_leader', name: 'Wolf Leader', flag: 'ks_wolf_leader', desc: 'Your abilities are 20% stronger, but you carry 2 fewer torpedo reloads.', stats: [s('ability_power_pct', 20)] },
      { id: 'one_torpedo', name: 'One Torpedo, One Ship', flag: 'ks_one_torpedo', desc: 'Single torpedoes deal 80% more damage; spreads deal half damage.' },
    ],
  },
  {
    name: 'Ghost',
    small: [s('noise_pct', -3), s('visual_sig_pct', -3), s('torpedo_wake_pct', -5), s('decoy_duration_pct', 8), s('battery_drain_pct', -3), s('sonar_range_pct', 4), s('decoy_capacity', 1), s('submerged_speed_pct', 3)],
    notables: [
      { name: 'Rubber Soles', stats: [s('noise_pct', -6), s('battery_drain_pct', -4)] },
      { name: 'Pillenwerfer Drill', stats: [s('decoy_capacity', 1), s('decoy_duration_pct', 15)] },
      { name: 'Grey on Grey', stats: [s('visual_sig_pct', -8), s('torpedo_wake_pct', -10)] },
      { name: 'Listening Watch', stats: [s('sonar_range_pct', 10), s('sonar_accuracy_pct', 10)] },
    ],
    keystones: [
      { id: 'ghost', name: 'Ghost', flag: 'ks_ghost', desc: 'Decoys last twice as long, but you take 20% more damage while submerged.' },
      { id: 'silent_hunter', name: 'Silent Hunter', flag: 'ks_silent_hunter', desc: 'You run 4 dB quieter, but the deck gun is removed.' },
    ],
  },
  {
    name: 'Iron Coffin',
    small: [s('hull_hp_pct', 4), s('test_depth_pct', 3), s('dive_rate_pct', 5), s('flooding_pct', -5), s('repair_pct', 6), s('damage_taken_pct', -2), s('battery_pct', 5), s('hull_hp', 50)],
    notables: [
      { name: 'Alarm! Fluten!', stats: [s('dive_rate_pct', 15), s('accel_pct', 6)] },
      { name: 'Shored Bulkheads', stats: [s('flooding_pct', -12), s('repair_pct', 10)] },
      { name: 'Deep Rated', stats: [s('test_depth_pct', 8), s('hull_hp_pct', 6)] },
      { name: 'Double Battery', stats: [s('battery_pct', 12), s('recharge_pct', 10)] },
    ],
    keystones: [
      { id: 'iron_coffin', name: 'Iron Coffin', flag: 'ks_iron_coffin', desc: 'Your test depth is 40% deeper; you are 8% slower surfaced.', stats: [s('surfaced_speed_pct', -8)] },
    ],
  },
  {
    name: 'Raider',
    small: [s('surfaced_speed_pct', 3), s('gun_damage_pct', 5), s('gun_reload_pct', 4), s('lookout_range_pct', 5), s('recharge_pct', 6), s('funds_pct', 3), s('loot_find_pct', 4), s('submerged_speed_pct', 3)],
    notables: [
      { name: 'Surface Runner', stats: [s('surfaced_speed_pct', 6), s('recharge_pct', 10)] },
      { name: 'Gun Action', stats: [s('gun_damage_pct', 12), s('gun_accuracy_pct', 10)] },
      { name: 'Prize Rules', stats: [s('funds_pct', 8), s('loot_find_pct', 8)] },
      { name: 'Bridge Watch', stats: [s('lookout_range_pct', 12), s('periscope_pct', 8)] },
    ],
    keystones: [
      { id: 'night_surface', name: 'Night Surface Attack', flag: 'ks_night_surface', desc: 'Surfaced you are faster and see further, but are 30% easier to spot in daylight.', stats: [s('surfaced_speed_pct', 10), s('lookout_range_pct', 15)] },
    ],
  },
];

/** local layout of one branch (u = outward along the branch, v = sideways) */
const SPINE_U = [120, 220, 320, 420, 520, 620, 720, 820];
const ARM_L: [number, number][] = [[380, -110], [450, -200], [540, -280], [640, -340], [740, -390]];
const ARM_R: [number, number][] = [[580, 110], [660, 195], [760, 260], [860, 310]];
const SIDE: [number, number][] = [[660, -110], [720, -190]];

function build(faction: Faction, branches: Branch[]): SkillTree {
  const nodes: TreeNode[] = [];
  const byId = new Map<string, TreeNode>();
  const add = (n: Omit<TreeNode, 'links'>) => { const node: TreeNode = { ...n, links: [] }; nodes.push(node); byId.set(n.id, node); return node; };
  const link = (a: string, b: string) => {
    const A = byId.get(a)!, Bn = byId.get(b)!;
    if (!A.links.includes(b)) A.links.push(b);
    if (!Bn.links.includes(a)) Bn.links.push(a);
  };
  const start = add({ id: `${faction}_start`, kind: 'start', name: faction === 'escort' ? 'Escort Group' : 'Flotilla', x: 0, y: 0, stats: [] });
  const spineIds: string[][] = [];
  branches.forEach((br, bi) => {
    const ang = Math.PI / 4 + bi * Math.PI / 2;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const pos = (u: number, v: number) => ({ x: Math.round(u * ca - v * sa), y: Math.round(u * sa + v * ca) });
    const key = br.name.toLowerCase().replace(/\s+/g, '_');
    let si = 0;
    const small = (id: string, u: number, v: number) => {
      const st = br.small[si++ % br.small.length];
      return add({ id, kind: 'small', name: br.name, ...pos(u, v), stats: [st], cluster: br.name });
    };
    const notable = (id: string, n: Notable, u: number, v: number) =>
      add({ id, kind: 'notable', name: n.name, ...pos(u, v), stats: n.stats, cluster: br.name });
    const keystone = (k: Keystone, u: number, v: number) =>
      add({ id: `${faction}_ks_${k.id}`, kind: 'keystone', name: k.name, ...pos(u, v), stats: k.stats ?? [], flag: k.flag, desc: k.desc, cluster: br.name });
    // spine: notables at positions 3 and 6
    const sp: string[] = [];
    SPINE_U.forEach((u, i) => {
      const id = `${faction}_${key}_s${i}`;
      if (i === 3) notable(id, br.notables[0], u, 0);
      else if (i === 6) notable(id, br.notables[1], u, 0);
      else small(id, u, 0);
      sp.push(id);
    });
    link(start.id, sp[0]);
    for (let i = 1; i < sp.length; i++) link(sp[i - 1], sp[i]);
    spineIds.push(sp);
    const ksEnd = keystone(br.keystones[0], 920, 0);
    link(sp[sp.length - 1], ksEnd.id);
    // left arm from spine node 2, ends in a notable (and a keystone when the branch has two)
    let prev = sp[2];
    ARM_L.forEach(([u, v], i) => {
      const id = `${faction}_${key}_l${i}`;
      const last = i === ARM_L.length - 1;
      if (last && br.keystones[1]) keystone(br.keystones[1], u, v);
      else if (i === 2) notable(id, br.notables[2], u, v);
      else small(id, u, v);
      const real = last && br.keystones[1] ? `${faction}_ks_${br.keystones[1].id}` : id;
      link(prev, real);
      prev = real;
    });
    // right arm from spine node 4, ends in a notable
    prev = sp[4];
    ARM_R.forEach(([u, v], i) => {
      const id = `${faction}_${key}_r${i}`;
      if (i === ARM_R.length - 1) notable(id, br.notables[3], u, v);
      else small(id, u, v);
      link(prev, id);
      prev = id;
    });
    // small side loop between the spine and the left arm
    prev = sp[5];
    SIDE.forEach(([u, v], i) => {
      const id = `${faction}_${key}_x${i}`;
      small(id, u, v);
      link(prev, id);
      prev = id;
    });
    link(prev, `${faction}_${key}_l3`);
  });
  // bridges between neighbouring branches (spine node 3 ↔ next branch spine node 3)
  for (let bi = 0; bi < branches.length; bi++) {
    const a = spineIds[bi][3], b = spineIds[(bi + 1) % branches.length][3];
    const A = byId.get(a)!, Bn = byId.get(b)!;
    const mx = (A.x + Bn.x) / 2, my = (A.y + Bn.y) / 2, r = Math.hypot(mx, my) || 1;
    const R = 420 * 0.86;
    const id = `${faction}_bridge${bi}`;
    const st = branches[bi].small[bi % branches[bi].small.length];
    add({ id, kind: 'small', name: 'Crossover', x: Math.round((mx / r) * R), y: Math.round((my / r) * R), stats: [st], cluster: 'Crossover' });
    link(a, id); link(id, b);
  }
  return { faction, nodes, startId: start.id };
}

export const ESCORT_TREE: SkillTree = build('escort', ESCORT);
export const UBOAT_TREE: SkillTree = build('uboat', UBOAT);
export const TREES: Record<Faction, SkillTree> = { escort: ESCORT_TREE, uboat: UBOAT_TREE };

export function nodeById(tree: SkillTree, id: string): TreeNode | undefined { return tree.nodes.find((n) => n.id === id); }

/** a node can be taken when it is not taken yet and touches the start or a taken node */
export function canAllocate(tree: SkillTree, allocated: readonly string[], id: string): boolean {
  const n = nodeById(tree, id);
  if (!n || n.kind === 'start' || allocated.includes(id)) return false;
  const have = new Set(allocated);
  return n.links.some((l) => l === tree.startId || have.has(l));
}

/** a node can be refunded when every other taken node stays connected to the start */
export function canRefund(tree: SkillTree, allocated: readonly string[], id: string): boolean {
  if (!allocated.includes(id)) return false;
  const rest = new Set(allocated.filter((a) => a !== id));
  const seen = new Set<string>([tree.startId]);
  const queue = [tree.startId];
  while (queue.length) {
    const cur = nodeById(tree, queue.pop()!)!;
    for (const l of cur.links) if (rest.has(l) && !seen.has(l)) { seen.add(l); queue.push(l); }
  }
  for (const r of rest) if (!seen.has(r)) return false;
  return true;
}

export function treeStats(tree: SkillTree, allocated: readonly string[]): StatBlock {
  const out = new StatBlock();
  const have = new Set(allocated);
  for (const n of tree.nodes) {
    if (!have.has(n.id)) continue;
    for (const st of n.stats) out.add(st.stat, st.value);
    if (n.flag) out.flags.add(n.flag);
  }
  return out;
}
