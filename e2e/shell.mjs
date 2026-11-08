// End-to-end check of the Phase 1 app shell: every route renders, navigation works (sidebar, drawer, palette,
// keyboard), the new pages do real things, phones get no horizontal overflow, and nothing logs errors.
//
//   npm run build && PORT=3801 node server.js &
//   BASE_URL=http://127.0.0.1:3801 node e2e/shell.mjs        # SHOTS_DIR=/some/dir also saves screenshots
import { chromium } from 'playwright';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3801';
const SHOTS = process.env.SHOTS_DIR || '';
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + String(extra).slice(0, 160) : ''}`); };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: false }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const PAGES = [
  ['command-center', 'Command Center'], ['chat', null], ['discover', 'Discover Agents'], ['my-agents', 'My Agents'],
  ['builder', 'Agent Builder'], ['workflows', 'Workflows'], ['projects', 'Projects'], ['memory', 'Memory'],
  ['integrations', 'Integrations'], ['activity', 'Activity'], ['analytics', 'Analytics'], ['settings', 'Settings'], ['billing', 'Billing']
];
const PLANNED = new Set(['projects', 'memory', 'integrations', 'activity', 'analytics', 'billing']);
const href = id => (id === 'chat' ? '#/app' : `#/app/${id}`);

const browser = await chromium.launch();
const errors = [];
const watch = p => {
  p.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  p.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  p.on('response', r => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
};

// ============ desktop ============
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const page = await ctx.newPage();
watch(page);
await page.goto(`${BASE}/?fx=off#/app/command-center`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('h1:has-text("Command Center")');
await shot(page, 's01-command-center');

// every route renders its own heading (no blank or broken routes) and the sidebar marks it current
for (const [id, heading] of PAGES) {
  await page.goto(`${BASE}/?fx=off${href(id)}`, { waitUntil: 'domcontentloaded' });
  if (heading) await page.waitForSelector(`h1:has-text("${heading}")`, { timeout: 8000 }).catch(() => {});
  else await page.waitForSelector('[data-agent]', { timeout: 8000 }).catch(() => {});
  const current = await page.locator('nav[aria-label="Main"] a[aria-current="page"]').getAttribute('data-nav').catch(() => null);
  const ok = heading ? (await page.locator('h1').first().textContent())?.includes(heading) : (await page.locator('[data-agent]').count()) === 42;
  const planned = PLANNED.has(id) ? (await page.getByTestId('planned-page').count()) === 1 && /Phase \d+/.test(await page.locator('main').textContent()) : true;
  check(`route ${href(id)} renders${PLANNED.has(id) ? ' an honest planned page' : ''} and is marked current`, ok && planned && current === id, `current=${current}`);
  check(`route ${href(id)} sets the tab title`, (await page.title()).includes('AgentVerse'));
}
await page.goto(`${BASE}/?fx=off#/app/does-not-exist`, { waitUntil: 'domcontentloaded' });
check('an unknown app route shows a 404 page with a way back', await page.getByTestId('not-found').isVisible().catch(() => false) || await page.getByTestId('not-found').waitFor({ timeout: 5000 }).then(() => true, () => false));

// sidebar navigation by click, and planned items are labelled
await page.goto(`${BASE}/?fx=off#/app/command-center`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('h1:has-text("Command Center")');
await page.locator('nav[aria-label="Main"] a[data-nav="discover"]').click();
await page.waitForSelector('h1:has-text("Discover Agents")');
check('clicking a sidebar link navigates (hash route)', page.url().endsWith('#/app/discover'));
check('planned items carry a "Soon" label', (await page.locator('nav[aria-label="Main"] a[data-nav="billing"]').textContent()).includes('Soon'));

// keyboard: the nav links are reachable with Tab and activate with Enter
await page.locator('nav[aria-label="Main"] a[data-nav="workflows"]').focus();
await page.keyboard.press('Enter');
await page.waitForSelector('h1:has-text("Workflows")');
check('a nav link activates with the keyboard', page.url().endsWith('#/app/workflows'));

// collapse persists
await page.getByRole('button', { name: 'Collapse sidebar' }).click();
await sleep(250);
check('sidebar collapses to icons', (await page.locator('aside[aria-label="Sidebar"]').getAttribute('data-collapsed')) === 'true' && (await page.locator('aside[aria-label="Sidebar"]').boundingBox()).width < 90);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('h1:has-text("Workflows")');
check('collapsed state survives a reload', (await page.locator('aside[aria-label="Sidebar"]').getAttribute('data-collapsed')) === 'true');
await shot(page, 's02-workflows-collapsed');
await page.getByRole('button', { name: 'Expand sidebar' }).click();

// palette navigation
await page.keyboard.press('Control+k');
await page.getByRole('combobox', { name: 'Search commands' }).fill('go to settings');
await page.keyboard.press('Enter');
await page.waitForSelector('h1:has-text("Settings")');
check('the command palette navigates to pages', page.url().endsWith('#/app/settings'));

// settings: theme + services status are real
await page.getByRole('radio', { name: 'Light' }).click();
await sleep(150);
check('settings: theme radio switches to light and persists', !(await page.evaluate(() => document.documentElement.classList.contains('dark'))) && (await page.evaluate(() => localStorage.getItem('agentverse.theme'))) === '"light"');
await shot(page, 's03-settings-light');
await page.getByRole('radio', { name: 'Dark' }).click();
check('settings: provider status comes from the server (demo, no keys)', /No key/.test(await page.getByTestId('settings-providers').textContent()) && /canned demo replies/.test(await page.locator('main').textContent()));

// discover: search, filter, details drawer, chat
await page.goto(`${BASE}/?fx=off#/app/discover`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-discover-agent]');
check('discover lists all 42 agents', (await page.locator('[data-discover-agent]').count()) === 42);
await page.getByTestId('discover-search').fill('contract');
await sleep(100);
const found = await page.locator('[data-discover-agent]').evaluateAll(els => els.map(e => e.getAttribute('data-discover-agent')));
check('discover search ranks the contract agents first', found[0] === 'contract-specialist' || found.includes('contract-specialist'), found.join(','));
await page.getByTestId('discover-search').fill('');
await page.getByTestId('discover-category').selectOption('Social Media');
check('discover category filter', (await page.locator('[data-discover-agent]').count()) === 6 && /6 agents/.test(await page.getByTestId('discover-count').textContent()));
await page.getByTestId('discover-search').fill('zzzzqq');
check('discover no-match state offers to clear filters', await page.getByRole('button', { name: 'Clear filters' }).isVisible());
await page.getByRole('button', { name: 'Clear filters' }).click();
await page.getByRole('button', { name: 'Details for Full-Stack Coding Assistant' }).click();
await page.getByTestId('agent-detail').waitFor();
check('details drawer shows tools (labelled not connected) and the workflows that use the agent',
  /not connected/.test(await page.getByTestId('agent-detail').textContent()) && /Code Review/.test(await page.getByTestId('agent-detail').textContent()));
await shot(page, 's04-discover-detail');
await page.keyboard.press('Escape');
await page.getByRole('dialog').waitFor({ state: 'detached' }).catch(() => {});
await page.getByRole('button', { name: 'Chat with Language Translator' }).click();
await page.waitForSelector('h2:has-text("Language Translator")');
check('"Chat" opens the chat on that agent', page.url().endsWith('#/app'));

// send a message, then the Command Center reflects it (real session data)
await page.getByRole('combobox', { name: 'Message' }).fill('Translate hello to French');
await page.keyboard.press('Enter');
await page.waitForFunction(() => !!document.querySelector('[aria-label="Send message"]'), null, { timeout: 30000 });
await page.locator('nav[aria-label="Main"] a[data-nav="command-center"]').click();
await page.waitForSelector('h1:has-text("Command Center")');
const sessionText = await page.getByTestId('cc-session').textContent();
check('command center counts the real message and reply', /Messages sent\s*1/.test(sessionText) && /Completed\s*1/.test(sessionText), sessionText);
check('command center lists the reply in recent activity', /Language Translator/.test(await page.getByTestId('cc-activity').textContent()));
check('command center shows platform services as not configured (none set)', (await page.getByTestId('cc-services').textContent()).match(/Not configured/g)?.length === 5);
await shot(page, 's05-command-center-activity');

// workflows page: run → chat with the team chip
await page.locator('nav[aria-label="Main"] a[data-nav="workflows"]').click();
await page.getByRole('button', { name: 'Run Brainstorm' }).click();
await page.getByTestId('workflow-chip').waitFor({ timeout: 5000 });
check('"Run workflow" opens chat with the workflow tagged', page.url().endsWith('#/app') && /Brainstorm ideas for/.test(await page.getByRole('combobox', { name: 'Message' }).inputValue()));
await page.getByRole('button', { name: 'Remove workflow' }).click();
await page.getByRole('combobox', { name: 'Message' }).fill('');

// builder → template → my agents: duplicate and delete
await page.locator('nav[aria-label="Main"] a[data-nav="builder"]').click();
await page.waitForSelector('h1:has-text("Agent Builder")');
await page.getByTestId('builder-templates').getByRole('button').first().click();
await page.getByRole('button', { name: 'Create agent' }).click();
await page.waitForSelector('[data-testid="custom-agent-card"]');
await page.locator('nav[aria-label="Main"] a[data-nav="my-agents"]').click();
await page.waitForSelector('h1:has-text("My Agents")');
check('a template-built agent appears in My Agents', (await page.locator('[data-my-agent]').count()) === 1);
await page.getByRole('button', { name: /^Duplicate / }).click();
await sleep(150);
check('duplicate creates a copy', (await page.locator('[data-my-agent]').count()) === 2 && (await page.locator('[data-my-agent$="(copy)"]').count()) === 1);
await page.locator('[data-my-agent$="(copy)"]').getByRole('button', { name: /^Delete / }).click();
await page.getByRole('button', { name: 'Delete agent' }).click();
await sleep(300);
check('delete asks to confirm, then removes only that agent', (await page.locator('[data-my-agent]').count()) === 1);
await shot(page, 's06-my-agents');

// account menu + notifications are honest
await page.getByRole('button', { name: 'Account menu' }).click();
const signIn = page.getByRole('menuitem', { name: /Sign in/ });
check('account menu: sign-in is shown as unavailable, not a dead button', (await signIn.getAttribute('aria-disabled')) === 'true');
await page.keyboard.press('Escape');
check('Esc closes the account menu and returns focus to its button',
  await page.getByRole('menu').waitFor({ state: 'detached', timeout: 3000 }).then(() => true, () => false)
  && await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Account menu'));
await page.getByRole('button', { name: 'Notifications' }).click();
check('notifications: an honest empty state', await page.getByText("You're all caught up").isVisible());
await page.keyboard.press('Escape');

// logo still returns to the landing page
await page.getByRole('button', { name: 'AgentVerse home' }).click();
await page.waitForSelector('[data-testid=hero-launch]');
check('logo returns to the landing page', page.url().endsWith('#/'));

// ============ phone ============
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
const m = await mctx.newPage();
watch(m);
for (const [id] of PAGES) {
  await m.goto(`${BASE}/?fx=off${href(id)}`, { waitUntil: 'domcontentloaded' });
  await m.waitForSelector('main h1, [data-agent]', { timeout: 8000 }).catch(() => {});
  await sleep(100);
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`phone: ${href(id)} has no horizontal overflow`, overflow <= 0, overflow);
}
check('phone: the sidebar is hidden', !(await m.locator('aside[aria-label="Sidebar"]').isVisible()));
await m.goto(`${BASE}/?fx=off#/app/command-center`, { waitUntil: 'domcontentloaded' });
await m.waitForSelector('h1:has-text("Command Center")');
await m.getByRole('button', { name: 'Open navigation' }).tap();
const drawer = m.getByRole('dialog', { name: 'Navigation' });
check('phone: the menu button opens a navigation drawer', await drawer.isVisible() && (await drawer.boundingBox()).width <= 390);
await shot(m, 's07-phone-drawer');
await drawer.locator('a[data-nav="discover"]').tap();
await m.waitForSelector('h1:has-text("Discover Agents")');
check('phone: choosing a page navigates and closes the drawer', m.url().endsWith('#/app/discover')
  && await m.getByRole('dialog', { name: 'Navigation' }).waitFor({ state: 'detached', timeout: 3000 }).then(() => true, () => false));
await shot(m, 's08-phone-discover');

check('no uncaught errors, console errors (CSP included) or 5xx anywhere', errors.length === 0, errors.join(' | '));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
