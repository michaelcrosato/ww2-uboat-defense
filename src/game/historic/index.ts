// The historical battles (M17): menu entries, the arena settings each one fixes, and construction.

import type { Mission } from '../mission';
import type { RenderScene } from '../../render/scene';
import type { Scenario } from './scenario';
import { PearlHarbor } from './pearlHarbor';
import { Midway } from './midway';

export interface BattleInfo {
  id: string; name: string; date: string; blurb: string;
  /** who the player commands on each side */
  escort: string; uboat: string;
}

export const BATTLES: BattleInfo[] = [
  {
    id: 'pearl_harbor', name: 'Pearl Harbor', date: 'Sunday 7 December 1941, 07:50',
    blurb: 'The Pacific Fleet at its moorings, true to scale on the real harbour. 353 carrier aircraft in two waves; a midget submarine loose in the North Channel.',
    escort: 'USS Monaghan (DD-354), the ready-duty destroyer, moored outboard in the nest at X-14',
    uboat: 'Type A midget submarine from I-22, two torpedoes, inside the harbour',
  },
  {
    id: 'midway', name: 'Midway', date: 'Thursday 4 June 1942, 08:10',
    blurb: 'The Japanese carrier striking force at sea: Akagi, Kaga, Soryu and Hiryu with their screen, the torpedo squadrons\' sacrifice and the dive bombers at 10:22.',
    escort: 'Destroyer Arashi in the screen of the carrier striking force',
    uboat: 'USS Nautilus (SS-168), the submarine that worked in on the Kido Butai',
  },
];

/** arena settings a battle fixes (the player's side and the seed stay theirs) */
export function battlePreset(id: string): Record<string, number | string | boolean> {
  const forces = { 'arena.convoy': 0, 'arena.escorts': 0, 'arena.uboats': 0, 'arena.aircraft': 'none', 'arena.islands': 0, 'arena.lighthouse': false, 'arena.timeFlow': 1, 'arena.survivors': true };
  if (id === 'pearl_harbor') return { ...forces, 'arena.theater': 'pearl_harbor', 'arena.year': 1941, 'arena.hour': 7 + 50.01 / 60, 'arena.season': '0', 'arena.weather': 'clear', 'arena.seaState': 1, 'arena.swell': 0.05, 'arena.windDir': 60, 'arena.layer': 0, 'arena.moon': 0.6 };
  if (id === 'midway') return { ...forces, 'arena.theater': 'pacific', 'arena.year': 1942, 'arena.hour': 8 + 10.01 / 60, 'arena.season': '1', 'arena.weather': 'clear', 'arena.seaState': 3, 'arena.swell': 1.2, 'arena.windDir': 120, 'arena.layer': 90, 'arena.moon': 0.2 };
  return {};
}

export function createScenario(id: string, m: Mission, scene: RenderScene): Scenario | null {
  if (id === 'pearl_harbor') return new PearlHarbor(m, scene);
  if (id === 'midway') return new Midway(m, scene);
  return null;
}
