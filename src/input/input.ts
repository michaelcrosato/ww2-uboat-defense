// Unified input: keyboard, mouse, gamepad (PS5 DualSense / Xbox / generic standard mapping) and
// touch. Gameplay asks for named actions; bindings are rebindable and persisted. Codes:
//   keyboard 'KeyW', 'Space', 'ShiftLeft' ...   mouse 'Mouse0' (left) 'Mouse1' (middle) 'Mouse2' (right)
//   wheel 'WheelUp' / 'WheelDown'    gamepad buttons 'Pad0'..'Pad17'    touch buttons 'Touch:<name>'

import { clamp } from '../core/math';
import { dev } from '../core/devSettings';

export type Action =
  | 'throttleUp' | 'throttleDown' | 'rudderLeft' | 'rudderRight'
  | 'fire' | 'alt' | 'ping' | 'charge' | 'chargePort' | 'chargeStbd'
  | 'ability1' | 'ability2' | 'ability3' | 'ability4' | 'ability5' | 'ability6'
  | 'depthUp' | 'depthDown' | 'periscope' | 'surface' | 'periscopeDepth' | 'searchlight'
  | 'target' | 'tactical' | 'map' | 'pause' | 'timeUp' | 'timeDown' | 'camera' | 'zoomIn' | 'zoomOut' | 'interact'
  | 'panUp' | 'panDown' | 'panLeft' | 'panRight'
  | 'menuUp' | 'menuDown' | 'menuLeft' | 'menuRight' | 'menuAccept' | 'menuBack' | 'menuTabL' | 'menuTabR' | 'abilityMod' | 'tutorialNext';

export const ACTION_LABELS: Record<Action, string> = {
  throttleUp: 'Telegraph ahead', throttleDown: 'Telegraph astern', rudderLeft: 'Rudder to port', rudderRight: 'Rudder to starboard',
  fire: 'Fire (guns / torpedo)', alt: 'Set course / lock target', ping: 'ASDIC ping / periscope view', charge: 'Drop depth charge',
  chargePort: 'K-gun port', chargeStbd: 'K-gun starboard',
  ability1: 'Ability 1', ability2: 'Ability 2', ability3: 'Ability 3', ability4: 'Ability 4', ability5: 'Ability 5', ability6: 'Ability 6',
  depthUp: 'Order shallower', depthDown: 'Order deeper', periscope: 'Raise / lower periscope', surface: 'Surface', periscopeDepth: 'Periscope depth',
  searchlight: 'Searchlight', target: 'Cycle target', tactical: 'Tactical plot', map: 'Chart', pause: 'Pause', timeUp: 'Time compression +',
  timeDown: 'Time compression -', camera: 'Camera mode', zoomIn: 'Zoom in', zoomOut: 'Zoom out', interact: 'Collect / interact',
  panUp: 'Free camera: pan up', panDown: 'Free camera: pan down', panLeft: 'Free camera: pan left', panRight: 'Free camera: pan right',
  menuUp: 'Menu up', menuDown: 'Menu down', menuLeft: 'Menu left', menuRight: 'Menu right', menuAccept: 'Accept', menuBack: 'Back',
  menuTabL: 'Previous tab', menuTabR: 'Next tab', abilityMod: 'Ability set 2 (hold)', tutorialNext: 'Tutorial: skip step',
};

// PS5 standard mapping: 0 Cross, 1 Circle, 2 Square, 3 Triangle, 4 L1, 5 R1, 6 L2, 7 R2, 8 Create,
// 9 Options, 10 L3, 11 R3, 12-15 d-pad up/down/left/right, 16 PS, 17 touchpad
export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  throttleUp: ['KeyW', 'ArrowUp', 'Pad12'],
  throttleDown: ['KeyS', 'ArrowDown', 'Pad13'],
  rudderLeft: ['KeyA', 'ArrowLeft'],
  rudderRight: ['KeyD', 'ArrowRight'],
  fire: ['Mouse0', 'Pad7'],
  alt: ['Mouse2', 'Pad6'],
  ping: ['ShiftLeft', 'Pad11'],
  charge: ['Space', 'Pad5'],
  chargePort: ['KeyZ'],
  chargeStbd: ['KeyX'],
  ability1: ['Digit1', 'Pad2'],
  ability2: ['Digit2', 'Pad3'],
  ability3: ['Digit3', 'Pad1'],
  ability4: ['Digit4', 'Pad0'],
  ability5: ['Digit5'],
  ability6: ['Digit6'],
  depthUp: ['KeyQ', 'Pad12'],
  depthDown: ['KeyE', 'Pad13'],
  periscope: ['Space', 'Pad5'],
  surface: ['KeyR'],
  periscopeDepth: ['KeyF'],
  searchlight: ['KeyL'],
  target: ['KeyT', 'Pad15'],
  tactical: ['Tab', 'Pad8'],
  map: ['KeyM', 'Pad17'],
  pause: ['Escape', 'KeyP', 'Pad9'],
  timeUp: ['Equal', 'NumpadAdd', 'BracketRight'],
  timeDown: ['Minus', 'NumpadSubtract', 'BracketLeft'],
  camera: ['KeyC', 'Pad10'],
  zoomIn: ['WheelUp', 'PageUp'],
  zoomOut: ['WheelDown', 'PageDown'],
  interact: ['KeyG', 'Pad14'],
  // the arrows steer like WASD until the free camera takes them over (Input.suppress)
  panUp: ['ArrowUp'],
  panDown: ['ArrowDown'],
  panLeft: ['ArrowLeft'],
  panRight: ['ArrowRight'],
  menuUp: ['ArrowUp', 'KeyW', 'Pad12'],
  menuDown: ['ArrowDown', 'KeyS', 'Pad13'],
  menuLeft: ['ArrowLeft', 'KeyA', 'Pad14'],
  menuRight: ['ArrowRight', 'KeyD', 'Pad15'],
  menuAccept: ['Enter', 'Space', 'Pad0'],
  menuBack: ['Escape', 'Backspace', 'Pad1'],
  menuTabL: ['KeyQ', 'Pad4'],
  menuTabR: ['KeyE', 'Pad5'],
  abilityMod: ['Pad4'],
  tutorialNext: ['Enter'],
};

const STORE = 'wolfpack.bindings.v1';
export type Device = 'kbm' | 'ps' | 'xbox' | 'pad' | 'touch';

export const PS_GLYPHS: Record<string, string> = {
  Pad0: '✕', Pad1: '○', Pad2: '□', Pad3: '△', Pad4: 'L1', Pad5: 'R1', Pad6: 'L2', Pad7: 'R2', Pad8: 'Create', Pad9: 'Options',
  Pad10: 'L3', Pad11: 'R3', Pad12: 'D↑', Pad13: 'D↓', Pad14: 'D←', Pad15: 'D→', Pad16: 'PS', Pad17: 'Pad',
};
export const XBOX_GLYPHS: Record<string, string> = {
  Pad0: 'A', Pad1: 'B', Pad2: 'X', Pad3: 'Y', Pad4: 'LB', Pad5: 'RB', Pad6: 'LT', Pad7: 'RT', Pad8: 'View', Pad9: 'Menu',
  Pad10: 'LS', Pad11: 'RS', Pad12: 'D↑', Pad13: 'D↓', Pad14: 'D←', Pad15: 'D→', Pad16: 'Xbox', Pad17: 'Share',
};

export class Input {
  bindings: Record<Action, string[]>;
  private codes = new Set<string>();       // currently held
  private pressedCodes = new Set<string>(); // went down this frame
  private releasedCodes = new Set<string>();
  private queueDown: string[] = [];
  private queueUp: string[] = [];
  /** mouse in internal pixels */
  mx = 0; my = 0;
  mouseMoved = false;
  wheel = 0;
  /** gamepad sticks (deadzoned) */
  lx = 0; ly = 0; rx = 0; ry = 0;
  l2 = 0; r2 = 0;
  padIndex = -1;
  padId = '';
  device: Device = 'kbm';
  /** middle-drag pan delta (internal px; touch drags in free camera add to it too) */
  dragX = 0; dragY = 0;
  /** the mouse is over the game canvas (edge scrolling only then) */
  pointerIn = false;
  /** codes bound to these actions are ignored by every other gameplay action (the free camera's arrows) */
  suppress: Action[] = [];
  private dragging = false;
  private lastPx = 0; private lastPy = 0;
  private prevPad: boolean[] = [];
  /** callbacks fired on the first user gesture (audio unlock) */
  onGesture: (() => void)[] = [];
  private gestured = false;
  /** suppress game input while a text field / rebinding capture is active */
  captureHandler: ((code: string) => boolean) | null = null;
  touchAxes = { x: 0, y: 0, ax: 0, ay: 0, aiming: false };

  constructor(private el: HTMLElement, private toPixel: (cx: number, cy: number) => [number, number]) {
    this.bindings = { ...DEFAULT_BINDINGS };
    this.load();
    addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' && (e.target as HTMLInputElement).type === 'text') return;
      if (this.captureHandler && this.captureHandler(e.code)) { e.preventDefault(); return; }
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace'].includes(e.code) || (e.code === 'F11')) e.preventDefault();
      if (!e.repeat) this.queueDown.push(e.code);
      this.setDevice('kbm');
      this.gesture();
    });
    addEventListener('keyup', (e) => this.queueUp.push(e.code));
    addEventListener('blur', () => { for (const c of this.codes) this.queueUp.push(c); this.pointerIn = false; });
    el.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') this.pointerIn = false; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') { this.setDevice('touch'); this.gesture(); return; }
      const code = 'Mouse' + e.button;
      if (this.captureHandler && this.captureHandler(code)) { e.preventDefault(); return; }
      this.queueDown.push(code);
      if (e.button === 1) { this.dragging = true; this.lastPx = e.clientX; this.lastPy = e.clientY; e.preventDefault(); }
      this.setDevice('kbm');
      this.gesture();
    });
    addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch') return;
      this.queueUp.push('Mouse' + e.button);
      if (e.button === 1) this.dragging = false;
    });
    addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      const [x, y] = this.toPixel(e.clientX, e.clientY);
      this.mx = x; this.my = y; this.mouseMoved = true;
      this.pointerIn = e.target === el || el.contains(e.target as Node);
      if (this.dragging) {
        const [ax, ay] = this.toPixel(this.lastPx, this.lastPy);
        this.dragX += x - ax; this.dragY += y - ay;
        this.lastPx = e.clientX; this.lastPy = e.clientY;
      }
      if (this.device !== 'kbm' && (Math.abs(e.movementX) + Math.abs(e.movementY) > 2)) this.setDevice('kbm');
    });
    el.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
      const code = e.deltaY < 0 ? 'WheelUp' : 'WheelDown';
      this.queueDown.push(code); this.queueUp.push(code);
      e.preventDefault();
    }, { passive: false });
    addEventListener('gamepadconnected', (e) => { this.padIndex = e.gamepad.index; this.padId = e.gamepad.id; });
    addEventListener('gamepaddisconnected', (e) => { if (e.gamepad.index === this.padIndex) { this.padIndex = -1; if (this.device !== 'kbm') this.setDevice('kbm'); } });
  }

  private gesture() {
    if (this.gestured) return;
    this.gestured = true;
    for (const f of this.onGesture) f();
  }
  setDevice(d: Device) { this.device = d; }

  get padKind(): 'ps' | 'xbox' | 'pad' {
    const id = this.padId.toLowerCase();
    if (id.includes('054c') || id.includes('dualsense') || id.includes('dualshock') || id.includes('wireless controller') || id.includes('playstation')) return 'ps';
    if (id.includes('xbox') || id.includes('045e') || id.includes('xinput')) return 'xbox';
    return 'pad';
  }
  get usingPad() { return this.device === 'ps' || this.device === 'xbox' || this.device === 'pad'; }

  /** call once per frame before game logic */
  update() {
    this.pressedCodes.clear();
    this.releasedCodes.clear();
    for (const c of this.queueDown) { if (!this.codes.has(c)) this.pressedCodes.add(c); this.codes.add(c); }
    for (const c of this.queueUp) { if (this.codes.has(c)) this.releasedCodes.add(c); this.codes.delete(c); }
    this.queueDown.length = 0; this.queueUp.length = 0;
    this.pollPad();
  }
  /** call at end of frame */
  endFrame() { this.wheel = 0; this.dragX = 0; this.dragY = 0; this.mouseMoved = false; }

  private pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp: Gamepad | null = null;
    if (this.padIndex >= 0) gp = pads[this.padIndex] ?? null;
    if (!gp) for (const p of pads) if (p && p.connected) { gp = p; this.padIndex = p.index; this.padId = p.id; break; }
    if (!gp) { this.lx = this.ly = this.rx = this.ry = 0; this.l2 = this.r2 = 0; return; }
    const dz = dev.num('controls.deadzone');
    const ax = (v: number) => (Math.abs(v) < dz ? 0 : Math.sign(v) * (Math.abs(v) - dz) / (1 - dz));
    // radial deadzone for sticks
    const stick = (x: number, y: number): [number, number] => {
      const m = Math.hypot(x, y);
      if (m < dz) return [0, 0];
      const k = Math.min(1, (m - dz) / (1 - dz)) / m;
      return [x * k, y * k];
    };
    [this.lx, this.ly] = stick(gp.axes[0] ?? 0, gp.axes[1] ?? 0);
    [this.rx, this.ry] = stick(gp.axes[2] ?? 0, gp.axes[3] ?? 0);
    this.l2 = gp.buttons[6]?.value ?? 0;
    this.r2 = gp.buttons[7]?.value ?? 0;
    let any = Math.abs(this.lx) + Math.abs(this.ly) + Math.abs(this.rx) + Math.abs(this.ry) > 0.25;
    for (let i = 0; i < gp.buttons.length; i++) {
      const b = gp.buttons[i];
      const down = i === 6 || i === 7 ? b.value > 0.35 : b.pressed;
      const was = this.prevPad[i] ?? false;
      const code = 'Pad' + i;
      if (down && !was) {
        if (this.captureHandler && this.captureHandler(code)) { this.prevPad[i] = down; continue; }
        this.pressedCodes.add(code); this.codes.add(code); any = true;
      } else if (!down && was) { this.releasedCodes.add(code); this.codes.delete(code); }
      this.prevPad[i] = down;
    }
    void ax;
    if (any) {
      const g = dev.str('controls.glyphs');
      this.device = g === 'ps' || g === 'xbox' ? g : (this.padKind === 'pad' ? 'xbox' : this.padKind);
      this.gesture();
    }
  }

  down(a: Action): boolean { for (const c of this.bindings[a]) if (this.codes.has(c) && !this.blocked(a, c)) return true; return false; }
  pressed(a: Action): boolean { for (const c of this.bindings[a]) if (this.pressedCodes.has(c) && !this.blocked(a, c)) return true; return false; }
  released(a: Action): boolean { for (const c of this.bindings[a]) if (this.releasedCodes.has(c) && !this.blocked(a, c)) return true; return false; }
  /** a code taken over by a suppressing action (menus always keep theirs) */
  private blocked(a: Action, c: string) {
    if (!this.suppress.length || this.suppress.includes(a) || a.startsWith('menu')) return false;
    for (const s of this.suppress) if (this.bindings[s].includes(c)) return true;
    return false;
  }
  codeDown(c: string) { return this.codes.has(c); }
  codePressed(c: string) { return this.pressedCodes.has(c); }
  /** press + release an action through its first binding (touch buttons) */
  tapAction(a: Action) { const c = this.bindings[a][0]; if (c) { this.queueDown.push(c); this.queueUp.push(c); } }
  holdAction(a: Action, down: boolean) { const c = this.bindings[a][0]; if (c) (down ? this.queueDown : this.queueUp).push(c); }
  setBindings(a: Action, codes: string[]) { this.bindings[a] = codes.filter(Boolean); this.save(); }
  /** inject from touch UI or tests */
  injectDown(code: string) { this.queueDown.push(code); }
  injectUp(code: string) { this.queueUp.push(code); }

  /** steering axes (-1..1): keyboard, left stick or touch stick */
  moveAxes(): [number, number] {
    let x = 0, y = 0;
    if (this.down('rudderLeft')) x -= 1;
    if (this.down('rudderRight')) x += 1;
    if (this.down('throttleUp')) y -= 1;
    if (this.down('throttleDown')) y += 1;
    if (Math.abs(this.lx) + Math.abs(this.ly) > 0) { x = this.lx; y = this.ly; }
    if (Math.abs(this.touchAxes.x) + Math.abs(this.touchAxes.y) > 0) { x = this.touchAxes.x; y = this.touchAxes.y; }
    return [clamp(x, -1, 1), clamp(y, -1, 1)];
  }

  rumble(strong: number, weak: number, ms: number) {
    if (!dev.bool('controls.rumble') || this.padIndex < 0) return;
    const gp = navigator.getGamepads?.()[this.padIndex];
    const act = (gp as unknown as { vibrationActuator?: { playEffect: (t: string, p: object) => Promise<unknown> } })?.vibrationActuator;
    act?.playEffect('dual-rumble', { duration: ms, strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(weak, 0, 1) }).catch(() => {});
  }

  /** printable glyph for the first binding of an action on the current device */
  glyph(a: Action): string {
    const list = this.bindings[a];
    const pad = this.usingPad;
    const g = this.device === 'ps' ? PS_GLYPHS : XBOX_GLYPHS;
    for (const c of list) {
      if (pad && c.startsWith('Pad')) return g[c] ?? c;
      if (!pad && !c.startsWith('Pad')) return keyLabel(c);
    }
    return list.length ? keyLabel(list[0]) : '—';
  }

  rebind(a: Action, slot: number, code: string) {
    const list = [...this.bindings[a]];
    list[slot] = code;
    this.bindings[a] = list.filter(Boolean);
    this.save();
  }
  resetBindings() { this.bindings = { ...DEFAULT_BINDINGS }; this.save(); }
  save() {
    try {
      const diff: Partial<Record<Action, string[]>> = {};
      for (const k in this.bindings) { const a = k as Action; if (JSON.stringify(this.bindings[a]) !== JSON.stringify(DEFAULT_BINDINGS[a])) diff[a] = this.bindings[a]; }
      localStorage.setItem(STORE, JSON.stringify(diff));
    } catch { /* ignore */ }
  }
  load() {
    try {
      const raw = localStorage.getItem(STORE);
      if (!raw) return;
      const d = JSON.parse(raw) as Partial<Record<Action, string[]>>;
      for (const k in d) if (k in DEFAULT_BINDINGS && Array.isArray(d[k as Action])) this.bindings[k as Action] = d[k as Action]!;
    } catch { /* ignore */ }
  }
  /** conflicts: actions in the same context sharing a code */
  conflicts(): string[] {
    const gameplay: Action[] = (Object.keys(DEFAULT_BINDINGS) as Action[]).filter((a) => !a.startsWith('menu'));
    const seen = new Map<string, Action[]>();
    for (const a of gameplay) for (const c of this.bindings[a]) seen.set(c, [...(seen.get(c) ?? []), a]);
    const out: string[] = [];
    const allowed = [['charge', 'periscope'], ['depthUp', 'throttleUp'], ['depthDown', 'throttleDown'],
      ['panUp', 'throttleUp'], ['panDown', 'throttleDown'], ['panLeft', 'rudderLeft'], ['panRight', 'rudderRight']];
    for (const [c, acts] of seen) {
      if (acts.length < 2) continue;
      if (acts.length === 2 && allowed.some(([x, y]) => acts.includes(x as Action) && acts.includes(y as Action))) continue;
      out.push(`${keyLabel(c)}: ${acts.map((a) => ACTION_LABELS[a]).join(' / ')}`);
    }
    return out;
  }
}

export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
  const map: Record<string, string> = {
    Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', WheelUp: 'Wheel↑', WheelDown: 'Wheel↓', Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'RShift',
    ControlLeft: 'Ctrl', AltLeft: 'Alt', Escape: 'Esc', Enter: 'Enter', Tab: 'Tab', Backspace: 'Bksp', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←',
    ArrowRight: '→', Equal: '=', Minus: '-', BracketLeft: '[', BracketRight: ']', PageUp: 'PgUp', PageDown: 'PgDn',
  };
  return map[code] ?? PS_GLYPHS[code] ?? code;
}
