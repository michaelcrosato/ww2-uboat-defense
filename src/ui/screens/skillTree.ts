// Captain tab: the passive skill tree on a canvas. Mouse: drag to pan, wheel to zoom, click to allocate
// (or refund an allocated node), right-click refunds. Keyboard / gamepad: the canvas is one nav item whose
// arrows walk between nodes (falling back to the page at the edge), accept toggles, right stick pans.

import type { PortCtx } from './port';
import { h, nav, sfx } from '../dom';
import { affixText, allocateNode, canAllocate, canRefund, nodeById, refundNode, TREES, type TreeNode } from '../../meta/index.ts';

const KIND_R: Record<TreeNode['kind'], number> = { start: 11, small: 5, notable: 9, keystone: 13, ability: 9 };
const KIND_COL: Record<TreeNode['kind'], string> = { start: '#e8e2cf', small: '#9aa4a8', notable: '#8fb8d8', keystone: '#e0a040', ability: '#7ac08a' };

/** view state survives re-renders of the tab (allocations rebuild the DOM) */
const view = { x: 0, y: 0, zoom: 0.55, cursor: '' };

export function treeTab(ctx: PortCtx): HTMLElement {
  const { c, shell } = ctx;
  const tree = TREES[c.faction];
  const input = shell.app.input;
  if (!view.cursor || !nodeById(tree, view.cursor)) { view.cursor = tree.startId; view.x = 0; view.y = 0; }
  const canvas = h('canvas', { class: 'tree-canvas' });
  const info = h('div', { class: 'tree-info' });
  const points = h('div', { class: 'tree-points' });
  const g = canvas.getContext('2d')!;
  const alloc = () => new Set([tree.startId, ...c.tree]);
  let W = 1, H = 1, dpr = 1;

  const toScreen = (n: { x: number; y: number }) => [W / 2 + (n.x - view.x) * view.zoom, H / 2 + (n.y - view.y) * view.zoom];
  const draw = () => {
    const A = alloc();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    // links: allocated paths in accent, reachable ones dim
    for (const n of tree.nodes) for (const id of n.links) {
      if (id < n.id) continue;
      const m = nodeById(tree, id)!;
      const [ax, ay] = toScreen(n), [bx, by] = toScreen(m);
      const both = A.has(n.id) && A.has(m.id), one = A.has(n.id) || A.has(m.id);
      g.strokeStyle = both ? '#e0a040' : one ? '#5c6a70' : '#2b363d';
      g.lineWidth = both ? 3 : 2;
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
    }
    for (const n of tree.nodes) {
      const [x, y] = toScreen(n);
      const r = KIND_R[n.kind] * Math.max(1, view.zoom * 1.4);
      const on = A.has(n.id), avail = !on && canAllocate(tree, c.tree, n.id);
      g.fillStyle = on ? KIND_COL[n.kind] : '#11171b';
      g.strokeStyle = on ? '#fff3d8' : avail ? KIND_COL[n.kind] : '#3a4850';
      g.lineWidth = avail ? 2.5 : 1.5;
      g.beginPath();
      if (n.kind === 'keystone') { g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath(); }
      else g.arc(x, y, r, 0, Math.PI * 2);
      g.fill(); g.stroke();
      if (n.id === view.cursor) {
        g.strokeStyle = '#e0a040'; g.lineWidth = 2;
        g.beginPath(); g.arc(x, y, r + 5, 0, Math.PI * 2); g.stroke();
      }
    }
    drawMini(A);
  };
  // minimap (bottom-right): the whole tree, allocated paths, the visible area; click or drag to jump
  const EXT = 860;
  const mini = () => { const m = Math.round(Math.max(90, Math.min(150, Math.min(W, H) * 0.3))); return { x: W - m - 8, y: H - m - 8, m, s: (m - 10) / (EXT * 2) }; };
  const drawMini = (A: Set<string>) => {
    const M = mini(), cx = M.x + M.m / 2, cy = M.y + M.m / 2;
    const P = (n: { x: number; y: number }) => [cx + n.x * M.s, cy + n.y * M.s];
    g.fillStyle = 'rgba(8, 12, 15, 0.88)'; g.fillRect(M.x, M.y, M.m, M.m);
    g.strokeStyle = '#3a4850'; g.lineWidth = 1; g.strokeRect(M.x + 0.5, M.y + 0.5, M.m - 1, M.m - 1);
    for (const n of tree.nodes) for (const id of n.links) {
      if (id < n.id || !A.has(n.id) || !A.has(id)) continue;
      const [ax, ay] = P(n), [bx, by] = P(nodeById(tree, id)!);
      g.strokeStyle = '#e0a040'; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
    }
    for (const n of tree.nodes) {
      const [x, y] = P(n), on = A.has(n.id), big = n.kind !== 'small' ? 3 : 2;
      g.fillStyle = on ? KIND_COL[n.kind] : canAllocate(tree, c.tree, n.id) ? '#6c7a80' : '#2f3c44';
      g.fillRect(Math.round(x - big / 2), Math.round(y - big / 2), big, big);
    }
    const hw = W / 2 / view.zoom, hh = H / 2 / view.zoom;
    const [vx0, vy0] = P({ x: view.x - hw, y: view.y - hh }), [vx1, vy1] = P({ x: view.x + hw, y: view.y + hh });
    g.save(); g.beginPath(); g.rect(M.x, M.y, M.m, M.m); g.clip();
    g.strokeStyle = '#e8e2cf'; g.strokeRect(Math.round(vx0) + 0.5, Math.round(vy0) + 0.5, Math.round(vx1 - vx0), Math.round(vy1 - vy0));
    g.restore();
    const cur = nodeById(tree, view.cursor);
    if (cur) { const [x, y] = P(cur); g.strokeStyle = '#e0a040'; g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.stroke(); }
  };
  /** canvas point inside the minimap → tree coordinates (null outside it) */
  const miniAt = (mx: number, my: number): { x: number; y: number } | null => {
    const M = mini();
    if (mx < M.x || my < M.y || mx > M.x + M.m || my > M.y + M.m) return null;
    return { x: (mx - M.x - M.m / 2) / M.s, y: (my - M.y - M.m / 2) / M.s };
  };
  const describe = () => {
    const n = nodeById(tree, view.cursor)!;
    const A = alloc();
    const state = n.id === tree.startId ? 'Starting point'
      : A.has(n.id) ? (canRefund(tree, c.tree, n.id) ? 'Allocated — accept or right-click to refund' : 'Allocated — other nodes depend on it')
      : canAllocate(tree, c.tree, n.id) ? (c.skillPoints > 0 ? 'Available — accept to allocate' : 'Available — no skill points left') : 'Not connected yet';
    info.replaceChildren(h('div', { class: 'tn-name ' + n.kind }, n.name, h('span', { class: 'dim' }, `  ${n.kind}${n.cluster ? ' · ' + n.cluster : ''}`)));
    if (n.stats.length) info.append(h('div', null, n.stats.map((s) => affixText(s)).join(' · ')));
    if (n.desc) info.append(h('div', { class: 'tn-desc' }, n.desc));
    info.append(h('div', { class: 'dim' }, state));
    points.textContent = `Skill points: ${c.skillPoints}   Allocated: ${c.tree.length}`;
  };
  const refresh = () => { draw(); describe(); };
  const toggle = (id: string, refundOnly = false) => {
    const A = alloc();
    let ok = false;
    if (A.has(id)) ok = refundNode(c, id);
    else if (!refundOnly) ok = allocateNode(c, id);
    // rebuild (header points change); the view and cursor persist in `view`
    if (ok) { sfx('ui_click'); ctx.changed(); }
    else sfx('ui_error');
  };
  /** nearest node in a direction from the cursor (60° cone, distance + off-axis penalty) */
  const step = (dx: number, dy: number): boolean => {
    const cur = nodeById(tree, view.cursor)!;
    let best: TreeNode | null = null, bs = Infinity;
    for (const n of tree.nodes) {
      if (n === cur) continue;
      const vx = n.x - cur.x, vy = n.y - cur.y;
      const along = vx * dx + vy * dy, side = Math.abs(vx * dy - vy * dx);
      if (along <= 0 || side > along * 1.2) continue;
      const s = along + side * 1.5;
      if (s < bs) { bs = s; best = n; }
    }
    if (!best) return false;
    view.cursor = best.id;
    // keep the cursor on screen
    const [sx, sy] = toScreen(best);
    if (sx < 40 || sx > W - 40 || sy < 40 || sy > H - 40) { view.x = best.x; view.y = best.y; }
    refresh();
    return true;
  };
  // legend overlay (top-left of the canvas, so it shows in the narrow one-column layout too)
  const KIND_LABEL: [TreeNode['kind'], string][] = [['start', 'Start'], ['small', 'Minor'], ['notable', 'Notable'], ['keystone', 'Keystone'], ['ability', 'Ability']];
  const legend = h('div', { class: 'tree-legend' },
    KIND_LABEL.map(([k, l]) => h('span', { class: 'tl-item' }, h('i', { class: 'tl-dot ' + k, style: `--kc:${KIND_COL[k]}` }), l)),
    h('div', { class: 'dim' }, 'filled = allocated · bright ring = can allocate'));
  const wrap = nav(h('div', { class: 'tree-wrap', 'data-id': 'tree' }, canvas, legend), { move: step, accept: () => toggle(view.cursor) });

  // mouse: hover picks, click toggles, right-click refunds, drag pans, wheel zooms
  const pick = (e: PointerEvent | MouseEvent): TreeNode | null => {
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    let best: TreeNode | null = null, bd = 18;
    for (const n of tree.nodes) { const [x, y] = toScreen(n); const d = Math.hypot(x - mx, y - my); if (d < bd) { bd = d; best = n; } }
    return best;
  };
  let drag: { x: number; y: number; moved: boolean } | null = null;
  let miniDrag = false;
  const local = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const jump = (e: PointerEvent) => { const [mx, my] = local(e), t = miniAt(mx, my); if (t) { view.x = t.x; view.y = t.y; draw(); } return !!t; };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    if (e.button === 0 && jump(e)) { miniDrag = true; return; }
    drag = { x: e.clientX, y: e.clientY, moved: false };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (miniDrag) { if (e.buttons & 1) jump(e); return; }
    if (drag && (e.buttons & 1)) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (drag.moved) { view.x -= dx / view.zoom; view.y -= dy / view.zoom; drag.x = e.clientX; drag.y = e.clientY; draw(); }
      return;
    }
    const n = pick(e);
    if (n && n.id !== view.cursor) { view.cursor = n.id; refresh(); }
  });
  canvas.addEventListener('pointerup', (e) => {
    if (miniDrag) { miniDrag = false; return; }
    const d = drag; drag = null;
    if (!d || d.moved) return;
    const n = pick(e);
    if (n) { view.cursor = n.id; toggle(n.id, e.button === 2); }
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    view.zoom = Math.max(0.25, Math.min(2, view.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    draw();
  }, { passive: false });

  const fit = () => {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, devicePixelRatio || 1);
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    draw();
  };
  new ResizeObserver(fit).observe(canvas);
  // right stick pans while the tree has focus
  const pan = () => {
    if (!canvas.isConnected) return;
    if (shell.ui.focused === wrap && Math.hypot(input.rx, input.ry) > 0.1) { view.x += input.rx * 12 / view.zoom; view.y += input.ry * 12 / view.zoom; draw(); }
    requestAnimationFrame(pan);
  };
  requestAnimationFrame(pan);
  describe();
  ctx.setHelp('Arrows / d-pad walk the tree, accept allocates or refunds. Mouse: drag to pan, wheel to zoom, right-click refunds, click the minimap to jump.');
  return h('div', { class: 'tree-tab' }, wrap, h('div', { class: 'tree-side' }, points, info));
}
