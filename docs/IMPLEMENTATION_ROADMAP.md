# AgentVerse — Implementation Roadmap

The brief lists Phase 0 to Phase 11 (twelve phases). They are implemented in order. Each phase ends with type
checks, unit/integration tests, both browser e2e suites, a production build, a docs update and a commit
`phase-N: …`. Live status is tracked in [`PHASE_PROGRESS.md`](./PHASE_PROGRESS.md).

Ground rules for every phase: preserve the features listed in the audit §3; no fake buttons, integrations, metrics
or tool results; anything needing credentials ships as **awaiting configuration**; no Supabase.

---

## Phase 0 — Audit and architecture foundation

* **Objectives**: audit; stabilise; move the backend to a typed modular monolith without changing behaviour.
* **Preserve**: every `/api/*` URL and SSE event shape; Gemini retry semantics; demo mode; Vercel CDN layout.
* **Files**: `server.js` (becomes a thin entry), new `server/src/**`, `api/[...path].js`, `package.json`, `tsconfig*`,
  `Dockerfile`, `vercel.json`, docs.
* **New**: config validation (zod), pino logger with redaction, request ids, central error handler, helmet,
  CORS allowlist, `/api/v1` prefix (+ `/api` aliases), provider adapter interface (openai / gemini / demo),
  server integration tests with mocked upstreams.
* **DB/API changes**: none / additive (`/api/v1/*`, `/api/v1/meta`). `/api/tools/execute` removed (fake).
* **Security**: S1, S2, S4, S8, S9 from the audit.
* **Tests**: server tests for health, agents, workflows, chat validation, SSE streaming, Gemini fallback chain,
  workflow failure semantics, rate limit, CORS, headers.
* **Acceptance**: build + all suites green; behaviour identical from the browser's point of view.

## Phase 1 — UI architecture and design system

* **Objectives**: an application shell for the platform without losing the existing identity.
* **Preserve**: landing page and 3D effects; workspace chat; palette; shortcuts; theme; e2e selectors.
* **Files**: `client/src/App.tsx` (split), new `client/src/app/**` (shell, router, pages), `client/src/components/ui/**`.
* **New**: router with nested routes (`#/app/...`), collapsible sidebar, top bar with search/palette, profile menu,
  notification entry, workspace selector, responsive mobile nav, pages: Command Center, Discover Agents, My Agents,
  Agent Builder, Workflows, Chat, Settings, plus honest "not available yet" pages for modules of later phases
  (Projects, Memory, Integrations, Activity, Analytics, Billing) that say which phase delivers them.
* **Design system**: Button, IconButton, Card, Badge, StatusDot, Tabs, Dropdown, Drawer, Tooltip, Field/Input/Select,
  Table, EmptyState, ErrorState, Skeleton/Spinner, PageHeader, ProgressBar. Tokens stay in `index.css`.
* **Tests**: unit tests for routing; e2e for every route (no broken routes), keyboard nav, mobile nav, no overflow.
* **Acceptance**: consistent shell, responsive, no dead buttons, both e2e suites green.

## Phase 2 — Authentication, database and user management

* **Objectives**: accounts and persistence.
* **New deps**: `prisma`, `@prisma/client`, `@prisma/adapter-pg`, `pg`, `better-auth`.
* **DB**: full schema in [`DATABASE_DESIGN.md`](./DATABASE_DESIGN.md) — auth tables, workspaces, members, roles,
  agents + versions, conversations + messages, executions, usage, audit log, notifications; tables for later phases
  are added in their phase's migration.
* **Auth**: Better Auth email + password, email verification, password reset, sessions in Postgres, httpOnly cookies,
  organization plugin → workspaces (owner/admin/member), admin plugin → platform roles (user/admin/superadmin).
  Free/Paid are plan entitlements (Phase 10), not roles. Mailer adapter (SMTP) — logs links in development,
  **awaiting configuration** in production until SMTP is set.
* **API**: `/api/auth/*` (Better Auth), `/api/v1/me`, `/api/v1/workspaces/*`, `/api/v1/agents` CRUD,
  `/api/v1/conversations/*`. Every query is scoped by `workspaceId` from the session's active membership.
* **Frontend**: sign in / sign up / verify / reset pages, protected routes, profile, workspace switcher,
  "import my local agents" action.
* **Security**: server-side authorization middleware, CSRF via SameSite=Lax + Origin checks (Better Auth),
  audit log of auth and membership events.
* **Tests**: integration tests against a real Postgres (skipped when `DATABASE_URL` is absent), cross-workspace
  access tests, e2e sign-up → create agent → reload → still there.
* **Acceptance**: users persist data across logout; no cross-workspace access.

## Phase 3 — Agent marketplace

* Seed the 42 built-in agents into `Agent` rows (`isSystem`), marketplace queries (search, category, tags, sort by
  popularity/rating/recency), agent detail pages, reviews + ratings, favourites, install to workspace, usage stats
  from execution records, custom agent builder extended (provider, model, temperature, tools, memory settings,
  input/output schema, visibility), duplicate/test/publish privately, versioning (`AgentVersion` immutable rows).
* Tests: query filters, version immutability, visibility rules.

## Phase 4 — Real AI execution engine

* Provider registry with capability flags (streaming, tools, structured output, max context), per-agent
  provider/model selection, key validation endpoint, usage + token tracking (provider-reported usage, estimated when
  not reported and marked as such), timeouts, retries, fallback, structured output.
* `AgentExecution` lifecycle: queued → running → waiting_input / waiting_approval → completed / failed / cancelled,
  with logs.
* Tool registry: id, description, zod input/output schema, permission, timeout, audit. Real tools first:
  calculator, URL fetch (SSRF-guarded), knowledge retrieval (Phase 7), web search (when a search API key is set),
  file reading (Phase 7 storage), sandboxed code execution only with a real isolated runtime — otherwise
  disabled and labelled. Email/tickets require an authorised integration (Phase 8).
* Live-mode failures become explicit errors (no demo-text fallback).

## Phase 5 — Multi-agent orchestration

* Planner (LLM structured output → task DAG), dependency resolution, scheduler with concurrency, BullMQ + Redis
  durable jobs (idempotency keys, retries with backoff, dead-letter queue, cancellation, recovery on restart),
  least-privilege context passing, approvals for sensitive tools, result validation and synthesis with provenance.
* Falls back to in-process execution when Redis is not configured (labelled as non-durable).

## Phase 6 — Visual workflow studio

* `@xyflow/react` canvas (zoom, pan, minimap, handles), 15 node types, validation, variable mapping, versions,
  run/pause/resume/cancel/retry through the Phase 5 engine, execution overlay. The 4 existing workflows become
  templates expressed as graphs.

## Phase 7 — Projects, memory and knowledge

* Projects with conversations/agents/workflows/files/activity; S3-compatible storage (R2) with signed URLs;
  document extraction; memory records of 5 scopes with pgvector embeddings; permission-filtered retrieval and
  bounded context assembly with source attribution.

## Phase 8 — Integrations

* Adapter framework (OAuth, scopes, encrypted credentials with AES-256-GCM and key rotation, test/disconnect,
  logs). Order: webhooks (in/out, HMAC), GitHub, Google (Drive/Calendar/Gmail), Slack. Each "connected" only after
  a real API call succeeds.

## Phase 9 — Command Center and activity

* Metrics computed from executions/usage tables, SSE event bus (in-process, Redis pub/sub when available),
  live agent/execution monitors, timelines, approvals inbox, persisted notifications, analytics charts.

## Phase 10 — Billing

* Plans and limits in the database (configurable), entitlement checks in the API, usage metering, payment
  provider abstraction. Provider choice requires verifying merchant eligibility for a Pakistan-based business
  (candidates: Paddle or Lemon Squeezy as merchant of record, 2Checkout/Verifone, PayPro/local gateways; Stripe only
  through an eligible entity) — **decision needs the owner's input**; implementation waits for it.

## Phase 11 — Security, performance, testing, deployment

* Security review of every module, CSP hardening, secrets management, dependency upgrades, load tests for SSE,
  e2e coverage of all flows, observability (structured logs, error monitoring hook), backups and restore runbook,
  Vercel (web) + Railway (API, worker) + managed Postgres/Redis + R2. Docs: DEPLOYMENT, ENVIRONMENT_VARIABLES,
  SECURITY, TESTING, PRODUCTION_CHECKLIST.

---

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Vercel serverless vs. long-running work (workflows, SSE, BullMQ workers) | Phase 5+ cannot run durable jobs inside Vercel functions | Run API + worker on Railway; Vercel keeps static hosting (and optionally the API for light endpoints) |
| Payment provider eligibility in Pakistan | Phase 10 blocked | Provider abstraction; owner decision required |
| Sandboxed code execution | Security exposure if done naively | Only with an isolated runtime (e.g. a remote sandbox service); otherwise the tool stays disabled |
| Model cost exposure | Financial | Auth + per-plan limits + provider spending caps |
| Scope (12 phases) vs. session length | Partial phases | Each session ends with a coherent, tested subset and an updated `PHASE_PROGRESS.md` |
