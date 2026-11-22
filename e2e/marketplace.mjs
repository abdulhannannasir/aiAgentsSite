// End-to-end check of the agent marketplace (Phase 3) against a server WITH a database (same setup as e2e/accounts.mjs):
//   BASE_URL=http://127.0.0.1:3802 node e2e/marketplace.mjs
import { chromium } from 'playwright';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3802';
const SHOTS = process.env.SHOTS_DIR || '';
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + String(extra).slice(0, 160) : ''}`); };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = Math.random().toString(36).slice(2, 7);
const me = { name: 'Margaret Hamilton', email: `mh-${run}@example.com`, password: 'apollo guidance 1969' };

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })).newPage();
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error' && !/401|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
page.on('response', r => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });

// sign up (sign-up is rate limited per IP: retry once after the window if needed)
await page.goto(`${BASE}/?fx=off#/auth/sign-up`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('h1:has-text("Create your account")');
await page.getByLabel('Name', { exact: true }).fill(me.name);
await page.getByLabel('Email', { exact: true }).fill(me.email);
await page.getByLabel('Password', { exact: true }).fill(me.password);
await page.getByRole('button', { name: 'Create account' }).click();
if (await page.getByText(/Too many attempts/).waitFor({ timeout: 2500 }).then(() => true, () => false)) { await sleep(11_000); await page.getByRole('button', { name: 'Create account' }).click(); }
await page.waitForSelector('h1:has-text("Command Center")', { timeout: 15000 });

// discover: real stats and usage sorts are offered now
await page.goto(`${BASE}/?fx=off#/app/discover`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="agent-card-stats"]');
check('discover cards show recorded stats', (await page.getByTestId('agent-card-stats').count()) === 42);
check('usage and rating sorts are offered when the server records them', /Most used/.test(await page.getByTestId('discover-sort').textContent()) && /Highest rated/.test(await page.getByTestId('discover-sort').textContent()));

// favorites
await page.getByRole('button', { name: 'Add Meal Planner & Grocery List to favorites' }).click();
await sleep(300);
await page.getByTestId('favorites-only').click();
check('the favorites filter shows exactly the favorite', (await page.locator('[data-discover-agent]').count()) === 1 && (await page.locator('[data-discover-agent="meal-planner"]').count()) === 1);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-discover-agent]');
await page.getByTestId('favorites-only').click();
check('favorites are saved on the server (survive a reload)', (await page.locator('[data-discover-agent]').count()) === 1);
await page.getByTestId('favorites-only').click();

// detail page: no review before use
await page.getByRole('link', { name: 'Details for Language Translator' }).click();
await page.getByTestId('agent-detail-page').waitFor();
await page.getByTestId('agent-stats').waitFor();
const statsBefore = await page.getByTestId('agent-stats').textContent();
check('detail page shows the user\'s runs (none yet)', /Yourruns0/.test(statsBefore.replace(/\s+/g, '')), statsBefore);
check('reviewing is only offered after using the agent', /at least once/.test(await page.locator('main').textContent()) && (await page.getByTestId('review-form').count()) === 0);

// use it through an example prompt, then come back
await page.getByTestId('example-prompts').locator('button').first().click();
await page.waitForSelector('h2:has-text("Language Translator")');
check('the example prompt is in the message box', /Spanish/.test(await page.getByRole('combobox', { name: 'Message' }).inputValue()));
await page.getByRole('combobox', { name: 'Message' }).press('Enter');
await page.getByTestId('msg-assistant').waitFor({ timeout: 15000 });
await page.waitForFunction(() => !!document.querySelector('[aria-label="Send message"]'), null, { timeout: 30000 });
await page.goto(`${BASE}/?fx=off#/app/agent/translator`, { waitUntil: 'domcontentloaded' });
await page.getByTestId('review-form').waitFor({ timeout: 8000 });
const statsAfter = (await page.getByTestId('agent-stats').textContent()).replace(/\s+/g, '');
check('the run is counted (real data): your runs 1', /Yourruns1/.test(statsAfter), statsAfter);
check('the conversation is listed under "Your conversations"', (await page.getByTestId('my-conversations').locator('li').count()) === 1);

// post a review
await page.getByRole('radio', { name: '4 stars' }).click();
await page.getByLabel('Your review (optional)').fill('Natural, friendly Spanish.');
await page.getByRole('button', { name: 'Post review' }).click();
await page.getByTestId('review-list').waitFor({ timeout: 8000 });
// The database may hold reviews from earlier runs, so check this user's entry and the summary's consistency.
const mine = page.getByTestId('review-list').locator('li', { hasText: 'You' });
const mineText = await mine.textContent();
check('the review is listed as yours, with first name and initial only',
  (await mine.count()) === 1 && /Margaret H\./.test(mineText) && /Natural, friendly Spanish/.test(mineText) && !/Hamilton/.test(await page.getByTestId('review-list').textContent()));
const listed = await page.getByTestId('review-list').locator('li').count();
const summary = await page.getByTestId('agent-detail-page').locator('header').textContent();
check('the rating summary counts every review', new RegExp(`\\(${listed} reviews?\\)`).test(summary), summary);
await shot(page, 'm01-agent-detail-reviewed');
await page.getByRole('radio', { name: '2 stars' }).click();
await page.getByRole('button', { name: 'Update review' }).click();
await sleep(800);
check('the review can be updated', /2 out of 5 stars/.test(await page.getByTestId('review-list').innerHTML()));

// version history of a saved agent
await page.goto(`${BASE}/?fx=off#/app/my-agents`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('h1:has-text("My Agents")');
await page.getByRole('button', { name: 'New agent' }).first().click();
await page.getByLabel('Name', { exact: true }).fill('Versioned');
await page.getByLabel('System prompt').fill('First instructions.');
await page.getByRole('button', { name: 'Create agent' }).click();
await page.waitForSelector('h2:has-text("Versioned")');
await page.goto(`${BASE}/?fx=off#/app/my-agents`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-my-agent="Versioned"]');
await page.getByRole('button', { name: 'Edit Versioned' }).click();
await page.getByLabel('System prompt').fill('Second instructions.');
await page.getByRole('button', { name: 'Save changes' }).click();
await sleep(500);
await page.getByRole('button', { name: 'Version history of Versioned' }).click();
await page.getByTestId('version-history').locator('li').nth(1).waitFor({ timeout: 5000 });
const hist = await page.getByTestId('version-history').textContent();
check('version history lists v2 (current) and v1', (await page.getByTestId('version-history').locator('li').count()) === 2 && /v2.*Current/.test(hist) && /v1/.test(hist), hist);
await shot(page, 'm02-version-history');

check('no uncaught errors, console errors or 5xx', errors.length === 0, errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
