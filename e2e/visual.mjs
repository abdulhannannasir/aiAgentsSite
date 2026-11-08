// Browser checks for the redesign: 3D scenes, custom cursor, magnetic buttons, tilt cards, scroll storytelling,
// bento interactions, live-workspace effects, and the reduced-motion / mobile fallbacks. WebGL runs on
// SwiftShader (software GL), so it proves the scenes render and react, not that a real GPU hits 60 fps.
//
//   npm run build && PORT=3801 node server.js &         # demo mode needs no API key
//   BASE_URL=http://127.0.0.1:3801 node e2e/visual.mjs
//   SHOTS_DIR=/some/dir ...                              # also writes screenshots
//
// Playwright is intentionally not a dependency of the app; install it where you run this.
import { chromium } from 'playwright';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3801';
const SHOTS = process.env.SHOTS_DIR || '';
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== '' ? '  -> ' + String(extra).slice(0, 160) : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const watch = (page, label) => {
  page.on('pageerror', e => errors.push(`${label}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${label}: console.error ${m.text().slice(0, 200)}`); });
};
const centre = async loc => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height }; };
const scrollTo = async (page, y, wait = 1400) => { await page.evaluate(v => window.scrollTo(0, v), y); await sleep(wait); };
const sectionTop = (page, id) => page.evaluate(i => document.getElementById(i).getBoundingClientRect().top + window.scrollY, id);

// ============================================================ desktop, full effects
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference', acceptDownloads: true });
// Count real GPU draw calls per canvas, to prove the scenes pause when they should.
await ctx.addInitScript(() => {
  window.__draws = new WeakMap();
  for (const P of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
    for (const fn of ['drawArrays', 'drawElements']) {
      const orig = P[fn];
      P[fn] = function (...args) { window.__draws.set(this.canvas, (window.__draws.get(this.canvas) || 0) + 1); return orig.apply(this, args); };
    }
  }
});
const page = await ctx.newPage();
watch(page, 'desktop');
await page.goto(`${BASE}/?fx=high`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid=hero-launch]');
await page.waitForFunction(() => document.querySelector('[data-testid=fx-background]')?.dataset.ready === 'true' && document.querySelector('[data-testid=hero-orb]')?.dataset.ready === 'true', null, { timeout: 30000 }).catch(() => {});

// ---- 3D engine
check('landing is the front door (hero headline, nav)', /swarm of AI agents/.test(await page.locator('h1').textContent()) && await page.getByRole('navigation', { name: 'Primary' }).isVisible());
check('3D swarm background rendered (WebGL canvas, tier high)', await page.getByTestId('fx-background').getAttribute('data-ready') === 'true' && await page.getByTestId('fx-background').getAttribute('data-tier') === 'high' && await page.locator('[data-testid=fx-background] canvas').count() === 1);
check('3D hero orb rendered in its own canvas', await page.getByTestId('hero-orb').getAttribute('data-ready') === 'true' && await page.locator('[data-testid=hero-orb] canvas').count() === 1);
check('exactly 3 canvases: two WebGL scenes (swarm, orb) and the 2D cursor trail', await page.locator('canvas').count() === 3);
const frames = await page.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now(); const f = t => { n++; t - t0 < 2000 ? requestAnimationFrame(f) : res(n / ((t - t0) / 1000)); }; requestAnimationFrame(f); }));
console.log(`INFO  page rAF rate with both WebGL scenes on software GL: ${frames.toFixed(0)} fps (a real GPU runs these scenes far faster)`);
await shot(page, 'v-hero');

// the WebGL swarm is really drawing: count bright pixels in a band that holds no text (static SVG art is faded out by now)
const brightPixels = async clip => {
  const png = (await page.screenshot({ clip })).toString('base64');
  return page.evaluate(async b64 => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, cv.width, cv.height).data; let n = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.max(d[i], d[i + 1], d[i + 2]) > 70) n++;
    return n;
  }, png);
};
const band = { x: 0, y: 74, width: 1440, height: 110 };
const lit1 = await brightPixels(band);
await page.mouse.move(300, 120); await page.mouse.move(520, 130, { steps: 12 }); await sleep(900);
const lit2 = await brightPixels(band);
check('the swarm is drawing real geometry (bright node/edge pixels in a text-free band)', lit1 > 15 && lit2 > 15, `${lit1} / ${lit2}`);

// ---- render loops pause when they should (measured as GPU draw calls, not assumed)
const BG = '[data-testid=fx-background] canvas', ORB = '[data-testid=hero-orb] canvas';
const draws = sel => page.evaluate(q => window.__draws.get(document.querySelector(q)) || 0, sel);
const delta = async (sel, ms = 900) => { const a = await draws(sel); await sleep(ms); return (await draws(sel)) - a; };
check('both scenes draw frames while the hero is on screen', (await delta(BG)) > 3 && (await delta(ORB)) > 3);
await scrollTo(page, await sectionTop(page, 'story') - 40, 1500);
const orbOff = await delta(ORB), bgOn = await delta(BG);
check('scrolled past the hero: the orb stops drawing (0 draw calls) while the swarm keeps going', orbOff === 0 && bgOn > 3, `orb ${orbOff}, swarm ${bgOn}`);
await scrollTo(page, 0, 1500);
check('back at the top: the orb resumes', (await delta(ORB)) > 3);

// ---- custom cursor
await page.mouse.move(700, 300); await page.mouse.move(720, 320, { steps: 6 }); await sleep(500);
const cur = () => page.evaluate(() => { const c = document.querySelector('[data-testid=fx-cursor]'); const [, ring, dot] = c.children; const r = ring.getBoundingClientRect(); const d = dot.getBoundingClientRect(); return { rx: r.x, ry: r.y, rw: r.width, rh: r.height, dx: d.x + d.width / 2, dy: d.y + d.height / 2, ringOpacity: getComputedStyle(ring).opacity, label: ring.textContent, htmlClass: document.documentElement.className }; });
let c = await cur();
check('custom cursor is live: ring follows the pointer, values stay finite', Number.isFinite(c.rx) && Number.isFinite(c.ry) && Math.abs(c.rx + c.rw / 2 - 720) < 30 && Math.abs(c.ry + c.rh / 2 - 320) < 30, JSON.stringify(c));
check('system pointer hidden while the fx cursor runs', /fx-cursor/.test(c.htmlClass));
const launch = page.getByTestId('hero-launch');
let lb = await centre(launch);
await page.mouse.move(lb.x, lb.y, { steps: 10 }); await sleep(900);
c = await cur(); lb = await centre(launch);
check('magnetic snap: ring wraps the button it hovers', Math.abs(c.rw - (lb.w + 12)) < 8 && Math.abs(c.rh - (lb.h + 12)) < 8, `ring ${c.rw.toFixed(0)}x${c.rh.toFixed(0)} vs button ${lb.w.toFixed(0)}x${lb.h.toFixed(0)}`);
await page.mouse.move(150, 800, { steps: 10 }); await sleep(700);
c = await cur();
check('ring springs back to a small circle off the button', Math.abs(c.rw - 34) < 3, c.rw);
const orb = await centre(page.getByTestId('hero-orb'));
await page.mouse.move(orb.x, orb.y, { steps: 10 }); await sleep(800);
c = await cur();
check('over the 3D orb the ring becomes a labelled "Pulse" disc', c.label === 'Pulse' && c.rw > 60, `${c.label} ${c.rw}`);
await page.mouse.click(orb.x, orb.y); await sleep(300);
check('clicking the orb does not break the page', await page.getByTestId('hero-orb').isVisible());

// ---- magnetic button pulls toward the cursor, then releases
const magnet = launch.locator('xpath=..');
const tx = () => magnet.evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m41);
await page.mouse.move(1300, 800); await sleep(900);
const rest = await tx();
const lb2 = await centre(launch);
await page.mouse.move(lb2.x + lb2.w / 2 + 28, lb2.y, { steps: 8 }); await sleep(700);
const pulled = await tx();
check('magnetic button leans toward a nearby cursor', pulled - rest > 2, `${rest.toFixed(1)} -> ${pulled.toFixed(1)}`);
await page.mouse.move(1300, 800, { steps: 8 }); await sleep(1100);
check('and eases back to rest when the cursor leaves', Math.abs((await tx()) - rest) < 1.5, await tx());

// ---- cursor trail: ordinary movement leaves a tail, but one huge jump must not stretch it into a streak
const trailLit = box => page.evaluate(({ x, y, w, h }) => {
  const d = document.querySelector('[data-testid=fx-cursor] canvas').getContext('2d').getImageData(x, y, w, h).data;
  let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++; return n;
}, box);
const trailMax = async (box, times) => { let m = 0, prev = 0; for (const t of times) { await sleep(t - prev); prev = t; m = Math.max(m, await trailLit(box)); } return m; };
await page.mouse.move(150, 150); await page.mouse.move(180, 170, { steps: 5 }); await sleep(700);
await page.mouse.move(1150, 650); // a single event ~1,100 px away
const streak = await trailMax({ x: 560, y: 320, w: 120, h: 120 }, [25, 60, 110, 170]); // box around the jump's midpoint
check('cursor trail: a 1,100px instant jump draws no streak across the screen', streak === 0, `${streak} lit px at the midpoint`);
await page.mouse.move(300, 790); await sleep(700);
await page.mouse.move(520, 790, { steps: 22 }); // ~10 px per event, over empty background
const tail = await trailMax({ x: 380, y: 770, w: 150, h: 40 }, [0, 16, 40]);
check('cursor trail: ordinary movement still leaves a visible tail', tail > 150, `${tail} lit px behind the pointer`);

// A brisk steady sweep must leave a short comet tail, not a glowing line across the screen. Pointer events are sent
// one per animation frame (20 px each = 1,200 px/s at 60 Hz) so the speed is exact whatever this machine's frame rate.
await page.mouse.move(700, 700); await sleep(600);
const sweep = await page.evaluate(async () => {
  const send = (x, y) => window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, pointerType: 'mouse', bubbles: true }));
  const y = window.innerHeight - 60; let x = 20;
  send(x, y); await new Promise(r => setTimeout(r, 500));
  await new Promise(done => { let n = 0; const f = () => { x += 20; send(x, y); if (++n < 26) requestAnimationFrame(f); else done(); }; requestAnimationFrame(f); });
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const cv = document.querySelector('[data-testid=fx-cursor] canvas');
  const d = cv.getContext('2d').getImageData(0, y - 12, cv.width, 24).data; let minX = cv.width;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8) minX = Math.min(minX, (i >> 2) % cv.width);
  return Math.max(0, Math.round(x - minX));
});
check('cursor trail: a brisk 1,200 px/s sweep leaves a short comet tail, not a streak (<= 200 px)', sweep <= 200, `${sweep} px (it was ~535 px before the cap)`);
check('cursor trail: that tail is still clearly visible (>= 40 px)', sweep >= 40, `${sweep} px`);

// ---- agent deck: 3D tilt, spotlight border, status glow
await scrollTo(page, await sectionTop(page, 'agents') - 70, 1500);
const deck = page.locator('[data-agent-card]');
check('agent deck shows 6 real agents as cards', await deck.count() === 6);
const card = deck.first();
const before = await card.evaluate(el => getComputedStyle(el).transform);
let cb = await centre(card);
await page.mouse.move(cb.x - cb.w * 0.4, cb.y - cb.h * 0.4, { steps: 8 }); await sleep(700);
const after = await card.evaluate(el => ({ t: getComputedStyle(el).transform, mx: el.style.getPropertyValue('--mx') }));
check('card tilts in 3D toward the pointer (matrix3d changes)', /matrix3d/.test(after.t) && after.t !== before, after.t.slice(0, 70));
check('spotlight border follows the pointer (--mx set)', after.mx !== '' && after.mx !== '50%', after.mx);
check('over a card the ring turns into a labelled "Open" disc', (await cur()).label === 'Open');
const statuses = await deck.evaluateAll(els => els.map(e => e.dataset.status));
check('cards carry mixed Active / Training / Idle states with a chip and glow each', new Set(statuses).size === 3 && await page.getByTestId('status-glow').count() === 6, statuses.join(','));
await page.getByRole('group', { name: 'Preview an agent status' }).getByRole('button', { name: /Training/i }).click(); await sleep(300);
check('legend preview forces every card to Training', (await deck.evaluateAll(els => els.map(e => e.dataset.status))).every(s => s === 'training'));
await page.getByRole('button', { name: 'Reset' }).click();
await shot(page, 'v-deck');

// ---- scroll story (pinned + scrubbed on desktop)
const storyTop = await sectionTop(page, 'story');
const tab = i => page.getByTestId(`story-tab-${i}`).getAttribute('aria-current');
const vis = async i => page.getByTestId(`story-copy-${i}`).evaluate(el => ({ v: getComputedStyle(el).visibility, o: +getComputedStyle(el).opacity }));
await scrollTo(page, storyTop + 20, 1600);
check('story is pinned: step 01 active, copy 1 visible, others hidden', await tab(0) === 'step' && (await vis(0)).o > 0.9 && (await vis(1)).v === 'hidden' && (await vis(2)).v === 'hidden');
await shot(page, 'v-story-1');
await scrollTo(page, storyTop + 1500, 2400);
check('scrolling cross-fades to step 02 (tab + copy)', await tab(1) === 'step' && (await vis(1)).o > 0.9 && (await vis(0)).v === 'hidden', `${await tab(1)} ${JSON.stringify(await vis(1))}`);
check('step 02 shows the workflow node graph with a flowing link or active node', await page.locator('[data-testid=story-visual-1] [data-node]').count() === 3);
await shot(page, 'v-story-2');
await scrollTo(page, storyTop + 2600, 2400);
check('scrolling on reaches step 03 (the JSON forge visual)', await tab(2) === 'step' && (await vis(2)).o > 0.9 && /agentverse\.agent/.test(await page.getByTestId('story-visual-2').textContent()));
await page.getByTestId('story-tab-0').click(); await sleep(2800);
check('the step tabs jump back through the pinned scroll', await tab(0) === 'step');

// ---- bento: live prompt builder, orchestration preview, palette, builder hand-off
await scrollTo(page, await sectionTop(page, 'features') + 120, 1800);
const prompt = () => page.getByTestId('bento-prompt').textContent();
check('prompt builder starts as Researcher / Concise / Bullets', /meticulous research analyst/.test(await prompt()) && /short and direct/.test(await prompt()));
await page.getByRole('radio', { name: 'Coder' }).click(); await page.getByRole('radio', { name: 'Formal' }).click(); await page.getByRole('radio', { name: 'Tables' }).click();
check('choosing role/tone/format rewrites the system prompt live', /senior full-stack engineer/.test(await prompt()) && /formal, professional/.test(await prompt()) && /tables/i.test(await prompt()));
await page.locator('#bento-temp').fill('1.6');
check('temperature slider updates its label and the agent preview', /creative/.test(await page.getByText(/1\.6 · creative/).textContent()) && /temp 1\.6/.test(await page.getByTestId('bento-agent-preview').textContent()));
const tabs = page.getByRole('tablist', { name: 'Workflows' });
await tabs.getByRole('tab', { name: '/code-review' }).click(); await sleep(400);
check('orchestration preview switches workflow and draws its 3-agent team', await page.locator('#features [data-node]').count() === 3 && /Prioritizer/.test(await page.locator('#features').textContent()));
await shot(page, 'v-bento');

// hand off to the real builder with the prompt
await page.getByTestId('bento-open-builder').click();
await page.getByRole('dialog', { name: 'Create an agent' }).waitFor({ timeout: 6000 });
check('"Open in the builder" navigates to the workspace and opens the creator pre-filled', page.url().endsWith('#/app') && /senior full-stack engineer/.test(await page.getByLabel('System prompt').inputValue()) && await page.getByLabel('Name').inputValue() === 'Coder Agent');
await page.keyboard.press('Escape'); await sleep(500);
check('the workspace is the real app (42 agents listed)', await page.locator('[data-agent]').count() === 42);

// ---- live workspace effects while a workflow runs
await page.getByTestId('palette-button').click();
await page.getByRole('combobox', { name: 'Search commands' }).fill('research');
await page.keyboard.press('Enter'); await sleep(500);
const composer = page.getByRole('combobox', { name: 'Message' });
check('palette "Run /research" tags the team and prefills the composer', await page.getByTestId('workflow-chip').isVisible());
await composer.fill('/research quantum batteries'); await page.keyboard.press('Escape');
await composer.fill('quantum batteries'); await page.keyboard.press('Enter');
const sawPulse = await page.waitForSelector('[data-testid=typing-pulse]', { timeout: 8000 }).then(() => true, () => false);
check('typing pulse shows before the first token', sawPulse);
const flowing = await page.waitForSelector('[data-testid=collab-strip] [data-link=flowing]', { timeout: 20000 }).then(() => true, () => false);
check('collaboration strip animates the live handoff between agents', flowing);
check('waveform is active in the composer while the reply streams', await page.locator('[data-testid=waveform][data-active=true]').count() >= 1);
check('header status chip reads Active while generating', /Active/.test(await page.locator('header [data-testid=status-chip]').first().textContent()));
check('sidebar card of the running agent shows Active too', await page.locator('[data-agent][data-status=active]').count() >= 1);
await shot(page, 'v-live');
await page.waitForFunction(() => !!document.querySelector('[aria-label="Send message"]'), null, { timeout: 40000 });
await sleep(700);
check('when the run ends the strip, waveform and Active state clear', await page.getByTestId('collab-strip').count() === 0 && await page.locator('[data-testid=waveform]').count() === 0 && /Idle/.test(await page.locator('header [data-testid=status-chip]').first().textContent()));
await page.getByRole('button', { name: /Thought stream/ }).first().click(); await sleep(500);
check('expanded thought stream draws the handoff graph with every node complete', await page.locator('[data-testid=thought-stream] [data-node][data-status=complete]').count() === 3);
await shot(page, 'v-live-done');

// ---- ring behaviour inside the workspace
const row = page.locator('[data-agent]').nth(1); await row.scrollIntoViewIfNeeded(); await sleep(300);
const sb = await centre(row);
await page.mouse.move(sb.x, sb.y, { steps: 8 }); await sleep(800);
c = await cur();
check('sidebar rows use the snapping ring (not the big disc)', c.label === '' && Math.abs(c.rw - (sb.w + 12)) < 10, `${c.rw.toFixed(0)} vs ${sb.w.toFixed(0)}`);
const tb = await centre(composer);
await page.mouse.move(tb.x, tb.y, { steps: 8 }); await sleep(600);
check('over the text box the custom ring hides so the I-beam shows', (await cur()).ringOpacity === '0');

// ---- command palette on the landing page + effects switch + theme isolation
await page.getByRole('button', { name: 'AgentVerse home' }).click(); await sleep(600);
check('logo returns to the landing page', page.url().endsWith('#/') && await page.getByTestId('hero-launch').isVisible());
await page.keyboard.press('Control+k');
await page.getByRole('dialog', { name: 'Command palette' }).waitFor({ timeout: 5000 });
check('palette on the landing page offers "Open the workspace", hides chat-only commands', await page.getByText('Open the workspace').count() === 1 && await page.getByText('New chat').count() === 0);
await page.getByRole('combobox', { name: 'Search commands' }).fill('thinking assistant');
await page.keyboard.press('Enter'); await sleep(900);
check('choosing an agent from the landing palette opens the workspace on it', page.url().endsWith('#/app') && await page.locator('section[aria-label^="Chat with"]').count() === 1);
await page.getByTestId('palette-button').click();
await page.getByRole('combobox', { name: 'Search commands' }).fill('light theme'); await page.keyboard.press('Enter'); await sleep(500);
check('light workspace theme drops the dark 3D backdrop', await page.getByTestId('fx-background').count() === 0);
await page.getByRole('button', { name: 'AgentVerse home' }).click(); await sleep(800);
check('the landing page stays obsidian even with the light theme on', await page.getByTestId('fx-background').count() === 1 && await page.locator('.dark [data-testid=hero-launch]').count() === 1);
await page.evaluate(() => localStorage.setItem('agentverse.theme', '"dark"'));
await ctx.close();

// ---- landing sections that need their own scroll positions (fresh page)
// Effects off here on purpose: software WebGL starves GSAP's ticker, and these checks are about the DOM/GSAP logic.
const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
const p2 = await ctx2.newPage(); watch(p2, 'sections');
await p2.goto(`${BASE}/?fx=off`, { waitUntil: 'domcontentloaded' });
await p2.waitForSelector('#agents', { timeout: 20000 });
await scrollTo(p2, await sectionTop(p2, 'stats') - 300, 800);
await p2.waitForFunction(() => { const n = [...document.querySelectorAll('[data-count]')]; return n.length === 4 && n.every(e => e.textContent === e.dataset.count); }, null, { timeout: 15000 }).catch(() => {});
const counts = await p2.locator('[data-count]').evaluateAll(els => els.map(e => [e.dataset.count, e.textContent]));
check('stats count up to the real numbers (42 agents, 4 workflows, 4 templates)', counts.length === 4 && counts.every(([a, b]) => a === b) && counts[0][0] === '42' && counts[2][0] === '4' && counts[3][0] === '4', JSON.stringify(counts));
check('screen readers get the final numbers directly', (await p2.locator('#stats dd .sr-only').allTextContents()).join(',') === counts.map(c2 => c2[0]).join(','));
const stage = await p2.locator('[data-arch-stage]').boundingBox();
await scrollTo(p2, (await p2.evaluate(() => window.scrollY)) + stage.y - 60, 600);
await scrollTo(p2, (await p2.evaluate(() => window.scrollY)) + stage.height * 0.9, 2500);
const arch = await p2.evaluate(() => ({ nodes: [...document.querySelectorAll('[data-arch-node]')].map(n => +getComputedStyle(n).opacity), links: [...document.querySelectorAll('[data-arch-link],[data-arch-return]')].map(l => parseFloat(getComputedStyle(l).strokeDashoffset)) }));
check('architecture diagram: all 6 nodes visible and every link fully drawn by the end of the scroll', arch.nodes.length === 6 && arch.nodes.every(o => o > 0.95) && arch.links.length === 6 && arch.links.every(o => Math.abs(o) < 1), JSON.stringify(arch));
await shot(p2, 'v-arch');
// workflow "Run it live" hand-off
await scrollTo(p2, await sectionTop(p2, 'features') + 150, 1500);
await p2.getByTestId('bento-run-workflow').click(); await sleep(900);
check('"Run it live" opens the workspace with that workflow tagged', p2.url().endsWith('#/app') && await p2.getByTestId('workflow-chip').isVisible());
await ctx2.close();

// ---- effects switch (auto -> lite -> off) without a forced tier
const ctx3 = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
const p3 = await ctx3.newPage(); watch(p3, 'fx-switch');
await p3.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await p3.waitForSelector('[data-testid=hero-launch]');
const tierNow = () => p3.evaluate(() => document.documentElement.dataset.fx);
const startTier = await tierNow();
const runFx = async () => { await p3.keyboard.press('Control+k'); await p3.getByRole('combobox', { name: 'Search commands' }).fill('visual effects'); await p3.keyboard.press('Enter'); await sleep(700); };
await runFx();
check('"Visual effects" command moves auto -> lite (no backdrop blur tier)', startTier !== 'off' && await tierNow() === 'low', `${startTier} -> ${await tierNow()}`);
check('lite tier drops backdrop-filter from glass panels', await p3.evaluate(() => { const n = document.querySelector('.glass'); const s = getComputedStyle(n); return (s.backdropFilter || 'none') === 'none'; }));
await runFx();
check('and lite -> off: no canvases, static network remains', await tierNow() === 'off' && await p3.locator('canvas').count() <= 1 && await p3.locator('[data-testid=fx-background] svg').count() === 1);
check('the preference persists across a reload', (await p3.reload({ waitUntil: 'domcontentloaded' }), await p3.waitForSelector('[data-testid=hero-launch]'), await tierNow()) === 'off');
await ctx3.close();

// ============================================================ reduced motion: everything static
const rm = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const pr = await rm.newPage(); watch(pr, 'reduced-motion');
await pr.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await pr.waitForSelector('[data-testid=hero-launch]'); await sleep(1500);
check('reduced motion: effects tier is off, no WebGL canvases, static network art instead', await pr.getByTestId('fx-background').getAttribute('data-tier') === 'off' && await pr.locator('canvas').count() === 0 && await pr.locator('[data-testid=fx-background] svg').count() === 1);
check('reduced motion: no custom cursor, no magnetic wrappers moving', await pr.getByTestId('fx-cursor').count() === 0);
await scrollTo(pr, await sectionTop(pr, 'story') - 40, 1500);
check('reduced motion: story is stacked cards (no pinning or scroll hijack)', await pr.getByTestId('story-tab-0').count() === 0 && await pr.locator('#story article').count() === 3);
await scrollTo(pr, await sectionTop(pr, 'stats') - 300, 1500);
check('reduced motion: stats show final numbers immediately', (await pr.locator('[data-count]').allTextContents()).join(',') === '42,16,4,4' || (await pr.locator('[data-count]').allTextContents())[0] === '42');
await scrollTo(pr, await sectionTop(pr, 'architecture') + 200, 800);
check('reduced motion: architecture diagram is fully drawn with no scrub', (await pr.locator('[data-arch-node]').evaluateAll(n => n.every(x => +getComputedStyle(x).opacity > 0.95))));
await rm.close();

// ============================================================ phone: lite tier, stacked layout, no overflow
const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'no-preference' });
const pm = await mob.newPage(); watch(pm, 'mobile');
await pm.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await pm.waitForSelector('[data-testid=hero-launch]'); await sleep(3000);
check('phone: lite tier, background + orb still render', await pm.getByTestId('fx-background').getAttribute('data-tier') === 'low' && await pm.locator('canvas').count() === 2);
check('phone: no custom cursor (touch)', await pm.getByTestId('fx-cursor').count() === 0);
// Measured against the real device width (390), not innerWidth: a phone widens its layout viewport to fit overflowing content.
const overflow = () => pm.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, window.innerWidth) - 390);
const navClipped = () => pm.evaluate(() => { const b = document.querySelector('nav[aria-label=Primary] button:last-child')?.getBoundingClientRect(); return !b || b.right > 391 || b.left < 0; });
check('phone: hero has no horizontal overflow', await overflow() <= 1, await overflow());
await shot(pm, 'v-mobile-hero');
check('phone: nav fits the screen, launch button fully on-screen', !(await navClipped()) && await pm.getByRole('button', { name: 'Launch', exact: true }).isVisible());
check('phone: layout viewport is not widened (innerWidth stays 390)', await pm.evaluate(() => window.innerWidth) === 390);
for (const id of ['agents', 'story', 'features', 'stats', 'architecture']) { await scrollTo(pm, await sectionTop(pm, id) - 60, 900); }
check('phone: story is stacked cards', await pm.getByTestId('story-tab-0').count() === 0 && await pm.locator('#story article').count() === 3);
check('phone: architecture shows the vertical path list, not the wide SVG', await pm.locator('ol[aria-label="Request path"]').isVisible() && !(await pm.locator('[data-arch-stage]').isVisible()));
check('phone: bento tiles stack and nothing overflows the page', await overflow() <= 1, await overflow());
await shot(pm, 'v-mobile-arch');
await scrollTo(pm, await sectionTop(pm, 'agents') - 60, 900);
await pm.locator('[data-agent-card]').first().tap(); await sleep(900);
check('phone: tapping an agent card opens the workspace on that agent', pm.url().endsWith('#/app') && await pm.locator('section[aria-label^="Chat with"]').count() === 1);
check('phone: workspace has no horizontal overflow', await overflow() <= 1, await overflow());
await shot(pm, 'v-mobile-app');
await mob.close();

check('no uncaught errors or console errors anywhere', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
