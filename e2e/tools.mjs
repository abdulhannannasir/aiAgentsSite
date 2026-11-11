// End-to-end check of Phase 4 (live mode, tools, executions) against a database-backed server in LIVE mode pointed at
// the mock provider:
//   node e2e/mock-openai.mjs 3901 &
//   DATABASE_URL=… BETTER_AUTH_SECRET=… BETTER_AUTH_URL=http://127.0.0.1:3803 OPENAI_API_KEY=test \
//     OPENAI_BASE_URL=http://127.0.0.1:3901 OPENAI_MODEL=gpt-mock OPENAI_MODELS=gpt-mock,gpt-mock-mini PORT=3803 node server.js &
//   BASE_URL=http://127.0.0.1:3803 node e2e/tools.mjs
import { chromium } from 'playwright';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3803';
const SHOTS = process.env.SHOTS_DIR || '';
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + String(extra).slice(0, 180) : ''}`); };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = Math.random().toString(36).slice(2, 7);

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })).newPage();
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error' && !/401|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
page.on('response', r => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
const idle = () => page.waitForFunction(() => !!document.querySelector('[aria-label="Send message"]'), null, { timeout: 30000 });
const send = async text => { await page.getByRole('combobox', { name: 'Message' }).fill(text); await page.getByRole('combobox', { name: 'Message' }).press('Enter'); await page.getByTestId('msg-assistant').last().waitFor(); await idle(); };

// sign up (rate limited per IP: retry once after the window)
await page.goto(`${BASE}/?fx=off#/auth/sign-up`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('h1:has-text("Create your account")');
await page.getByLabel('Name', { exact: true }).fill('Ada Tools');
await page.getByLabel('Email', { exact: true }).fill(`tools-${run}@example.com`);
await page.getByLabel('Password', { exact: true }).fill('correct horse battery');
await page.getByRole('button', { name: 'Create account' }).click();
if (await page.getByText(/Too many attempts/).waitFor({ timeout: 2500 }).then(() => true, () => false)) { await sleep(11_000); await page.getByRole('button', { name: 'Create account' }).click(); }
await page.waitForSelector('h1:has-text("Command Center")', { timeout: 15000 });
check('live mode badge', /Live AI/.test(await page.getByTestId('mode-badge').textContent()));

// a tool call, shown in the thought stream, and its real result used in the answer
await page.goto(`${BASE}/?fx=off#/app`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-agent]');
await page.locator('[data-agent="personal-assistant"]').click();
await send('Please work out something for me');
const answer = await page.getByTestId('msg-assistant').last().textContent();
check('the answer uses the tool result (the clock tool ran for real)', /Final answer: UTC: \d{4}-\d{2}-\d{2}T/.test(answer), answer);
const stream = page.getByTestId('thought-stream').last();
if ((await stream.locator('button[aria-expanded]').first().getAttribute('aria-expanded')) === 'false') await stream.locator('button[aria-expanded]').first().click();
const toolStep = stream.locator('[data-testid="thought-step"]', { hasText: 'Current date and time' });
await toolStep.getByRole('button', { name: /Show output/ }).click().catch(() => {});
const streamText = await stream.textContent();
check('the thought stream shows the tool call, its input and its real result', (await toolStep.count()) === 1 && /timezone: UTC/.test(streamText) && /UTC: \d{4}-\d{2}/.test(streamText), streamText);
check('the reply is not marked failed', !/Failed/.test(streamText));
await shot(page, 't01-tool-in-thought-stream');

// a provider failure is an honest error, not canned text
await page.locator('[data-agent="translator"]').click();
await page.getByRole('combobox', { name: 'Message' }).fill('FAIL401 please');
await page.getByRole('combobox', { name: 'Message' }).press('Enter');
await idle();
const failed = await page.getByTestId('msg-assistant').last().textContent();
check('a provider failure shows a user-safe error (no demo text, no provider details)', /rejected the server's credentials/.test(failed) && !/Demo mode|Incorrect API key/.test(failed), failed);

// a saved agent pinned to another model
await page.goto(`${BASE}/?fx=off#/app/builder`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Blank agent' }).click();
await page.getByLabel('Name', { exact: true }).fill('Mini Agent');
await page.getByLabel('System prompt').fill('Be brief.');
const modelOptions = await page.getByLabel('Model').locator('option').allTextContents();
check('the model picker lists the server default and the allowed models', modelOptions.some(o => /Server default \(gpt-mock\)/.test(o)) && modelOptions.includes('gpt-mock-mini'), modelOptions.join(','));
check('unavailable tools are marked in the editor', /not on this server/.test(await page.getByRole('dialog').textContent()));
await page.getByLabel('Model').selectOption({ label: 'gpt-mock-mini' });
await page.getByRole('button', { name: 'Create agent' }).click();
await page.waitForSelector('h2:has-text("Mini Agent")');
await send('hello');
check('the pinned model answers', /Final answer from gpt-mock-mini/.test(await page.getByTestId('msg-assistant').last().textContent()));

// Activity: real runs with model, tokens, tools
await page.goto(`${BASE}/?fx=off#/app/activity`, { waitUntil: 'domcontentloaded' });
await page.getByTestId('execution-list').waitFor({ timeout: 8000 });
const items = page.getByTestId('execution-list').locator('[data-execution]');
check('activity lists the three runs, newest first', (await items.count()) === 3 && /Mini Agent/.test(await items.first().textContent()), await page.getByTestId('execution-list').textContent());
const statuses = await items.evaluateAll(els => els.map(e => e.getAttribute('data-status')));
check('statuses are real: completed, failed, completed', statuses.join() === 'COMPLETED,FAILED,COMPLETED', statuses.join());
check('the tool run shows its tool count and summed tokens', /100 in · 15 out/.test(await items.nth(2).textContent()), await items.nth(2).textContent());
await items.nth(2).click();
await page.getByTestId('execution-tools').waitFor();
check('run details list the tool invocation', /Date & time/.test(await page.getByTestId('execution-tools').textContent()) && /gpt-mock/.test(await page.getByTestId('execution-detail').textContent()));
await shot(page, 't02-activity-detail');
await page.keyboard.press('Escape');
await page.getByRole('radio', { name: 'Failed' }).click();
await sleep(500);
check('the status filter works', (await page.getByTestId('execution-list').locator('[data-execution]').count()) === 1);

// Settings: tool availability is honest
await page.goto(`${BASE}/?fx=off#/app/settings`, { waitUntil: 'domcontentloaded' });
await page.getByTestId('settings-tools').waitFor();
const tools = await page.getByTestId('settings-tools').textContent();
check('settings lists available tools and why others are not', /Read a web pageAvailable/.test(tools) && /TAVILY_API_KEY/.test(tools) && /sandbox/.test(tools), tools);

check('no uncaught errors, console errors or 5xx', errors.length === 0, errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
