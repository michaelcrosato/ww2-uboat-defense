// Precipitation: snow as lit world-space particles around the view, rain as tiny ripples on the wave
// sim plus slanted streaks drawn on the HUD canvas (screen space, cheap). Storm lightning is in
// Environment/World; thunder is played by the AudioBridge.

import type { World } from './world';
import type { Camera } from '../render/camera';
import { PK } from '../render/materials';
import { fx } from '../core/math';
import { dev } from '../core/devSettings';

interface Drop { x: number; y: number; len: number; sp: number }

export class WeatherFx {
  private snowAcc = 0;
  private rainAcc = 0;
  private drops: Drop[] = [];

  /** world-space part, once per rendered frame (dt = simulated seconds, 0 while paused) */
  update(w: World, cam: Camera, dt: number) {
    if (dt <= 0 || !dev.bool('display.weather')) return;
    const view = cam.viewRect(60);
    const P = w.scene.particles;
    const wind = w.ocean.windSpeed, wd = w.ocean.params.windDir;
    if (w.env.snow > 0) {
      this.snowAcc += dt * 420 * w.env.snow;
      for (; this.snowAcc >= 1; this.snowAcc--) {
        const x = fx.range(view.x0, view.x1), y = fx.range(view.y0, view.y1 + 60);
        P.spawn(PK.SNOW, x, y, fx.range(18, 34), Math.cos(wd) * wind * 0.4, Math.sin(wd) * wind * 0.4, -1.4, 9, 0.8, [0.95, 0.97, 1]);
      }
    }
    if (w.env.rain > 0) {
      this.rainAcc += dt * 90 * w.env.rain;
      for (; this.rainAcc >= 1; this.rainAcc--) {
        w.scene.splats.push({ x: fx.range(view.x0, view.x1), y: fx.range(view.y0, view.y1), radius: 0.7, wave: -0.25, foam: 0.03, bio: 0.05, oil: 0, fire: 0, push: 0 });
      }
    }
  }

  /** screen-space rain streaks on the HUD canvas (W×H HUD pixels) */
  drawRain(g: CanvasRenderingContext2D, w: World, W: number, H: number, dt: number) {
    const rain = dev.bool('display.weather') ? w.env.rain : 0;
    const want = Math.round(rain * W * H / 900);
    while (this.drops.length < want) this.drops.push({ x: fx.range(0, W), y: fx.range(-H, H), len: fx.range(4, 9), sp: fx.range(220, 340) });
    if (this.drops.length > want) this.drops.length = want;
    if (!want) return;
    // slant with the wind across the screen
    const slant = Math.cos(w.ocean.params.windDir) * Math.min(1, w.ocean.windSpeed / 20) * 0.45;
    g.strokeStyle = 'rgba(190, 210, 230, 0.32)';
    g.lineWidth = 1;
    g.beginPath();
    for (const d of this.drops) {
      d.y += d.sp * dt; d.x += d.sp * slant * dt;
      if (d.y > H) { d.y = -d.len; d.x = fx.range(-20, W + 20); }
      if (d.x > W + 20) d.x -= W + 40; else if (d.x < -20) d.x += W + 40;
      g.moveTo(Math.round(d.x) + 0.5, Math.round(d.y));
      g.lineTo(Math.round(d.x - slant * d.len) + 0.5, Math.round(d.y - d.len));
    }
    g.stroke();
  }
}
