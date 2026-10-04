// Window-filling canvas with a low-res internal buffer scaled by a whole number (pixel-perfect).
// The game renders at W x H internal pixels (+2 px margin for the sub-pixel camera shift) and is
// presented S times larger. A 2D HUD canvas at the same internal resolution is layered on top.

import type { ConfigStore } from '../core/config';

export class Screen {
  /** the game canvas; replaced (not reused) when a backend falls back, see replaceCanvas */
  canvas: HTMLCanvasElement;
  readonly hud: HTMLCanvasElement;
  readonly hudCtx: CanvasRenderingContext2D;
  /** internal pixels */
  W = 640; H = 360;
  /** whole-number scale from internal pixels to device pixels */
  S = 3;
  dpr = 1;
  /** HUD pixels per internal pixel (display.hudScale) */
  hudScale = 1;
  /** device pixel size of the drawing buffer */
  pw = 1; ph = 1;
  private listeners: (() => void)[] = [];

  constructor(readonly root: HTMLElement, private cfg: ConfigStore) {
    this.canvas = Screen.makeCanvas();
    this.hud = document.createElement('canvas');
    this.hud.id = 'hud';
    root.append(this.canvas, this.hud);
    this.hudCtx = this.hud.getContext('2d', { alpha: true })!;
    this.hudCtx.imageSmoothingEnabled = false;
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(root);
    addEventListener('resize', () => this.resize());
    document.addEventListener('fullscreenchange', () => setTimeout(() => this.resize(), 30));
    cfg.on('display.pixelScale', () => this.resize());
    cfg.on('display.targetHeight', () => this.resize());
    cfg.on('display.hudScale', () => this.resize());
    this.resize();
  }

  private static makeCanvas() {
    const c = document.createElement('canvas');
    c.id = 'game';
    return c;
  }

  /**
   * Swap in a fresh <canvas id="game">. A canvas keeps the first context type it was asked for,
   * so each backend attempt (WebGPU, then WebGL2) needs its own canvas. Input listens on `root`.
   */
  replaceCanvas(): HTMLCanvasElement {
    const c = Screen.makeCanvas();
    c.width = this.pw; c.height = this.ph;
    this.canvas.replaceWith(c);
    this.canvas = c;
    return c;
  }

  onResize(f: () => void) { this.listeners.push(f); }

  resize() {
    const rc = this.root.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const pw = Math.max(1, Math.round(rc.width * dpr)), ph = Math.max(1, Math.round(rc.height * dpr));
    this.dpr = dpr; this.pw = pw; this.ph = ph;
    this.canvas.width = pw; this.canvas.height = ph;
    const mode = this.cfg.str('display.pixelScale');
    let S: number;
    if (mode === 'auto') {
      const target = this.cfg.num('display.targetHeight');
      S = Math.max(1, Math.round(ph / target));
    } else S = Math.max(1, parseInt(mode, 10) || 3);
    // never let the internal buffer exceed 1280 px wide (cost) or drop below 160 px tall
    while (S > 1 && ph / S < 160) S--;
    while (pw / S > 1600) S++;
    this.S = S;
    this.W = Math.ceil(pw / S);
    this.H = Math.ceil(ph / S);
    // the HUD canvas is internal resolution, stretched by CSS with pixelated sampling
    // display.hudScale 2: the HUD buffer is half size and stretched, so the pixel font and panels double
    const k = this.hudScale = Math.max(1, parseInt(this.cfg.str('display.hudScale')) || 1);
    this.hud.width = Math.ceil(this.W / k); this.hud.height = Math.ceil(this.H / k);
    this.hud.style.width = (this.hud.width * k * S) / dpr + 'px';
    this.hud.style.height = (this.hud.height * k * S) / dpr + 'px';
    this.hudCtx.imageSmoothingEnabled = false;
    for (const f of this.listeners) f();
  }

  /** client (CSS px) -> internal pixel coordinates */
  clientToPixel(cx: number, cy: number): [number, number] {
    const rc = this.canvas.getBoundingClientRect();
    return [((cx - rc.left) * this.dpr) / this.S, ((cy - rc.top) * this.dpr) / this.S];
  }

  get isFullscreen() { return !!document.fullscreenElement; }
  async toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } catch (e) { console.warn('fullscreen refused', e); }
  }
}
