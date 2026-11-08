// End-to-end check of accounts (Phase 2) against a server WITH a database:
//
//   createdb agentverse_e2e && DATABASE_URL=… npx prisma migrate deploy
//   DATABASE_URL=postgresql://…/agentverse_e2e BETTER_AUTH_SECRET=<32+ chars> BETTER_AUTH_URL=http://127.0.0.1:3802 \
//     PORT=3802 node server.js > /tmp/agentverse-e2e.log 2>&1 &
//   BASE_URL=http://127.0.0.1:3802 SERVER_LOG=/tmp/agentverse-e2e.log node e2e/accounts.mjs
//
// Without SMTP the server logs emails in development; SERVER_LOG lets the test read the password-reset link.
// Use an empty database: the test signs up fixed addresses with a random suffix, so reruns don't collide.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3802';
const LOG = process.env.SERVER_LOG || '';
const SHOTS = process.env.SHOTS_DIR || '';
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + String(extra).slice(0, 160) : ''}`); };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = Math.random().toString(36).slice(2, 7);
const ada = { name: 'Ada Lovelace', email: `ada-${run}@example.com`, password: 'analytical engine 1843' };
const bob = { name: 'Bob Builder', email: `bob-${run}@example.com`, password: 'can we fix it 123' };

const browser = await chromium.launch();
const errors = [];
const watch = p => {
  p.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  // 401 from /api/v1/me while signed out is expected and is not a console error the user sees
  p.on('console', m => { if (m.type() === 'error' && !/401|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  p.on('response', r => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
};
const nav = (page, id) => page.locator(`nav[aria-label="Main"] a[data-nav="${id}"]`).click();
const signUp = async (page, u) => {
  await page.goto(`${BASE}/?fx=off#/auth/sign-up`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('h1:has-text("Create your account")'); // the auth screens are a lazy chunk
  await page.getByLabel('Name', { exact: true }).fill(u.name);
  await page.getByLabel('Email', { exact: true }).fill(u.email);
  await page.getByLabel('Password', { exact: true }).fill(u.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  // Sign-up is rate limited per IP (3 attempts / 10 s). Back-to-back test runs can hit it: the form must say so,
  // and trying again after the window must work.
  const limited = await page.getByText(/Too many attempts/).waitFor({ timeout: 2500 }).then(() => true, () => false);
  if (limited) {
    check('sign-up rate limit is explained in the form', true);
    await sleep(11_000);
    await page.getByRole('button', { name: 'Create account' }).click();
  }
  await page.waitForSelector('h1:has-text("Command Center")', { timeout: 15000 });
};

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const page = await ctx.newPage();
watch(page);

// ---- as a guest, build an agent in this browser
await page.goto(`${BASE}/?fx=off#/app/builder`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('h1:has-text("Agent Builder")');
await page.getByTestId('builder-templates').getByRole('button').first().click();
await page.getByLabel('Name', { exact: true }).fill('Guest Helper');
await page.getByRole('button', { name: 'Create agent' }).click();
await page.waitForSelector('[data-testid="custom-agent-card"]');
check('guest: the closed creator dialog is removed from the page once its exit animation ends',
  await page.locator('div[role=dialog]').waitFor({ state: 'detached', timeout: 5000 }).then(() => true, () => false));
check('guest: an agent is created in the browser', (await page.evaluate(() => JSON.parse(localStorage.getItem('agentverse.customAgents') || '[]').length)) === 1);
await page.getByRole('button', { name: 'Account menu' }).click();
check('guest: the account menu offers sign-in when the server has accounts', (await page.getByRole('menuitem', { name: 'Sign in' }).getAttribute('aria-disabled')) === null);
await page.keyboard.press('Escape');

// ---- sign-up validation, then sign up
await page.goto(`${BASE}/?fx=off#/auth/sign-up`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('h1:has-text("Create your account")');
await page.getByLabel('Name', { exact: true }).fill('x'); await page.getByLabel('Email', { exact: true }).fill('x@example.com'); await page.getByLabel('Password', { exact: true }).fill('short');
await page.getByRole('button', { name: 'Create account' }).click();
check('sign-up: a short password is refused in the form', await page.getByRole('alert').textContent().then(t => /at least 8/.test(t)));
await shot(page, 'a01-sign-up');
await signUp(page, ada);
check('sign-up lands in the Command Center, signed in', page.url().endsWith('#/app/command-center'));
check('the sidebar shows the personal workspace', /Ada's workspace/.test(await page.getByTestId('workspace-label').textContent()) && /owner/i.test(await page.getByTestId('workspace-label').textContent()));
await page.getByRole('button', { name: 'Account menu' }).click();
check('the account menu shows who is signed in', (await page.getByTestId('account-name').textContent()) === ada.name);
await page.keyboard.press('Escape');

// ---- move the browser agent into the workspace (explicit, never silent)
await nav(page, 'my-agents');
await page.waitForSelector('h1:has-text("My Agents")');
check('signed in: My Agents offers to move the browser agent into the workspace', /1 agent/.test(await page.getByTestId('import-local-banner').textContent()));
await page.getByTestId('import-local-banner').getByRole('button').click();
await page.waitForSelector('[data-my-agent="Guest Helper"]');
check('the moved agent is saved (shared, version 1) and the browser copy is gone',
  /Shared/.test(await page.locator('[data-my-agent="Guest Helper"]').textContent()) && /v1/.test(await page.locator('[data-my-agent="Guest Helper"]').textContent())
  && (await page.evaluate(() => JSON.parse(localStorage.getItem('agentverse.customAgents') || '[]').length)) === 0
  && (await page.getByTestId('import-local-banner').count()) === 0);
await page.getByRole('button', { name: 'Edit Guest Helper' }).click();
await page.getByLabel('Description').fill('Now with a saved description');
await page.getByRole('button', { name: /^Save/ }).click();
await sleep(400);
check('editing a saved agent creates version 2', /v2/.test(await page.locator('[data-my-agent="Guest Helper"]').textContent()));
await page.getByRole('button', { name: 'Make Guest Helper private' }).click();
await sleep(300);
check('sharing can be turned off (private)', /Private/.test(await page.locator('[data-my-agent="Guest Helper"]').textContent()));
await shot(page, 'a02-my-agents-saved');

// ---- saved chats survive a reload
await page.goto(`${BASE}/?fx=off#/app`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-agent]');
await page.locator('[data-agent="translator"]').click();
await page.getByRole('combobox', { name: 'Message' }).fill('Please remember this sentence');
await page.keyboard.press('Enter');
await page.waitForFunction(() => !!document.querySelector('[aria-label="Send message"]'), null, { timeout: 30000 });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-agent]');
await page.locator('[data-agent="translator"]').click();
await page.waitForSelector('[data-testid="msg-user"]', { timeout: 8000 }).catch(() => {});
check('after a reload, opening the agent brings the saved conversation back',
  (await page.getByTestId('msg-user').count()) === 1 && /Please remember this sentence/.test(await page.getByTestId('msg-user').first().textContent()));
await shot(page, 'a03-chat-restored');

// ---- the saved agent answers from the server, and is listed in the chat sidebar
await page.locator('[data-testid="custom-agent-card"][data-agent-name="Guest Helper"] button').first().click();
await page.getByRole('combobox', { name: 'Message' }).fill('hello saved agent');
await page.keyboard.press('Enter');
await page.waitForFunction(() => !!document.querySelector('[aria-label="Send message"]'), null, { timeout: 30000 });
check('a saved agent answers through the server (loaded by id)', /I'm Guest Helper/.test(await page.getByTestId('msg-assistant').last().textContent()));

// ---- workspaces: create, switch, isolation of agents between them
await page.goto(`${BASE}/?fx=off#/app/my-agents`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-my-agent]');
await page.getByRole('button', { name: /^Workspace: .*Switch workspace$/ }).click();
await page.getByRole('menuitem', { name: /New workspace/ }).click();
await page.getByLabel('Workspace name').fill('Team Space');
await page.getByRole('button', { name: 'Create workspace' }).click();
await page.waitForFunction(() => /Team Space/.test(document.querySelector('[data-testid=workspace-label]')?.textContent || ''), null, { timeout: 8000 });
await sleep(300);
check('a new workspace becomes active and starts empty', (await page.locator('[data-my-agent]').count()) === 0);
await page.getByRole('button', { name: /^Workspace: .*Switch workspace$/ }).click();
await page.getByRole('menuitem', { name: /Ada's workspace/ }).click();
await page.waitForSelector('[data-my-agent="Guest Helper"]', { timeout: 8000 });
check('switching back shows that workspace\'s agents again', (await page.locator('[data-my-agent]').count()) === 1);
await shot(page, 'a04-workspace-switcher');

// ---- sign out
await page.getByRole('button', { name: 'Account menu' }).click();
await page.getByRole('menuitem', { name: 'Sign out' }).click();
await page.waitForFunction(() => /Guest workspace/.test(document.querySelector('[data-testid=workspace-label]')?.textContent || ''), null, { timeout: 8000 });
check('signing out returns to the guest workspace with nothing from the account', (await page.locator('[data-my-agent]').count()) === 0);

// ---- a second person sees none of it
const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const p2 = await ctx2.newPage();
watch(p2);
await signUp(p2, bob);
await nav(p2, 'my-agents');
await p2.waitForSelector('h1:has-text("My Agents")');
await sleep(300);
check('another account sees none of the first account\'s agents', (await p2.locator('[data-my-agent]').count()) === 0);
await p2.goto(`${BASE}/?fx=off#/app`, { waitUntil: 'domcontentloaded' });
await p2.waitForSelector('[data-agent]');
await p2.locator('[data-agent="translator"]').click();
await sleep(800);
check('…nor their saved conversations', (await p2.getByTestId('msg-user').count()) === 0);

// ---- wrong password, then password reset through the emailed link (read from the server log)
await page.goto(`${BASE}/?fx=off#/auth/sign-in`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('h1:has-text("Sign in")');
await page.getByLabel('Email', { exact: true }).fill(ada.email); await page.getByLabel('Password', { exact: true }).fill('wrong password!!');
await page.getByRole('button', { name: 'Sign in' }).click();
check('a wrong password shows a clear error', await page.getByRole('alert').waitFor({ timeout: 5000 }).then(async () => /don't match/.test(await page.getByRole('alert').textContent()), () => false));
if (LOG) {
  await page.getByRole('link', { name: 'Forgot your password?' }).click();
  await page.waitForSelector('h1:has-text("Reset your password")');
  await page.getByLabel('Email', { exact: true }).fill(ada.email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  // Reset emails are rate limited per IP (3 / minute); back-to-back runs can hit it.
  const limitMsg = await page.getByText(/Too many attempts/).waitFor({ timeout: 2500 }).then(() => page.getByText(/Too many attempts/).textContent(), () => null);
  if (limitMsg) {
    check('reset-email rate limit is explained in the form with the real wait', /wait (\d+ second|a minute)/.test(limitMsg), limitMsg);
    await sleep((Number(/wait (\d+)/.exec(limitMsg)?.[1]) || 60) * 1000 + 1000);
    await page.getByRole('button', { name: 'Send reset link' }).click();
  }
  check('reset request confirms without revealing whether the account exists',
    await page.getByText(/If an account exists for/).waitFor({ timeout: 5000 }).then(() => true, () => false));
  let link = null;
  for (let i = 0; i < 20 && !link; i++) {
    const lines = fs.readFileSync(LOG, 'utf8').split('\n').filter(l => l.includes(ada.email) && l.includes('reset-password'));
    link = lines.length ? /(http\S+?reset-password\/[^\s"\\]+)/.exec(lines.at(-1))?.[1] : null;
    if (!link) await sleep(250);
  }
  check('the reset email was produced (development log copy)', !!link, link);
  if (link) {
    await page.goto(link.replace(/\\u0026/g, '&'), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('h1:has-text("Choose a new password")', { timeout: 8000 });
    check('the reset link opens the new-password page and the token is removed from the address bar', !/token=/.test(page.url()));
    await page.getByLabel('New password').fill('a brand new passphrase');
    await page.getByRole('button', { name: 'Save new password' }).click();
    await page.waitForSelector('h1:has-text("Password changed")');
    await page.getByRole('link', { name: 'Sign in' }).click();
    await page.waitForSelector('h1:has-text("Sign in")');
    await page.getByLabel('Email', { exact: true }).fill(ada.email); await page.getByLabel('Password', { exact: true }).fill('a brand new passphrase');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForSelector('h1:has-text("Command Center")', { timeout: 10000 });
    check('signing in with the new password works', page.url().endsWith('#/app/command-center'));
  }
} else {
  console.log('SKIP  password reset (set SERVER_LOG to the server\'s log file)');
}

// ---- phone layout of the auth screens
const m = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })).newPage();
watch(m);
for (const p of ['sign-in', 'sign-up', 'forgot-password']) {
  await m.goto(`${BASE}/?fx=off#/auth/${p}`, { waitUntil: 'domcontentloaded' });
  await m.waitForSelector('h1');
  check(`phone: #/auth/${p} has no horizontal overflow`, (await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
}
await shot(m, 'a05-phone-sign-in');

check('no uncaught errors, console errors or 5xx', errors.length === 0, errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
