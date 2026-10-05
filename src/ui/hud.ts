// In-mission HUD on the low-res overlay canvas: compass, status, depth gauge, ability bar,
// tactical plot, contact markers, solution lines, loot labels, messages and warnings.

import type { Screen } from '../render/screen';
import type { Camera } from '../render/camera';
import type { RenderBackend } from '../render/types';
import { backendLabel } from '../render/backend';
import { audio } from '../audio/audio';
import type { Mission } from '../game/mission';
import type { PlayerControl } from '../game/player';
import { CHARGE_DEPTHS } from '../game/player';
import type { Input } from '../input/input';
import { TELEGRAPH, type Vessel } from '../game/vessel';
import { drawText, textWidth, pxLine, pxLineClip, pxCircle, pxRect, pxFill, panel, bar, wrapText, hasGlyphs } from './pixelFont';
import { clamp, fmtInt, formatTime, toBearing, KNOT } from '../core/math';
import { dev } from '../core/devSettings';
import { ABILITIES } from '../meta/abilities';
import { hullPoints } from '../game/vessel';
import { WeatherFx } from '../game/weatherFx';
import { SRC, type BearingLine } from '../game/sensors';
import { RARITY_BEAM } from '../game/weapons';
import { BEAUFORT_NAME } from '../water/ocean';
import type { Tutorial } from '../game/tutorial';

const C = {
  text: '#e8e2cf', dim: '#a49f8c', allied: '#8fc4e8', axis: '#e8c070', danger: '#ff6a4a', good: '#8ad89a', warn: '#ffc040',
  water: '#4aa0c0', layer: '#5a8ad8', grid: '#2a3a44',
};
const RARITY_HEX: Record<string, string> = { common: '#c8c8c8', magic: '#6f9cff', rare: '#ffd84a', legendary: '#ff8c2a', unique: '#d8b47a' };

export interface Msg { text: string; t: number; kind: string; important: boolean; color?: string; /** swiped away (touch toasts) */ gone?: boolean }
/** seconds a crew message stays up */
export const msgLife = (m: Msg) => (m.important ? 10 : 7);

export class Hud {
  /** precipitation (world particles + HUD rain streaks) */
  readonly weather = new WeatherFx();
  msgs: Msg[] = [];
  warnings = new Map<string, number>();
  fps = 60;
  private fpsAcc = 0; private fpsN = 0;
  showPlot = true;
  /** the touch overlay shows finger-sized ability buttons instead of the canvas bar */
  touchAbilities = false;
  /** this frame's layout: right edge of the status panel (+ depth gauge) and of the ability bar */
  private statusRight = 0;
  private barRight = 0;
  tactical = false;
  /** active renderer (perf line + backend name next to the FPS) */
  backend: RenderBackend | null = null;
  /** CPU frame ms + sim steps this frame (debug.perf) */
  perf: { cpuMs: number; steps: number } | null = null;
  /** lesson coach (tutorial missions) and the bottom edge of its panel this frame */
  tutorial: Tutorial | null = null;
  private tutBottom = 0;
  /**
   * Touch layout (set by the touch overlay): vessel status under the objectives at the top (the bottom of the
   * screen belongs to the thumbs), crew messages and warnings handed to the swipeable DOM toasts, the FPS
   * under the plot.
   */
  mobile = false;
  /**
   * This frame's layout in HUD px: bottom edges of the left column, the right column (plot) and the centre
   * (tutorial); the inner side edges of the two columns (right of the left one, left of the right one: the
   * plot plus, on touch, the pause / time buttons beside it) and the plot's own left edge.
   */
  readonly layout = { left: 0, right: 0, center: 0, leftX: 0, rightX: 0, plotX: 0 };
  /**
   * Room the touch overlay's DOM controls take, in HUD px (set by the overlay every frame): the pause / time
   * buttons beside the plot (landscape, `right`) or under it (portrait, `below`), and the throttle's box.
   */
  readonly reserved = { right: 0, below: 0, throttle: null as { x0: number; y0: number; x1: number; y1: number } | null };
  private plotR = 52;
  /** warnings swiped away: text -> time until which they stay quiet */
  private dismissed = new Map<string, number>();

  constructor(private screen: Screen, private cam: Camera, private input: Input) {}

  attach(m: Mission) {
    const w = m.world;
    this.msgs = [];
    w.bus.on('message', (e) => {
      if (e.side && e.side !== w.playerSide) return;
      this.msgs.push({ text: e.text, t: performance.now() / 1000, kind: e.kind ?? 'info', important: !!e.important, color: e.color });
      if (this.msgs.length > 40) this.msgs.shift();
    });
    w.bus.on('torpedoFired', (e) => { if (e.by.side !== w.playerSide) { const p = w.player; if (p && Math.hypot(e.x - p.pos.x, e.y - p.pos.y) < 2000 && (p.kind === 'escort' || p.kind === 'merchant')) this.warn('TORPEDO IN THE WATER!'); } });
    w.bus.on('ping', (e) => { if (w.player?.sub && e.by.side !== w.playerSide && Math.hypot(e.by.pos.x - w.player.pos.x, e.by.pos.y - w.player.pos.y) < 2500) this.warn('ASDIC! WE ARE BEING PINGED'); });
    w.bus.on('dcDrop', (e) => { if (w.player?.sub && e.by.side !== w.playerSide && Math.hypot(e.x - w.player.pos.x, e.y - w.player.pos.y) < 900) this.warn('WASSERBOMBEN! DEPTH CHARGES!'); });
    // a surfaced U-boat's casing is awash in any sea, so only surface ships get the warning
    w.bus.on('greenWater', (e) => { if (!e.v.sub) this.warn('GREEN WATER OVER THE BOW', 1.5); });
  }

  warn(text: string, dur = 3) {
    const now = performance.now() / 1000;
    if ((this.dismissed.get(text) ?? 0) > now) return;
    this.warnings.set(text, now + dur);
  }
  /** a warning swiped away stays quiet for a while even if its condition persists */
  dismissWarning(text: string, quiet = 20) { this.warnings.delete(text); this.dismissed.set(text, performance.now() / 1000 + quiet); }

  draw(m: Mission, pc: PlayerControl, realDt: number) {
    const g = this.screen.hudCtx, W = this.screen.hud.width, H = this.screen.hud.height;
    g.clearRect(0, 0, W, H);
    g.imageSmoothingEnabled = false;
    this.fpsAcc += realDt; this.fpsN++;
    if (this.fpsAcc > 0.5) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; }
    const w = m.world, v = w.player;
    this.statusRight = this.barRight = 0;
    this.layout.left = this.layout.right = this.layout.center = this.layout.leftX = 0;
    // the plot is smaller on a narrow touch HUD (portrait phone); the columns' inner edges are known up front
    this.plotR = this.mobile && W < 460 ? 40 : 52;
    this.layout.plotX = this.showPlot ? W - 2 * this.plotR - 6 : W;
    this.layout.rightX = this.layout.plotX - (this.mobile ? this.reserved.right : 0);
    this.weather.drawRain(g, w, W, H, realDt);
    this.worldOverlays(g, m, pc);
    this.debugOverlays(g, m);
    this.drawObjectives(g, m);
    this.drawCompass(g, v, W);
    if (v) this.drawStatus(g, v, pc, H);
    this.drawAbilities(g, pc, W, H);
    if (this.showPlot) this.drawPlot(g, m, W);
    // fps: a touch HUD keeps it under the plot (before the tutorial panel, which stacks below), else bottom right
    const fps = dev.bool('display.showFps') ? `${Math.round(this.fps)} fps ${this.backend ? backendLabel(this.backend.info) : ''}`.trimEnd() : '';
    if (fps && this.mobile) { drawText(g, fps, W - 4, this.layout.right + 2, C.dim, { align: 'right' }); this.layout.right += 11; }
    this.drawTutorial(g, W);
    if (!this.mobile) this.drawMessages(g, H);
    this.drawWarnings(g, m, W, H);
    // time compression
    const ts = pc.timeScale;
    if (ts > 1 && !this.mobile) drawText(g, `TIME x${ts}`, W / 2, 30, C.warn, { align: 'center' });
    // above the ability bar when a narrow (large-text) HUD would put them on the same row
    if (fps && !this.mobile) drawText(g, fps, W - 4, W - 4 - textWidth(fps) < this.barRight + 6 ? H - 48 : H - 10, C.dim, { align: 'right' });
    if (dev.bool('debug.perf') && this.backend) {
      // short right-aligned lines under the chart: clear of the status panel, ability bar and messages
      const R = this.backend.stats, P = this.perf;
      const lines = [
        `slices ${R.stackInstances}  ptcl ${R.particles}`, `lights ${R.lights}  bodies ${w.vessels.length}  shells ${w.projectiles.shells.length}`,
        `cpu ${P ? P.cpuMs.toFixed(1) : '-'} ms  steps ${P?.steps ?? '-'}`,
        `gpu ${R.gpuMs !== undefined ? R.gpuMs.toFixed(1) + ' ms' : 'n/a'}  voices ${audio.ready ? audio.voiceCount : 'off'}`,
      ];
      const passes = R.passMs ? Object.entries(R.passMs).map(([k, v]) => `${k} ${v.toFixed(1)}`) : [];
      for (let k = 0; k < passes.length; k += 2) lines.push(passes.slice(k, k + 2).join('  '));
      lines.forEach((l, i) => drawText(g, l, W - 4, 140 + i * 10, C.dim, { align: 'right' }));
    }
  }

  // ------------------------------------------------------------------ world-space markers
  /** no player HUD (attract mode): just clear and draw the rain */
  ambient(m: Mission, realDt: number) {
    const g = this.screen.hudCtx, W = this.screen.hud.width, H = this.screen.hud.height;
    g.clearRect(0, 0, W, H);
    this.weather.drawRain(g, m.world, W, H, realDt);
  }

  /** world → HUD pixels (the HUD buffer is 1/hudScale of the game buffer) */
  private ts(x: number, y: number, z = 0): [number, number] {
    const [sx, sy] = this.cam.toScreen(x, y, z), k = this.screen.hudScale;
    return [sx / k, sy / k];
  }

  /** debug.colliders / debug.buoyancy / debug.sensors: physics and sensor geometry in world space */
  private debugOverlays(g: CanvasRenderingContext2D, m: Mission) {
    const cols = dev.bool('debug.colliders'), buoy = dev.bool('debug.buoyancy'), sens = dev.bool('debug.sensors');
    if (!cols && !buoy && !sens) return;
    const w = m.world, W = this.screen.hud.width, H = this.screen.hud.height;
    const on = (x: number, y: number) => x > -40 && y > -40 && x < W + 40 && y < H + 40;
    const ring = (x: number, y: number, r: number, col: string, dash = 2) => {
      let [px, py] = this.ts(x + r, y, 0);
      for (let i = 1; i <= 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        const [qx, qy] = this.ts(x + Math.cos(a) * r, y + Math.sin(a) * r, 0);
        if (on(px, py) || on(qx, qy)) pxLine(g, px, py, qx, qy, col, dash);
        px = qx; py = qy;
      }
    };
    for (const v of w.vessels) {
      if (!v.alive) continue;
      const [sx, sy] = this.ts(v.pos.x, v.pos.y, 0);
      if (!on(sx, sy) && !sens) continue;
      const f = v.fwd(), toW = (lx: number, ly: number) => this.ts(v.pos.x + f.x * lx - f.y * ly, v.pos.y + f.y * lx + f.x * ly, 0);
      if (cols) {
        // deck outline of the convex hull collider
        const pts = hullPoints(v.cls.length, v.cls.beam, 0, 1), top: [number, number][] = [];
        for (let i = 0; i < pts.length; i += 12) top.push([pts[i], pts[i + 1]]);
        const ring2 = [...top, ...top.map(([x, y]) => [x, -y] as [number, number]).reverse()];
        for (let i = 0; i < ring2.length; i++) {
          const [ax, ay] = toW(ring2[i][0], ring2[i][1]), [bx, by] = toW(ring2[(i + 1) % ring2.length][0], ring2[(i + 1) % ring2.length][1]);
          pxLine(g, ax, ay, bx, by, '#ff60ff');
        }
      }
      if (buoy) {
        // columns: blue = dry … green = fully wetted (submerged length / column height)
        for (const c of v.hydro.cols) {
          const k = clamp(c.sub / Math.max(0.01, c.h), 0, 1);
          const [x, y] = toW(c.lx, c.ly);
          pxFill(g, x - 1, y - 1, 2, 2, `rgb(${Math.round(80 * (1 - k))},${Math.round(120 + 135 * k)},${Math.round(255 * (1 - k))})`);
        }
      }
      if (sens) {
        const s = v.cls.sensors;
        if (v.isPlayer) {
          ring(v.pos.x, v.pos.y, s.lookout * v.stats.mul('lookout_range_pct'), '#e8e2cf', 3);
          if (s.hydrophone) ring(v.pos.x, v.pos.y, s.hydrophone * v.stats.mul('sonar_range_pct'), '#9adfff', 3);
          if (s.radar && w.year >= 1941) ring(v.pos.x, v.pos.y, s.radar * v.stats.mul('radar_range_pct'), '#a0ffa0', 4);
        }
        if (s.asdic && v.kind === 'escort') {
          // ASDIC beam wedge (16° sweep, or the full circle in arcade mode)
          const R = s.asdic * v.stats.mul('sonar_range_pct');
          if (v.isPlayer) ring(v.pos.x, v.pos.y, R, '#7fe0ff', 2);
          const half = dev.str('game.asdic') === 'arcade' ? Math.PI : 8 * Math.PI / 180;
          if (half < 3) for (const a of [-half, half]) {
            const [ex, ey] = this.ts(v.pos.x + Math.cos(v.asdicBearing + a) * R, v.pos.y + Math.sin(v.asdicBearing + a) * R, 0);
            pxLine(g, sx, sy, ex, ey, v.side === w.playerSide ? '#7fe0ff' : '#ff8a6a', 2);
          }
        }
      }
    }
  }

  /**
   * Passive bearings (`display.bearings`). Every listener on the player's side feeds the shared plot,
   * but drawing all their lines (six jittery copies per contact, 3.2 km each, from every boat of the
   * wolfpack) buried the screen. By default only the player's own hydrophones show: a tick per heard
   * contact on a ring around the boat, plus one ray to the contact under the reticle or locked.
   * HF/DF bearings are rare and their cross is the point, so each listener's latest one is drawn.
   */
  private drawBearings(g: CanvasRenderingContext2D, m: Mission, pc: PlayerControl) {
    const mode = dev.str('display.bearings');
    if (mode === 'off') return;
    const w = m.world, v = w.player, side = w.playerSide, now = w.time, cam = this.cam;
    const W = this.screen.hud.width, H = this.screen.hud.height;
    const S = (x: number, y: number) => this.ts(x, y, 0);
    const colOf = (l: BearingLine) => l.src === SRC.HFDF ? '#d890ff' : side === 'allied' ? '#ff8a6a' : C.axis;
    const fadeOf = (l: BearingLine) => clamp(1 - (now - l.t) / 25, 0, 1);
    const ray = (l: BearingLine, len: number, alpha: number, from = 0) => {
      if (alpha <= 0) return;
      g.globalAlpha = alpha;
      const dx = Math.cos(l.bearing), dy = Math.sin(l.bearing);
      const [x0, y0] = S(l.x + dx * from, l.y + dy * from), [x1, y1] = S(l.x + dx * len, l.y + dy * len);
      pxLineClip(g, x0, y0, x1, y1, colOf(l), 3, W, H);
    };
    const alive = !!v && v.alive;
    const aimed = alive ? pc.target ?? pc.hoverTarget() : null;
    // ring radius (m): clears the hull at any zoom; a world circle, so ticks point along true bearings
    const pxPerM = cam.zoom / this.screen.hudScale;
    const R = mode === 'ring' && alive ? Math.max(26, v!.cls.length * 0.5 * pxPerM + 10) / pxPerM : 0;
    const ticks: { l: BearingLine; a: number; aimed: boolean }[] = [];
    for (const c of w.sensors.list(side)) {
      if (mode === 'all') { for (const l of c.lines) ray(l, 3200, fadeOf(l) * 0.7); continue; }
      for (const l of c.heard.values()) if (l.src === SRC.HFDF) ray(l, 3200, fadeOf(l) * 0.7);
      const own = v ? c.heard.get(v.id) : undefined;
      if (!own || own.src === SRC.HFDF) continue;
      const isAimed = !!aimed && c.truth === aimed;
      // out to the far side of the estimate, not across the whole map
      if (mode === 'lines' || isAimed) ray(own, clamp(Math.hypot(c.x - own.x, c.y - own.y) + c.err, 300, 3200), fadeOf(own) * (isAimed ? 0.85 : 0.6), R);
      if (mode === 'ring') ticks.push({ l: own, a: fadeOf(own), aimed: isAimed });
    }
    if (R > 0 && v) {
      const [cx, cy] = S(v.pos.x, v.pos.y);
      g.globalAlpha = ticks.length ? 0.3 : 0.12;
      pxCircle(g, cx, cy, R * pxPerM, C.dim, 3, cam.cosT);
      for (const t of ticks) {
        const b = t.l.bearing, len = (t.aimed ? 9 : 5) / pxPerM;
        const [x0, y0] = S(v.pos.x + Math.cos(b) * R, v.pos.y + Math.sin(b) * R);
        const [x1, y1] = S(v.pos.x + Math.cos(b) * (R + len), v.pos.y + Math.sin(b) * (R + len));
        g.globalAlpha = 0.35 + 0.65 * t.a;
        pxLine(g, x0, y0, x1, y1, t.aimed ? C.text : colOf(t.l));
      }
    }
    g.globalAlpha = 1;
  }

  /**
   * `display.nightOutline`: after dark the player's own hull is a dark shape on dark water (worse under moon
   * glitter), so a faint outline traces its plan at the surface; dashed while it is under water.
   */
  private drawOwnOutline(g: CanvasRenderingContext2D, m: Mission) {
    const v = m.world.player, mode = dev.str('display.nightOutline');
    if (!v || !v.alive || mode === 'off') return;
    const k = mode === 'always' ? 1 : clamp((m.world.env.darkness - 0.3) / 0.35, 0, 1);
    if (k <= 0) return;
    const pts = hullPoints(v.cls.length, v.cls.beam, 0, 1), side: [number, number][] = [];
    for (let i = 0; i < pts.length; i += 12) side.push([pts[i], pts[i + 1]]);
    const ring = [...side, ...side.map(([x, y]) => [x, -y] as [number, number]).reverse()];
    const f = v.fwd();
    const S = ([lx, ly]: [number, number]) => this.ts(v.pos.x + f.x * lx - f.y * ly, v.pos.y + f.y * lx + f.x * ly, 0);
    g.globalAlpha = 0.6 * k;
    for (let i = 0; i < ring.length; i++) {
      const [ax, ay] = S(ring[i]), [bx, by] = S(ring[(i + 1) % ring.length]);
      pxLine(g, ax, ay, bx, by, '#c4e6ff', v.submerged ? 2 : 0);
    }
    g.globalAlpha = 1;
  }

  private worldOverlays(g: CanvasRenderingContext2D, m: Mission, pc: PlayerControl) {
    const w = m.world, cam = this.cam, v = w.player;
    const S = (x: number, y: number, z = 0) => this.ts(x, y, z);
    const side = w.playerSide;
    const now = w.time;
    this.drawOwnOutline(g, m);
    this.drawBearings(g, m, pc);
    // contacts
    for (const c of w.sensors.list(side)) {
      const age = now - c.last;
      const fade = clamp(1 - age / 90, 0.15, 1);
      const enemyVisible = c.truth && w.isVisibleToPlayer(c.truth) && c.truth.alive && !c.truth.submerged;
      g.globalAlpha = fade;
      if (enemyVisible && c.kind === 'surface') continue;
      const [sx, sy] = S(c.x, c.y);
      const col = c.kind === 'sub' ? C.danger : C.axis;
      const r = c.err * cam.zoom;
      if (r > 3 && r < 600) pxCircle(g, sx, sy, r, col, 2, cam.cosT);
      diamond(g, sx, sy, 3, col);
      if (c.vx || c.vy) { const [tx, ty] = S(c.x + c.vx * 60, c.y + c.vy * 60); pxLine(g, sx, sy, tx, ty, col, 2); }
      if (age < 60) drawText(g, c.classified + (c.depth !== null ? ` ${Math.round(c.depth)}m` : ''), sx + 6, sy - 3, col, { alpha: fade });
    }
    g.globalAlpha = 1;
    // friendly vessel names when zoomed in
    for (const o of w.vessels) {
      if (!o.alive || o.isPlayer) continue;
      const vis = w.isVisibleToPlayer(o);
      if (!vis) continue;
      const [sx, sy] = S(o.pos.x, o.pos.y, 0);
      if (sx < -20 || sy < -20 || sx > this.screen.hud.width + 20 || sy > this.screen.hud.height + 20) continue;
      const friendly = o.side === side;
      if (cam.zoom > 0.9 && (Math.hypot(o.pos.x - pc.aimX, o.pos.y - pc.aimY) < o.cls.length * 0.6 || o === pc.target)) {
        drawText(g, o.name + (o.kind === 'merchant' ? ` ${fmtInt(o.grt)} GRT` : ''), sx, sy + 10, friendly ? C.allied : C.axis, { align: 'center' });
        if (o.kind !== 'merchant' || !friendly) { bar(g, sx - 16, sy + 20, 32, 2, o.hpFrac, o.hpFrac > 0.5 ? C.good : C.danger); }
      }
      if (dev.bool('debug.ai') && o.ai?.debug) drawText(g, o.ai.debug, sx, sy - 18, '#9adfff', { align: 'center' });
    }
    // target lock brackets
    if (pc.target && v) {
      const t = pc.target;
      const c = w.sensors.contacts[side].get(t.id);
      const vis = w.isVisibleToPlayer(t) && !t.submerged;
      const tx = vis || !c ? t.pos.x : c.x, ty = vis || !c ? t.pos.y : c.y;
      if (vis || c) {
        const [sx, sy] = S(tx, ty);
        const r = Math.max(6, t.cls.length * 0.5 * cam.zoom);
        brackets(g, sx, sy, r, C.warn);
        const d = Math.hypot(tx - v.pos.x, ty - v.pos.y);
        drawText(g, `${t.name}  ${Math.round(d)}m`, sx, sy - r - 10, C.warn, { align: 'center' });
      }
    }
    if (!v || !v.alive) return;
    // ASDIC beam
    if (v.pinging > 0 && v.cls.sensors.asdic) {
      g.globalAlpha = clamp(v.pinging / 1.2, 0, 1) * 0.6;
      const R = v.cls.sensors.asdic * v.stats.mul('sonar_range_pct');
      const arc = dev.str('game.asdic') === 'arcade' ? Math.PI : 8 * Math.PI / 180;
      const [ox, oy] = S(v.pos.x, v.pos.y);
      if (arc < 1) for (const a of [-arc, arc]) { const [ex, ey] = S(v.pos.x + Math.cos(v.asdicBearing + a) * R, v.pos.y + Math.sin(v.asdicBearing + a) * R); pxLine(g, ox, oy, ex, ey, '#7fe0ff', 2); }
      else pxCircle(g, ox, oy, R * cam.zoom * (1.2 - v.pinging / 1.2), '#7fe0ff', 2, cam.cosT);
      g.globalAlpha = 1;
    }
    // aim reticle and range
    const [ax, ay] = S(pc.aimX, pc.aimY);
    const range = Math.hypot(pc.aimX - v.pos.x, pc.aimY - v.pos.y);
    const rc = v.sub ? (pc.weaponMode === 'gun' ? C.warn : '#a0ffd0') : C.text;
    pxLine(g, ax - 6, ay, ax - 2, ay, rc); pxLine(g, ax + 2, ay, ax + 6, ay, rc);
    pxLine(g, ax, ay - 6, ax, ay - 2, rc); pxLine(g, ax, ay + 2, ax, ay + 6, rc);
    drawText(g, `${Math.round(range)}m`, ax + 8, ay + 4, rc, { alpha: 0.85 });
    // gun range ring (escort / deck gun)
    if (v.guns.length && (v.kind === 'escort' || pc.weaponMode === 'gun')) {
      const gr = v.guns[0].spec.range * v.stats.mul('gun_range_pct');
      const [px, py] = S(v.pos.x, v.pos.y);
      g.globalAlpha = 0.25;
      pxCircle(g, px, py, gr * cam.zoom, C.warn, 4, cam.cosT);
      g.globalAlpha = 1;
    }
    // torpedo solution
    if (v.sub && pc.solution && pc.weaponMode === 'torpedo') {
      const s = pc.solution;
      const [px, py] = S(v.pos.x, v.pos.y), [tx, ty] = S(s.tx, s.ty);
      pxLine(g, px, py, tx, ty, '#a0ffd0', 3);
      pxCircle(g, tx, ty, 4, '#a0ffd0');
      const gyro = Math.round(((s.heading - v.heading) * 180 / Math.PI + 540) % 360 - 180);
      drawText(g, `SOLUTION  gyro ${gyro > 0 ? '+' : ''}${gyro}°  run ${Math.round(s.t)}s`, tx + 7, ty - 3, '#a0ffd0');
    }
    // own torpedoes
    for (const t of w.projectiles.torpedoes) {
      if (t.from.side !== side) continue;
      const [sx, sy] = S(t.x, t.y), [ex, ey] = S(t.x + Math.cos(t.heading) * 60, t.y + Math.sin(t.heading) * 60);
      pxLine(g, sx, sy, ex, ey, '#a0ffd0', 2);
    }
    // loot labels (Diablo-style), only near the player
    for (const c of w.projectiles.crates) {
      const d = Math.hypot(c.x - v.pos.x, c.y - v.pos.y);
      if (d > 600) continue;
      const [sx, sy] = S(c.x, c.y, 2);
      const col = RARITY_HEX[c.item.rarity];
      const tw = textWidth(c.item.name);
      g.globalAlpha = 0.75; pxFill(g, sx - tw / 2 - 3, sy - 14, tw + 6, 11, '#05080b'); g.globalAlpha = 1;
      pxRect(g, sx - tw / 2 - 3, sy - 14, tw + 6, 11, col);
      drawText(g, c.item.name, sx, sy - 12, col, { align: 'center', outline: null });
      void RARITY_BEAM;
    }
    // lifeboats
    for (const b of w.projectiles.boats) {
      const d = Math.hypot(b.x - v.pos.x, b.y - v.pos.y);
      if (d > 500 || v.kind !== 'escort') continue;
      const [sx, sy] = S(b.x, b.y, 1);
      drawText(g, `${b.count} survivors`, sx, sy - 12, '#ffb070', { align: 'center' });
    }
  }

  // ------------------------------------------------------------------ panels
  private drawCompass(g: CanvasRenderingContext2D, v: Vessel | null, W: number) {
    let cw = Math.min(220, W * 0.4), cx = W / 2;
    const y = 4;
    // a touch HUD keeps it in the room between the objectives (136 px) and the plot with its buttons
    if (this.mobile) { const l = 140, r = this.layout.rightX - 6; cw = Math.min(220, r - l); cx = clamp(W / 2, l + cw / 2, r - cw / 2); }
    panel(g, cx - cw / 2, y, cw, 16, 0.6);
    if (!v) return;
    const hdg = toBearing(v.heading);
    const pxPerDeg = cw / 120;
    for (let d = -60; d <= 60; d++) {
      const b = Math.round(hdg + d);
      const bb = ((b % 360) + 360) % 360;
      const x = cx + (b - hdg) * pxPerDeg;
      if (x < cx - cw / 2 + 2 || x > cx + cw / 2 - 2) continue;
      if (bb % 10 === 0) pxFill(g, x, y + 11, 1, bb % 30 === 0 ? 4 : 2, C.dim);
      if (bb % 30 === 0) {
        const lbl = bb === 0 ? 'N' : bb === 90 ? 'E' : bb === 180 ? 'S' : bb === 270 ? 'W' : String(bb);
        drawText(g, lbl, x, y + 2, bb % 90 === 0 ? C.text : C.dim, { align: 'center', outline: null });
      }
    }
    pxFill(g, cx, y + 1, 1, 14, C.warn);
    if (v.course !== null) {
      const cb = toBearing(v.course);
      let d = cb - hdg; if (d > 180) d -= 360; if (d < -180) d += 360;
      const x = cx + clamp(d, -58, 58) * pxPerDeg;
      drawText(g, '▾', x, y + 12, C.good, { align: 'center' });
    }
    drawText(g, String(Math.round(hdg)).padStart(3, '0') + '°', cx, y + 18, C.text, { align: 'center' });
  }

  private drawStatus(g: CanvasRenderingContext2D, v: Vessel, pc: PlayerControl, H: number) {
    const x = 4, h = v.sub ? 92 : 78, y = this.mobile ? this.layout.left + 4 : H - h - 4, w = 164;
    this.statusRight = x + w + (v.sub ? 22 : 0);
    if (this.mobile) { this.layout.left = y + h; this.layout.leftX = Math.max(this.layout.leftX, this.statusRight); }
    panel(g, x, y, w, h);
    drawText(g, v.name, x + 4, y + 4, v.side === 'allied' ? C.allied : C.axis);
    drawText(g, v.cls.name, x + 4, y + 13, C.dim);
    // hull + flooding
    drawText(g, 'HULL', x + 4, y + 24, C.dim);
    bar(g, x + 30, y + 25, 60, 4, v.hpFrac, v.hpFrac > 0.5 ? C.good : v.hpFrac > 0.25 ? C.warn : C.danger);
    const fl = v.hydro.floodTotal();
    drawText(g, 'FLOOD', x + 96, y + 24, fl > 0.05 ? C.danger : C.dim);
    bar(g, x + 128, y + 25, 30, 4, fl * 2, '#4a90d0');
    // speed / telegraph / rudder
    const kn = v.hydro.fwdSpeed / KNOT;
    drawText(g, `${kn.toFixed(1)} kn`, x + 4, y + 34, C.text);
    const tel = v.speedCmd !== null ? `${Math.round(v.speedCmd * 100)}%` : TELEGRAPH[v.telegraph].name;
    drawText(g, tel, x + 46, y + 34, C.warn);
    // telegraph dial
    for (let i = 0; i < TELEGRAPH.length; i++) pxFill(g, x + 110 + i * 7, y + 36, 5, 3, i === v.telegraph && v.speedCmd === null ? C.warn : '#2a3a44');
    drawText(g, 'RUDDER', x + 4, y + 44, C.dim);
    pxFill(g, x + 46, y + 47, 60, 1, '#2a3a44');
    pxFill(g, x + 76, y + 45, 1, 5, C.dim);
    pxFill(g, x + 76 + v.rudder * 29, y + 44, 2, 7, C.text);
    if (v.course !== null) drawText(g, `CRS ${String(Math.round(toBearing(v.course))).padStart(3, '0')}`, x + 112, y + 44, C.good);
    const ly = y + 56;
    if (v.kind === 'escort') {
      drawText(g, `D/C ${v.dcLeft}  set ${pc.chargeDepth}m${pc.mobile && pc.chargeDepthAuto ? ' auto' : ''}`, x + 4, ly, C.text);
      drawText(g, `Hedgehog ${v.hedgehogLeft}  Star ${v.starShells}  ${v.searchlightOn ? 'LIGHT ON' : ''}`, x + 4, ly + 10, C.dim);
    } else if (v.sub) {
      const s = v.sub, sc = v.cls.sub!;
      drawText(g, `DEPTH ${Math.round(v.keelDepth)}m`, x + 4, ly, v.keelDepth > sc.testDepth ? C.danger : C.text);
      drawText(g, `ord ${Math.round(s.orderedDepth)}m`, x + 70, ly, C.good);
      drawText(g, 'BATT', x + 4, ly + 10, C.dim);
      bar(g, x + 30, ly + 11, 50, 4, s.battery, s.battery > 0.3 ? '#d8d070' : C.danger);
      const st = s.surfaced ? 'SURFACED' : v.atPeriscopeDepth ? (s.periscope > 0.5 ? 'PERISCOPE UP' : 'PERISCOPE DEPTH') : 'SUBMERGED';
      drawText(g, st, x + 86, ly + 10, s.surfaced ? C.warn : C.allied);
      // tubes
      let tx = x + 4;
      drawText(g, pc.weaponMode === 'gun' ? 'DECK GUN' : 'TUBES', tx, ly + 20, pc.weaponMode === 'gun' ? C.warn : C.dim);
      tx += 40;
      for (const t of v.tubes) {
        pxFill(g, tx, ly + 21, 5, 5, t.loaded ? '#a0ffd0' : '#2a3a44');
        if (!t.loaded && t.reload > 0) pxFill(g, tx, ly + 26 - Math.round((1 - t.reload / (v.cls.torpedoes!.reloadTime)) * 5), 5, 1, C.warn);
        tx += t.stern ? 8 : 7;
      }
      drawText(g, `+${v.torpedoReloads}`, tx + 3, ly + 20, C.dim);
      if (s.silent > 0) drawText(g, 'SILENT', x + 120, ly + 20, '#9adfff');
      // depth gauge on the right edge
      this.depthGauge(g, v, x + w + 4, y, h);
    }
  }

  private depthGauge(g: CanvasRenderingContext2D, v: Vessel, x: number, y: number, h: number) {
    const s = v.sub!, sc = v.cls.sub!, W = 18;
    panel(g, x, y, W, h);
    const max = sc.crushDepth * 1.05;
    const Y = (d: number) => y + 3 + (d / max) * (h - 6);
    pxFill(g, x + 3, Y(sc.testDepth), W - 6, 1, C.warn);
    pxFill(g, x + 3, Y(sc.crushDepth), W - 6, 1, C.danger);
    const lay = v.world.layerDepth;
    if (lay > 0) pxLine(g, x + 2, Y(lay), x + W - 3, Y(lay), C.layer, 2);
    pxFill(g, x + 3, Y(sc.periscopeDepth), 3, 1, C.dim);
    pxFill(g, x + 2, Y(s.orderedDepth), W - 4, 1, C.good);
    pxFill(g, x + 5, Y(0), W - 10, Math.max(1, Y(v.keelDepth) - Y(0)), '#3a6a8a');
    pxFill(g, x + 4, Y(v.keelDepth) - 1, W - 8, 3, C.text);
  }

  private drawAbilities(g: CanvasRenderingContext2D, pc: PlayerControl, W: number, H: number) {
    const slots = pc.abilities.slots;
    const n = slots.length;
    if (!n || this.touchAbilities) return;
    const sz = 22, gap = 3;
    const total = n * sz + (n - 1) * gap;
    // centred, but stepping right of the status panel when the HUD is narrow (large HUD text)
    const x0 = Math.max(Math.round(W / 2 - total / 2), this.statusRight + 8), y = H - sz - 14;
    this.barRight = x0 + total;
    const keys = ['ability1', 'ability2', 'ability3', 'ability4', 'ability5', 'ability6'] as const;
    slots.forEach((s, i) => {
      const x = x0 + i * (sz + gap);
      panel(g, x, y, sz, sz, 0.8);
      if (!s) return;
      const def = ABILITIES[s.id];
      const ready = pc.abilities.ready(i);
      const icon = hasGlyphs(def.glyph) ? def.glyph : def.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
      drawText(g, icon, x + sz / 2, y + 8, ready ? C.text : C.dim, { align: 'center', scale: 1 });
      if (s.cooldown > 0 && !dev.bool('game.noCooldowns')) {
        const f = clamp(s.cooldown / Math.max(0.01, s.maxCooldown), 0, 1);
        g.globalAlpha = 0.65; pxFill(g, x + 1, y + 1 + (1 - f) * (sz - 2), sz - 2, f * (sz - 2), '#000'); g.globalAlpha = 1;
        drawText(g, String(Math.ceil(s.cooldown)), x + sz / 2, y + 8, C.warn, { align: 'center' });
      }
      if (s.active > 0) pxRect(g, x, y, sz, sz, C.good);
      if (s.charges !== null) drawText(g, String(s.charges), x + sz - 3, y + sz - 8, C.warn, { align: 'right' });
      const k = this.input.usingPad ? (i >= 4 ? 'L1+' + this.input.glyph(keys[i - 4]) : this.input.glyph(keys[i])) : this.input.glyph(keys[i]);
      drawText(g, k, x + sz / 2, y + sz + 3, C.dim, { align: 'center' });
    });
  }

  private drawPlot(g: CanvasRenderingContext2D, m: Mission, W: number) {
    const w = m.world, v = w.player;
    const R = this.plotR, cx = W - R - 6, cy = R + 6;
    const range = 3200;
    this.layout.right = cy + R + 21;
    g.globalAlpha = 0.7; pxFill(g, cx - R, cy - R, R * 2, R * 2, '#06100f'); g.globalAlpha = 1;
    pxCircle(g, cx, cy, R, '#3c4a52');
    pxCircle(g, cx, cy, R / 2, C.grid, 2);
    if (!v) return;
    const P = (x: number, y: number): [number, number] => [cx + ((x - v.pos.x) / range) * R, cy + ((y - v.pos.y) / range) * R];
    const inside = (x: number, y: number) => Math.hypot(x - cx, y - cy) < R - 1;
    for (const o of w.vessels) {
      if (!o.alive) continue;
      const friendly = o.side === w.playerSide;
      if (!friendly && !w.isVisibleToPlayer(o)) continue;
      const [x, y] = P(o.pos.x, o.pos.y);
      if (!inside(x, y)) continue;
      pxFill(g, x - 1, y - 1, o.kind === 'merchant' ? 2 : 3, o.kind === 'merchant' ? 2 : 3, o.isPlayer ? C.good : friendly ? (o.kind === 'merchant' ? '#d8d8c8' : C.allied) : C.axis);
    }
    for (const c of w.sensors.list(w.playerSide)) {
      if (c.truth && w.isVisibleToPlayer(c.truth) && !c.truth.submerged) continue;
      const [x, y] = P(c.x, c.y);
      if (!inside(x, y)) continue;
      diamond(g, x, y, 2, c.kind === 'sub' ? C.danger : C.axis);
    }
    for (const c of w.projectiles.crates) { const [x, y] = P(c.x, c.y); if (inside(x, y)) pxFill(g, x, y, 1, 1, RARITY_HEX[c.item.rarity]); }
    for (const a of w.projectiles.aircraft) { const [x, y] = P(a.x, a.y); if (inside(x, y)) drawText(g, '+', x, y - 3, C.allied, { align: 'center', outline: null }); }
    // convoy route
    const conv = m.convoy;
    const [ex, ey] = P(conv.exitX, conv.y);
    if (inside(ex, ey)) pxFill(g, ex, ey - 3, 1, 7, C.good);
    drawText(g, '3 km', cx, cy + R + 3, C.dim, { align: 'center' });
    const env = w.env;
    const hh = Math.floor(env.hour), mm = Math.floor((env.hour % 1) * 60);
    drawText(g, `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}  ${env.weather}  Bf ${Math.round(w.ocean.params.seaState)}`, cx, cy + R + 12, C.dim, { align: 'center' });
    void BEAUFORT_NAME;
  }

  private drawObjectives(g: CanvasRenderingContext2D, m: Mission) {
    const x = 4, y = 4;
    const S = m.stats;
    const lines: [string, string][] = [];
    if (m.side === 'allied') {
      lines.push([`Convoy ${m.convoy.alive.length}/${m.merchantsTotal} ships`, C.text]);
      lines.push([`Lost ${fmtInt(S.tonnageLost)} GRT`, S.tonnageLost ? C.danger : C.dim]);
      lines.push([`U-boats sunk ${S.uboatsSunk}`, S.uboatsSunk ? C.good : C.dim]);
    } else {
      lines.push([`Sunk ${fmtInt(S.tonnageSunk)} GRT`, S.tonnageSunk ? C.good : C.text]);
      lines.push([`Ships ${S.shipsSunk.length}  Torpedoes ${S.torpedoHits}/${S.torpedoes}`, C.dim]);
    }
    lines.push([`Convoy ${Math.round(m.convoy.progress * 100)}%  ${formatTime(m.elapsed)}`, C.dim]);
    if (S.loot.length) lines.push([`Salvage ${S.loot.length}`, '#ffd84a']);
    const wdt = 132;
    panel(g, x, y, wdt, lines.length * 10 + 6, 0.55);
    lines.forEach(([t, c], i) => drawText(g, t, x + 4, y + 4 + i * 10, c));
    this.layout.left = y + lines.length * 10 + 6;
    this.layout.leftX = Math.max(this.layout.leftX, x + wdt);
  }

  /** the tutorial coach: step title, instruction (keys highlighted) and the skip hint, under the compass */
  private drawTutorial(g: CanvasRenderingContext2D, W: number) {
    this.tutBottom = 0;
    const view = this.tutorial?.view();
    if (!view) return;
    // between the objectives and the plot; a narrow (large-text) HUD gets the full width below the objectives
    const narrow = W < 460;
    let w = narrow ? W - 8 : Math.min(300, W - 16), x = narrow ? 4 : Math.round(W / 2 - w / 2), y = narrow ? 52 : 34;
    const height = (w: number) => 17 + wrapText(view.body, w - 10).length * 10 + (view.footer ? 11 : 2);
    if (this.mobile) {
      // touch HUD (both top columns are full): in the gap between them when a readable panel fits there,
      // else (portrait phone, tablet) stacked under both, clear of the pause / time buttons, and beside the
      // throttle when it would reach down to it
      const l = this.layout.leftX + 6, r = this.layout.rightX - 6, t = this.reserved.throttle;
      if (r - l >= 200) { w = Math.min(300, r - l); x = Math.round(clamp(W / 2 - w / 2, l, r - w)); y = 34; }
      else {
        w = W - 8; x = 4; y = Math.max(this.layout.left, this.layout.right + this.reserved.below) + 6;
        if (t && y < t.y1 && y + height(w) > t.y0) { x = Math.ceil(t.x1) + 4; w = W - 4 - x; }
      }
    }
    const body = wrapText(view.body, w - 10);
    const h = height(w);
    const a = g.globalAlpha;
    g.globalAlpha = view.alpha;
    panel(g, x, y, w, h, 0.85);
    drawText(g, view.title.toUpperCase(), x + 5, y + 4, view.done ? C.good : C.warn, { alpha: view.alpha });
    drawText(g, `TUTORIAL ${view.n}/${view.total}`, x + w - 5, y + 4, C.dim, { align: 'right', alpha: view.alpha });
    body.forEach((line, i) => drawKeys(g, line, x + 5, y + 16 + i * 10, C.text, '#a0ffd0', view.alpha));
    if (view.footer) drawKeys(g, view.footer, x + w - 5 - textWidth(view.footer), y + h - 11, C.dim, C.dim, view.alpha);
    g.globalAlpha = a;
    this.tutBottom = this.layout.center = y + h;
  }

  private drawMessages(g: CanvasRenderingContext2D, H: number) {
    const now = performance.now() / 1000;
    const recent = this.msgs.filter((m) => !m.gone && now - m.t < msgLife(m)).slice(-6);
    let y = H - 104 - recent.length * 10;
    for (const m of recent) {
      const a = clamp((msgLife(m) - (now - m.t)) / 1.5, 0, 1);
      const col = m.color ?? (m.kind === 'alert' ? C.danger : m.kind === 'radio' ? '#b8d8a0' : m.kind === 'loot' ? '#ffd84a' : m.kind === 'crew' ? C.allied : C.text);
      for (const line of wrapText(m.text, 260)) { drawText(g, line, 6, y, col, { alpha: a }); y += 10; }
    }
  }

  private drawWarnings(g: CanvasRenderingContext2D, m: Mission, W: number, H: number) {
    const now = performance.now() / 1000;
    const v = m.world.player;
    if (v?.sub && v.keelDepth > v.cls.sub!.testDepth) this.warn('BELOW TEST DEPTH', 0.3);
    if (v && v.hydro.floodTotal() > 0.15 && v.alive) this.warn('FLOODING', 0.3);
    if (v?.sub && v.sub.battery < 0.12 && v.submerged) this.warn('BATTERY LOW', 0.3);
    let y = Math.max(H * 0.22, this.tutBottom + 8);
    for (const [t, until] of this.warnings) {
      if (now > until) { this.warnings.delete(t); continue; }
      if (this.mobile) continue;
      const blink = Math.floor(now * 4) % 2 === 0;
      drawText(g, t, W / 2, y, blink ? C.danger : '#ffb090', { align: 'center', scale: 1 });
      y += 11;
    }
    if (m.over) {
      const t = m.outcome === 'victory' ? 'MISSION COMPLETE' : m.outcome === 'sunk' ? 'SHIP LOST' : m.outcome === 'withdrew' ? 'WITHDRAWN' : 'MISSION FAILED';
      drawText(g, t, W / 2, H * 0.4, m.outcome === 'victory' ? C.good : C.danger, { align: 'center', scale: 2 });
      drawText(g, m.overReason, W / 2, H * 0.4 + 22, C.text, { align: 'center' });
    }
  }
}

/** one line of text with [key] tokens picked out in their own colour */
function drawKeys(g: CanvasRenderingContext2D, s: string, x: number, y: number, col: string, keyCol: string, alpha: number) {
  let cx = x;
  for (const part of s.split(/(\[[^\]]*\])/)) {
    if (!part) continue;
    drawText(g, part, cx, y, part.startsWith('[') ? keyCol : col, { alpha });
    // segments meet mid-line: add back the inter-glyph gap that textWidth trims off the end
    cx += textWidth(part) + 1;
  }
}

function diamond(g: CanvasRenderingContext2D, x: number, y: number, r: number, col: string) {
  pxLine(g, x - r, y, x, y - r, col); pxLine(g, x, y - r, x + r, y, col);
  pxLine(g, x + r, y, x, y + r, col); pxLine(g, x, y + r, x - r, y, col);
}
function brackets(g: CanvasRenderingContext2D, x: number, y: number, r: number, col: string) {
  const k = Math.max(3, r * 0.35);
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    pxLine(g, x + sx * r, y + sy * r, x + sx * (r - k), y + sy * r, col);
    pxLine(g, x + sx * r, y + sy * r, x + sx * r, y + sy * (r - k), col);
  }
}
