// In-mission HUD on the low-res overlay canvas: compass, status, depth gauge, ability bar,
// tactical plot, contact markers, solution lines, loot labels, messages and warnings.

import type { Screen } from '../render/screen';
import type { Camera } from '../render/camera';
import type { RenderBackend } from '../render/types';
import type { Mission } from '../game/mission';
import type { PlayerControl } from '../game/player';
import { CHARGE_DEPTHS } from '../game/player';
import type { Input } from '../input/input';
import { TELEGRAPH, type Vessel } from '../game/vessel';
import { drawText, textWidth, pxLine, pxCircle, pxRect, pxFill, panel, bar, wrapText, hasGlyphs } from './pixelFont';
import { clamp, fmtInt, formatTime, toBearing, KNOT } from '../core/math';
import { dev } from '../core/devSettings';
import { ABILITIES } from '../meta/abilities';
import { SRC } from '../game/sensors';
import { RARITY_BEAM } from '../game/weapons';
import { BEAUFORT_NAME } from '../water/ocean';

const C = {
  text: '#e8e2cf', dim: '#a49f8c', allied: '#8fc4e8', axis: '#e8c070', danger: '#ff6a4a', good: '#8ad89a', warn: '#ffc040',
  water: '#4aa0c0', layer: '#5a8ad8', grid: '#2a3a44',
};
const RARITY_HEX: Record<string, string> = { common: '#c8c8c8', magic: '#6f9cff', rare: '#ffd84a', legendary: '#ff8c2a', unique: '#d8b47a' };

interface Msg { text: string; t: number; kind: string; important: boolean }

export class Hud {
  msgs: Msg[] = [];
  warnings = new Map<string, number>();
  fps = 60;
  private fpsAcc = 0; private fpsN = 0;
  showPlot = true;
  tactical = false;
  /** active renderer (perf line + backend name next to the FPS) */
  backend: RenderBackend | null = null;

  constructor(private screen: Screen, private cam: Camera, private input: Input) {}

  attach(m: Mission) {
    const w = m.world;
    this.msgs = [];
    w.bus.on('message', (e) => {
      if (e.side && e.side !== w.playerSide) return;
      this.msgs.push({ text: e.text, t: performance.now() / 1000, kind: e.kind ?? 'info', important: !!e.important });
      if (this.msgs.length > 40) this.msgs.shift();
    });
    w.bus.on('torpedoFired', (e) => { if (e.by.side !== w.playerSide) { const p = w.player; if (p && Math.hypot(e.x - p.pos.x, e.y - p.pos.y) < 2000 && (p.kind === 'escort' || p.kind === 'merchant')) this.warn('TORPEDO IN THE WATER!'); } });
    w.bus.on('ping', (e) => { if (w.player?.sub && e.by.side !== w.playerSide && Math.hypot(e.by.pos.x - w.player.pos.x, e.by.pos.y - w.player.pos.y) < 2500) this.warn('ASDIC! WE ARE BEING PINGED'); });
    w.bus.on('dcDrop', (e) => { if (w.player?.sub && e.by.side !== w.playerSide && Math.hypot(e.x - w.player.pos.x, e.y - w.player.pos.y) < 900) this.warn('WASSERBOMBEN! DEPTH CHARGES!'); });
    w.bus.on('greenWater', () => this.warn('GREEN WATER OVER THE BOW', 1.5));
  }

  warn(text: string, dur = 3) { this.warnings.set(text, performance.now() / 1000 + dur); }

  draw(m: Mission, pc: PlayerControl, realDt: number) {
    const g = this.screen.hudCtx, W = this.screen.W, H = this.screen.H;
    g.clearRect(0, 0, W, H);
    g.imageSmoothingEnabled = false;
    this.fpsAcc += realDt; this.fpsN++;
    if (this.fpsAcc > 0.5) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; }
    const w = m.world, v = w.player;
    this.worldOverlays(g, m, pc);
    this.drawObjectives(g, m);
    this.drawCompass(g, v, W);
    if (v) this.drawStatus(g, v, pc, H);
    this.drawAbilities(g, pc, W, H);
    if (this.showPlot) this.drawPlot(g, m, W);
    this.drawMessages(g, H);
    this.drawWarnings(g, m, W, H);
    // time compression + fps
    const ts = pc.timeScale;
    if (ts > 1) drawText(g, `TIME x${ts}`, W / 2, 30, C.warn, { align: 'center' });
    if (dev.bool('display.showFps')) drawText(g, `${Math.round(this.fps)} fps ${this.backend?.info.kind ?? ''}`.trimEnd(), W - 4, H - 10, C.dim, { align: 'right' });
    if (dev.bool('debug.perf') && this.backend) {
      const R = this.backend.stats;
      drawText(g, `slices ${R.stackInstances}  particles ${R.particles}  lights ${R.lights}  bodies ${w.vessels.length}  shells ${w.projectiles.shells.length}`, 4, H - 10, C.dim);
    }
  }

  // ------------------------------------------------------------------ world-space markers
  private worldOverlays(g: CanvasRenderingContext2D, m: Mission, pc: PlayerControl) {
    const w = m.world, cam = this.cam, v = w.player;
    const S = (x: number, y: number, z = 0) => cam.toScreen(x, y, z);
    const side = w.playerSide;
    const now = w.time;
    // contacts
    for (const c of w.sensors.list(side)) {
      const age = now - c.last;
      const fade = clamp(1 - age / 90, 0.15, 1);
      const enemyVisible = c.truth && w.isVisibleToPlayer(c.truth) && c.truth.alive && !c.truth.submerged;
      g.globalAlpha = fade;
      for (const l of c.lines) {
        const la = clamp(1 - (now - l.t) / 25, 0, 1) * 0.7;
        if (la <= 0) continue;
        g.globalAlpha = la;
        const [x0, y0] = S(l.x, l.y), [x1, y1] = S(l.x + Math.cos(l.bearing) * 3200, l.y + Math.sin(l.bearing) * 3200);
        pxLine(g, x0, y0, x1, y1, l.src === SRC.HFDF ? '#d890ff' : side === 'allied' ? '#ff8a6a' : '#e8c070', 3);
      }
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
      if (sx < -20 || sy < -20 || sx > this.screen.W + 20 || sy > this.screen.H + 20) continue;
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
    const cw = Math.min(220, W * 0.4), cx = W / 2, y = 4;
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
    const x = 4, h = v.sub ? 92 : 78, y = H - h - 4, w = 164;
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
      drawText(g, `D/C ${v.dcLeft}  set ${CHARGE_DEPTHS[pc.chargeDepthIdx]}m`, x + 4, ly, C.text);
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
    if (!n) return;
    const sz = 22, gap = 3;
    const total = n * sz + (n - 1) * gap;
    const x0 = Math.round(W / 2 - total / 2), y = H - sz - 14;
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
    const R = 52, cx = W - R - 6, cy = R + 6;
    const range = 3200;
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
  }

  private drawMessages(g: CanvasRenderingContext2D, H: number) {
    const now = performance.now() / 1000;
    const recent = this.msgs.filter((m) => now - m.t < (m.important ? 10 : 7)).slice(-6);
    let y = H - 104 - recent.length * 10;
    for (const m of recent) {
      const a = clamp(((m.important ? 10 : 7) - (now - m.t)) / 1.5, 0, 1);
      const col = m.kind === 'alert' ? C.danger : m.kind === 'radio' ? '#b8d8a0' : m.kind === 'loot' ? '#ffd84a' : m.kind === 'crew' ? C.allied : C.text;
      for (const line of wrapText(m.text, 260)) { drawText(g, line, 6, y, col, { alpha: a }); y += 10; }
    }
  }

  private drawWarnings(g: CanvasRenderingContext2D, m: Mission, W: number, H: number) {
    const now = performance.now() / 1000;
    const v = m.world.player;
    if (v?.sub && v.keelDepth > v.cls.sub!.testDepth) this.warn('BELOW TEST DEPTH', 0.3);
    if (v && v.hydro.floodTotal() > 0.15 && v.alive) this.warn('FLOODING', 0.3);
    if (v?.sub && v.sub.battery < 0.12 && v.submerged) this.warn('BATTERY LOW', 0.3);
    let y = H * 0.22;
    for (const [t, until] of this.warnings) {
      if (now > until) { this.warnings.delete(t); continue; }
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
