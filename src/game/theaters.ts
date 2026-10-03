// Theaters of the Battle of the Atlantic and beyond. Each one sets the water palette, clarity
// (how deep a U-boat stays visible), bioluminescence, swell and latitude (day length, sun angle).

export interface Theater {
  id: string;
  name: string;
  region: string;
  blurb: string;
  /** water albedo ramp, dark (trough/deep) -> light (crest) */
  ramp: string[];
  foam: string;
  foamShade: string;
  /** tint of things seen below the surface */
  murk: string;
  /** visibility of submerged objects (m) */
  clarity: number;
  /** default bioluminescence strength of churned water at night (0..1) */
  bio: number;
  skyDay: string; skyDusk: string; skyNight: string;
  fog: string;
  swellHeight: number; swellDirDeg: number; swellLength: number;
  seaState: number;
  latitude: number;
  /** water temperature drives the thermal layer depth default (m), 0 = none */
  layerDepth: number;
  ice?: boolean;
  coastLights?: boolean;
  /** era flavour for contracts */
  convoyPrefix: string;
}

export const THEATERS: Theater[] = [
  {
    id: 'north_atlantic', name: 'North Atlantic', region: 'Western Approaches', convoyPrefix: 'HX',
    blurb: 'Grey-green swell, short days, the mid-ocean air gap. Where the Battle of the Atlantic was decided.',
    ramp: ['#08151d', '#0d212a', '#132d36', '#1a3a42', '#234950', '#30595f', '#436f73', '#5d8887'],
    foam: '#dbe6e6', foamShade: '#98b0b2', murk: '#0d222a', clarity: 11, bio: 0.12,
    skyDay: '#8d9ca6', skyDusk: '#73636e', skyNight: '#0b1018', fog: '#7c8a90',
    swellHeight: 2.2, swellDirDeg: 70, swellLength: 170, seaState: 5, latitude: 56, layerDepth: 70,
  },
  {
    id: 'arctic', name: 'Arctic', region: 'Barents Sea, Murmansk run', convoyPrefix: 'PQ',
    blurb: 'Black water, pack ice and polar night. Snow squalls hide everything; the cold kills faster than torpedoes.',
    ramp: ['#050c15', '#091422', '#0e1d2f', '#14283c', '#1c344a', '#28445b', '#3a5a72', '#52758c'],
    foam: '#eef4f8', foamShade: '#a9bccb', murk: '#09141f', clarity: 16, bio: 0.04,
    skyDay: '#a6b4c4', skyDusk: '#6e6f86', skyNight: '#05080f', fog: '#9aa6b2',
    swellHeight: 1.6, swellDirDeg: 110, swellLength: 140, seaState: 4, latitude: 72, layerDepth: 0, ice: true,
  },
  {
    id: 'mediterranean', name: 'Mediterranean', region: 'Malta convoys, Alboran Sea', convoyPrefix: 'MW',
    blurb: 'Clear blue water: a U-boat at periscope depth can be seen from the air. Calm seas, short nights.',
    ramp: ['#051d38', '#082a4e', '#0c3864', '#11487b', '#185a91', '#2170a7', '#2f88bb', '#47a2cc'],
    foam: '#f3f7f9', foamShade: '#a8c7da', murk: '#0a2f52', clarity: 32, bio: 0.25,
    skyDay: '#9cc3e6', skyDusk: '#c08a78', skyNight: '#070d1c', fog: '#9bb3c6',
    swellHeight: 0.5, swellDirDeg: 120, swellLength: 90, seaState: 3, latitude: 36, layerDepth: 45,
  },
  {
    id: 'us_east_coast', name: 'US East Coast', region: 'Cape Hatteras, Operation Drumbeat', convoyPrefix: 'KS',
    blurb: '1942: the coast is not blacked out. Ships are silhouetted against the glow of the cities.',
    ramp: ['#0a1925', '#0f2533', '#153140', '#1d3f4e', '#274e5d', '#345f6c', '#47737f', '#618b94'],
    foam: '#e2ecee', foamShade: '#9fb7bd', murk: '#0d2230', clarity: 14, bio: 0.2,
    skyDay: '#93a9bb', skyDusk: '#a07a74', skyNight: '#0c1220', fog: '#8796a2',
    swellHeight: 1.2, swellDirDeg: 250, swellLength: 120, seaState: 3, latitude: 35, layerDepth: 40, coastLights: true,
  },
  {
    id: 'caribbean', name: 'Caribbean', region: 'Aruba, Trinidad, the tanker routes', convoyPrefix: 'TAW',
    blurb: 'Turquoise water and glowing wakes. Bioluminescence betrays every boat that moves at night.',
    ramp: ['#042c3e', '#073d55', '#0a516c', '#0e6784', '#157f9a', '#1f98ad', '#30b1bf', '#4fc9cc'],
    foam: '#f5fbfb', foamShade: '#a5d6d9', murk: '#08475b', clarity: 26, bio: 0.85,
    skyDay: '#8ec9e8', skyDusk: '#d0967a', skyNight: '#061224', fog: '#a9cdd8',
    swellHeight: 0.7, swellDirDeg: 260, swellLength: 100, seaState: 3, latitude: 14, layerDepth: 60,
  },
  {
    id: 'indian_ocean', name: 'Indian Ocean', region: 'Monsun boats off Ceylon', convoyPrefix: 'PA',
    blurb: 'Deep ultramarine, long monsoon swell, phosphorescent seas and humid haze.',
    ramp: ['#03172f', '#062243', '#0a2f58', '#0f3e6d', '#164f82', '#1f6296', '#2d79aa', '#4392bd'],
    foam: '#f1f6fa', foamShade: '#9fbcd6', murk: '#082c52', clarity: 24, bio: 0.7,
    skyDay: '#93bde0', skyDusk: '#c98e70', skyNight: '#060c1d', fog: '#a5b8c8',
    swellHeight: 2.0, swellDirDeg: 30, swellLength: 200, seaState: 4, latitude: 8, layerDepth: 80,
  },
];

export const theaterById = (id: string) => THEATERS.find((t) => t.id === id) ?? THEATERS[0];
