# AgentVerse — Architecture Audit (Phase 0)

Audit date: 2026-11-08 · Baseline commit: `ecc7709` (main, after PR #5)

This audit records what the repository actually contains before the 12-phase platform work starts. Everything
below was verified by reading the code and running it, not assumed from the brief.

## 1. Baseline health

| Check | Command | Result |
| --- | --- | --- |
| Install | `npm ci` | OK (Node 22, npm 10) |
| Type check | `npm run typecheck` | OK, strict mode, 0 errors |
| Unit tests | `npm test` | 59 passed (client libs + fx) |
| Production build | `npm run build` | OK, 5.7 s |
| Browser e2e: workspace features | `node e2e/features.mjs` | 79 passed, 0 failed |
| Browser e2e: 3D / cursor / scroll / fallbacks | `node e2e/visual.mjs` | 76 passed, 0 failed |
| `npm audit` | | 6 advisories (2 critical, 1 high, 3 moderate), all in dev tooling (vite/esbuild dev server, vitest). Not shipped to production. |

The baseline is stable. Nothing was broken before this work started.

## 2. Existing architecture

```
Browser (React 18 SPA, hash routing: #/ landing, #/app workspace)
   │  fetch /api/agents, /api/workflows, /api/health
   │  POST /api/chat  ── Server-Sent Events (stream, plan, step, step_delta, error, done)
   ▼
Express 4 (server.js, one 709-line CommonJS file)
   ├─ 42 agents (in-code array, system prompts never sent to the browser)
   ├─ 4 workflows (workflows.js) run as sequential model calls
   ├─ provider: OpenAI (chat completions, streaming) | Gemini (streamGenerateContent SSE) | demo (canned text)
   ├─ in-memory per-instance rate limiter (20 req/min/IP)
   └─ /api/tools/execute — simulated tools
```

* **Frontend**: React 18, TypeScript (strict), Vite 5, Tailwind 3, Framer Motion, GSAP ScrollTrigger, Three.js
  + React Three Fiber + drei (lazy chunk), marked + DOMPurify + Prism for message rendering, lucide icons.
* **Backend**: Express 4 + `cors`, no other runtime dependencies. Custom `.env` loader.
* **State**: the server is stateless by design. Conversations live in React state (lost on refresh); custom agents,
  theme and effects preference live in `localStorage`.
* **Deployment**: Vercel (CDN static output + one function `api/[...path].js` wrapping the Express app), Render
  (`render.yaml`), Railway (`railway.toml`), Docker (multi-stage). Health: `/healthz`, `/api/health`.

### 2.1 Routes and screens

| Route | Component | Purpose |
| --- | --- | --- |
| `#/` | `LandingPage` → `Hero`, lazy `BelowFold` (Story, BentoGrid, AgentDeck, Architecture, Stats, CtaFooter) | Marketing page with the 3D swarm |
| `#/app` | `Navbar` + `AgentSidebar` + `ChatWindow` | Workspace: pick an agent, chat, run workflows |
| (dialogs) | `CommandPalette`, `AgentCreator`, `AgentExportModal`, `DocsModal`, `ShortcutsModal` | Overlays on either view |

### 2.2 API surface (baseline)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/healthz` | plain `ok` |
| GET | `/api/health` | `{ ok, mode, provider, agents }` |
| GET | `/api/agents`, `/api/agents/:id` | public agent fields (no prompt) |
| GET | `/api/workflows` | 4 workflows with resolved step agents |
| POST | `/api/chat` | `agentId` **or** `agent` (custom) **or** `workflowId`; history from the browser; SSE reply |
| POST | `/api/tools/execute` | **simulated** tools (see §4) |

### 2.3 Agents and workflows

* 42 built-in agents across 16 categories (Support, Development, Content, Analytics, Sales, Marketing, Legal,
  Productivity, Communication, Research, Human Resources, Business Management, Law Firm Management, Personal
  Tools, Social Media, Daily Life). Each has `id, name, category, description, icon, color, gradient,
  systemPrompt, greeting, tools[], mostUsed, useCase`.
* 4 workflows, each three sequential steps, each step a different agent with a role instruction:
  `research` (Deep Research Brief), `code-review`, `legal-draft`, `brainstorm`. Step outputs are passed forward
  (trimmed to 6,000 chars). A failed step stops the run and is reported as failed — never replaced with canned text.
* 4 agent templates in the builder (`client/src/lib/templates.ts`).
* Agent file format `agentverse.agent` v1 with strict import validation (`client/src/lib/agentFile.ts`).

### 2.4 AI integration (works, keep)

* OpenAI: streaming chat completions, configurable base URL and model, temperature passed through.
* Gemini: key in header (never URL), retry + model fallback chain with bounded waits (per-attempt header timeout,
  overall deadline, idle-stream guard), 429/404 skip to next model, 400/401/403 fail fast, thought parts hidden.
* Provider is chosen **once per process** from env vars. No per-agent provider/model selection yet.
* No token/usage accounting, no execution records, no tool calling.

## 3. Features that work and must be preserved

1. Landing page with 3D swarm, hero orb, custom cursor, GSAP story, effect tiers (`high/low/off`), reduced-motion fallbacks.
2. Workspace: 42 agents, category filter, per-agent independent streaming threads, stop, new chat.
3. Command palette (⌘K), slash-command workflows, shortcuts cheatsheet, docs modal, light/dark theme.
4. Thought stream with live step status for workflows.
5. Custom agent builder with templates, temperature, tool permissions (labels), JSON export/import with validation.
6. Chat export (copy / download Markdown).
7. Gemini retry/fallback logic and the honest failure semantics for workflow steps.
8. Vercel static-on-CDN deployment fix (see README "Why the static output matters").

These are covered by `e2e/features.mjs` and `e2e/visual.mjs`; both suites must stay green through every phase.

## 4. Simulated, mocked or placeholder functionality

| Item | Where | Status |
| --- | --- | --- |
| Demo mode canned replies | `buildDemoResponse`, `streamDemoText` | Labelled "Demo mode" in text and navbar. Honest, keep as the no-key mode. |
| Live-mode fallback to demo text | `callLLM` (non-strict) | When a provider fails before the first token, the user gets demo text. It carries the demo disclaimer, but in live mode this hides a real failure. **Change in Phase 4** to an explicit error. |
| Tools `web_search`, `code_interpreter`, `file_reader`, `ticket_system`, `email_sender`, `knowledge_base` | `executeTool` | **Fake.** Return mock text such as "Email queued… Status: Sent (simulated)". Only used in demo replies and the unauthenticated `/api/tools/execute`. |
| `calculator` | `safeCalc` | Real (safe recursive-descent parser, no `eval`). |
| Agent `tools[]` / custom-agent tool permissions | builder + API | Stored and exported, **never executed** in live mode. Labels only. |
| Landing deck "Training" status | `AgentDeck` | Explicitly a preview of the three states; the workspace only shows Active while really streaming. OK. |
| Workflow "research" steps | `workflows.js` | Honest: told they have no web access and to flag what to verify. |

## 5. Missing functionality (relative to the 12-phase brief)

No accounts, sessions, roles, workspaces or teams · no database · no persisted conversations, projects, files or
memory · no per-agent provider/model selection · no usage/token accounting · no execution records or execution
states · no tool registry or real tools · no orchestrator (planner, DAG, parallelism, retries, approvals) · no
background jobs · no visual workflow editor · no integrations or webhooks · no Command Center metrics · no
notifications · no billing · no audit log · no server-side tests · no API versioning or OpenAPI document.

## 6. Security review

| # | Finding | Severity | Plan |
| --- | --- | --- | --- |
| S1 | `cors()` allows every origin | Medium (no cookies today; becomes High once sessions exist) | Phase 0: explicit allowlist via `CORS_ORIGINS`; same-origin by default |
| S2 | No security headers (CSP, frame-ancestors, nosniff, HSTS) | Medium | Phase 0: `helmet` with a CSP that fits the SPA |
| S3 | Rate limiter is per instance and in memory | Medium (cost exposure in live mode) | Phase 0: keep as a speed bump; Phase 5/11: Redis-backed limiter; document host firewall rules |
| S4 | `/api/tools/execute` is public and returns fake success for email/tickets | Medium (misleading) | Phase 0: remove from the public API; Phase 4 replaces it with a permissioned tool registry |
| S5 | Anyone can spend the model budget (no auth) | High for live deployments | Phase 2 auth + Phase 10 plan limits; until then documented spending caps |
| S6 | Chat history is supplied by the client and trusted | Low (stateless design; a user can only fool their own session) | Phase 2: server-side conversations for signed-in users |
| S7 | Custom agent system prompts accepted from the client | Low (validated length/type) | Phase 2/3: custom agents stored server-side and referenced by id |
| S8 | No structured logging / request ids; provider errors logged with `console` | Low | Phase 0: pino with redaction of secrets and auth headers |
| S9 | Error responses are ad hoc | Low | Phase 0: central error handler with a consistent `{ error: { code, message, requestId } }` shape |
| S10 | Dev-tool advisories (esbuild dev server CORS, vitest) | Low (dev only) | Upgrade Vite/Vitest in a dedicated change; do not expose the dev server |

Good practices already present: Gemini key sent in a header; system prompts never sent to the browser; strict input
length limits; Markdown sanitised with DOMPurify; `x-powered-by` disabled; JSON body limit 1 MB; graceful
SIGTERM shutdown; no secrets in the repository.

## 7. Performance review

* `shaders` chunk is 810 KB (Three.js); it is lazy and loaded after first paint, and the landing below-fold content
  is a separate chunk. The main bundle is 490 KB (162 KB gzip) — acceptable, but the new app shell must lazy-load
  its pages so the workspace does not pay for modules it does not show.
* The 3D swarm also renders behind the workspace (capped at 30 fps, tiered). New data-heavy pages should keep the
  static fallback option and avoid backdrop blur over animating canvases on `low` tier (already handled by CSS).
* Server: no N+1 concerns yet (no DB). Each chat is one upstream stream; workflows are sequential.

## 8. Technical debt

* `server.js` mixes config, registry, providers, rate limiting, workflow engine and routes in one file.
* JavaScript backend with no types while the frontend is strict TypeScript; `ChatRequest`/`ServerEvent` contracts are
  duplicated by hand on both sides.
* `App.tsx` (331 lines) owns data loading, settings, selection, dialogs, import/export and the palette.
* Only two views; the hash router cannot express nested pages.
* README describes some behaviour (e.g. demo fallback) that later phases will change; docs must move with the code.

## 9. Database requirements

All entities in the brief need relational storage with strict tenant (workspace) isolation, plus vector search for
memory retrieval. PostgreSQL 16 with `pgvector` covers both; Prisma provides migrations and typed access. See
[`DATABASE_DESIGN.md`](./DATABASE_DESIGN.md).

## 10. Integration requirements

Gemini and OpenAI are already integrated (keys via env). Everything else (Google, GitHub, Slack, webhooks, email,
object storage, payments) needs credentials the repository does not have. Each will be built behind an adapter,
marked **awaiting configuration** until real credentials are provided and tested — never shown as connected.

## 11. Recommended implementation architecture

**Modular monolith**, TypeScript end to end, one deployable API process plus an optional worker process:

```
server/src/
  config/        env parsing + validation (zod), feature flags derived from what is configured
  lib/           logger (pino), errors, http helpers, SSE writer
  middleware/    request id, security headers, CORS allowlist, rate limiting, error handler, auth context
  modules/
    agents/      registry (built-in) + custom agents (DB) + versions
    workflows/   definitions + execution
    chat/        conversation + streaming endpoint
    providers/   ProviderAdapter interface: openai, gemini, demo (capabilities, streaming, usage)
    auth/        Better Auth wiring (Phase 2)
    workspaces/  membership + RBAC (Phase 2)
    ...          executions, tools, orchestrator, projects, memory, integrations, billing (later phases)
  db/            Prisma client (only when DATABASE_URL is set)
  app.ts         builds the Express app (used by server.js, Vercel, tests)
  index.ts       listens + graceful shutdown
```

Key decisions:

1. **Backend moves to TypeScript ESM.** Better Auth (the preferred auth library) is ESM-only, and typed contracts can
   then be shared with the client. Compiled with `tsc` to `server/dist`; `server.js` stays the entry point.
2. **Database is optional at runtime.** Without `DATABASE_URL` the app keeps working exactly as today (guest mode,
   demo or live AI, local custom agents). Account features answer `503 FEATURE_UNAVAILABLE` and the UI says why.
   This preserves the zero-config Vercel deployment while enabling the full platform when Postgres is configured.
3. **API versioning**: new routes under `/api/v1`. Existing `/api/*` paths stay as aliases so deployed clients and the
   e2e suites keep working.
4. **No Supabase**, per the brief. Postgres + Prisma, Better Auth, BullMQ + Redis, S3-compatible storage.

## 12. Migration strategy

1. Port `server.js` to TypeScript modules with behaviour-identical tests (server integration tests + the two e2e
   suites) before adding features. Keep every existing URL.
2. Introduce the database additively: migrations create new tables only; there is no existing data to migrate.
3. Move custom agents from `localStorage` to the database on first sign-in (explicit "import my local agents" action,
   never silent), keeping `localStorage` as the guest store.
4. Each later phase lands behind configuration (DB, Redis, storage, provider keys) so partial deployments degrade
   to clearly labelled "not configured" states instead of breaking.
