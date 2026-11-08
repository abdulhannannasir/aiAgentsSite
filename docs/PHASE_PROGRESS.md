# AgentVerse — Phase Progress

Single source of truth for where the 12-phase build stands. Updated at the end of every phase (or session).

| Phase | Title | Status |
| --- | --- | --- |
| 0 | Audit and architecture foundation | ✅ Done |
| 1 | UI architecture and design system | ✅ Done |
| 2 | Auth, database, user management | ✅ Done (team invitations UI deferred, see below) |
| 3 | Agent marketplace | ⚪ Not started (42 agents + builder exist from before) |
| 4 | Real AI execution engine | ⚪ Not started (OpenAI/Gemini streaming exist from before) |
| 5 | Multi-agent orchestration | ⚪ Not started (4 sequential workflows exist from before) |
| 6 | Visual workflow studio | ⚪ Not started |
| 7 | Projects, memory, knowledge | ⚪ Not started |
| 8 | Integrations | ⚪ Not started |
| 9 | Command Center and activity | ⚪ Not started |
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
