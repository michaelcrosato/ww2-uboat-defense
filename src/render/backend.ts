// Backend selection: WebGPU (adapter → device → shader/pipeline compile) and, on any failure, a
// fresh canvas with WebGL2. A canvas keeps its first context type, hence replaceCanvas().

import type { Screen } from './screen';
import type { BackendInfo, BackendPref, RenderBackend } from './types';
import { WebGL2Backend } from './webgl2/renderer';
import { WebGPUBackend } from './webgpu/renderer';

/** `auto` picks WebGPU (parity with WebGL2 verified by tools/compare.mjs since M6) */
export const WEBGPU_DEFAULT = true;

export interface BackendOpts {
  /** test hook (`?gpufail=1`): make WebGPU init fail to exercise the fallback */
  gpuFail?: boolean;
  /** test hook (`?gpupresent=readback`): present WebGPU frames through a 2D canvas (headless) */
  gpuReadback?: boolean;
  /** debug (`?testpattern=1`): WebGPU draws the world-anchored test pattern instead of the scene */
  testPattern?: boolean;
  /** test hook (`?glfail=1`): make WebGL2 init fail too (with `?gpufail=1`: the no-renderer boot message) */
  glFail?: boolean;
  /** test hook (`?gpulose=<s>`): report a WebGPU device loss after s seconds (runtime switch to WebGL2) */
  gpuLose?: number;
}

/** shown when neither renderer can start */
export const NO_RENDERER = 'No usable GPU renderer: Wolfpack & Escort needs WebGPU or WebGL2. Check that hardware ' +
  'acceleration is enabled in the browser settings, or try a current Chrome, Edge, Firefox or Safari.';

export async function createBackend(screen: Screen, pref: BackendPref, opts: BackendOpts = {}): Promise<RenderBackend> {
  const tryGpu = pref === 'webgpu' || (pref === 'auto' && WEBGPU_DEFAULT);
  if (tryGpu) {
    try {
      const b = await WebGPUBackend.create(screen, { fail: opts.gpuFail, present: opts.gpuReadback ? 'readback' : 'canvas' }, { testPattern: opts.testPattern });
      console.info(`renderer: WebGPU (${b.info.adapter})`);
      if (opts.gpuLose) setTimeout(() => { b.g.lost ??= 'device lost: simulated (?gpulose)'; }, opts.gpuLose * 1000);
      return b;
    } catch (e) {
      console.warn(`renderer: WebGPU failed, falling back to WebGL2: ${(e as Error).message ?? e}`);
      screen.replaceCanvas();
    }
  }
  return createWebGL2(screen, opts.glFail);
}

/** synchronous WebGL2 on a fresh canvas (runtime fallback after WebGPU device loss) */
export function fallbackToWebGL2(screen: Screen): RenderBackend {
  screen.replaceCanvas();
  return createWebGL2(screen);
}

function createWebGL2(screen: Screen, fail = false): RenderBackend {
  let b: WebGL2Backend;
  try {
    if (fail) throw new Error('forced failure (?glfail=1)');
    b = new WebGL2Backend(screen);
  } catch (e) {
    console.error(`renderer: WebGL2 failed: ${(e as Error).message ?? e}`);
    throw new Error(NO_RENDERER);
  }
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
