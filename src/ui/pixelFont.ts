// 5x7 proportional pixel font with lower case, borrowed from my-3d2dge (MIT, same author), plus a
// few naval glyphs. Drawn with fillRect runs so text stays crisp on the low-res HUD canvas.

const G57: Record<string, string> = {
  A: '.###.|#...#|#...#|#####|#...#|#...#|#...#', B: '####.|#...#|#...#|####.|#...#|#...#|####.', C: '.###.|#...#|#....|#....|#....|#...#|.###.', D: '####.|#...#|#...#|#...#|#...#|#...#|####.', E: '#####|#....|#....|####.|#....|#....|#####', F: '#####|#....|#....|####.|#....|#....|#....',
  G: '.###.|#...#|#....|#.###|#...#|#...#|.####', H: '#...#|#...#|#...#|#####|#...#|#...#|#...#', I: '###|.#.|.#.|.#.|.#.|.#.|###', J: '..###|...#.|...#.|...#.|...#.|#..#.|.##..', K: '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#', L: '#....|#....|#....|#....|#....|#....|#####',
  M: '#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#', N: '#...#|#...#|##..#|#.#.#|#..##|#...#|#...#', O: '.###.|#...#|#...#|#...#|#...#|#...#|.###.', P: '####.|#...#|#...#|####.|#....|#....|#....', Q: '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#', R: '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
  S: '.####|#....|#....|.###.|....#|....#|####.', T: '#####|..#..|..#..|..#..|..#..|..#..|..#..', U: '#...#|#...#|#...#|#...#|#...#|#...#|.###.', V: '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..', W: '#...#|#...#|#...#|#.#.#|#.#.#|#.#.#|.#.#.', X: '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
  Y: '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..', Z: '#####|....#|...#.|..#..|.#...|#....|#####', a: '.....|.....|.###.|....#|.####|#...#|.####', b: '#....|#....|####.|#...#|#...#|#...#|####.', c: '.....|.....|.###.|#....|#....|#....|.###.', d: '....#|....#|.####|#...#|#...#|#...#|.####',
  e: '.....|.....|.###.|#...#|#####|#....|.###.', f: '..##|.#..|####|.#..|.#..|.#..|.#..', g: '.....|.....|.####|#...#|#...#|#...#|.####|....#|.###.', h: '#....|#....|####.|#...#|#...#|#...#|#...#', i: '#|.|#|#|#|#|#', j: '..#|...|..#|..#|..#|..#|..#|#.#|.#.',
  k: '#...|#...|#..#|#.#.|##..|#.#.|#..#', l: '#.|#.|#.|#.|#.|#.|.#', m: '.....|.....|##.#.|#.#.#|#.#.#|#.#.#|#.#.#', n: '.....|.....|####.|#...#|#...#|#...#|#...#', o: '.....|.....|.###.|#...#|#...#|#...#|.###.', p: '.....|.....|####.|#...#|#...#|#...#|####.|#....|#....',
  q: '.....|.....|.####|#...#|#...#|#...#|.####|....#|....#', r: '....|....|#.##|##..|#...|#...|#...', s: '.....|.....|.####|#....|.###.|....#|####.', t: '.#..|.#..|####|.#..|.#..|.#..|..##', u: '.....|.....|#...#|#...#|#...#|#...#|.####', v: '.....|.....|#...#|#...#|#...#|.#.#.|..#..',
  w: '.....|.....|#...#|#...#|#.#.#|#.#.#|.#.#.', x: '.....|.....|#...#|.#.#.|..#..|.#.#.|#...#', y: '.....|.....|#...#|#...#|#...#|#...#|.####|....#|.###.', z: '.....|.....|#####|...#.|..#..|.#...|#####', '0': '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.', '1': '..#..|.##..|..#..|..#..|..#..|..#..|.###.',
  '2': '.###.|#...#|....#|...#.|..#..|.#...|#####', '3': '####.|....#|....#|.###.|....#|....#|####.', '4': '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.', '5': '#####|#....|####.|....#|....#|#...#|.###.', '6': '.###.|#....|#....|####.|#...#|#...#|.###.', '7': '#####|....#|...#.|..#..|.#...|.#...|.#...',
  '8': '.###.|#...#|#...#|.###.|#...#|#...#|.###.', '9': '.###.|#...#|#...#|.####|....#|....#|.###.', '!': '#|#|#|#|#|.|#', '"': '#.#|#.#|...|...|...|...|...', '#': '.#.#.|.#.#.|#####|.#.#.|#####|.#.#.|.#.#.', $: '..#..|.####|#.#..|.###.|..#.#|####.|..#..',
  '%': '##..#|##..#|...#.|..#..|.#...|#..##|#..##', '&': '.##..|#..#.|#.#..|.#...|#.#.#|#..#.|.##.#', "'": '#|#|.|.|.|.|.', '(': '..#|.#.|#..|#..|#..|.#.|..#', ')': '#..|.#.|..#|..#|..#|.#.|#..', '*': '.....|#.#.#|.###.|#####|.###.|#.#.#|.....',
  '+': '.....|..#..|..#..|#####|..#..|..#..|.....', ',': '..|..|..|..|..|.#|.#|#.', '-': '....|....|....|####|....|....|....', '.': '.|.|.|.|.|.|#', '/': '....#|....#|...#.|..#..|.#...|#....|#....', ':': '.|.|#|.|.|#|.',
  ';': '..|..|.#|..|..|.#|.#|#.', '<': '...#|..#.|.#..|#...|.#..|..#.|...#', '=': '.....|.....|#####|.....|#####|.....|.....', '>': '#...|.#..|..#.|...#|..#.|.#..|#...', '?': '.###.|#...#|....#|...#.|..#..|.....|..#..', '@': '.###.|#...#|#.###|#.#.#|#.###|#....|.####',
  '[': '###|#..|#..|#..|#..|#..|###', ']': '###|..#|..#|..#|..#|..#|###', '^': '..#..|.#.#.|#...#|.....|.....|.....|.....', _: '.....|.....|.....|.....|.....|.....|#####', '|': '#|#|#|#|#|#|#',
  '~': '.....|.....|.#...|#.#.#|...#.|.....|.....', '°': '.##.|#..#|#..#|.##.|....|....|....', '·': '.|.|.|#|.|.|.', '•': '...|...|.#.|###|.#.|...|...',
  '←': '.....|..#..|.#...|#####|.#...|..#..|.....', '→': '.....|..#..|...#.|#####|...#.|..#..|.....', '↑': '..#..|.###.|#.#.#|..#..|..#..|..#..|.....', '↓': '.....|..#..|..#..|..#..|#.#.#|.###.|..#..',
  '×': '.....|#...#|.#.#.|..#..|.#.#.|#...#|.....', '▸': '#...|##..|###.|####|###.|##..|#...', '▾': '.....|.....|#####|.###.|..#..|.....|.....', '◂': '...#|..##|.###|####|.###|..##|...#', '♦': '..#..|.###.|#####|#####|.###.|..#..|.....',
  '✕': '.....|#...#|.#.#.|..#..|.#.#.|#...#|.....', '○': '.....|.###.|#...#|#...#|#...#|.###.|.....', '□': '.....|#####|#...#|#...#|#...#|#####|.....', '△': '.....|..#..|.#.#.|.#.#.|#...#|#####|.....',
  '★': '..#..|..#..|#####|.###.|.#.#.|#...#|.....', '♪': '..##.|..#.#|..#..|..#..|.##..|###..|.#...', '█': '#####|#####|#####|#####|#####|#####|#####', '…': '.....|.....|.....|.....|.....|.....|#.#.#',
};

interface Glyph { w: number; runs: [number, number, number][] }
const GLYPHS: Record<string, Glyph> = {};
for (const ch in G57) {
  const rows = G57[ch].split('|');
  const runs: [number, number, number][] = [];
  rows.forEach((r, y) => { for (let x = 0; x < r.length;) { if (r[x] !== '#') { x++; continue; } let n = 1; while (r[x + n] === '#') n++; runs.push([x, y, n]); x += n; } });
  GLYPHS[ch] = { w: rows[0].length, runs };
}
const H = 7, SPACE = 3, GAP = 1;

const glyph = (ch: string) => GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()] ?? GLYPHS['?'];
/** true when every character of s has a glyph (ability icons fall back to letters otherwise) */
export const hasGlyphs = (s: string) => [...s].every((ch) => ch === ' ' || !!GLYPHS[ch] || !!GLYPHS[ch.toUpperCase()]);

export function textWidth(s: string, scale = 1): number {
  let w = 0, m = 0;
  for (const ch of s) {
    if (ch === '\n') { m = Math.max(m, w); w = 0; continue; }
    w += ch === ' ' ? SPACE + GAP : glyph(ch).w + GAP;
  }
  return (Math.max(m, w) - GAP) * scale;
}
export const lineHeight = (scale = 1) => (H + 3) * scale;

export interface TextOpts { scale?: number; align?: 'left' | 'center' | 'right'; outline?: string | null; shadow?: string | null; alpha?: number }

export function drawText(g: CanvasRenderingContext2D, s: string, x: number, y: number, color: string, o: TextOpts = {}) {
  const sc = o.scale ?? 1;
  const lines = s.split('\n');
  const prevA = g.globalAlpha;
  if (o.alpha !== undefined) g.globalAlpha = o.alpha;
  const pass = (ox: number, oy: number, col: string) => {
    g.fillStyle = col;
    lines.forEach((line, li) => {
      const lw = textWidth(line, sc);
      let cx = Math.round(x + (o.align === 'center' ? -lw / 2 : o.align === 'right' ? -lw : 0));
      const cy = Math.round(y + li * lineHeight(sc));
      for (const ch of line) {
        if (ch === ' ') { cx += (SPACE + GAP) * sc; continue; }
        const gl = glyph(ch);
        for (const [rx, ry, rn] of gl.runs) g.fillRect(cx + rx * sc + ox, cy + ry * sc + oy, rn * sc, sc);
        cx += (gl.w + GAP) * sc;
      }
    });
  };
  if (o.shadow) pass(sc, sc, o.shadow);
  const outline = o.outline === undefined ? '#05080b' : o.outline;
  if (outline) for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) pass(ox, oy, outline);
  pass(0, 0, color);
  g.globalAlpha = prevA;
}

/** word-wrap to a pixel width */
export function wrapText(s: string, maxW: number, scale = 1): string[] {
  const out: string[] = [];
  for (const para of s.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const t = line ? line + ' ' + word : word;
      if (textWidth(t, scale) <= maxW || !line) line = t; else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

// ---------------------------------------------------------------- pixel primitives
export function pxLine(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, col: string, dash = 0) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, n = 0;
  g.fillStyle = col;
  for (let guard = 0; guard < 4000; guard++) {
    if (!dash || (Math.floor(n / dash) % 2 === 0)) g.fillRect(x0, y0, 1, 1);
    n++;
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
/** pxLine clipped to a w×h buffer: world-space rays kilometres long would otherwise rasterize mostly off-screen */
export function pxLineClip(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, col: string, dash: number, w: number, h: number) {
  // Liang–Barsky against [-2, w + 1] × [-2, h + 1]
  const dx = x1 - x0, dy = y1 - y0;
  const p = [-dx, dx, -dy, dy], q = [x0 + 2, w + 1 - x0, y0 + 2, h + 1 - y0];
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return; continue; }
    const r = q[i] / p[i];
    if (p[i] < 0) { if (r > t1) return; if (r > t0) t0 = r; } else { if (r < t0) return; if (r < t1) t1 = r; }
  }
  pxLine(g, x0 + dx * t0, y0 + dy * t0, x0 + dx * t1, y0 + dy * t1, col, dash);
}
export function pxCircle(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, col: string, dash = 0, sy = 1) {
  r = Math.max(1, r);
  const n = Math.max(12, Math.ceil(r * 6.3));
  g.fillStyle = col;
  let last = '';
  for (let i = 0; i < n; i++) {
    if (dash && Math.floor(i / dash) % 2) continue;
    const a = (i / n) * Math.PI * 2;
    const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r * sy);
    const k = x + ',' + y;
    if (k === last) continue;
    last = k;
    g.fillRect(x, y, 1, 1);
  }
}
export function pxRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string) {
  g.fillStyle = col;
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  g.fillRect(x, y, w, 1); g.fillRect(x, y + h - 1, w, 1); g.fillRect(x, y, 1, h); g.fillRect(x + w - 1, y, 1, h);
}
export function pxFill(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string) {
  g.fillStyle = col;
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}
/** framed panel with a translucent steel fill */
export function panel(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, alpha = 0.72) {
  const a = g.globalAlpha;
  g.globalAlpha = alpha * a;
  pxFill(g, x, y, w, h, '#0a1116');
  g.globalAlpha = a;
  pxRect(g, x, y, w, h, '#3c4a52');
  pxFill(g, x + 1, y + 1, w - 2, 1, '#566872');
}
export function bar(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, frac: number, col: string, back = '#1a2228') {
  pxFill(g, x, y, w, h, back);
  pxFill(g, x, y, Math.max(0, Math.min(1, frac)) * w, h, col);
  pxRect(g, x - 1, y - 1, w + 2, h + 2, '#05080b');
}
