// Headless screenshot + console check.
//   node tools/shot.mjs [--url /?scene=x] [--wait 4000] [--out check-output/shot.png] [--w 1280 --h 720]
//                       [--eval "js run in page before shot"] [--steps "key:KeyW:2000,wait:500"] [--init "js"] [--preview]
//                       (steps: wait:ms, key:Code:ms, press:Code, click:x:y, move:x:y, eval:js, until:js[:timeoutMs];
//                        js is URI-decoded, so encode commas/colons, e.g. until:window.__lookdevDone)
// Starts Vite in-process, opens Chromium (SwiftShader WebGL2), prints console errors, saves PNG.
import { createServer, preview } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const url = opt('url', '/');
const wait = +opt('wait', 4000);
const out = opt('out', 'check-output/shot.png');
const W = +opt('w', 1280), H = +opt('h', 720);
const evalJs = opt('eval', '');
const steps = opt('steps', '');
const shots = +opt('shots', 1);
const every = +opt('every', 1000);

// --preview serves the production build in dist/ (run `npm run build` first) instead of the dev server
const port = 5199 + Math.floor(Math.random() * 300);
const server = args.includes('--preview')
  ? await preview({ preview: { port, strictPort: false }, logLevel: 'error' })
  : await createServer({ server: { port, strictPort: false }, logLevel: 'error' });
if (!args.includes('--preview')) await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, '');
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
// --init: script run in the page before any of its own code (e.g. make localStorage throw)
const initJs = opt('init', '');
if (initJs) await page.addInitScript(initJs);
const errors = [];
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' || m.type() === 'warning') { errors.push(`[${m.type()}] ${t}`); }
  else if (process.env.VERBOSE) console.log('[page]', t);
});
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
const t0 = Date.now();
await page.goto(base + url, { waitUntil: 'load' });
for (const st of steps ? steps.split(',') : []) {
  const [kind, a, b] = st.split(':');
  if (kind === 'wait') await page.waitForTimeout(+a);
  else if (kind === 'key') { await page.keyboard.down(a); await page.waitForTimeout(+(b || 300)); await page.keyboard.up(a); }
  else if (kind === 'press') await page.keyboard.press(a);
  else if (kind === 'click') await page.mouse.click(+a, +b);
  else if (kind === 'move') await page.mouse.move(+a, +b);
  else if (kind === 'eval') await page.evaluate(decodeURIComponent(a));
  else if (kind === 'until') await page.waitForFunction(decodeURIComponent(a), null, { timeout: +(b || 180000), polling: 250 });
}
await page.waitForTimeout(wait);
if (evalJs) { const r = await page.evaluate(evalJs); if (r !== undefined) console.log('eval:', JSON.stringify(r)); }
mkdirSync(dirname(out), { recursive: true });
for (let i = 0; i < shots; i++) {
  const p = shots === 1 ? out : out.replace(/\.png$/, `-${i}.png`);
  await page.screenshot({ path: p });
  console.log('saved', p);
  if (i < shots - 1) await page.waitForTimeout(every);
}
const fps = await page.evaluate(() => window.__perf ?? null);
if (fps) console.log('perf:', JSON.stringify(fps));
console.log(`elapsed ${Date.now() - t0}ms; ${errors.length} console errors/warnings`);
for (const e of errors.slice(0, 30)) console.log(e.slice(0, 2000));
await browser.close();
await server.close();
process.exit(errors.some((e) => e.startsWith('[pageerror]') || e.includes('failed')) ? 1 : 0);
