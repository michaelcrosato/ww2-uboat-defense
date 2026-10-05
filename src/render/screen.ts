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
  /** internal (game) pixels per HUD pixel: 1, or 1.33-2 with display.hudScale 2 (not always whole) */
  hudScale = 1;
  /** touch layouts (set by the touch overlay) round the HUD pixel down: see resize() */
  private touchHud = false;
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
      // the target is the short side: a portrait phone (9:16) gets the same pixel size as a landscape screen
      const target = this.cfg.num('display.targetHeight');
      S = Math.max(1, Math.round(Math.min(pw, ph) / target));
    } else S = Math.max(1, parseInt(mode, 10) || 3);
    // never let the internal buffer exceed 1280 px wide (cost) or drop below 160 px tall
    while (S > 1 && ph / S < 160) S--;
    while (pw / S > 1600) S++;
    this.S = S;
    this.W = Math.ceil(pw / S);
    this.H = Math.ceil(ph / S);
    // the HUD canvas has its own whole-number device-pixel scale, stretched by CSS with pixelated
    // sampling: the game pixel normally; display.hudScale 2 takes one size up (about 1.33-1.5x text),
    // which keeps the HUD buffer roomy enough for its panels (a flat 2x left only 320x180)
    const large = (parseInt(this.cfg.str('display.hudScale')) || 1) >= 2;
    let hp = large ? Math.max(S + 1, Math.round((S * 4) / 3)) : S;
    // a touch HUD fills its whole short side (top panels, thumb controls below): where the game pixel rounded
    // up (a 4:3 tablet), the HUD pixel rounds down, so the HUD keeps at least the target in HUD pixels
    if (this.touchHud && mode === 'auto') {
      hp = Math.min(hp, Math.max(1, Math.floor((Math.min(pw, ph) / this.cfg.num('display.targetHeight')) * (large ? 4 / 3 : 1))));
    }
    this.hudScale = hp / S;
    this.hud.width = Math.ceil(pw / hp); this.hud.height = Math.ceil(ph / hp);
    this.hud.style.width = (this.hud.width * hp) / dpr + 'px';
    this.hud.style.height = (this.hud.height * hp) / dpr + 'px';
    this.hudCtx.imageSmoothingEnabled = false;
    for (const f of this.listeners) f();
  }

  /** client (CSS px) -> internal pixel coordinates */
  clientToPixel(cx: number, cy: number): [number, number] {
    const rc = this.canvas.getBoundingClientRect();
    return [((cx - rc.left) * this.dpr) / this.S, ((cy - rc.top) * this.dpr) / this.S];
  }

  get isFullscreen() { return !!document.fullscreenElement; }
  setTouchHud(on: boolean) { if (on !== this.touchHud) { this.touchHud = on; this.resize(); } }
  /**
   * Phones: fullscreen without browser chrome (nothing to swipe away) and the current orientation held,
   * so tilting the phone mid-battle does not flip the layout. Needs a user gesture; refusals (iPhone
   * Safari has no element fullscreen, the gesture was missing) leave the game playing in the page.
   */
  async enterGameMode() {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      const o = screen.orientation as ScreenOrientation & { lock?: (type: string) => Promise<void> };
      await o.lock?.(innerHeight >= innerWidth ? 'portrait' : 'landscape');
    } catch { /* refused: stay in the page */ }
  }
  async toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } catch (e) { console.warn('fullscreen refused', e); }
  }
}
