// Per-pass GPU timing with `timestamp-query` (optional feature). Every `every` frames the passes get
// timestampWrites; the query set is resolved and read back asynchronously, and `ms` holds the latest
// per-pass durations. Passes not executed that frame keep their previous value.

import { BU } from './targets';

export class GpuTimer {
  readonly ms: Record<string, number> = {};
  private qs: GPUQuerySet;
  private resolveBuf: GPUBuffer;
  private readBuf: GPUBuffer;
  private frame = 0;
  private sampling = false;
  private reading = false;
  private used = new Set<string>();

  constructor(private device: GPUDevice, private names: readonly string[], private every = 30) {
    const n = names.length * 2;
    this.qs = device.createQuerySet({ label: 'gpu timer', type: 'timestamp', count: n });
    this.resolveBuf = device.createBuffer({ label: 'gpu timer resolve', size: n * 8, usage: BU.QUERY_RESOLVE | BU.COPY_SRC });
    this.readBuf = device.createBuffer({ label: 'gpu timer read', size: n * 8, usage: BU.MAP_READ | BU.COPY_DST });
  }

  /** call once per frame before encoding */
  begin() {
    this.sampling = !this.reading && this.frame++ % this.every === 0;
    this.used.clear();
  }

  /** timestampWrites for a render or compute pass descriptor (undefined when not sampling) */
  writes(name: string): GPURenderPassTimestampWrites | undefined {
    if (!this.sampling) return undefined;
    const i = this.names.indexOf(name);
    if (i < 0 || this.used.has(name)) return undefined;
    this.used.add(name);
    return { querySet: this.qs, beginningOfPassWriteIndex: i * 2, endOfPassWriteIndex: i * 2 + 1 };
  }

  /** after the last pass, before finish() */
  resolve(enc: GPUCommandEncoder) {
    if (!this.sampling || !this.used.size) return;
    enc.resolveQuerySet(this.qs, 0, this.names.length * 2, this.resolveBuf, 0);
    enc.copyBufferToBuffer(this.resolveBuf, 0, this.readBuf, 0, this.names.length * 16);
  }

  /** after submit */
  read() {
    if (!this.sampling || !this.used.size) return;
    this.reading = true;
    const used = [...this.used];
    this.readBuf.mapAsync(1 /* GPUMapMode.READ */).then(() => {
      const t = new BigUint64Array(this.readBuf.getMappedRange());
      for (const name of used) {
        const i = this.names.indexOf(name);
        const d = Number(t[i * 2 + 1] - t[i * 2]) / 1e6;
        if (d >= 0 && d < 1e4) this.ms[name] = d;
      }
      this.readBuf.unmap();
    }).catch(() => undefined).finally(() => { this.reading = false; });
  }

  get total() { return Object.values(this.ms).reduce((a, b) => a + b, 0); }

  destroy() { this.qs.destroy(); this.resolveBuf.destroy(); this.readBuf.destroy(); }
}
