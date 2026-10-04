// Material ids written to the G-buffer (albedo.a = id / 255) and CPU particle kinds. Shared by
// every backend; the shader-side #defines (MAT_GLSL, later WGSL consts) must match these values.

export const MAT = {
  NONE: 0,
  WATER: 1,
  METAL: 2,
  WOOD: 3,
  FOAM: 4,
  FIRE: 5,
  SMOKE: 6,
  LAMP: 7,
  UNDERWATER: 8,
  SPRAY: 9,
  ICE: 10,
  LAND: 11,
} as const;

export const PK = {
  SPRAY: 0, MIST: 1, SMOKE: 2, FIRE: 3, SPARK: 4, DEBRIS: 5, FOAMBIT: 6, STEAM: 7, TRACER: 8, SHEET: 9, FLASH: 10, SNOW: 11,
} as const;
