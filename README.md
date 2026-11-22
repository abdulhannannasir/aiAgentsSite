# AgentVerse — AI Agent Workspace

42 pre-made AI agents, **multi-agent workflows**, and a **custom agent builder**: a React + TypeScript front end on a small Express API, wrapped in a cyberpunk-style interface with a 3D agent swarm, a scroll-driven landing page and live collaboration visuals.

- `/` is the landing page. `/#/app` is the chat workspace, and `/#/app/<page>` the other app pages: Command Center, Discover Agents, My Agents, Agent Builder, Workflows, Orchestrator, Activity and Settings, plus clearly labelled planned modules (Projects, Memory, Integrations, Analytics, Billing) that say which roadmap phase builds them. Hash routing, so no server rewrites are needed.

- **Demo mode** (default): works instantly with no API key. Replies are canned text and simulated workflow steps.
- **Live mode**: set `GEMINI_API_KEY` (Google Gemini) or `OPENAI_API_KEY` (OpenAI) and every agent answers with a real model, streamed token by token, calling real tools when it is permitted to (see **Tools**). If the provider fails, the user sees an honest error, never canned text.

## Tools

Agents carry tool permissions; a tool is offered to the model only if the agent is permitted **and** the tool is available on the server (`GET /api/v1/tools` lists every tool and why any is unavailable). Every call shows up in the reply's thought stream and, for signed-in users, in **Activity** with its input, result and duration.

| Tool | Status |
| --- | --- |
| `calculator` | Available — exact arithmetic with a safe parser (no `eval`). |
| `current_time` | Available — current date/time in UTC and any IANA zone. |
| `url_fetch` | Available — reads public web pages: http/https on ports 80/443 only, every address checked against private/loopback/link-local/metadata ranges at connection time (so DNS rebinding can't sneak past) and again on each redirect, 2 MB / 15 s limits, text extracted and labelled as untrusted for the model. |
| `web_search` | Awaiting configuration — set `TAVILY_API_KEY`. |
| `code_interpreter` | Unavailable — needs an isolated sandbox; code never runs on the API server. |
| `file_reader`, `knowledge_base` | Unavailable — arrive with project files and memory (Phase 7). |
| `ticket_system`, `email_sender` | Unavailable — need a connected integration and approvals (Phases 5 and 8). |

A reply may use up to four rounds of tool calls; each extra model call counts against the rate limit. Tools only run with a real model, never in demo mode.

## Accounts and workspaces (optional)

Set `DATABASE_URL` (PostgreSQL) and `BETTER_AUTH_SECRET` and the app gains accounts; leave them out and it runs exactly as before, in guest mode.

| Signed in | Guest |
| --- | --- |
| Email + password sign-up and sign-in, email verification, password reset (Better Auth, database sessions in httpOnly cookies) | No account |
| A personal **workspace** on sign-up; create more and switch between them; roles owner / admin / member | One browser-local space |
| Custom agents saved in the workspace, **versioned** on every edit, shared with the workspace or private; agents built as a guest can be moved in with one click | Custom agents in `localStorage` |
| Chats saved on the server (history loaded from the database, not trusted from the browser) and restored when you reopen an agent; each reply records an execution and usage | Chats end on refresh |
| Marketplace: favorites, reviews (only after using an agent), usage stats computed from recorded runs | Agent pages without usage numbers or reviews |

```bash
createdb agentverse
DATABASE_URL=postgresql://localhost/agentverse npm run db:migrate
DATABASE_URL=postgresql://localhost/agentverse BETTER_AUTH_SECRET=$(openssl rand -base64 32) npm start
```

Without `SMTP_URL`, verification and reset emails are written to the server log in development (never in production). Data is isolated per workspace on the server; see `docs/DATABASE_DESIGN.md` and `docs/API_DESIGN.md`.

## The interface

| Piece | What it is |
| --- | --- |
| **3D agent swarm** | A WebGL network of drifting nodes and links (custom GLSL) behind everything. Nodes shy away from the cursor, the camera flies through it as you scroll, and pulses travel along the links. |
| **Hero orb** | An interactive noise-displaced GLSL orb with a wireframe shell and seven orbiting "agents". It follows the cursor across the page, swells on hover and ripples on click. |
| **Live hero demo** | A console inside the hero that runs a real multi-agent workflow: the handoff graph lights up agent by agent while their output streams in. The first time it scrolls into view it replays a **recorded sample** (labelled "Sample run"; it makes no API call, so it costs nothing per visitor). Type your own task, pick a workflow and press **Run** to send it through `POST /api/chat`, the same stream the workspace uses (labelled "Live"). Stop cancels the request. With reduced motion the finished sample is shown instead of replayed. |
| **Custom cursor** | A dot, an easing ring and a neon trail. Over small controls the ring morphs to wrap them (magnetic snap), over cards it becomes a labelled disc, over text fields it steps aside. |
| **Magnetic buttons** | Primary buttons lean toward the cursor when it gets close, then spring back. |
| **3D agent cards** | Glass cards that tilt toward the pointer, light their border under the cursor, and glow by status (Active, Training, Idle). In the workspace a card shows Active only while that agent is really generating a reply. The landing page's deck shows all three states as a preview. |
| **Landing page** | Staggered holographic hero, a pinned scroll story (GSAP ScrollTrigger), a bento grid of live feature blocks, counted stats and a scroll-drawn architecture diagram. |
| **Live workspace** | A typing pulse before the first token, a waveform driven by the real streaming rate, and a node graph of the agents handing work to each other while a workflow runs. |

### Visual effects, tiers and performance

Effects adapt to the device. The tier is decided by `lib/fx/capability.ts`:

| Tier | When | What runs |
| --- | --- | --- |
| `high` | Capable desktop | Everything above. |
| `low` | Phones and tablets, small screens, 2 cores or less, 2 GB or less, data-saver, or chosen by the user | Fewer nodes, no travelling pulses, lower resolution, no backdrop blur. (The custom cursor only ever runs with a mouse, so touch devices never get it.) |
| `off` | Reduced-motion preference, no WebGL, or chosen by the user | No canvases and no custom cursor; a static SVG of the network instead. The reduced-motion preference also turns off the pinned scroll story and count-up, and shows final values. |

Change it from the command palette (**Visual effects**: auto, lite, off), or force it for testing with `?fx=high|low|off`.

How it stays smooth:
- All per-frame motion (drift, twinkle, cursor push, pulses) runs in the vertex and fragment shaders. The CPU only updates a few uniforms and the camera each frame.
- Links are one `LineSegments` and nodes one `Points`: two draw calls for the whole swarm.
- The 3D code (`three`, React Three Fiber, drei) is a separate chunk loaded after first paint, and everything below the hero loads as its own chunk. The static network shows until the first WebGL frame is ready.
- The hero orb stops rendering (0 draw calls) when scrolled out of view. Behind the workspace the swarm is capped at 30 fps.
- drei's `PerformanceMonitor` watches real frame times and sheds nodes and resolution on a device that can't hold the frame rate.
- The cursor loop sleeps as soon as everything has settled. Pointer and scroll state is shared mutable data, so moving the mouse never triggers a React render.

Not measured: the test environment renders WebGL in software, so the repo can prove the scenes draw, react and pause correctly, but not that a given GPU holds 60 fps. Check that on the devices you care about.

## What's in the workspace

| Feature | How to use it |
| --- | --- |
| **Command palette** | `⌘/Ctrl + K` (or the navbar search). Switch agents, run workflows, start a new chat, export, toggle the theme, open the docs. |
| **Slash-command workflows** | Type `/` in the chat box: `/research`, `/code-review`, `/legal-draft`, `/brainstorm`. Picking one inserts its prompt and tags the agent team that will run it. |
| **Thought stream** | Every reply has a collapsible drawer showing each step, which agent ran it, a status (Pending / Active / Complete / Failed) and the text it produced. |
| **Agent export / import** | In *My agents* or the agent editor: export an agent to a `.json` file, import one back (it fills the editor so you can review it first). |
| **Shortcuts cheatsheet** | Press `?` (when not typing in a field). |
| **Chat export** | **Export** menu in the chat header: copy as Markdown or download a `.md` file. |
| **Template gallery** | In the agent editor: four ready-made agents (Legal & Regulatory Compliance Advisor, Full-Stack Code Debugger, Deep Web Research Analyst, Product Growth Strategist). |

Other keys: `Esc` closes dialogs and menus · `⌘/Ctrl + N` or `Alt + N` starts a new chat (browsers often reserve `⌘/Ctrl + N`, so `Alt + N` always works) · `Enter` sends · `Shift + Enter` adds a line.

## Project structure

```
├── server.js            # entry point: imports the compiled API (server/dist) and listens
├── server/              # Express API, TypeScript (ESM), compiled with tsc
│   ├── src/
│   │   ├── app.ts       # builds the Express app (used by server.js, Vercel and the tests)
│   │   ├── contracts.ts # wire types shared with the React client
│   │   ├── config/      # environment parsing and validation (zod)
│   │   ├── lib/         # logger (pino), errors, SSE writer
│   │   ├── middleware/  # request ids, security headers (helmet), CORS allowlist, rate limit, error handler
│   │   ├── modules/     # agents (registry), workflows (definitions + engine), chat, providers (openai, gemini, demo)
│   │   └── routes/      # /api/v1 (also mounted at /api for older clients)
│   └── test/            # server tests (vitest, real HTTP, fake model upstreams)
├── client/              # React + TypeScript + Tailwind source (Vite)
│   └── src/
│       ├── app/         # app shell (top bar, collapsible sidebar, mobile drawer), navigation model, workspace context
│       ├── pages/       # Command Center, Chat, Discover, My Agents, Builder, Workflows, Settings, planned modules (lazy-loaded)
│       ├── components/  # CommandPalette, SlashCommandMenu, ThoughtStream, AgentCreator, AgentExportModal, …
│       │   ├── ui/      # design system: Button, Card, Badge, StatusDot, Tabs, Table, Menu, Popover, Drawer, Tooltip, Field, …
│       │   ├── landing/ # Hero, Story, BentoGrid, Architecture, Stats, AgentDeck, …
│       │   └── fx/      # NeuralScene, OrbScene (R3F), CustomCursor, Magnetic, TiltCard, Waveform, CollabGraph, …
│       ├── hooks/       # useChat (per-agent streaming threads), useDemoRun (hero demo), useFocusTrap, useScrollFx (GSAP), useStreamActivity
│       └── lib/         # agent file import/export, chat export, SSE parser, fuzzy search, templates, hero demo run logic + recorded sample
│           └── fx/      # network generator, effects tiers, GLSL shaders, shared pointer state
├── docs/                # architecture audit, roadmap, database + API design, phase progress
├── e2e/features.mjs     # browser test of the workspace features (Playwright)
├── e2e/visual.mjs       # browser test of the 3D, cursor, scroll and fallback behaviour (Playwright)
├── e2e/shell.mjs        # browser test of the app shell: every route, navigation, pages, phone layout
├── e2e/hero-demo.mjs    # browser test of the hero's live demonstration (Playwright)
├── public/              # build output — generated by `npm run build`, not committed
├── render.yaml  railway.toml  vercel.json  Dockerfile
```

## Run locally

```bash
npm install
npm run build      # compiles the API into server/dist, type-checks and builds the React app into public/
npm start          # http://localhost:3000
```

While developing the front end, run the API and the Vite dev server (hot reload) side by side:

```bash
npm run dev          # API on :3000 from the TypeScript sources (tsx), restarts on changes
npm run dev:client   # React app on :5173, proxies /api to :3000
```

For live AI replies, copy `.env.example` to `.env` and fill in `GEMINI_API_KEY` or `OPENAI_API_KEY` (the server reads `.env` automatically), or:

```bash
GEMINI_API_KEY=your-key npm start
```

The navbar badge shows **Demo mode** or **Live AI**.

### Tests

```bash
npm test             # client unit tests (incl. the hero demo run logic) + server tests (API, validation, SSE, providers against fake upstreams)
TEST_DATABASE_URL=postgresql://localhost/agentverse_test npm test   # also runs the PostgreSQL integration tests
TEST_REDIS_URL=redis://localhost:6379/5 TEST_DATABASE_URL=… npm test # also runs the Redis (BullMQ) worker test
npm run typecheck    # strict TypeScript, client and server
```

`e2e/features.mjs` drives a real browser through every workspace feature, including the failure paths (bad JSON, oversize files, server errors). `e2e/visual.mjs` covers the redesign with WebGL on: the 3D scenes, cursor snapping, magnetic and tilt interactions, the scroll story, bento blocks, live workspace effects, render-loop pausing (counted as GPU draw calls), and the reduced-motion and phone fallbacks. `e2e/hero-demo.mjs` covers the hero demo: the first-view sample, a real run and its request, Stop, every failure mode (HTTP errors, a dropped connection, a step failing mid-run, an empty reply), and the reduced-motion, phone and server-unreachable fallbacks. They need Playwright, which is deliberately not an app dependency:

```bash
npx playwright install chromium
PORT=3801 node server.js &
BASE_URL=http://127.0.0.1:3801 node e2e/features.mjs
BASE_URL=http://127.0.0.1:3801 node e2e/visual.mjs      # SHOTS_DIR=/some/dir also saves screenshots
BASE_URL=http://127.0.0.1:3801 node e2e/shell.mjs
BASE_URL=http://127.0.0.1:3801 node e2e/hero-demo.mjs
# accounts: a server with a database (see the header of e2e/accounts.mjs)
BASE_URL=http://127.0.0.1:3802 SERVER_LOG=/tmp/agentverse-e2e.log node e2e/accounts.mjs
BASE_URL=http://127.0.0.1:3802 node e2e/marketplace.mjs
# live mode against a fake OpenAI (see the header of e2e/tools.mjs)
node e2e/mock-openai.mjs 3901 &
BASE_URL=http://127.0.0.1:3803 node e2e/tools.mjs
# orchestration (see the header of e2e/orchestrator.mjs)
BASE_URL=http://127.0.0.1:3804 GUEST_URL=http://127.0.0.1:3801 node e2e/orchestrator.mjs
BASE_URL=http://127.0.0.1:3804 GUEST_URL=http://127.0.0.1:3801 node e2e/studio.mjs
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Set automatically by Render / Railway. |
| `GEMINI_API_KEY` | _(empty)_ | Google Gemini key. Set = real AI replies via Gemini. |
| `GEMINI_MODEL` | `gemini-flash-latest` | Any Gemini model your key can use. |
| `GEMINI_FALLBACK_MODELS` | `gemini-flash-lite-latest,gemini-2.5-flash` | Backup models, tried in order. Empty = no backups. |
| `GEMINI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta` | Override the Gemini endpoint. |
| `OPENAI_API_KEY` | _(empty)_ | OpenAI key. Set = real AI replies via OpenAI. |
| `OPENAI_MODEL` | `gpt-4o-mini` | Any chat-completions model your key can use. |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Point at any OpenAI-compatible API. |
| `LLM_PROVIDER` | _(auto)_ | `gemini`, `openai` or `demo` to force one provider. |
| `OPENAI_MODELS` / `GEMINI_MODELS` | the default model (+ Gemini backups) | Models a saved agent may be pinned to (comma-separated). Listed at `GET /api/v1/models`. |
| `TAVILY_API_KEY` | _(empty)_ | Enables the `web_search` tool (Tavily Search API). |
| `CORS_ORIGINS` | _(empty)_ | Other sites allowed to call the API (comma-separated). Empty = same-origin only. |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | `20` / `60000` | Chat requests per IP per window. |
| `LOG_LEVEL` | `info` | pino log level (logs are JSON, secrets redacted). |
| `DATABASE_URL` | _(empty)_ | PostgreSQL. Enables accounts, workspaces and saved data (with `BETTER_AUTH_SECRET`). |
| `BETTER_AUTH_SECRET` | _(empty)_ | 32+ random characters for sessions. |
| `BETTER_AUTH_URL` | `http://localhost:$PORT` | Public URL of the app (email links, trusted origin). |
| `SMTP_URL` / `MAIL_FROM` | _(empty)_ | Email delivery for verification and password reset. |
| `REQUIRE_EMAIL_VERIFICATION` | `true` if SMTP is set | Require a confirmed email before first sign-in. |
| `REDIS_URL` | _(empty)_ | Makes orchestration jobs durable (BullMQ) and lets `npm run worker` run them. Required for orchestration on Vercel. |
| `ORCHESTRATION_WORKER` | `on` (`off` on Vercel) | Whether this server also runs orchestration jobs. `off` = it only queues them. |
| `ORCHESTRATION_CONCURRENCY` / `WORKER_CONCURRENCY` | `2` / `4` | Parallel tasks per run / jobs per worker process. |
| `ORCHESTRATION_RETRY_BASE_MS` | `2000` | First retry delay for a failed task (doubles; 3 attempts). |

With no key the app runs in demo mode. If both keys are set it uses OpenAI unless `LLM_PROVIDER=gemini`. A reply that fails (bad key, quota, blocked prompt, timeout) is reported as an error with a user-safe reason; a **workflow step** that fails is reported as Failed and stops the run. `/api/health` reports the active provider.

Built-in limits: 20 chat requests per minute per IP (best-effort, see below), 4,000 characters per new message, and the last 20 earlier messages (8,000 characters each) sent as context. A workflow counts as one request per step.

## How chat works

The server keeps **no per-user state**. The browser holds each conversation and sends the recent history with every message, so any server instance can answer any request (which is what makes it safe on serverless hosts like Vercel). Refreshing the page starts fresh conversations; custom agents and the theme are kept in `localStorage`.

```
POST /api/chat   { "message": "...", "history": [{ "role": "user" | "assistant", "content": "..." }],
                   // exactly one of:
                   "agentId": "coding-assistant"                                 // a built-in agent
                   "agent": { "name", "systemPrompt", "temperature", "tools" }    // a custom agent
                   "workflowId": "research" }                                     // a multi-agent workflow
```

Requests also work at `/api/v1/chat` (the versioned path the app uses; `/api/*` stays as an alias). Errors share one shape: `{ "error": { "code", "message", "requestId" } }`. `GET /api/v1/meta` reports which providers and platform services are configured (booleans only, never values).

The reply streams back as server-sent events: `stream` (text), `error`, `done`, and for workflows also `plan`, `step` and `step_delta`. `GET /api/workflows` lists the workflows and their teams. A custom agent's prompt (max 4,000 characters) and temperature (0–2) are validated on the server as well as in the browser.

## Multi-agent workflows

A workflow is a real pipeline: each step is a **separate model call made as a different agent** (plus a role instruction), and each step is given the user's task and the output of every step before it. Intermediate outputs stream into the Thought stream; the last step's output is the answer. If a step fails the run stops and that step shows Failed. Nothing is replaced with made-up output.

There is **no live web access**. Research-style steps use the model's own knowledge and are told to flag what should be verified.

## Orchestration (goal → plan → agents → combined answer)

The **Orchestrator** page (signed in) takes a goal. A planner model splits it into up to 6 tasks, each assigned to one
of the built-in agents, with dependencies between them. Independent tasks run in parallel; each task sees only the
goal, its instruction and the results of the tasks it depends on. A final step combines the results into one answer
that cites the tasks it used (`[T1]`), shown as clickable sources.

* **Approvals.** A task that wants a tool reaching outside the server (reading web pages, web search) waits until you
  (or a workspace admin) approve it. Rejecting skips that task and anything depending on it; the rest is still combined.
* **Failures.** Temporary provider errors are retried with backoff (3 attempts). A task that still fails stops the run
  with the reason, and **Retry** re-runs just that task and what was skipped because of it.
* **Durability.** State lives in PostgreSQL. With `REDIS_URL`, jobs go through BullMQ and survive restarts; a separate
  `npm run worker` process can run them. Without Redis they run inside the API server (labelled *not durable*): a
  restart interrupts running tasks, and a recovery sweep re-runs them when the server is back.
* **Cost.** A run is up to 8 model calls (plan, 6 tasks, synthesis), counted against the rate limit up front; each person
  can have 3 runs in progress.

## Workflow studio

**Workflows → New workflow** (or a template) opens a visual editor. Drag steps onto the canvas and connect them:
Manual input, Agent, Prompt, Tool, Condition (true/false branches), Text template, Merge, Extract JSON field,
Approval, Delay and Output. Prompts and templates pass results along with `{{input}}` and `{{step_id}}`. The editor
checks the graph as you build it (loops, unconnected steps, missing settings, variables that aren't upstream, tools not
available here), every save is a new version, and **Run** executes the saved version on the orchestration engine:
the canvas shows each step's status and result, and approvals, pause, resume and cancel work from the run panel.
Knowledge search, integration actions, webhook/schedule triggers and code steps are listed as coming later.

## Agent files

```json
{
  "schema": "agentverse.agent",
  "version": 1,
  "agent": {
    "name": "My Agent",
    "description": "One line about it",
    "icon": "🤖",
    "systemPrompt": "You are…",
    "temperature": 0.7,
    "tools": ["web_search", "calculator"]
  }
}
```

Imports are validated (size, JSON syntax, schema and version, field types and lengths, known tool names) and report a clear error instead of failing silently. Tool permissions are saved and exported but are labels until the tool registry exists.

## Gemini retries and backup models

Google sometimes answers `503 high demand` or `429 quota` for a model. Before falling back, the server retries a temporary error (5xx, network) once on the same model, then tries each backup model in `GEMINI_FALLBACK_MODELS`. A `429` (that model's quota, which won't clear in a moment) and a `404` (model not available to your key) skip straight to the next model; errors no other model could fix (`400`, `401`/`403`) fail immediately. This happens before any text reaches the user. Waits are bounded, because Google can hold a call open for minutes before refusing it: each attempt must start responding within 8 seconds (`GEMINI_TIMEOUT_MS`; a hang moves on to the next model), opening a stream takes at most 16 seconds in total (`GEMINI_DEADLINE_MS`), and a stream silent for 30 seconds (`GEMINI_IDLE_MS`) is cut off. Each failed attempt is logged with Google's reason, so you can see why in your host's logs.

## Deploy

All hosts build the React app with `npm run build`, which writes `public/` for the server to serve. Put the code in a **GitHub repository** first:

```bash
git init && git add . && git commit -m "AgentVerse" && git branch -M main
git remote add origin https://github.com/<you>/<repo>.git && git push -u origin main
```

### Vercel (free Hobby plan, no card)

1. Import the repository at [vercel.com](https://vercel.com). `vercel.json` runs `npm run build`, publishes the built `public/` folder as **static output on the CDN**, and runs the Express app as a single function (`api/[...path].js` loads `server.js`) for every `/api/*` request.
2. Settings → **Environment Variables**: add `GEMINI_API_KEY` (tick **Sensitive**) for live replies, then redeploy.
3. Orchestration cannot run inside Vercel functions (work would stop when the response ends). To use it with a Vercel
   API, set `REDIS_URL` and run `npm run worker` on a long-running host (e.g. Railway) with the same variables;
   otherwise the Orchestrator page explains why it is unavailable.
4. Rate limiting on serverless: the built-in limiter keeps counters per instance, so it is only a speed bump. Add a rate-limit rule for `/api/chat` under **Firewall** (path equals `/api/chat`, 20 requests per 60 s per IP) and set a quota or spending cap with your model provider.
5. After every deploy run the smoke test. It loads the real page, because a site can pass every HTTP check and still be blank:

```bash
node e2e/smoke.mjs https://your-site.vercel.app
```

Why the static output matters: if the Express app serves `public/` itself (`express.static`), Vercel bundles those files into the function and rewrites the JavaScript from ES modules to CommonJS. Browsers then fail with `exports is not defined` and the page is blank. Keep the built app on the CDN as configured here.

### Render

New → **Blueprint**, pick the repository (reads `render.yaml`). Add `GEMINI_API_KEY` or `OPENAI_API_KEY` in the dashboard for live replies. Render may require payment details even for free services.

### Railway

New Project → **Deploy from GitHub repo** (reads `railway.toml`), add the key under **Variables**, then **Generate Domain**.

For durable orchestration add a **Redis** service, set `REDIS_URL` on the app from it, and (optionally, to keep long
runs off the web process) add a second service from the same repository with the start command `npm run worker`, the
same variables, and `ORCHESTRATION_WORKER=off` on the web service. Without a worker service the web service runs the
jobs itself.

### Docker

```bash
docker build -t agentverse .
docker run -p 3000:3000 -e GEMINI_API_KEY=your-key agentverse
```

The image is multi-stage: the React app is built in one stage and only the server and `public/` ship in the runtime image. Omit the key to run in demo mode.

## Things to know before going public

- **Guests' conversations live in the browser tab.** Refreshing ends them and custom agents persist in that browser only. With a database configured, signed-in users' agents and chats are saved on the server.
- **Live mode costs money.** Anyone who can reach your site can spend your model credits, and a workflow makes several model calls. Use a hard limit at your host and a quota or spending cap with your model provider.
- **Only some tools exist yet.** Calculator, date/time and reading public web pages work (web search with a Tavily key). Email, tickets, files, knowledge and code execution are listed as unavailable and are never pretended.
- **Legal, finance and health agents** are chat templates, not professional advice.
- **Free tiers sleep.** Free web services may spin down when idle, so the first visit can be slow.
