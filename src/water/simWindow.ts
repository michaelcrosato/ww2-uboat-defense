// A square simulation window in world space that follows the camera in whole-cell jumps, so
// simulated wakes stay put in the world while the window scrolls (textures are shifted by
// integer cells; newly exposed cells start calm). Shifts are quantized to `quant` cells so
// coarser grids sharing the window (the fluid velocity) also shift by whole cells.

export class SimWindow {
  ox = 0; oy = 0;        // world position of texel (0,0) corner
  quant = 1;
  constructor(public n: number, public cell: number) {}
  get size() { return this.n * this.cell; }
  /** returns integer cell shift (dx, dy) needed to keep (cx, cy) near the center, and applies it */
  recenter(cx: number, cy: number, force = false): [number, number] {
    const half = this.size / 2;
    const q = Math.max(1, this.quant);
    const dxc = Math.round((cx - half - this.ox) / (this.cell * q)) * q;
    const dyc = Math.round((cy - half - this.oy) / (this.cell * q)) * q;
    // only move when the camera has drifted a bit (avoids shifting every frame)
    const thresh = Math.max(q, Math.floor(this.n / 16));
    if (!force && Math.abs(dxc) < thresh && Math.abs(dyc) < thresh) return [0, 0];
    this.ox += dxc * this.cell; this.oy += dyc * this.cell;
    return [dxc, dyc];
  }
  reset(cx: number, cy: number) {
    const half = this.size / 2;
    const q = Math.max(1, this.quant) * this.cell;
    this.ox = Math.round((cx - half) / q) * q;
    this.oy = Math.round((cy - half) / q) * q;
  }
  contains(x: number, y: number, margin = 0) {
    return x >= this.ox + margin && y >= this.oy + margin && x <= this.ox + this.size - margin && y <= this.oy + this.size - margin;
  }
}
