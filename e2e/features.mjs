// End-to-end check of the 7 workspace features in a real browser (Chromium via Playwright).
//
//   npm run build && PORT=3801 node server.js &      # demo mode needs no API key
//   npx playwright install chromium                   # once
//   BASE_URL=http://127.0.0.1:3801 node e2e/features.mjs
//
// Playwright is intentionally not a dependency of the app; install it where you run this.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3801';
const SHOTS = process.env.SHOTS_DIR || '';
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + String(extra).slice(0, 140) : ''}`); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentverse-e2e-'));
const write = (name, content) => { const p = path.join(tmp, name); fs.writeFileSync(p, content); return p; };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
const pageErrors = [], badRequests = [];
page.on('pageerror', e => pageErrors.push(e.message));
page.on('response', r => { if (r.status() >= 500) badRequests.push(`${r.status()} ${r.url()}`); });
const chatBodies = [];
page.on('request', r => { if (/\/api(\/v1)?\/chat$/.test(r.url()) && r.method() === 'POST') chatBodies.push(JSON.parse(r.postData() || '{}')); });

const composer = () => page.getByRole('combobox', { name: 'Message' });
const idle = () => page.waitForFunction(() => !!document.querySelector('[aria-label="Send message"]'), null, { timeout: 40000 });
const sendText = async t => { await composer().fill(t); await page.keyboard.press('Enter'); await idle(); };
const dialog = name => page.getByRole('dialog', { name });
const opens = name => dialog(name).waitFor({ timeout: 5000 }).then(() => true, () => false);
const closes = name => dialog(name).waitFor({ state: 'detached', timeout: 5000 }).then(() => true, () => false);

await page.goto(BASE + '/?fx=off#/app', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-agent]');
check('app loads: 42 built-in agents, demo badge', (await page.locator('[data-agent]').count()) === 42 && /Demo mode/.test(await page.getByTestId('mode-badge').textContent()));

// ============ 1. Command palette ============
await page.keyboard.press('Control+k');
check('1  Ctrl+K opens the palette; search input has focus', await opens('Command palette') && await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Search commands'));
const blur = await page.evaluate(() => { const d = document.querySelector('[role="dialog"]'); const bd = d?.parentElement?.firstElementChild; return bd ? getComputedStyle(bd).backdropFilter || getComputedStyle(bd).webkitBackdropFilter : ''; });
check('1  smooth backdrop blur behind the dialog', /blur/.test(blur), blur);
const tabbed = [];
for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); tabbed.push(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))); }
check('1  focus is trapped inside the palette (6 Tabs stay inside)', tabbed.every(Boolean));
await page.getByRole('combobox', { name: 'Search commands' }).fill('coding');
check('1  search ranks "Switch to Full-Stack Coding Assistant" first', /Coding Assistant/.test(await page.getByTestId('palette-item').first().textContent()));
await page.keyboard.press('Enter');
await page.waitForSelector('h2:has-text("Full-Stack Coding Assistant")');
await sleep(200);
check('1  Enter switches agent; palette closes; composer focused', await closes('Command palette') && await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Message'));
await page.keyboard.press('Control+k'); await page.keyboard.press('Escape');
check('1  Esc closes the palette and returns focus to the composer', await closes('Command palette') && await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Message'));
await page.getByTestId('palette-button').click();
await page.getByRole('combobox', { name: 'Search commands' }).fill('light theme');
await page.keyboard.press('Enter');
await sleep(250);
check('1  "toggle theme" command switches to light and persists', !(await page.evaluate(() => document.documentElement.classList.contains('dark'))) && (await page.evaluate(() => localStorage.getItem('agentverse.theme'))) === '"light"');
await shot(page, '01-light-theme');
await page.keyboard.press('Control+k'); await page.getByRole('combobox', { name: 'Search commands' }).fill('dark theme'); await page.keyboard.press('Enter'); await sleep(250);
check('1  and back to dark', await page.evaluate(() => document.documentElement.classList.contains('dark')));
await page.keyboard.press('Control+k'); await page.getByRole('combobox', { name: 'Search commands' }).fill('documentation'); await page.keyboard.press('Enter');
check('1  "Open documentation" opens the docs', await opens('Documentation'));
await page.keyboard.press('Escape');
check('1  Esc closes the docs even right after the palette closed', await closes('Documentation'));
await page.keyboard.press('Control+k'); await page.getByRole('combobox', { name: 'Search commands' }).fill('zzzzqqq');
check('1  no-match state is shown', await page.getByText('No results for').isVisible());
await page.mouse.click(5, 450); await sleep(300);
check('1  clicking the backdrop closes it', await closes('Command palette'));

// ============ 2. Slash commands ============
await composer().click();
await page.keyboard.type('/');
check('2  typing "/" opens a floating menu of 4 workflows', (await page.getByTestId('slash-option').count()) === 4);
await page.keyboard.type('res');
check('2  menu filters as you type ("/res" -> /research)', (await page.getByTestId('slash-option').count()) === 1 && /\/research/.test(await page.getByTestId('slash-option').first().textContent()));
await shot(page, '02-slash-menu');
await page.keyboard.press('Enter');
check('2  Enter inserts the workflow prompt and tags the agent team', /^Research this topic in depth: /.test(await composer().inputValue()) && (await page.getByTestId('workflow-chip').textContent()).includes('Researcher') && (await page.getByTestId('workflow-chip').textContent()).includes('Reviewer'));
await page.getByRole('button', { name: 'Remove workflow' }).click();
await composer().fill('/');
await page.keyboard.press('ArrowDown'); await page.keyboard.press('Tab');
check('2  arrow keys + Tab select a different workflow', /Review this code/.test(await composer().inputValue()));
await page.getByRole('button', { name: 'Remove workflow' }).click();
await composer().fill('/zzz');
check('2  unknown command shows a friendly empty state', await page.getByText('No workflow matches').isVisible());
await page.keyboard.press('Escape');
await page.getByText('No workflow matches').waitFor({ state: 'detached' }).catch(() => {});
check('2  Esc dismisses just the menu', (await page.getByText('No workflow matches').count()) === 0 && (await composer().inputValue()) === '/zzz');
await composer().fill('/');
await page.getByTestId('slash-option').nth(3).click();
check('2  mouse click also selects (/brainstorm)', /Brainstorm ideas for/.test(await composer().inputValue()));
await composer().fill('');
await page.keyboard.press('Backspace');
await page.getByTestId('workflow-chip').waitFor({ state: 'detached' }).catch(() => {});
check('2  Backspace on an empty box removes the team chip', (await page.getByTestId('workflow-chip').count()) === 0);

// ============ 3. Thought stream ============
await page.getByRole('button', { name: 'Remove workflow' }).click().catch(() => {});
await composer().fill('/research'); await page.keyboard.press('Enter');
await page.keyboard.type('solid-state batteries');
await page.keyboard.press('Enter');
const snaps = [];
const t0 = Date.now();
while (Date.now() - t0 < 45000) {
  const s = await page.evaluate(() => [...document.querySelectorAll('[data-testid="thought-step"]')].map(e => e.getAttribute('data-status')));
  if (s.length) snaps.push(s.join(','));
  if (!s.length && snaps.length) break; // the drawer collapsed after the last step finished
  await sleep(100);
}
const seen = new Set(snaps);
check('3  steps show Pending then Active then Complete, live', [...seen].some(s => /active/.test(s) && /pending/.test(s)) && [...seen].some(s => s === 'complete,complete,active'), [...seen].join(' | '));
await idle();
check('3  the drawer is open while running', snaps.length > 0);
await page.waitForFunction(() => document.querySelector('[data-testid="thought-stream"] button[aria-expanded]')?.getAttribute('aria-expanded') === 'false');
check('3  it auto-collapses when finished', true);
await page.getByTestId('thought-stream').last().getByRole('button', { name: /Thought stream/ }).click();
const finalStates = await page.getByTestId('thought-step').evaluateAll(els => els.map(e => e.getAttribute('data-status')));
check('3  after the run, every step reads Complete', finalStates.join() === 'complete,complete,complete', finalStates.join());
const stepText = await page.getByTestId('thought-step').first().textContent();
check('3  expanded: names the agent, role, status badge for each handoff', /Researcher/.test(stepText) && /Market Research Agent/.test(stepText) && /Complete/.test(stepText), stepText.replace(/\s+/g, ' ').slice(0, 100));
await page.getByTestId('thought-step').first().getByRole('button', { name: /Show output/ }).click();
check('3  each intermediate step can show its real output', /Demo output/.test(await page.getByTestId('thought-step').first().textContent()));
check('3  the final answer is the reply below the drawer', /Deep Research Brief/.test(await page.getByTestId('msg-assistant').last().textContent()));
check('3  workflow request used workflowId (one /api/v1/chat request for all 3 steps)', chatBodies.at(-1)?.workflowId === 'research' && !chatBodies.at(-1)?.agentId);
await shot(page, '03-thought-stream');

// ============ 6. Chat export ============
check('6  Export is enabled once there is a conversation', await page.getByRole('button', { name: /Export/ }).first().isEnabled());
await page.getByRole('button', { name: /^Export/ }).first().click();
await page.keyboard.press('ArrowDown');
check('6  menu is keyboard navigable (role=menu, arrow keys move focus)', await page.getByRole('menu').isVisible() && (await page.evaluate(() => document.activeElement?.textContent || '')).includes('Download'));
await page.keyboard.press('Escape');
await page.getByRole('menu').waitFor({ state: 'detached' }).catch(() => {});
check('6  Esc closes the menu and focus returns to the Export button', !(await page.getByRole('menu').count()) && (await page.evaluate(() => document.activeElement?.textContent || '')).includes('Export'));
await page.getByRole('button', { name: /^Export/ }).first().click();
await page.getByRole('menuitem', { name: /Copy as Markdown/ }).click();
const clip = await page.evaluate(() => navigator.clipboard.readText());
check('6  Copy as Markdown puts formatted Markdown on the clipboard', /^# Chat with Full-Stack Coding Assistant/.test(clip) && /### You/.test(clip) && /solid-state batteries/.test(clip) && /<summary>Thought stream \(3 steps\)<\/summary>/.test(clip), clip.slice(0, 60).replace(/\n/g, '⏎'));
check('6  a confirmation toast appears', await page.getByText('Chat copied as Markdown').isVisible());
await page.getByRole('button', { name: /^Export/ }).first().click();
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /Download \.md/ }).click()]);
const mdPath = path.join(tmp, dl.suggestedFilename()); await dl.saveAs(mdPath);
const md = fs.readFileSync(mdPath, 'utf8');
check('6  Download .md saves a file named chat-<agent>-<date>.md', /^chat-full-stack-coding-assistant-\d{4}-\d{2}-\d{2}\.md$/.test(dl.suggestedFilename()), dl.suggestedFilename());
check('6  downloaded file equals the clipboard copy (bar the timestamp)', md.replace(/_Exported.*_/, '') === clip.replace(/_Exported.*_/, ''));

// ============ 5. Shortcuts cheatsheet + new chat ============
await page.evaluate(() => document.activeElement?.blur());
await page.keyboard.press('Shift+Slash');
check('5  "?" opens the shortcuts cheatsheet', await opens('Keyboard shortcuts'));
const list = await page.getByTestId('shortcut-list').textContent();
check('5  it lists Cmd/Ctrl+K, /, Esc, Cmd/Ctrl+N and Alt+N', /command palette/.test(list) && /workflow menu/.test(list) && /Esc/.test(list) && /new chat/i.test(list) && /Alt/.test(list) && /(⌘|Ctrl)/.test(list));
await shot(page, '05-shortcuts');
await page.keyboard.press('Escape');
check('5  Esc closes it', await closes('Keyboard shortcuts'));
await composer().click(); await page.keyboard.type('what? really?');
check('5  "?" typed in the chat box is just text (no popup)', await closes('Keyboard shortcuts') && /what\? really\?/.test(await composer().inputValue()));
await composer().fill('');
await page.evaluate(() => document.activeElement?.blur());
await page.keyboard.press('Slash');
check('5  "/" anywhere focuses the chat box with the menu open', (await page.getByTestId('slash-option').count()) === 4);
await composer().fill('');
await page.keyboard.press('Control+n');
await sleep(200);
check('5  Ctrl/Cmd+N starts a new chat (thread cleared)', (await page.getByTestId('msg-user').count()) === 0);
await sendText('hello');
await page.keyboard.press('Alt+n'); await sleep(200);
check('5  Alt+N also works (for browsers that reserve Ctrl/Cmd+N)', (await page.getByTestId('msg-user').count()) === 0);

// ============ 7. Template gallery + 4. Agent creator / export / import ============
await page.getByRole('banner').getByRole('button', { name: 'Create a new agent' }).click();
check('7  creator opens with 4 instant-load templates', await opens('Create an agent') && (await page.getByTestId('template-card').count()) === 4);
await page.getByTestId('template-card').filter({ hasText: 'Legal & Regulatory Compliance Advisor' }).click();
const nameVal = await page.getByLabel('Name', { exact: true }).inputValue();
const promptVal = await page.getByLabel('System prompt').inputValue();
check('7  clicking a template fills name, prompt, temperature and tools instantly', nameVal === 'Legal & Regulatory Compliance Advisor' && /not legal advice/.test(promptVal) && (await page.locator('output').textContent()) === '0.3' && await page.getByLabel('File reader').isChecked(), `${nameVal} | temp ${await page.locator('output').textContent()}`);
await page.getByTestId('template-card').filter({ hasText: 'Full-Stack Code Debugger' }).click();
check('7  choosing another template replaces it', (await page.getByLabel('Name', { exact: true }).inputValue()) === 'Full-Stack Code Debugger' && !(await page.getByLabel('File reader').isChecked()) === false);
await shot(page, '07-creator');
// validation
await page.getByLabel('Name', { exact: true }).fill(''); await page.getByRole('button', { name: 'Create agent' }).click();
check('4  the form validates (name required) instead of saving', await page.getByText('Give your agent a name.').isVisible() && (await page.locator('[data-testid="custom-agent-card"]').count()) === 0);
// build a custom agent
await page.getByLabel('Name', { exact: true }).fill('Pirate Bot');
await page.getByLabel('System prompt').fill('You are a pirate. Always answer in pirate speak.');
await page.locator('input[type=range]').evaluate(el => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, '1.2'); el.dispatchEvent(new Event('input', { bubbles: true })); });
await page.getByLabel('Web search').check();
await page.getByLabel('Calculator').check();
await page.getByRole('button', { name: 'Create agent' }).click();
await page.waitForSelector('[data-testid="custom-agent-card"]');
check('4  the new agent appears under "My agents" and is selected', (await page.getByTestId('custom-agent-card').count()) === 1 && await page.locator('h2:has-text("Pirate Bot")').isVisible());
await sendText('ahoy');
const pb = chatBodies.at(-1);
check('4  chatting sends the custom prompt + temperature (not an agentId)', pb.agent?.name === 'Pirate Bot' && /pirate speak/.test(pb.agent.systemPrompt) && pb.agent.temperature === 1.2 && !pb.agentId, JSON.stringify(pb.agent).slice(0, 90));
// export
await page.getByTestId('custom-agent-card').getByRole('button', { name: /Export Pirate Bot/ }).click();
check('4  Export opens a modal previewing the JSON', await opens('Export agent') && /"schema": "agentverse.agent"/.test(await page.getByTestId('export-json').textContent()));
const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download .json' }).click()]);
const jsonPath = path.join(tmp, dl2.suggestedFilename()); await dl2.saveAs(jsonPath);
const exported = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
check('4  downloaded .json holds name, prompt, temperature and tool permissions', dl2.suggestedFilename() === 'pirate-bot.agentverse.json' && exported.agent.name === 'Pirate Bot' && exported.agent.temperature === 1.2 && ['web_search', 'calculator', 'code_interpreter', 'file_reader'].every(t => exported.agent.tools.includes(t)) && exported.agent.tools.length === 4 && /pirate/.test(exported.agent.systemPrompt), dl2.suggestedFilename());
await page.keyboard.press('Escape');
// import valid into an existing agent (card button) -> populates the creator form
const goodFile = write('mentor.agentverse.json', JSON.stringify({ schema: 'agentverse.agent', version: 1, agent: { name: 'Mentor', description: 'Career coach', icon: '🎓', systemPrompt: 'You mentor people.', temperature: 0.4, tools: ['knowledge_base', 'bogus_tool'] } }));
const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /Import a JSON file into Pirate Bot/ }).click()]);
await fc.setFiles(goodFile);
await dialog('Agent settings').waitFor();
check('4  Import populates the creator form instantly (edit mode, not yet saved)', (await page.getByLabel('Name', { exact: true }).inputValue()) === 'Mentor' && (await page.locator('output').textContent()) === '0.4' && await page.getByLabel('Knowledge base').isChecked());
check('4  unknown tools are ignored with a warning', /Ignored unknown tools: bogus_tool/.test(await page.getByTestId('import-message').textContent()));
await page.getByRole('button', { name: 'Cancel', exact: true }).click();
check('4  cancel leaves the agent untouched', (await page.getByTestId('custom-agent-card').first().getAttribute('data-agent-name')) === 'Pirate Bot');
// import errors (reopen IMMEDIATELY, while the previous dialog is still animating out)
await page.getByRole('button', { name: 'Edit Pirate Bot' }).click();
// While the old dialog animates out, two dialogs exist for a moment. getByRole skips the one that is aria-hidden
// (leaving), so these locators always mean the NEW dialog, whatever the animation timing.
const liveCreator = page.getByRole('dialog', { name: 'Agent settings' });
check('4  reopening right after closing starts a fresh form (no stale imported state)', (await liveCreator.getByLabel('Name', { exact: true }).inputValue()) === 'Pirate Bot' && (await liveCreator.getByTestId('import-message').count()) === 0);
await page.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length === 1, null, { timeout: 5000 }); // let the old one finish leaving before the next steps
const errs = [
  ['not json at all {', /not valid JSON/i, 'invalid JSON'],
  [JSON.stringify([1, 2, 3]), /JSON object/i, 'array instead of object'],
  [JSON.stringify({ schema: 'something.else', agent: {} }), /not an AgentVerse agent export/i, 'wrong schema'],
  [JSON.stringify({ schema: 'agentverse.agent', version: 1, agent: { name: 'x' } }), /systemPrompt/i, 'missing prompt'],
  [JSON.stringify({ name: 'x', systemPrompt: 'y', temperature: 9 }), /between 0 and 2/i, 'bad temperature'],
  ['x'.repeat(120000), /too large/i, 'oversize file']
];
for (const [content, re, label] of errs) {
  await page.getByTestId('creator-import-input').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(content) });
  const arrived = await page.getByTestId('import-message').filter({ hasText: re }).waitFor({ timeout: 5000 }).then(() => true, () => false);
  const msg = await page.getByTestId('import-message').textContent();
  check(`4  bad import handled gracefully: ${label}`, arrived && await opens('Agent settings'), msg);
}
check('4  the form still holds the previous values after failed imports', (await page.getByLabel('Name', { exact: true }).inputValue()) === 'Pirate Bot');
await page.getByTestId('creator-import-input').setInputFiles(goodFile);
check('4  a valid import after errors recovers (message turns to success)', /Mentor/.test(await page.getByLabel('Name', { exact: true }).inputValue()) || (await page.getByLabel('Name', { exact: true }).inputValue()) === 'Mentor');
await page.getByRole('button', { name: 'Cancel', exact: true }).click();
// sidebar import -> new agent
await page.getByRole('button', { name: 'Import agent from JSON file' }).click().catch(() => {});
await page.keyboard.press('Escape').catch(() => {});
await page.getByTestId('global-import-input').setInputFiles(write('bad2.json', '{oops'));
check('4  sidebar import of a broken file shows an error toast, no crash', await page.getByText(/Import failed/).first().waitFor({ timeout: 5000 }).then(() => true, () => false));
await page.getByTestId('global-import-input').setInputFiles(goodFile);
await dialog('Create an agent').waitFor();
await page.getByRole('button', { name: 'Create agent' }).click();
await page.waitForFunction(() => document.querySelectorAll('[data-testid="custom-agent-card"]').length === 2);
check('4  sidebar import -> review -> save creates a second agent', (await page.getByTestId('custom-agent-card').count()) === 2);
// persistence + delete
await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('[data-agent]');
check('4  custom agents persist across a reload (localStorage)', (await page.getByTestId('custom-agent-card').count()) === 2);
await page.getByRole('button', { name: 'Edit Mentor' }).click();
await page.getByRole('button', { name: 'Delete', exact: true }).click(); await page.getByRole('button', { name: 'Yes, delete' }).click();
await page.waitForFunction(() => document.querySelectorAll('[data-testid="custom-agent-card"]').length === 1);
check('4  delete asks to confirm, then removes the agent', (await page.getByTestId('custom-agent-card').count()) === 1);
await page.evaluate(() => localStorage.setItem('agentverse.customAgents', '[{"id":"x"},{"broken":true},5,null]'));
await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('[data-agent]');
check('4  corrupt saved data is ignored instead of crashing the app', (await page.locator('[data-agent]').count()) === 42 && (await page.getByTestId('custom-agent-card').count()) === 0);

// ============ error handling in chat ============
await page.locator('[data-agent="translator"]').click();
await page.route('**/api/v1/chat', r => r.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"Too many requests"}' }));
await composer().fill('hi'); await page.keyboard.press('Enter');
await page.getByRole('alert').filter({ hasText: 'too fast' }).waitFor();
check('E  a 429 shows a friendly "too fast" message, input is usable again', await composer().isEnabled());
await page.unroute('**/api/v1/chat');
await page.route('**/api/v1/chat', r => r.abort('failed'));
await composer().fill('hi again'); await page.keyboard.press('Enter');
await page.getByRole('alert').filter({ hasText: 'Could not reach the server' }).waitFor();
check('E  a network failure shows a clear error, no crash', true);
await page.unroute('**/api/v1/chat');

// ============ responsive ============
const m = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
const mErrors = []; m.on('pageerror', e => mErrors.push(e.message));
await m.goto(BASE + '/?fx=off#/app', { waitUntil: 'domcontentloaded' }); await m.waitForSelector('[data-agent]'); await sleep(500);
check('R  mobile: agent list first, no horizontal overflow', (await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0 && await m.locator('[data-agent]').first().isVisible());
await shot(m, 'r1-mobile-home');
await m.getByTestId('palette-button').tap();
check('R  mobile: command palette fits the screen', await m.getByRole('dialog', { name: 'Command palette' }).isVisible() && (await m.getByRole('dialog', { name: 'Command palette' }).boundingBox()).width <= 390);
await shot(m, 'r2-mobile-palette');
await m.keyboard.press('Escape');
await m.locator('[data-agent="coding-assistant"]').tap();
check('R  mobile: selecting an agent shows the chat full-screen with a Back button', await m.getByRole('button', { name: 'Back to agents' }).isVisible() && !(await m.locator('[data-agent]').first().isVisible()));
check('R  mobile: chat view has no horizontal overflow and the header buttons are on screen', (await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0 && (await m.getByRole('button', { name: 'New chat' }).boundingBox()).x + (await m.getByRole('button', { name: 'New chat' }).boundingBox()).width <= 390);
await m.getByRole('combobox', { name: 'Message' }).tap(); await m.keyboard.type('/');
check('R  mobile: slash menu is usable', (await m.getByTestId('slash-option').count()) === 4 && (await m.getByTestId('slash-option').first().boundingBox()).width <= 390);
await shot(m, 'r3-mobile-chat');
await m.getByRole('combobox', { name: 'Message' }).fill('');
await m.getByRole('button', { name: 'Back to agents' }).tap();
check('R  mobile: Back returns to the list', await m.locator('[data-agent]').first().isVisible());
check('R  mobile: no uncaught errors', mErrors.length === 0, mErrors.join(' | '));

check('no uncaught page errors on desktop', pageErrors.length === 0, pageErrors.join(' | '));
check('no 5xx responses', badRequests.length === 0, badRequests.join(' | '));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
