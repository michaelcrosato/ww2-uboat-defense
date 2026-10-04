// Backend parity test: renders the deterministic look-dev scene with WebGPU and WebGL2 and diffs them.
//   node tools/compare.mjs [--hour 13] [--theater atlantic] [--seaState 4] [--frames 40] [--w 1280 --h 720]
// Prints a JSON summary, writes check-output/compare-{webgpu,webgl2,diff}[-<hour>].png
// (diff amplified ×4, pixels over the threshold in red). Exit 1 when the mean absolute difference
// exceeds 3/255 or more than 4 % of pixels differ by more than 24/255.
// WebGPU runs with ?gpupresent=readback (headless canvas present loses the device).
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { PNG } = require('playwright-core/lib/utilsBundle');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const hour = opt('hour', '13');
const extra = ['theater', 'seaState', 'weather', 'seed'].map((k) => (opt(k) ? `&${k}=${opt(k)}` : '')).join('');
const frames = +opt('frames', 40);
const W = +opt('w', 1280), H = +opt('h', 720);
const MEAN_MAX = 3, SHARE_MAX = 0.04, PIX = 24;

const server = await createServer({ server: { port: 5199 + Math.floor(Math.random() * 300), strictPort: false }, logLevel: 'error' });
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, '');
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});

async function render(renderer) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  const url = `${base}/?scene=lookdev&renderer=${renderer}&gpupresent=readback&hour=${hour}&seed=7&fxseed=1&frames=${frames}&dev.display.showFps=false${extra}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__lookdevDone === true, null, { timeout: 600000, polling: 500 });
  const kind = await page.evaluate(() => window.__app.backend.info.kind);
  const png = PNG.sync.read(await page.screenshot());
  await page.close();
  return { png, kind, errors };
}

const t0 = Date.now();
const gpu = await render('webgpu');
const gl = await render('webgl2');
await browser.close();
await server.close();

const A = gpu.png, B = gl.png, D = new PNG({ width: A.width, height: A.height });
let sum = 0, over = 0;
const px = A.width * A.height;
for (let i = 0; i < A.data.length; i += 4) {
  let m = 0;
  for (let c = 0; c < 3; c++) { const d = Math.abs(A.data[i + c] - B.data[i + c]); sum += d; m = Math.max(m, d); }
  if (m > PIX) over++;
  const amp = Math.min(255, m * 4);
  D.data[i] = m > PIX ? 255 : amp; D.data[i + 1] = m > PIX ? 0 : amp; D.data[i + 2] = m > PIX ? 0 : amp; D.data[i + 3] = 255;
}
const mean = sum / (px * 3);
const share = over / px;
mkdirSync('check-output', { recursive: true });
const sfx = `-${hour}`;
writeFileSync(`check-output/compare-webgpu${sfx}.png`, PNG.sync.write(A));
writeFileSync(`check-output/compare-webgl2${sfx}.png`, PNG.sync.write(B));
writeFileSync(`check-output/compare-diff${sfx}.png`, PNG.sync.write(D));
const pass = gpu.kind === 'webgpu' && gl.kind === 'webgl2' && mean <= MEAN_MAX && share <= SHARE_MAX && !gpu.errors.length && !gl.errors.length;
console.log(JSON.stringify({
  hour, pass, backends: [gpu.kind, gl.kind], meanAbsDiff: +mean.toFixed(3), shareOver24: +(share * 100).toFixed(3) + '%',
  thresholds: { mean: MEAN_MAX, share: SHARE_MAX * 100 + '%' }, errors: { webgpu: gpu.errors.slice(0, 5), webgl2: gl.errors.slice(0, 5) },
  seconds: Math.round((Date.now() - t0) / 1000),
}, null, 1));
process.exit(pass ? 0 : 1);
