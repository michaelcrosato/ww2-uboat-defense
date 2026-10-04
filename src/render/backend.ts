// Backend selection: WebGPU (adapter → device → shader/pipeline compile) and, on any failure, a
// fresh canvas with WebGL2. A canvas keeps its first context type, hence replaceCanvas().

import type { Screen } from './screen';
import type { BackendInfo, BackendPref, RenderBackend } from './types';
import { WebGL2Backend } from './webgl2/renderer';
import { WebGPUBackend } from './webgpu/renderer';

/**
 * Whether `auto` should pick WebGPU. Off until the WebGPU backend renders the whole scene (M6);
 * until then `?renderer=webgpu` / display.renderer=webgpu opt in explicitly.
 */
export const WEBGPU_DEFAULT = false;

export interface BackendOpts {
  /** test hook (`?gpufail=1`): make WebGPU init fail to exercise the fallback */
  gpuFail?: boolean;
  /** test hook (`?gpupresent=readback`): present WebGPU frames through a 2D canvas (headless) */
  gpuReadback?: boolean;
}

export async function createBackend(screen: Screen, pref: BackendPref, opts: BackendOpts = {}): Promise<RenderBackend> {
  const tryGpu = pref === 'webgpu' || (pref === 'auto' && WEBGPU_DEFAULT);
  if (tryGpu) {
    try {
      const b = await WebGPUBackend.create(screen, { fail: opts.gpuFail, present: opts.gpuReadback ? 'readback' : 'canvas' });
      console.info(`renderer: WebGPU (${b.info.adapter})`);
      return b;
    } catch (e) {
      console.warn(`renderer: WebGPU failed, falling back to WebGL2: ${(e as Error).message ?? e}`);
      screen.replaceCanvas();
    }
  }
  return createWebGL2(screen);
}

/** synchronous WebGL2 on a fresh canvas (runtime fallback after WebGPU device loss) */
export function fallbackToWebGL2(screen: Screen): RenderBackend {
  screen.replaceCanvas();
  return createWebGL2(screen);
}

function createWebGL2(screen: Screen): RenderBackend {
  const b = new WebGL2Backend(screen);
  console.info(`renderer: WebGL2 (${b.info.adapter})`);
  return b;
}

export function parseBackendPref(v: string | null | undefined): BackendPref {
  return v === 'webgpu' || v === 'webgl2' ? v : 'auto';
}

/** short overlay label, e.g. "WebGPU (SwiftShader)" */
export function backendLabel(info: BackendInfo): string {
  const name = info.kind === 'webgpu' ? 'WebGPU' : 'WebGL2';
  return /swiftshader/i.test(info.adapter) ? `${name} (SwiftShader)` : name;
}
