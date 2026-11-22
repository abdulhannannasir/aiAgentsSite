# AgentVerse — Phase Progress

Single source of truth for where the 12-phase build stands. Updated at the end of every phase (or session).

| Phase | Title | Status |
| --- | --- | --- |
| 0 | Audit and architecture foundation | ✅ Done |
| 1 | UI architecture and design system | ✅ Done |
| 2 | Auth, database, user management | ✅ Done (team invitations UI deferred, see below) |
| 3 | Agent marketplace | ✅ Done (per-agent model choice moves to Phase 4, see below) |
| 4 | Real AI execution engine | ✅ Done (sandboxed code execution deliberately not offered, see below) |
| 5 | Multi-agent orchestration | ✅ Done (Redis/BullMQ path verified locally; no managed Redis deploy yet, see below) |
| 6 | Visual workflow studio | ✅ Done (planned step types shown disabled with the phase that builds them) |
| 7 | Projects, memory, knowledge | ⚪ Not started |
| 8 | Integrations | ⚪ Not started |
| 9 | Command Center and activity | 🟡 Activity page with real execution history done early (Phase 4); live metrics/notifications pending |
| 10 | Billing | ⚪ Not started — needs owner decision on payment provider |
| 11 | Security, performance, testing, deployment | ⚪ Not started |

## Baseline (before any change)

typecheck ✅ · unit 59/59 ✅ · build ✅ · e2e features 79/79 ✅ · e2e visual 76/76 ✅

## Log

### Phase 0 — audit (2026-11-08)

* Created `docs/AGENTVERSE_ARCHITECTURE_AUDIT.md`, `IMPLEMENTATION_ROADMAP.md`, `DATABASE_DESIGN.md`, `API_DESIGN.md`.
* No code changes yet.

### Phase 0 — stabilization (2026-11-08)

**Implemented**
* Backend ported from one 709-line `server.js` to a TypeScript ESM modular monolith in `server/src`
  (config, lib, middleware, modules/{agents, workflows, chat, providers}, routes). Behaviour preserved: same
  42 agents, 4 workflows, SSE events, Gemini retry/fallback rules, demo mode, rate limits.
* Provider adapter interface (`ProviderAdapter`) with OpenAI, Gemini and demo implementations.
* Config validated with zod at startup; every bad value listed at once (`ConfigError`).
* Structured JSON logging (pino) with secret redaction; request ids (`X-Request-Id`); one error shape
  `{ error: { code, message, requestId } }`; JSON 404 for unknown API routes; malformed JSON → 400.
* Security: helmet with a strict CSP (`script-src 'self'` — the inline theme script moved to `/theme-init.js`),
  CORS allowlist (`CORS_ORIGINS`, same-origin by default), HSTS in production, same headers declared in `vercel.json`.
* API versioning: `/api/v1/*`; `/api/*` kept as aliases. New `GET /api/v1/meta` (configuration booleans only).
* Removed fake functionality: `POST /api/tools/execute` and the demo replies' fake tool results
  ("Email sent (simulated)", fake ticket numbers). Demo replies now state that tools are not connected.
* Client: API helpers on `/api/v1`, reads the new error shape, wire types imported from `server/src/contracts.ts`.
* Root package is ESM (`"type": "module"`); `npm run build` compiles the API then builds the client.

**Files** — new: `server/**`, `vitest.server.config.ts`, `client/public/theme-init.js`, `docs/*`.
Modified: `server.js` (thin entry), `api/[...path].js`, `package.json`, `Dockerfile`, `vercel.json`, `.env.example`,
`.gitignore`, `.dockerignore`, `README.md`, `client/index.html`, `client/src/lib/api.ts`, `client/src/types.ts`,
`tailwind.config.js`, `postcss.config.js`, `e2e/features.mjs` (URL matchers for `/api/v1/chat`). Removed: `workflows.js`.

**Database changes** — none. **API changes** — additive (`/api/v1/*`, `/meta`); `/api/tools/execute` removed.

**Tests** — typecheck ✅ · client unit 59/59 ✅ · server 58/58 ✅ (new) · build ✅ · e2e features 79/79 ✅ ·
e2e visual 76/76 ✅ (with the CSP active) · smoke 9/9 ✅.

**Known issues / not verified**
* `docker build` not run (no Docker daemon in the build environment). The Dockerfile was updated for `server/dist`.
* A Vercel preview deploy was not run. `api/[...path].js` was checked locally to export the handler without
  listening; run `node e2e/smoke.mjs <preview-url>` after the first deploy of this branch.
* Live-mode chat still falls back to the labelled demo reply when the provider fails before the first token
  (behaviour preserved on purpose; Phase 4 turns it into an explicit error).
* Dev-tool `npm audit` advisories (vite/esbuild dev server, vitest) remain; upgrade planned separately.

### Phase 1 — UI architecture and design system (2026-11-08)

**Implemented**
* App shell: sticky top bar (logo → landing, command search, AI-mode badge → Settings, New agent, notifications,
  shortcuts, docs, theme, account menu), collapsible desktop sidebar (state persisted), phone/tablet navigation drawer.
* Router: `#/app/<page>` for 13 pages; `#/app` stays the chat workspace so existing links and tests keep working;
  unknown pages get a 404 page; each page sets the tab title.
* Pages that work today: **Command Center** (agents, running now, workflows, AI mode, live agents with elapsed time,
  this-session stats, recent activity, platform-service status — all computed from real state or `/api/v1/meta`),
  **Chat** (the existing workspace), **Discover Agents** (search, category filter, sort, details drawer with tools and
  the workflows that use the agent), **My Agents** (chat, edit, duplicate, export, delete with confirmation),
  **Agent Builder** (templates, blank, import), **Workflows** (pipelines, run), **Settings** (theme, effects, provider
  and service status, delete local agents).
* Planned modules (Projects, Memory, Integrations, Activity, Analytics, Billing) are listed with a "Soon" label and open
  an honest page: what the module will do, which phase builds it, and whether this server already has the services it
  needs. Workspace selector, notifications and sign-in are shown truthfully (guest label, empty inbox, disabled
  sign-in with the reason) instead of fake controls.
* Design system in `client/src/components/ui`: Button / LinkButton / IconButton, Card, Badge, StatusDot, Stat,
  PageHeader, EmptyState, ErrorState, Spinner, Skeleton, ProgressBar, Field / Input / Select / Textarea / Segmented,
  Tabs, Table, Menu (keyboard: arrows, Home/End, Esc, focus return), Popover, Drawer (focus trap), Tooltip.
  Tokens remain the existing CSS variables, so light/dark and the neon identity are unchanged.
* New pages are lazy chunks (2–9 KB each); the landing page and 3D effects are untouched.

**Files** — new: `client/src/app/{Shell,nav,workspace}.tsx`, `client/src/pages/*`, `client/src/components/ui/*`,
`client/src/lib/sessionStats.ts`, `client/src/lib/shell.test.ts`, `e2e/shell.mjs`. Modified: `client/src/App.tsx`
(workspace context + page routing), `client/src/lib/route.ts`, `README.md`. Removed: `client/src/components/Navbar.tsx`
(replaced by the shell's top bar with the same controls and labels).

**Database / API changes** — none.

**Tests** — typecheck ✅ · client unit 67/67 ✅ (8 new: routing, nav model, session stats) · server 58/58 ✅ ·
build ✅ · e2e features 79/79 ✅ · e2e visual 76/76 ✅ · e2e shell 69/69 ✅ (new: every route, sidebar/drawer/palette/
keyboard navigation, collapse persistence, page actions, phone overflow on all 13 routes, no console/CSP errors).

**Known issues**
* Command Center figures are per browser tab until execution records exist (Phase 2 persistence, Phase 9 metrics);
  the page says so.
* The 3D swarm still renders behind data pages on the `high` tier (capped at 30 fps); revisit in Phase 11 performance.

### Phase 2 — authentication, database and user management (2026-11-08)

**Implemented**
* PostgreSQL + Prisma 7 (pg driver adapter). Schema and first migration: users, sessions, accounts, verifications,
  workspaces, members, invitations, agents + immutable versions, conversations, messages, executions, usage records,
  audit log, notifications. `npm run release` applies migrations on deploy (skips when no database is configured).
* Better Auth: email + password (scrypt hashes), email verification (required by default when SMTP is configured),
  password reset (1-hour links, all sessions revoked), database sessions in httpOnly SameSite=Lax cookies (secure in
  production), organization plugin = workspaces with owner / admin / member, admin plugin = platform roles
  user / admin / superadmin. Origin/CSRF checks pinned on (Better Auth turns them off under test runners); our own
  cookie-authenticated writes get the same origin rule. Built-in rate limits on sign-in/up and email sending.
* Every account gets a personal workspace; sessions open in it; workspaces can be created and switched.
* Server-side authorization: the workspace always comes from the session's membership (re-checked on every request;
  removing a member takes effect immediately); other workspaces' ids answer 404. Private agents are visible only to
  their creator; members edit their own agents, admins/owners edit any workspace agent.
* Saved custom agents with versions and sharing; bulk import; saved conversations with server-side history,
  execution records (status, provider, model, model calls, agent version) and usage metering; audit entries for
  sign-up, sessions, workspace and agent changes.
* Mailer: SMTP via nodemailer when `SMTP_URL` is set; otherwise development logs the message, production logs an error
  and sends nothing (links are secrets).
* Frontend: sign-in, create-account, forgot/reset-password and email-confirmed screens (`#/auth/*`); account menu
  with the signed-in user and sign-out; real workspace switcher with "New workspace"; My Agents shows versions, sharing,
  creator and permission-aware actions, plus an explicit "Move to <workspace>" for agents made as a guest; chats
  restore when you reopen an agent; Settings shows the account. Every sign-in, sign-out and workspace switch clears
  the in-memory chats so nothing crosses accounts.
* Guest mode is unchanged when `DATABASE_URL`/`BETTER_AUTH_SECRET` are absent: account routes answer
  503 `FEATURE_UNAVAILABLE` and the UI says accounts aren't enabled.

**Tests** — typecheck ✅ · client unit 68/68 ✅ · server 82/82 ✅ (24 new PostgreSQL integration tests: sign-up/in/out,
duplicate and weak passwords, verification-required flow, password reset, unknown-email reset, untrusted origins with
and without cookies, workspace create/switch/isolation, private vs shared agents, member vs admin permissions,
membership removal, versioning, all-or-nothing import, saved chats with server-side history, forged history ignored,
cross-user conversation access, saved-agent prompt + version recorded, workflow trace and usage, failed runs, guests
store nothing) · build ✅ · e2e features 79/79 ✅ · visual 76/76 ✅ · shell 69/69 ✅ · smoke 9/9 ✅ (all on a guest-mode
server) · e2e accounts 27/27 ✅ (new, DB-backed server; stable over repeated runs, including the rate-limit paths).

**Bugs found and fixed while testing**
* Better Auth silently disables its origin/CSRF checks under test runners → pinned on explicitly.
* The client told users to wait 10 s on any 429 although Better Auth's reset-email window is 60 s (it sends
  `X-Retry-After`, not `Retry-After`) → the message now uses the real value, or none.

**Database changes** — new: migration `20261108213506_init` (additive; there was no database before).

**API changes** — new: `/api/auth/*`, `/api/v1/me`, `/api/v1/workspaces[/:id/activate]`, `/api/v1/custom-agents/*`,
`/api/v1/conversations/*`; `POST /api/v1/chat` accepts `customAgentId`, `conversationId`, `threadKey` and emits a
`conversation` event for signed-in users. `/api/v1/meta` reports `auth`/`email` from what actually works.

**Known issues / deferred**
* Inviting people to a workspace: the data model and Better Auth's organization endpoints exist, but the invitation
  email + UI are not built yet (planned with Phase 3's sharing work). Membership changes are tested at the API level.
* Profile editing (name, email change) and account deletion UI are not built yet.
* Conversation history list (more than the latest conversation per agent) arrives with Phase 3/9.
* Token counts stay empty until providers report usage (Phase 4); `modelCalls` is recorded now.
* Not verified here: a real SMTP server, a Vercel/Railway deploy with a managed database (no credentials in this
  environment). Run `node e2e/smoke.mjs <url>` after deploying.

### Phase 3 — agent marketplace (2026-11-09)

**Implemented**
* Agent detail pages (`#/app/agent/<id>`): description, category, best-for, example prompts that open the chat ready to
  send (written for all 42 agents), configuration (current model, tool permissions — labelled as not connected —,
  input/output format), the workflows the agent belongs to (runnable), usage stats, reviews, and your own runs and
  recent conversations.
* Real usage stats per agent from recorded executions: runs in the last 30 days, all-time runs, completion rate, plus
  average rating and review count. Workflow runs are not credited to the agent whose chat they started in. Without a
  database nothing is shown and the page says why — no invented numbers.
* Discover: cards show rating and 30-day runs when recorded; sort by Featured, Most used (30 days), Highest rated, name,
  category (usage sorts only appear when the data exists); favorites toggle and a Favorites filter (signed in).
* Reviews: 1–5 whole stars + optional comment, one per person per agent, editable and deletable, **only from people who
  have run the agent**; reviewers are shown as first name + last initial because reviews are visible across workspaces.
* Favorites for built-in agents and saved agents you can see; removed automatically when a saved agent is deleted.
* Version history for saved custom agents (My Agents → History).
* Honesty fix: the hand-picked `mostUsed` flag was labelled "Popular" though nothing measured it; it is now
  "Featured", and popularity comes from real runs.

**Bugs found and fixed while testing**
* Any malformed `#/app/...` link fell through to the landing page; it now shows "not found".
* On servers without a database every page load requested marketplace stats and logged a 503 in the browser console;
  the client now checks `/api/v1/meta` first and doesn't ask.
* Opening an unknown agent id made a request that could only 404; the page now answers from the loaded agent list.

**Database changes** — migration `20261109003328_marketplace` (additive: `agent_favorites`, `agent_reviews`, one index).

**API changes** — new `/api/v1/marketplace/*`; `GET /api/v1/agents/:id` adds `examples` and `workflows` (additive).

**Tests** — typecheck ✅ · client unit 69/69 ✅ · server 90/90 ✅ (6 new PostgreSQL tests: honest zeros, run counting and
30-day window, success rate, workflow runs excluded, review eligibility and validation, one review per person,
averages, guest read-only, favorites visibility and cleanup, 503 without a database) · build ✅ · e2e features 79/79 ✅ ·
visual 76/76 ✅ · shell 74/74 ✅ · smoke 9/9 ✅ · accounts 27/27 ✅ · marketplace 14/14 ✅ (new; stable on reruns against a
non-empty database).

**Deferred to Phase 4** (they need the provider registry): per-agent provider/model, input/output schemas, knowledge
files and memory settings in the builder. Publishing agents to other workspaces is not offered yet (custom agents are
private or shared with one workspace).

### Phase 4 — real AI execution engine (2026-11-11)

**Implemented**
* Provider layer: adapters emit text, tool calls and token usage (OpenAI `stream_options.include_usage`, Gemini
  `usageMetadata` incl. thinking tokens). Failures are `ProviderError`s with user-safe messages (auth, quota,
  unavailable, timeout, network, blocked, empty); details stay in the logs.
* **Live mode no longer falls back to canned demo text** when the provider fails (the audit's commitment): the user gets
  an honest error. Demo mode (no key) is unchanged and clearly labelled.
* Model catalog (`OPENAI_MODELS`, `GEMINI_MODELS`) at `GET /api/v1/models`; saved agents can be pinned to an allowed
  provider/model (validated, versioned; an agent whose model was later removed falls back to the default, logged).
  The agent editor shows a model picker for signed-in users.
* Tool registry (`GET /api/v1/tools`): calculator, current time, SSRF-guarded `url_fetch`, Tavily `web_search`
  (awaiting `TAVILY_API_KEY`); code interpreter, files, knowledge, tickets and email are listed as unavailable with the
  reason and are never offered or pretended.
* Tool-calling loop for OpenAI and Gemini (Gemini thought signatures echoed back): agent permissions ∩ available
  tools, input validated with zod, per-tool timeouts, errors returned to the model, untrusted output wrapped and
  labelled, up to 4 rounds then a forced answer, every extra model call charged to the rate limit, refusal of tools
  the agent isn't permitted.
* Executions record provider, model, model calls, tokens (null when not reported — never estimated) and each tool
  invocation; usage records for tokens. `GET /api/v1/executions`, `/:id`, `POST /:id/cancel` (stops a run in this
  process; members see their own runs, admins the workspace's).
* UI: tool calls appear live in the thought stream (a failed tool call doesn't fail the reply); **Activity** page with
  real run history, status filter, run details (input, output, tokens, tool calls) and cancel; Settings lists tool
  availability; built-in agents that clearly benefit got `url_fetch`, `calculator` or `current_time`.

**Security notes** — `url_fetch`: http/https only, ports 80/443, no credentials in URLs, IP literals and every DNS
answer checked against private/loopback/link-local/CGNAT/metadata/reserved/multicast ranges (IPv4, IPv6 and
IPv4-mapped) **at connection time** via a pinned lookup, every redirect re-checked (max 4), 2 MB / 12k chars / 15 s
limits, HTML reduced to text. No shell or code execution exists anywhere in the server.

**Database changes** — migration `20261111090513_tool_invocations` (additive).

**Tests** — typecheck ✅ · client unit 69/69 ✅ · server 118/118 ✅ (28 new: calculator, address blocklist, URL checks, DNS
guard, url_fetch against a local server incl. redirects to private addresses, truncation, content types; registry
availability/permissions/validation/timeouts; OpenAI and Gemini tool-call round trips with exact wire formats; tool
refusal; round cap; rate limit on extra calls; honest live errors; `/models`, `/tools`; executions with summed tokens,
usage rows, tool invocations, pinned models, visibility, live cancellation) · build ✅ · e2e features 79/79 ✅ · visual
76/76 ✅ · shell 74/74 ✅ · smoke 9/9 ✅ · accounts 27/27 ✅ · marketplace 14/14 ✅ · tools 15/15 ✅ (new: live mode against a
fake OpenAI — tool call in the thought stream, honest provider error, pinned model, Activity, settings).

**Test fix** — the visual suite's cursor-ring check sampled an eased animation at a fixed 800 ms and was borderline on
both this branch and the previous commit (436–444 px against a 432 + 12 px target); it now waits up to 3 s for the ring
to settle, same expectation.

**Not verified here** — real OpenAI/Gemini/Tavily APIs (no keys in this environment; wire formats are tested against
fakes that follow the providers' documented formats). Run one live chat with a tool after configuring keys.

**Deferred** — sandboxed code execution (needs an isolated runtime service; deliberately not run on the API server),
durable/queued execution and recovery after restarts (Phase 5), structured output schemas for agents.

### Phase 5 — multi-agent orchestration (2026-11-16)

**Implemented**
* **Orchestrator** (`server/src/modules/orchestration`): a goal → an LLM planner → a validated task DAG (1–6 tasks, known
  agents only, dependencies only on earlier tasks so the graph is acyclic by construction, tools cut down to the
  agent's permissions ∩ what this server has). An invalid plan gets one repair attempt that shows the planner the
  validation error; after that the run fails with an honest message. Demo mode uses a fixed, labelled demo plan.
* **Scheduler**: ready tasks (all dependencies succeeded) are queued up to `ORCHESTRATION_CONCURRENCY` per run, so
  independent tasks run in parallel; tasks behind a failed or skipped dependency are skipped with the reason. Each
  scheduling step holds a per-orchestration Postgres advisory lock.
* **Durable state**: the database is the source of truth (`Orchestration`, `OrchestrationTask`, `ApprovalRequest`);
  every transition is a conditional update ("only if still X"), so duplicate or late jobs, several workers and
  restarts cannot run a step twice or overwrite each other. Tasks are claimed with a lease (renewed by a heartbeat)
  and attempt number.
* **Queue drivers**: BullMQ on Redis when `REDIS_URL` is set (jobs survive restarts; a separate `npm run worker`
  process can consume them; crashed handlers retry with exponential backoff and stay in the failed set as the
  dead-letter list), otherwise an in-process queue that is labelled **not durable** in the API and the UI.
* **Retries and dead-letter**: transient provider errors (quota, unavailable, timeout, network, empty) retry with
  exponential backoff up to 3 attempts; permanent errors (bad credentials, rejected request, blocked) fail at once. A
  task that fails for good fails the orchestration, which can be resumed with **Retry task** (resets the task and
  everything skipped because of it; finished tasks are not re-run).
* **Recovery**: a sweep on start and every 30 s re-queues tasks whose lease expired (or fails them on their last
  attempt), re-queues queued tasks (in-process jobs are lost on restart), restarts stalled planning/synthesis and
  re-schedules running orchestrations.
* **Cancellation**: immediate in this process, and within one heartbeat in any other worker; pending approvals are
  cancelled with it.
* **Approvals**: a task whose tools reach outside the server and bring untrusted content back (`url_fetch`,
  `web_search`) waits for a person before it runs. Rationale: in an autonomous multi-step run, an outbound request is
  where a prompt-injected agent could leak data. Approve → it runs; reject → it and its dependents are skipped and the
  rest is still combined. Who may decide: the requester or a workspace owner/admin. Audited.
* **Least-privilege context**: a task sees the goal, its own instruction and only its dependencies' outputs.
* **Synthesis with provenance**: a final call combines the results and must cite tasks as `[T1]`; cited keys that
  exist are stored as `sources`, and the synthesizer is told which tasks were skipped or failed.
* **Metering**: model calls and tokens per task and per run (null when the provider reports none), usage records
  written as they happen (so retries never double-count) plus one `ORCHESTRATION_RUN` record.
* **API**: `POST/GET /api/v1/orchestrations` (with `Idempotency-Key`), `GET /:id`, `POST /:id/cancel`,
  `POST /:id/tasks/:key/retry`, `GET /api/v1/approvals`, `POST /api/v1/approvals/:id`; `/meta` reports
  `orchestration: { available, durable, worker, reason? }`. Limits: 3 runs in progress per person; a start charges the
  rate limiter for planning + 6 tasks + synthesis.
* **UI**: new **Orchestrator** page (sidebar): goal form (with an idempotency key per goal), approvals inbox, recent
  runs, and a run view with the plan grouped into stages (parallel tasks side by side), live status, approval
  buttons, retry, cancel, task results, the combined answer and clickable sources.

**Availability** — needs accounts (database + auth). On serverless hosts (Vercel) it needs `REDIS_URL` and a worker on
a long-running host; otherwise `/meta` and the page say why it is unavailable. `ORCHESTRATION_WORKER=off` makes an API
server only enqueue.

**Database changes** — migration `20261115234229_orchestration` (additive: 3 tables, 3 enums, one new `UsageKind` value).

**Tests** — typecheck ✅ · client unit 71/71 ✅ · server 144/144 ✅ (26 new: plan validation incl. cycles/forward
references/duplicates/unknown agents/tool filtering, JSON extraction, citations, approval rules, in-process queue
concurrency and de-duplication, Redis URL parsing; against PostgreSQL: DAG run with parallel tasks, least-privilege
prompts, provenance and exact usage, plan repair and honest planning failure, retry after 503, dead-letter on 401 with
skipped dependents and manual retry, approval approve/reject, cancel with pending approvals, Idempotency-Key,
workspace isolation, active-run limit, lease-expiry recovery, demo mode, unavailable states; **with Redis**: an
API-only server queues durably and a separately started worker runs the job) · build ✅ · e2e orchestrator 22/22 ✅ (new:
plan → approval → answer with sources, reject, inbox, cancel, phone layout, guest mode) and 21/21 against an API with
`ORCHESTRATION_WORKER=off` + Redis + a separate `npm run worker` process · features 79/79 ✅ · visual 76/76 ✅ · shell
74/74 ✅ · smoke 9/9 ✅ · accounts 27/27 ✅ · marketplace 14/14 ✅ · tools 15/15 ✅.

**Not verified here** — a managed Redis (Railway/Upstash) deploy and real provider planning quality (planner and
synthesizer prompts are tested against a fake model; plan quality with a real model should be checked after keys are
configured).

**Deferred** — the 4 fixed workflows still run inline in the chat request (they move onto this engine as templates in
Phase 6); notifications for pending approvals (Phase 9 event bus / notifications); planner use of saved custom agents.

### Phase 6 — visual workflow studio (2026-11-16)

**Implemented**
* **Editor** (`#/app/workflows/<id>`, React Flow): drag or click steps from a palette onto a zoomable, pannable canvas
  with minimap and controls; connect handles by dragging (conditions have a green *true* and a red *false* handle);
  select a step to edit it in the inspector; Delete removes the selected step or connection; unsaved-changes guard.
* **11 working step types**: Manual input, Agent (any built-in agent, optional tools), Prompt (own instructions,
  temperature), Tool (calculator, date/time, read a web page, web search, with templated arguments), Condition
  (contains / equals / matches / empty / longer than…), Text template, Merge (wait for all, or continue with the
  branches that ran), Extract JSON field, Approval (human gate), Delay, Output. **5 planned types** (knowledge search,
  integration action, webhook and schedule triggers, run code) are shown disabled with the reason; validation rejects them.
* **Variables**: `{{input}}` and `{{step_id}}` in prompts and templates, inserted with chips that list only upstream
  steps; validation refuses a variable that is not upstream.
* **Live validation** shared by the browser and the server (`server/src/modules/studio/graph.ts`): one input, at least
  one output, no loops, every step reachable, branch handles, per-step settings, agents and tool permissions, tools
  available on this server; warnings for steps that will ask for approval or lead nowhere. Issues list jumps to the step.
* **Versions**: every save is an immutable, attributed version; a graph with errors can be saved as a draft but not
  run; optimistic concurrency (409 when someone saved in between); any version can be loaded back and saved as the
  latest; older valid versions can be run explicitly through the API.
* **Execution through the Phase 5 engine**: a run compiles the saved graph into tasks (no planner call). Branches skip
  the path not taken ("Skipped because the condition … took the other branch"), Merge/Output use any-join, data steps
  run without a model, tool steps that reach outside the server and Approval steps wait for a person, Delay schedules
  the next attempt, the result is the Output steps' text. Leases, retries (model steps), cancellation, recovery and
  usage metering are inherited. **Pause / resume** (new `PAUSED` status): no new steps start; running ones finish.
* **Run overlay**: the canvas colours each step by status while a run is open; selecting a step shows its result;
  approvals, pause, resume and cancel are in the run panel; runs are listed per workflow and in the Orchestrator.
* **Templates**: the 4 chat workflows re-expressed as graphs, plus "Support triage" (classifier → condition → two
  branches → merge) and "Reviewed blog post" (draft → approval → polish). The chat workflows keep working as before.
* **API**: `/api/v1/studio/node-types`, `/templates`, `/validate` (public); `/workflows` CRUD (soft delete),
  `/versions`, `/runs`; `POST /api/v1/orchestrations/:id/pause|resume`.

**Database changes** — migration `20261116000626_workflow_studio` (additive: `workflows`, `workflow_versions`, task
`kind`/`nodeId`/`config`, orchestration `workflowId`/`workflowVersionId`, status `PAUSED`).

**Tests** — typecheck ✅ · client unit 72/72 ✅ · server 172/172 ✅ (28 new: validation rules incl. loops, reachability,
duplicates, planned kinds, agent/tool permissions, upstream-only variables, branch handles, regex; compilation order,
branches, joins; condition operators; JSON extraction; against PostgreSQL: templates, drafts, version conflicts,
branching runs, data steps incl. tool/extract/delay/multiple outputs, approval approve/reject, pause/resume, workspace
isolation, soft delete keeping run history) · build ✅ · e2e studio 27/27 ✅ (new: build from scratch by dragging
connections, variable chips, save, run with result on the canvas, versions, branch run, approval with pause/resume,
lists, phone layout, guest mode) · orchestrator 22/22 ✅ · features 79/79 ✅ · visual 76/76 ✅ · shell 74/74 ✅ · smoke 9/9 ✅
· accounts 27/27 ✅ · marketplace 14/14 ✅ · tools 15/15 ✅.

**Test fix** — the orchestrator e2e checked for the empty state before the list had loaded; it now waits for it.

**Deferred** — retrying a failed step from the studio's run panel (available from the full run details page), step
copy/paste and undo, the chat's `/command` workflows running on this engine, planned step types (Phases 7–8).
