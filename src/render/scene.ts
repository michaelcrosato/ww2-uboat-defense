// Backend-agnostic frame scene. Game code fills it (sprite stacks, lights, particles, water-sim
// inputs) and never touches a renderer; a RenderBackend consumes it once per frame.

import { SliceAtlas, type StackModel } from '../art/voxel';
import type { Quat } from '../core/math';
import type { HullInput, SplatInput } from '../water/simInputs';
import { LightList } from './lights';
import { ParticleSystem } from './particles';
import { FxSystem } from './fx';

export interface StackInstance {
  model: StackModel;
  x: number; y: number; z: number;
  q: Quat;
  damage?: number;
  flags?: number;      // 1 lamps on, 2 x-ray silhouette, 4 shadow decal (G-buffer only), 8 flatten, 16 airborne (no occluder)
  clipX0?: number; clipX1?: number;
  /** two damage centres in model x: (x, radius, x, radius); radius 0 = none */
  hits?: [number, number, number, number];
}

export class RenderScene {
  /** voxel slice atlas (CPU pixels; backends re-upload it when its `version` changes) */
  atlas = new SliceAtlas(2048);
  stacks: StackInstance[] = [];
  particles = new ParticleSystem();
  /** GPU effect particles, shockwaves, heat haze and camera trauma (render/fx.ts) */
  fx = new FxSystem();
  lights = new LightList();
  /** moving water-sim sources, rebuilt every frame */
  hulls: HullInput[] = [];
  /** one-shot water-sim impulses; kept until a frame actually steps the sims */
  splats: SplatInput[] = [];

  /** start gathering a new frame (splats persist until consumed by a sim step) */
  beginFrame() {
    this.stacks.length = 0;
    this.fx.heat.length = 0;
    this.fx.emitters.length = 0;
    this.lights.clear();
    this.hulls.length = 0;
  }
}
