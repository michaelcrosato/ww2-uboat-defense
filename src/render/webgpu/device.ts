// WebGPU device + canvas setup. Everything that can fail (adapter, device, shader compilation,
// pipeline validation) fails here, during init, so createBackend can fall back to WebGL2 instead of
// showing a black screen. Runtime loss / errors are recorded in `lost` for the App to act on.

export type PresentMode = 'canvas' | 'readback';

export interface GpuContext {
  adapter: GPUAdapter;
  device: GPUDevice;
  /** 'canvas': WebGPU canvas context. 'readback' (test hook): frames are copied to a 2D canvas */
  present: PresentMode;
  context: GPUCanvasContext | null;
  ctx2d: CanvasRenderingContext2D | null;
  /** format of the presented image (the canvas format, or rgba8unorm for readback) */
  format: GPUTextureFormat;
  features: string[];
  adapterName: string;
  hasTimestamps: boolean;
  /** set when the device is lost or reports an uncaptured error: switch backends */
  lost: string | null;
}

export interface GpuInitOpts {
  /** test hook (`?gpufail=1`): fail after the canvas got its WebGPU context */
  fail?: boolean;
  /**
   * test hook (`?gpupresent=readback`): headless Chromium + SwiftShader loses the device as soon as a
   * canvas texture is presented, so screenshots read each frame back into a 2D canvas instead (slow).
   */
  present?: PresentMode;
}

export async function initGpu(canvas: HTMLCanvasElement, opts: GpuInitOpts = {}): Promise<GpuContext> {
  if (!('gpu' in navigator) || !navigator.gpu) throw new Error('navigator.gpu is missing (no WebGPU in this browser)');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('no WebGPU adapter');
  const want: GPUFeatureName[] = ['float32-filterable', 'timestamp-query'];
  const requiredFeatures = want.filter((f) => adapter.features.has(f));
  const device = await adapter.requestDevice({ requiredFeatures });
  const present = opts.present ?? 'canvas';
  let context: GPUCanvasContext | null = null, ctx2d: CanvasRenderingContext2D | null = null;
  let format: GPUTextureFormat;
  if (present === 'readback') {
    ctx2d = canvas.getContext('2d', { alpha: false });
    if (!ctx2d) { device.destroy(); throw new Error('canvas.getContext("2d") returned null'); }
    format = 'rgba8unorm';
  } else {
    context = canvas.getContext('webgpu') as GPUCanvasContext | null;
    if (!context) { device.destroy(); throw new Error('canvas.getContext("webgpu") returned null'); }
    format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });
  }
  if (opts.fail) { device.destroy(); throw new Error('forced failure (?gpufail=1)'); }
  const info = adapter.info;
  const adapterName = [info?.vendor, info?.architecture, info?.description].filter((s) => s).join(' ') || 'unknown adapter';
  const ctx: GpuContext = {
    adapter, device, present, context, ctx2d, format, adapterName,
    features: [...device.features].map(String).sort(),
    hasTimestamps: device.features.has('timestamp-query'),
    lost: null,
  };
  device.lost.then((e) => { if (e.reason !== 'destroyed') ctx.lost = `device lost: ${e.message || e.reason}`; });
  device.addEventListener('uncapturederror', (e) => {
    const msg = (e as GPUUncapturedErrorEvent).error.message;
    console.error('WebGPU error:', msg);
    ctx.lost ??= `uncaptured error: ${msg.split('\n')[0]}`;
  });
  if (context) await probePresent(ctx, context);
  return ctx;
}

/** present one cleared frame and make sure the device survives it (it does not in headless SwiftShader) */
async function probePresent(g: GpuContext, context: GPUCanvasContext) {
  const enc = g.device.createCommandEncoder({ label: 'present probe' });
  enc.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] }).end();
  g.device.queue.submit([enc.finish()]);
  await g.device.queue.onSubmittedWorkDone().catch(() => undefined);
  await new Promise((r) => setTimeout(r, 50));
  if (g.lost) {
    g.device.destroy();
    throw new Error(`presenting to the canvas lost the device (${g.lost}); headless tests: add ?gpupresent=readback`);
  }
}

/** create a shader module and throw with the first compile error (so init can fall back) */
export async function shaderModule(g: GpuContext, label: string, code: string): Promise<GPUShaderModule> {
  const m = g.device.createShaderModule({ label, code });
  const info = await m.getCompilationInfo();
  const err = info.messages.find((x) => x.type === 'error');
  if (err) {
    const line = code.split('\n')[err.lineNum - 1] ?? '';
    throw new Error(`WGSL ${label}:${err.lineNum}:${err.linePos} ${err.message}\n  > ${line.trim()}`);
  }
  return m;
}

/** run pipeline/resource creation under a validation scope; throws on the first validation error */
export async function validated<T>(g: GpuContext, what: string, fn: () => T | Promise<T>): Promise<T> {
  g.device.pushErrorScope('validation');
  let out: T;
  try { out = await fn(); } finally {
    const e = await g.device.popErrorScope();
    if (e) throw new Error(`WebGPU validation (${what}): ${e.message.split('\n')[0]}`);
  }
  return out;
}
