// Backend selection. Target chain (M2+): WebGPU (adapter → device → pipelines) and on any failure
// a fresh canvas with WebGL2. Until the WebGPU backend exists, every preference gets WebGL2.

import type { Screen } from './screen';
import type { BackendPref, RenderBackend } from './types';
import { WebGL2Backend } from './webgl2/renderer';

export async function createBackend(screen: Screen, pref: BackendPref): Promise<RenderBackend> {
  if (pref === 'webgpu') console.info('renderer: WebGPU backend not implemented yet; using WebGL2');
  return new WebGL2Backend(screen);
}

export function parseBackendPref(v: string | null | undefined): BackendPref {
  return v === 'webgpu' || v === 'webgl2' ? v : 'auto';
}
