// The contract between the game and a renderer. Game code fills a RenderScene; a RenderBackend
// (WebGPU or WebGL2) turns scene + FrameParams into a finished, presented frame.

import type { Camera } from './camera';
import type { RenderScene } from './scene';
import type { Ocean } from '../water/ocean';
import type { Environment } from '../game/environment';
import type { Theater } from '../game/theaters';

export type BackendKind = 'webgpu' | 'webgl2';
export type BackendPref = 'auto' | BackendKind;

export interface BackendInfo {
  kind: BackendKind;
  adapter: string;
  /** water sims run as compute shaders (WebGPU) rather than fragment passes */
  computeSims: boolean;
  features: string[];
}

export interface BackendStats {
  stackInstances: number;
  particles: number;
  lights: number;
  gpuMs?: number;
  /** per-pass GPU ms (WebGPU with timestamp-query) */
  passMs?: Record<string, number>;
}

export interface FrameParams {
  camera: Camera;
  ocean: Ocean;
  env: Environment;
  theater: Theater;
  /** simulated seconds since the last frame (0 = paused: water sims hold) */
  simDt: number;
  time: number;
  flash: number;
  flashCol: [number, number, number];
  bio: number;
  ice: number;
}

export interface RenderBackend {
  readonly info: BackendInfo;
  readonly stats: BackendStats;
  /** set when the backend can no longer render (WebGPU device lost / error): the App swaps to WebGL2 */
  readonly lost?: string | null;
  resize(): void;
  /** whole frame incl. present */
  render(scene: RenderScene, f: FrameParams): void;
  /** new mission / camera teleport: clear the water sims and re-center their window */
  resetSims(): void;
  /** resolves once all submitted GPU work has finished (tests) */
  whenIdle(): Promise<void>;
  /** tests: never skip a frame for pacing (deterministic sim stepping across backends) */
  strictFrames?: boolean;
  dispose(): void;
}
