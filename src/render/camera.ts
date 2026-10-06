// Oblique orthographic camera. Top-down when tilt = 0; with tilt the camera leans south so heights
// rise up the screen (sprite-stacked ships show their superstructure and sides).
//   buffer x = x*zoom - ix + bw/2
//   buffer y = (y*cosT - z*sinT)*zoom - iy + bh/2          (y down, like the screen)
// (ix, iy) is the camera center in projected pixels, snapped to whole pixels so the pixel grid is
// anchored to the world; the fractional rest (fx, fy) shifts the upscaled image at present time.

import { clamp, damp, fx as fxRng, noise1 } from '../core/math';

export class Camera {
  x = 0; y = 0;           // world center (meters)
  zoom = 1;               // internal pixels per meter
  targetZoom = 1;
  tilt = 0.35;            // radians
  cosT = Math.cos(0.35); sinT = Math.sin(0.35);
  minZoom = 0.15; maxZoom = 4;
  // derived per frame
  ix = 0; iy = 0; fx = 0; fy = 0;
  bw = 642; bh = 362;     // render buffer size (internal + margin)
  W = 640; H = 360;
  private shakeAmt = 0;
  private shakeT = 0;
  shakeX = 0; shakeY = 0;
  /** effect trauma 0..1 (render/fx.ts): shake grows with its square, so small blasts stay subtle */
  trauma = 0;
  /** ship-motion sway in world metres (camera.roll), added like shake */
  bobX = 0; bobY = 0;

  setTilt(t: number) { this.tilt = t; this.cosT = Math.cos(t); this.sinT = Math.sin(t); }
  setViewport(W: number, H: number) { this.W = W; this.H = H; this.bw = W + 2; this.bh = H + 2; }

  addShake(amount: number) { this.shakeAmt = Math.min(12, this.shakeAmt + amount); }

  follow(tx: number, ty: number, dt: number, rate = 4) {
    const k = damp(rate, dt);
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;
  }

  update(dt: number, shakeScale = 1) {
    this.zoom += (this.targetZoom - this.zoom) * damp(10, dt);
    if (Math.abs(this.zoom - this.targetZoom) < 1e-4) this.zoom = this.targetZoom;
    this.shakeT += dt;
    this.shakeAmt *= Math.exp(-dt * 5);
    const a = Math.max(this.shakeAmt, this.trauma * this.trauma * 9) * shakeScale;
    this.shakeX = (noise1(this.shakeT * 23, 1) - 0.5) * 2 * a;
    this.shakeY = (noise1(this.shakeT * 23, 7) - 0.5) * 2 * a;
    if (a < 0.05) { this.shakeX = 0; this.shakeY = 0; }
    void fxRng;
  }

  /** compute pixel-snapped center for this frame */
  snap() {
    const px = (this.x + this.bobX) * this.zoom + this.shakeX, py = (this.y + this.bobY) * this.cosT * this.zoom + this.shakeY;
    this.ix = Math.floor(px); this.iy = Math.floor(py);
    this.fx = px - this.ix; this.fy = py - this.iy;
  }

  zoomBy(f: number) { this.targetZoom = clamp(this.targetZoom * f, this.minZoom, this.maxZoom); }

  /** world -> internal screen pixel (screen space, 0..W), including the sub-pixel shift */
  toScreen(x: number, y: number, z = 0): [number, number] {
    const bx = x * this.zoom - this.ix + this.bw / 2;
    const by = (y * this.cosT - z * this.sinT) * this.zoom - this.iy + this.bh / 2;
    return [bx - 1 - this.fx, by - 1 - this.fy];
  }
  /** internal screen pixel -> world point on the plane at height z */
  toWorld(sx: number, sy: number, z = 0): [number, number] {
    const bx = sx + 1 + this.fx, by = sy + 1 + this.fy;
    const X = bx - this.bw / 2 + this.ix, Y = by - this.bh / 2 + this.iy;
    return [X / this.zoom, (Y / this.zoom + z * this.sinT) / this.cosT];
  }
  /** visible world rectangle (approx, on the water plane) with margin in meters */
  viewRect(margin = 0): { x0: number; y0: number; x1: number; y1: number } {
    const [x0, y0] = this.toWorld(0, 0), [x1, y1] = this.toWorld(this.W, this.H);
    return { x0: x0 - margin, y0: y0 - margin - 40 * this.sinT, x1: x1 + margin, y1: y1 + margin };
  }
  /** uniforms shared by every world-space pass */
  uniforms(): { cam: [number, number, number, number]; tilt: [number, number]; buf: [number, number] } {
    return { cam: [this.ix, this.iy, this.zoom, 0], tilt: [this.cosT, this.sinT], buf: [this.bw, this.bh] };
  }
}
