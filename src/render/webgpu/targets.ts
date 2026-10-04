// Small WebGPU resource helpers: render targets, the two shared samplers, uniform buffers.

// Usage flag values from the WebGPU spec (TypeScript's DOM lib has the flag types but not the
// GPUTextureUsage / GPUBufferUsage constant objects).
export const TU = { COPY_SRC: 0x01, COPY_DST: 0x02, TEXTURE_BINDING: 0x04, STORAGE_BINDING: 0x08, RENDER_ATTACHMENT: 0x10 } as const;
export const BU = {
  MAP_READ: 0x0001, MAP_WRITE: 0x0002, COPY_SRC: 0x0004, COPY_DST: 0x0008, INDEX: 0x0010, VERTEX: 0x0020,
  UNIFORM: 0x0040, STORAGE: 0x0080, INDIRECT: 0x0100, QUERY_RESOLVE: 0x0200,
} as const;
export const SS = { VERTEX: 0x1, FRAGMENT: 0x2, COMPUTE: 0x4 } as const;

/** grow-by-doubling GPU buffer for per-frame instance / storage data */
export class DynBuffer {
  buffer: GPUBuffer | null = null;
  constructor(private device: GPUDevice, private usage: number, private label: string) {}
  /** upload `floats` floats of `data`; returns true when the GPUBuffer was (re)created */
  write(data: Float32Array<ArrayBuffer>, floats: number): boolean {
    const bytes = Math.max(256, floats * 4);
    let grew = false;
    if (!this.buffer || this.buffer.size < bytes) {
      this.buffer?.destroy();
      let size = Math.max(4096, this.buffer ? this.buffer.size : 0);
      while (size < bytes) size *= 2;
      this.buffer = this.device.createBuffer({ label: this.label, size, usage: this.usage | BU.COPY_DST });
      grew = true;
    }
    if (floats > 0) this.device.queue.writeBuffer(this.buffer, 0, data, 0, floats);
    return grew;
  }
  destroy() { this.buffer?.destroy(); this.buffer = null; }
}

export interface GpuTarget {
  texture: GPUTexture;
  view: GPUTextureView;
  w: number; h: number;
  format: GPUTextureFormat;
}

export function createTarget(device: GPUDevice, format: GPUTextureFormat, w: number, h: number, extraUsage = 0, label = 'target'): GpuTarget {
  const texture = device.createTexture({
    label, format, size: { width: w, height: h },
    usage: TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING | extraUsage,
  });
  return { texture, view: texture.createView(), w, h, format };
}

/** recreate `t` when the size differs; returns the (possibly new) target and whether it changed */
export function resizeTarget(device: GPUDevice, t: GpuTarget | null, format: GPUTextureFormat, w: number, h: number, extraUsage = 0, label = 'target'): [GpuTarget, boolean] {
  if (t && t.w === w && t.h === h) return [t, false];
  t?.texture.destroy();
  return [createTarget(device, format, w, h, extraUsage, label), true];
}

export interface Samplers { nearest: GPUSampler; linear: GPUSampler }

export function createSamplers(device: GPUDevice): Samplers {
  const edge = { addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' } as const;
  return {
    nearest: device.createSampler({ label: 'nearest', magFilter: 'nearest', minFilter: 'nearest', ...edge }),
    linear: device.createSampler({ label: 'linear', magFilter: 'linear', minFilter: 'linear', ...edge }),
  };
}

/** uniform buffer mirrored by a Float32Array; offsets are documented next to each WGSL struct */
export class Ubo {
  readonly f: Float32Array<ArrayBuffer>;
  readonly buffer: GPUBuffer;
  constructor(private device: GPUDevice, floats: number, label = 'ubo') {
    const n = Math.ceil(floats / 4) * 4;   // 16-byte multiple
    this.f = new Float32Array(n);
    this.buffer = device.createBuffer({ label, size: n * 4, usage: BU.UNIFORM | BU.COPY_DST });
  }
  write() { this.device.queue.writeBuffer(this.buffer, 0, this.f); }
  destroy() { this.buffer.destroy(); }
}
