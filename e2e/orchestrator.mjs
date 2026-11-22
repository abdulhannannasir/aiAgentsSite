// End-to-end check of Phase 5 (multi-agent orchestration) against a database-backed server in LIVE mode pointed at
// the mock provider (which plays planner, task agents and synthesizer):
//   node e2e/mock-openai.mjs 3901 &
//   DATABASE_URL=… BETTER_AUTH_SECRET=… BETTER_AUTH_URL=http://127.0.0.1:3804 OPENAI_API_KEY=test \
//     OPENAI_BASE_URL=http://127.0.0.1:3901 OPENAI_MODEL=gpt-mock RATE_LIMIT_MAX=200 PORT=3804 node server.js &
//   BASE_URL=http://127.0.0.1:3804 GUEST_URL=http://127.0.0.1:3801 node e2e/orchestrator.mjs
import { chromium } from 'playwright';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3804';
const GUEST = process.env.GUEST_URL || '';
const SHOTS = process.env.SHOTS_DIR || '';
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + String(extra).slice(0, 200) : ''}`); };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = Math.random().toString(36).slice(2, 7);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error' && !/401|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
page.on('response', r => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });

// ---- sign up (rate limited per IP: retry once after the window)
await page.goto(`${BASE}/?fx=off#/auth/sign-up`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('h1:has-text("Create your account")');
await page.getByLabel('Name', { exact: true }).fill('Grace Orchestrator');
await page.getByLabel('Email', { exact: true }).fill(`orch-${run}@example.com`);
await page.getByLabel('Password', { exact: true }).fill('correct horse battery');
await page.getByRole('button', { name: 'Create account' }).click();
if (await page.getByText(/Too many attempts/).waitFor({ timeout: 2500 }).then(() => true, () => false)) { await sleep(11_000); await page.getByRole('button', { name: 'Create account' }).click(); }
await page.waitForSelector('h1:has-text("Command Center")', { timeout: 15000 });

// ---- the page is in the navigation and starts empty
await page.getByRole('link', { name: 'Orchestrator' }).first().click();
await page.waitForSelector('h1:has-text("Orchestrator")');
check('Orchestrator is a ready page in the sidebar', page.url().endsWith('#/app/orchestrator'));
check('empty state before the first run', await page.getByText('No orchestrations yet').waitFor({ timeout: 8000 }).then(() => true, () => false));
await page.getByRole('button', { name: 'Start' }).click();
check('an empty goal is explained, not sent', await page.getByText('Describe the goal in a few words.').isVisible());

// ---- run 1: plan → T1 runs while T2 waits for approval → approve → combined answer with sources
await page.getByLabel('Goal').fill(`Compare two databases for a startup ${run}`);
await page.getByRole('button', { name: 'Start' }).click();
await page.waitForURL(/#\/app\/orchestrator\/[A-Za-z0-9_-]+$/, { timeout: 10000 });
const runUrl = page.url();
await page.locator('[data-task="T2"][data-status="WAITING_APPROVAL"]').waitFor({ timeout: 15000 });
await page.locator('[data-task="T1"][data-status="SUCCEEDED"]').waitFor({ timeout: 15000 });
check('plan summary and stages are shown', await page.getByText('Research and review in parallel, then recommend.').isVisible() && await page.getByText('Stage 1 · runs in parallel').isVisible() && await page.getByText('Stage 2', { exact: true }).isVisible());
check('T3 waits for its inputs', await page.locator('[data-task="T3"][data-status="PENDING"]').count() === 1 && /Uses T1, T2/.test(await page.locator('[data-task="T3"]').textContent()));
const t2 = page.locator('[data-task="T2"]');
check('the approval explains which tool and why', /url_fetch/.test(await t2.textContent()) && /outside services/.test(await t2.textContent()));
const durable = (await (await page.request.get(`${BASE}/api/v1/meta`)).json()).orchestration.durable;
check(durable ? 'a durable (Redis) server shows no in-process warning' : 'the run is labelled not durable (no Redis on this server)',
  durable ? await page.getByText(/runs jobs in-process/).count() === 0 : await page.getByText(/runs jobs in-process/).first().isVisible());
await shot(page, 'o01-waiting-approval');
await t2.getByRole('button', { name: 'Approve T2' }).click();
await page.locator('[data-testid="orchestration"][data-status="COMPLETED"]').waitFor({ timeout: 20000 });
const answer = page.getByTestId('orchestration-answer');
check('the combined answer is rendered', /The facts point one way/.test(await answer.textContent()));
check('sources link back to the tasks they came from', await answer.getByRole('button', { name: 'T1 · Gather key facts' }).isVisible() && await answer.getByRole('button', { name: 'T3 · Write recommendations' }).isVisible());
check('every task finished', await page.locator('[data-task][data-status="SUCCEEDED"]').count() === 3);
check('approval decision is recorded on the task', /Tool use approved by Grace Orchestrator/.test(await t2.textContent()));
const metrics = await page.getByTestId('orchestration').locator('dl').first().textContent();
check('model calls and tokens are the real totals (plan + 3 tasks + synthesis)', /Model calls5/.test(metrics) && /650 in · 134 out/.test(metrics), metrics);
await page.locator('[data-task="T1"] summary').click();
check('a task result can be opened', await page.locator('[data-task="T1"]').getByText('Result of T1 from gpt-mock.').isVisible());
await answer.getByRole('button', { name: 'T3 · Write recommendations' }).click();
await shot(page, 'o02-completed');

// ---- run 2: reject the tool use → T2 and its dependent T3 are skipped, the rest is still combined
await page.getByRole('link', { name: 'All orchestrations' }).click();
await page.getByLabel('Goal').fill(`Second goal ${run}`);
await page.getByRole('button', { name: 'Start' }).click();
await page.waitForURL(u => u.href !== runUrl && /#\/app\/orchestrator\/[A-Za-z0-9_-]+$/.test(u.href), { timeout: 10000 });
await page.locator('[data-task="T2"][data-status="WAITING_APPROVAL"]').waitFor({ timeout: 15000 });
await page.locator('[data-task="T2"]').getByRole('button', { name: 'Reject' }).click();
await page.locator('[data-testid="orchestration"][data-status="COMPLETED"]').waitFor({ timeout: 20000 });
check('rejected task and its dependent are skipped', await page.locator('[data-task="T2"][data-status="SKIPPED"]').count() === 1 && await page.locator('[data-task="T3"][data-status="SKIPPED"]').count() === 1);
check('the skip reason is shown', await page.getByText('A person rejected the tool use this task asked for.').isVisible() && await page.getByText('Skipped because T2 did not complete.').isVisible());

// ---- run 3: approvals inbox on the list page, then cancel from the run page
await page.getByRole('link', { name: 'All orchestrations' }).click();
await page.getByLabel('Goal').fill(`Third goal ${run}`);
await page.getByRole('button', { name: 'Start' }).click();
await page.locator('[data-task="T2"][data-status="WAITING_APPROVAL"]').waitFor({ timeout: 15000 });
const thirdUrl = page.url();
await page.getByRole('link', { name: 'All orchestrations' }).click();
const inbox = page.getByTestId('approvals-inbox');
await inbox.waitFor({ timeout: 8000 });
check('the approvals inbox lists the waiting task', /Waiting for your approval \(1\)/.test(await inbox.textContent()) && await inbox.getByRole('button', { name: 'Approve T2' }).isVisible());
check('the list shows status and pending approvals', await page.locator('[data-testid="orchestration-list"] [data-status="COMPLETED"]').count() === 2 && await page.getByText('1 awaiting approval').isVisible());
await shot(page, 'o03-list-and-inbox');
await page.goto(thirdUrl);
await page.getByRole('button', { name: 'Cancel' }).click();
await page.locator('[data-testid="orchestration"][data-status="CANCELLED"]').waitFor({ timeout: 8000 });
check('cancel stops the run and its waiting tasks', await page.locator('[data-task][data-status="CANCELLED"]').count() >= 2 && await page.getByRole('button', { name: 'Approve T2' }).count() === 0);

// ---- an unknown id is an honest error, not a blank page
await page.goto(`${BASE}/?fx=off#/app/orchestrator/doesnotexist`);
check('unknown orchestration shows an error', await page.getByText('Could not load this orchestration').waitFor({ timeout: 8000 }).then(() => true, () => false));

// ---- phone layout: no horizontal overflow on a run page
const phone = await browser.newContext({ viewport: { width: 375, height: 800 }, reducedMotion: 'reduce', storageState: await ctx.storageState() });
const p2 = await phone.newPage();
await p2.goto(runUrl);
await p2.locator('[data-testid="orchestration"]').waitFor({ timeout: 10000 });
const overflow = await p2.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check('no horizontal overflow at 375px', overflow <= 0, overflow);
await shot(p2, 'o04-phone');
await phone.close();

// ---- a guest server explains why orchestration is unavailable
if (GUEST) {
  const g = await (await browser.newContext()).newPage();
  await g.goto(`${GUEST}/?fx=off#/app/orchestrator`);
  check('guest mode explains that orchestration needs accounts', await g.getByText('Orchestration needs accounts').waitFor({ timeout: 8000 }).then(() => true, () => false));
}

check('no page errors, console errors or 5xx responses', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
