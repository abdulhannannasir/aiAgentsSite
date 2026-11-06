// Post-deploy smoke test. Run it against any deployed URL (preview or production):
//
//   node e2e/smoke.mjs https://your-site.vercel.app
//
// Part 1 needs nothing installed: it checks that the HTML, the JavaScript bundle (must be a real ES module,
// not CommonJS), the CSS and the API all answer correctly.
// Part 2 runs only if Playwright is installed: it loads the page in a real browser and checks that the app
// actually renders. A page can pass every HTTP check and still be blank if its JavaScript cannot run, so this
// is the check that matters.
const base = (process.argv[2] || '').replace(/\/$/, '');
if (!/^https?:\/\//.test(base)) { console.error('usage: node e2e/smoke.mjs https://your-site.example'); process.exit(2); }

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + String(extra).slice(0, 160) : ''}`); };
const get = async path => { const r = await fetch(base + path, { redirect: 'follow' }); return { r, text: await r.text() }; };

const home = await get('/');
check('GET / is 200 HTML', home.r.status === 200 && /text\/html/.test(home.r.headers.get('content-type') || ''), home.r.status);
const script = /<script[^>]+type="module"[^>]+src="([^"]+)"/.exec(home.text)?.[1];
const css = /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/.exec(home.text)?.[1];
check('HTML references a module script and a stylesheet', !!script && !!css, `${script} ${css}`);

if (script) {
  const js = await get(script);
  check('script is served as JavaScript', js.r.status === 200 && /javascript/.test(js.r.headers.get('content-type') || ''), `${js.r.status} ${js.r.headers.get('content-type')}`);
  // The bug this guards against: a host rewriting ES modules to CommonJS ("use strict"; Object.defineProperty(exports, ...)).
  // Browsers load <script type="module"> as an ES module, where `exports` does not exist, so the page is blank.
  const commonjs = /^\s*"use strict"/.test(js.text) || /Object\.defineProperty\(exports\b/.test(js.text) || /\bmodule\.exports\b/.test(js.text.slice(0, 2000));
  check('script is an ES module, not rewritten to CommonJS', !commonjs && /\b(import|export)\b/.test(js.text), commonjs ? 'CommonJS markers found' : '');
}
if (css) { const c = await get(css); check('stylesheet is 200 CSS', c.r.status === 200 && /css/.test(c.r.headers.get('content-type') || ''), c.r.status); }

const health = await get('/api/health').then(x => { try { return JSON.parse(x.text); } catch { return null; } });
check('/api/health answers', health?.ok === true && health.agents > 0, JSON.stringify(health));
const wf = await get('/api/workflows').then(x => { try { return JSON.parse(x.text); } catch { return null; } });
check('/api/workflows lists workflows', Array.isArray(wf) && wf.length > 0, wf && wf.length);

let chromium = null;
try { ({ chromium } = await import('playwright')); } catch { console.log('SKIP  browser check (Playwright is not installed: npm i -g playwright)'); }
if (chromium) {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/', { waitUntil: 'load', timeout: 45000 });
  await page.waitForFunction(() => (document.getElementById('root')?.children.length ?? 0) > 0, null, { timeout: 15000 }).catch(() => {});
  const rendered = await page.evaluate(() => ({ children: document.getElementById('root')?.children.length ?? 0, text: document.body.innerText.length }));
  check('browser: the app renders (not a blank page)', rendered.children > 0 && rendered.text > 50, JSON.stringify(rendered));
  check('browser: no uncaught JavaScript errors', errors.length === 0, errors[0]);
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
