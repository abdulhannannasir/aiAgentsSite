// End-to-end check of Phase 6 (visual workflow studio) against a database-backed server in LIVE mode pointed at the
// mock provider (same setup as e2e/orchestrator.mjs):
//   node e2e/mock-openai.mjs 3901 &
//   DATABASE_URL=… BETTER_AUTH_SECRET=… BETTER_AUTH_URL=http://127.0.0.1:3804 OPENAI_API_KEY=test \
//     OPENAI_BASE_URL=http://127.0.0.1:3901 OPENAI_MODEL=gpt-mock RATE_LIMIT_MAX=300 PORT=3804 node server.js &
//   BASE_URL=http://127.0.0.1:3804 GUEST_URL=http://127.0.0.1:3801 node e2e/studio.mjs
import { chromium } from 'playwright';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3804';
const GUEST = process.env.GUEST_URL || '';
const SHOTS = process.env.SHOTS_DIR || '';
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + String(extra).slice(0, 200) : ''}`); };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = Math.random().toString(36).slice(2, 7);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error' && !/401|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
page.on('response', r => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
page.on('dialog', d => void d.accept());

const node = id => page.locator(`.react-flow__node[data-id="${id}"]`);
const status = id => node(id).locator('[data-run-status]').getAttribute('data-run-status');
const drag = async (fromId, toId, handle = '.react-flow__handle.source') => {
  const a = await node(fromId).locator(handle).first().boundingBox();
  const b = await node(toId).locator('.react-flow__handle.target').boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
};
const saveState = () => page.getByTestId('save-state').textContent();
const runPanel = () => page.getByTestId('run-panel');
const startRun = async input => {
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await page.getByRole('textbox', { name: 'Input', exact: true }).fill(input);
  await page.getByRole('button', { name: 'Start run' }).click();
  await runPanel().waitFor({ timeout: 10000 });
};

// ---- sign up
await page.goto(`${BASE}/?fx=off#/auth/sign-up`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('h1:has-text("Create your account")');
await page.getByLabel('Name', { exact: true }).fill('Ada Studio');
await page.getByLabel('Email', { exact: true }).fill(`studio-${run}@example.com`);
await page.getByLabel('Password', { exact: true }).fill('correct horse battery');
await page.getByRole('button', { name: 'Create account' }).click();
if (await page.getByText(/Too many attempts/).waitFor({ timeout: 2500 }).then(() => true, () => false)) { await sleep(11_000); await page.getByRole('button', { name: 'Create account' }).click(); }
await page.waitForSelector('h1:has-text("Command Center")', { timeout: 15000 });

// ---- workflows page: templates and the original chat workflows
await page.goto(`${BASE}/?fx=off#/app/workflows`);
await page.getByTestId('templates').waitFor({ timeout: 10000 });
check('six templates are offered', await page.locator('[data-template]').count() === 6);
check('the chat workflows are still there', await page.locator('[data-workflow]').count() === 4);

// ---- build a workflow from scratch: add a step, connect it by dragging, fill a template, save, run
await page.getByRole('button', { name: 'New workflow' }).click();
await page.getByTestId('studio').waitFor({ timeout: 10000 });
await node('input').waitFor();
check('a new workflow starts as Input → Result with no errors', await node('result').isVisible() && /No errors/.test(await page.getByTestId('issues-toggle').textContent()));
check('planned step types are shown but disabled', await page.getByRole('button', { name: /Run code \(not available yet: Needs an isolated sandbox/ }).isDisabled());
await page.getByRole('button', { name: 'Add Text template' }).click();
await node('template_1').waitFor();
check('a new unconnected step is an error and Run is disabled', /1 error/.test(await page.getByTestId('issues-toggle').textContent()) && await page.getByRole('button', { name: 'Run', exact: true }).isDisabled());
await page.getByTestId('issues-toggle').click();
check('the issues list explains the problem', /"Text template" has no incoming connection/.test(await page.getByTestId('issues').textContent()));
await page.getByTestId('issues-toggle').click();
// move it out of the way of the existing edge, then wire input → template → result
await node('template_1').hover();
const tb = await node('template_1').boundingBox();
await page.mouse.down(); await page.mouse.move(tb.x + tb.width / 2, tb.y + 200, { steps: 8 }); await page.mouse.up();
await drag('input', 'template_1');
await drag('template_1', 'result');
check('dragging between handles connects steps', await page.locator('.react-flow__edge').count() === 3, await page.locator('.react-flow__edge').count());
await node('template_1').click();
const textField = page.getByTestId('inspector').getByLabel('Text', { exact: true });
await textField.fill('Hello ');
await page.getByRole('button', { name: 'Insert a variable into Text' }).first().waitFor().catch(() => {});
await page.getByLabel('Insert a variable into Text').getByRole('button', { name: '{{input}}' }).click();
check('variable chips insert {{variables}}', (await textField.inputValue()) === 'Hello {{input}}', await textField.inputValue());
await node('result').click();
await page.getByTestId('inspector').getByLabel('Result', { exact: true }).fill('{{template_1}}!');
check('edits mark the workflow unsaved', (await saveState()) === 'Unsaved changes');
check('Run waits for a save', await page.getByRole('button', { name: 'Run', exact: true }).isDisabled());
await page.getByRole('button', { name: 'Save' }).click();
await page.getByText('Version 2 · saved').waitFor({ timeout: 8000 });
check('saving creates version 2', (await saveState()) === 'Version 2 · saved');
await page.getByLabel('Workflow name').fill(`Greeter ${run}`);
await page.getByLabel('Workflow name').press('Enter');
await shot(page, 's01-editor');
await startRun('World');
await page.locator('[data-testid="run-panel"][data-status="COMPLETED"]').waitFor({ timeout: 15000 });
check('the run result is computed from the graph', /Hello World!/.test(await page.getByTestId('run-output').textContent()), await page.getByTestId('run-output').textContent());
check('nodes show their run status', (await status('template_1')) === 'SUCCEEDED' && (await status('result')) === 'SUCCEEDED');
await node('template_1').click();
check('selecting a node shows its result', /Hello World/.test(await runPanel().getByLabel('Selected step result').textContent()));
await runPanel().getByRole('button', { name: 'Back to editing' }).click();
await page.getByTestId('inspector').or(page.getByText('Build the workflow')).first().waitFor();

// ---- versions: load version 1 back into the editor
await page.getByRole('button', { name: 'Versions' }).click();
await page.getByTestId('versions').waitFor();
check('both versions are listed', await page.getByTestId('versions').locator('li').count() === 2);
await page.getByTestId('versions').locator('li').filter({ hasText: 'Version 1' }).getByRole('button', { name: 'Load' }).click();
await node('template_1').waitFor({ state: 'detached', timeout: 5000 });
check('loading an old version restores its graph as unsaved changes', (await saveState()) === 'Unsaved changes');

// ---- a template with branches: only the matching branch runs
await page.goto(`${BASE}/?fx=off#/app/workflows`);
await page.getByRole('button', { name: 'Use the Support triage template' }).click();
await node('is_bug').waitFor({ timeout: 10000 });
check('the condition shows true and false handles', await node('is_bug').locator('.react-flow__handle.source').count() === 2);
await startRun('The app crashes when I open settings');
await page.locator('[data-testid="run-panel"][data-status="COMPLETED"]').waitFor({ timeout: 15000 });
check('the bug branch ran and the other was skipped', (await status('bug_report')) === 'SUCCEEDED' && (await status('reply')) === 'SKIPPED' && (await status('merge')) === 'SUCCEEDED', `${await status('bug_report')} ${await status('reply')}`);
await shot(page, 's02-branch-run');

// ---- approval step, with pause and resume
await page.goto(`${BASE}/?fx=off#/app/workflows`);
await page.getByRole('button', { name: 'Use the Reviewed blog post template' }).click();
await node('review').waitFor({ timeout: 10000 });
await startRun('Why sleep matters');
await page.locator('[data-run-status="WAITING_APPROVAL"]').waitFor({ timeout: 15000 });
check('the run waits at the approval step with the draft shown', /Review the draft before it is polished/.test(await runPanel().textContent()));
await runPanel().getByRole('button', { name: 'Pause' }).click();
await page.locator('[data-testid="run-panel"][data-status="PAUSED"]').waitFor({ timeout: 8000 });
await runPanel().getByRole('button', { name: /^Approve/ }).click();
await sleep(600);
check('nothing new starts while paused', (await status('polish')) === 'PENDING');
await runPanel().getByRole('button', { name: 'Resume' }).click();
await page.locator('[data-testid="run-panel"][data-status="COMPLETED"]').waitFor({ timeout: 15000 });
check('after approving and resuming the run completes', (await status('polish')) === 'SUCCEEDED');
await shot(page, 's03-approval-done');

// ---- the workflow list and the orchestrator show the runs
await page.goto(`${BASE}/?fx=off#/app/workflows`);
await page.getByTestId('studio-list').waitFor();
check('workflows are listed with their last run', await page.locator('[data-studio-workflow]').count() === 3 && await page.getByText('Last run completed').count() === 3);
await page.goto(`${BASE}/?fx=off#/app/orchestrator`);
await page.getByTestId('orchestration-list').waitFor({ timeout: 8000 });
check('workflow runs appear in the Orchestrator list', await page.getByText(/Workflow: Support triage/).count() === 1);

// ---- phone layout
const phone = await browser.newContext({ viewport: { width: 375, height: 800 }, reducedMotion: 'reduce', storageState: await ctx.storageState() });
const p2 = await phone.newPage();
await p2.goto(`${BASE}/?fx=off#/app/workflows`);
await p2.getByTestId('studio-list').waitFor({ timeout: 10000 });
await p2.locator('[data-studio-workflow] a').first().click();
await p2.getByTestId('studio').waitFor({ timeout: 10000 });
await p2.locator('.react-flow__node').first().waitFor();
const overflow = await p2.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check('no horizontal overflow at 375px in the studio', overflow <= 0, overflow);
await shot(p2, 's04-phone');
await phone.close();

if (GUEST) {
  const g = await (await browser.newContext()).newPage();
  await g.goto(`${GUEST}/?fx=off#/app/workflows`);
  check('guest mode explains the studio needs accounts', await g.getByText('The workflow studio needs accounts').waitFor({ timeout: 8000 }).then(() => true, () => false));
  check('guest mode keeps the chat workflows', await g.locator('[data-workflow]').count() === 4);
}

check('no page errors, console errors or 5xx responses', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
