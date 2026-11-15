// Browser checks for the hero's live demonstration: the first-view sample replay, a real run through /api/chat,
// Stop, every failure mode, and the reduced-motion, phone and "server unreachable" fallbacks.
//
//   npm run build && PORT=3801 node server.js &         # demo mode needs no API key
//   BASE_URL=http://127.0.0.1:3801 node e2e/hero-demo.mjs
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

const browser = await chromium.launch();

// A page that records every POST to /api/chat and every uncaught error. (Console errors are not asserted here:
// the failure tests below cause genuine 4xx/5xx responses on purpose.)
async function open(ctxOptions, url = '/?fx=off', setup) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference', ...ctxOptions });
  const page = await ctx.newPage();
  page.chat = [];
  page.uncaught = [];
  page.on('pageerror', e => page.uncaught.push(e.message));
  page.on('request', r => { if (r.method() === 'POST' && r.url().endsWith('/api/chat')) page.chat.push(JSON.parse(r.postData() || '{}')); });
  await setup?.(page);
  await page.goto(BASE + url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid=hero-demo]');
  return { ctx, page };
}
// Records every phase the demo passes through, so a test can prove a state was (or was never) visited.
const recordPhases = page => page.addInitScript(() => {
  window.__phases = [];
  const log = () => {
    const ph = document.querySelector('[data-testid=hero-demo]')?.dataset.phase;
    if (ph && window.__phases[window.__phases.length - 1] !== ph) window.__phases.push(ph);
  };
  new MutationObserver(log).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-phase'] });
});
const phases = page => page.evaluate(() => window.__phases);
const attr = (page, name) => page.getByTestId('hero-demo').getAttribute(name);
const waitPhase = (page, phase, timeout = 20000) =>
  page.waitForFunction(p => document.querySelector('[data-testid=hero-demo]')?.dataset.phase === p, phase, { timeout }).then(() => true, () => false);
const text = (page, id) => page.getByTestId(id).innerText();
const nodes = page => page.locator('[data-testid=hero-demo] [data-node]');
const nodeStates = page => nodes(page).evaluateAll(n => n.map(x => x.getAttribute('data-status')));
const run = page => page.getByTestId('hero-demo-run');
const task = page => page.getByTestId('hero-demo-task');

// ============================================================ desktop, motion allowed
{
  const { ctx, page } = await open({});
  check('the demo sits inside the hero section', await page.locator('#top [data-testid=hero-demo]').count() === 1);
  check('first view: a recorded sample starts replaying by itself', await waitPhase(page, 'running') && await attr(page, 'data-source') === 'sample');
  check('the sample is labelled as a sample, never as live', /sample run/i.test(await text(page, 'hero-demo-badge')));
  await page.waitForFunction(() => !!document.querySelector('[data-testid=hero-demo] [data-node][data-status=active]'), null, { timeout: 5000 }).catch(() => {});
  check('the handoff graph shows an agent at work while it replays', (await nodeStates(page)).includes('active'));
  await shot(page, 'hd-replaying');

  await task(page).focus();
  check('clicking into the task field mid-replay skips to the finished sample', await waitPhase(page, 'done', 3000) && await attr(page, 'data-source') === 'sample');
  check('the finished sample shows all three agents complete and the final brief', (await nodeStates(page)).join() === 'complete,complete,complete' && /Bottom line/.test(await text(page, 'hero-demo-output')));
  check('loading the page and watching the sample never calls the API', page.chat.length === 0, page.chat.length);
  await shot(page, 'hd-sample-done');
  const cardHeight = async () => Math.round((await page.getByTestId('hero-demo').boundingBox()).height);
  const heights = [await cardHeight()];
  const sampleAgents = await nodes(page).allTextContents();

  // a real run
  const mine = 'the pros and cons of a four-day work week';
  await task(page).fill(mine);
  await run(page).click();
  check('Run starts a live run, labelled Live', await waitPhase(page, 'running', 3000) && await attr(page, 'data-source') === 'live' && /^live$/i.test((await text(page, 'hero-demo-badge')).trim()));
  check('the task field is locked while a live run is going', await task(page).isDisabled());
  await sleep(600); heights.push(await cardHeight());
  check('the live run finishes', await waitPhase(page, 'done', 30000));
  const body = page.chat[0] ?? {};
  check('it sent exactly one request: the research workflow, the starter plus my task, no history',
    page.chat.length === 1 && body.workflowId === 'research' && body.message === `Research this topic in depth: ${mine}` && Array.isArray(body.history) && body.history.length === 0 && !('agentId' in body), JSON.stringify(body));
  heights.push(await cardHeight());
  check('all three agents completed in the graph', (await nodeStates(page)).join() === 'complete,complete,complete');
  check('the recorded sample shows the same agents and roles as the real /research workflow', JSON.stringify(await nodes(page).allTextContents()) === JSON.stringify(sampleAgents), `${sampleAgents.join('|')} vs ${(await nodes(page).allTextContents()).join('|')}`);
  check('the answer is the server\'s own reply (a demo server labels its canned text "demo preview")', /demo preview/.test(await text(page, 'hero-demo-output')));
  check('the card did not change height when the live run started or finished (no layout jump)', heights.every(h => Math.abs(h - heights[0]) <= 4), heights.join(','));
  check('Continue in the workspace is offered once done', await page.getByRole('button', { name: /Continue in the workspace/ }).isVisible());
  await shot(page, 'hd-live-done');

  // another workflow
  await page.getByRole('button', { name: '/code-review' }).click();
  check('choosing a workflow resets to idle with its own example task', await attr(page, 'data-phase') === 'idle' && /items\.length/.test(await task(page).inputValue()) && await page.getByRole('button', { name: '/code-review' }).getAttribute('aria-pressed') === 'true');
  check('and shows that workflow\'s agents as pending', (await nodes(page).allTextContents()).join(' ').includes('Fixer') && (await nodeStates(page)).every(s => s === 'pending'));
  check('an empty task cannot be run', await (async () => { await task(page).fill('   '); return run(page).isDisabled(); })());

  // Stop
  await page.getByRole('button', { name: '/brainstorm' }).click();
  await run(page).click();
  await page.getByTestId('hero-demo-stop').click();
  check('Stop returns to idle without an error', await attr(page, 'data-phase') === 'idle' && await page.getByRole('alert').filter({ hasText: /./ }).count() === 0);
  await sleep(1500);
  check('a stopped run stays stopped (no late events revive it)', await attr(page, 'data-phase') === 'idle' && (await nodeStates(page)).every(s => s === 'pending'));

  check('no uncaught errors in the whole flow', page.uncaught.length === 0, page.uncaught[0]);
  await ctx.close();
}

// ============================================================ the sample plays through on its own
{
  const { ctx, page } = await open({}, '/?fx=off', recordPhases);
  check('left alone, the sample replays to the end', await waitPhase(page, 'done', 20000));
  check('motion allowed: it did replay (idle > running > done)', (await phases(page)).join('>') === 'idle>running>done', (await phases(page)).join('>'));
  check('the status line reports it as a sample', /Sample finished/.test(await text(page, 'hero-demo-status')));
  check('Replay plays it again', await (async () => { await page.getByRole('button', { name: 'Replay' }).click(); return waitPhase(page, 'running', 2000); })());
  check('still no API call', page.chat.length === 0);
  await ctx.close();
}

// ============================================================ failure modes of a live run
{
  const { ctx, page } = await open({});
  await waitPhase(page, 'done', 20000);
  const alertText = () => page.getByRole('alert').filter({ hasText: /./ }).first().innerText();
  const expectFailure = async (label, route, expect) => {
    await page.route('**/api/chat', route);
    await run(page).click();
    const ok = await waitPhase(page, 'failed', 8000);
    const msg = ok ? await alertText() : '';
    check(label, ok && expect.test(msg) && /failed/i.test(await text(page, 'hero-demo-badge')), msg);
    await page.unroute('**/api/chat');
    return ok;
  };
  await expectFailure('HTTP 500 with a reason: shows that reason and a Failed badge', r => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }), /boom/);
  await expectFailure('HTTP 429: tells the visitor to slow down', r => r.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"x"}' }), /too fast/i);
  await expectFailure('network failure: says the server could not be reached', r => r.abort('failed'), /Could not reach the server/);

  const sse = events => events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('');
  const steps = [['gather', 'Researcher'], ['synthesize', 'Synthesizer'], ['review', 'Reviewer']].map(([id, role]) => ({ id, agentName: 'A', agentIcon: '🔎', role, label: role, status: 'pending' }));
  await expectFailure('a step failing mid-run: shows the server\'s message and marks the step failed',
    r => r.fulfill({ status: 200, contentType: 'text/event-stream', body: sse([
      { type: 'plan', workflowId: 'research', steps },
      { type: 'step', id: 'gather', status: 'active' },
      { type: 'step', id: 'gather', status: 'error', error: 'This step failed.' },
      { type: 'error', content: 'The Researcher step failed, so the workflow stopped. Please try again.' },
      { type: 'done', message: null }]) }),
    /Researcher step failed/);
  check('...and the graph marks only the step that failed; the steps that never ran stay pending', (await nodeStates(page)).join() === 'error,pending,pending', (await nodeStates(page)).join());

  await expectFailure('an empty reply counts as a failure, not a blank success', r => r.fulfill({ status: 200, contentType: 'text/event-stream', body: sse([{ type: 'plan', workflowId: 'research', steps }, { type: 'done', message: null }]) }), /empty reply/);

  await page.getByRole('button', { name: 'Try again' }).click();
  check('Try again re-sends the task and recovers once the server is back', await waitPhase(page, 'done', 30000) && /demo preview/.test(await text(page, 'hero-demo-output')));
  check('no uncaught errors through any failure', page.uncaught.length === 0, page.uncaught[0]);
  await ctx.close();
}

// ============================================================ workflows never load: the sample still works, live runs are off
{
  const { ctx, page } = await open({}, '/?fx=off', p => p.route('**/api/workflows', r => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' })));
  check('workflows unavailable: the sample still replays', await waitPhase(page, 'done', 20000));
  check('...but the task field and Run are disabled, with no workflow chips', await task(page).isDisabled() && await run(page).isDisabled() && await page.getByRole('group', { name: 'Choose a workflow' }).locator('button').count() === 0);
  check('...and nothing was sent to the API', page.chat.length === 0);
  await ctx.close();
}

// ============================================================ reduced motion: no replay, the result at once
{
  const { ctx, page } = await open({ reducedMotion: 'reduce' }, '/?fx=off', recordPhases);
  check('reduced motion: the finished sample is shown immediately', await waitPhase(page, 'done', 2500) && await attr(page, 'data-source') === 'sample' && /Bottom line/.test(await text(page, 'hero-demo-output')));
  await sleep(1500);
  check('reduced motion: it never replayed (the demo never entered the running phase)', !(await phases(page)).includes('running'), (await phases(page)).join('>'));
  check('reduced motion: no API call', page.chat.length === 0);
  await ctx.close();
}

// ============================================================ phone
{
  const { ctx, page } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.getByTestId('hero-demo').scrollIntoViewIfNeeded();
  const box = await page.getByTestId('hero-demo').boundingBox();
  check('phone: the demo fits inside the screen with its gutters', box.x >= 0 && box.x + box.width <= 390 && box.width > 300, `${Math.round(box.x)}..${Math.round(box.x + box.width)}`);
  check('phone: the layout viewport is not widened by it', await page.evaluate(() => window.innerWidth) === 390);
  check('phone: it still replays once scrolled into view', await waitPhase(page, 'running', 6000));
  await waitPhase(page, 'done', 20000);
  await shot(page, 'hd-phone');
  await ctx.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
