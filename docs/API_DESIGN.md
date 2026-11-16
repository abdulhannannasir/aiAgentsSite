# AgentVerse — API Design

## Conventions

* Base path **`/api/v1`**. The original unversioned paths (`/api/health`, `/api/agents`, `/api/workflows`,
  `/api/chat`) remain as aliases of their v1 equivalents so existing clients keep working.
* JSON in and out (`Content-Type: application/json`), request bodies validated with zod.
* Streaming endpoints use **Server-Sent Events** (`text/event-stream`), one JSON object per `data:` line.
* Every response carries `X-Request-Id` (taken from the incoming header when it is a safe value, otherwise generated).
* Errors share one shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Message too long (max 4000 characters)", "requestId": "…", "details": {} } }
```

The client helper `errorMessage()` (`client/src/lib/api.ts`) reads `error.message`, and still understands the
older `{ "error": "text" }` shape.

| HTTP | code | When |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | body/query fails validation |
| 401 | `UNAUTHENTICATED` | no valid session (Phase 2+) |
| 403 | `FORBIDDEN` | authenticated but not allowed |
| 404 | `NOT_FOUND` | unknown resource, or a resource in another workspace |
| 409 | `CONFLICT` | unique constraint, version conflict |
| 429 | `RATE_LIMITED` | with `Retry-After` |
| 503 | `FEATURE_UNAVAILABLE` | the feature needs configuration that is missing (e.g. `DATABASE_URL`) |
| 500 | `INTERNAL` | unexpected; details only in logs |

## Endpoints

### Platform

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/healthz` | – | liveness, plain `ok` |
| GET | `/api/v1/health` | – | `{ ok, mode, provider, agents }` (unchanged shape) |
| GET | `/api/v1/meta` | – | what is configured: providers, database, auth, email, redis, storage — booleans only, never values |

### Agents and workflows (Phase 0, public)

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/v1/agents` | built-in agents (public fields, no prompts) |
| GET | `/api/v1/agents/:id` | one agent |
| GET | `/api/v1/workflows` | the 4 workflows with resolved step agents |

### Chat (Phase 0, public; persisted for signed-in users from Phase 2)

`POST /api/v1/chat`

```ts
{
  message: string;                       // 1..4000 chars
  history?: { role: 'user' | 'assistant'; content: string }[]; // last 20, 8000 chars each
  // exactly one of:
  agentId?: string;                      // built-in agent
  agent?: { name; description?; systemPrompt; temperature?; tools? };  // ad-hoc custom agent (guest mode)
  workflowId?: string;                   // multi-agent workflow
}
```

SSE events (unchanged from the baseline, typed in `server/src/contracts.ts` and imported by the client):

| type | payload |
| --- | --- |
| `plan` | `{ workflowId, steps: [{ id, agentName, agentIcon, role, label, status }] }` |
| `step` | `{ id, status: pending|active|complete|error, error? }` |
| `step_delta` | `{ id, content }` — text of an intermediate workflow step |
| `stream` | `{ content }` — answer text |
| `error` | `{ content }` — user-safe message |
| `done` | `{ message: { role: 'assistant', content } | null }` |

### Phase 2 (auth, workspaces, persistence) — implemented

| Method | Path | Description |
| --- | --- | --- |
| * | `/api/auth/*` | Better Auth: sign-up/email, sign-in/email, sign-out, get-session, verify-email, request-password-reset, reset-password, organization/* |
| GET | `/api/v1/me` | user, memberships, active workspace, role |
| GET/POST | `/api/v1/workspaces` | list / create |
| POST | `/api/v1/workspaces/:id/activate` | set active workspace on the session |
| GET/POST | `/api/v1/custom-agents` | list (workspace agents + your private ones) / create |
| GET/PATCH/DELETE | `/api/v1/custom-agents/:id` | read / update (a config change creates a new version; creator or workspace admin/owner) / delete |
| GET | `/api/v1/custom-agents/:id/versions` | version history |
| POST | `/api/v1/custom-agents/import` | bulk import, all or nothing (1–30 agents, validated like agent files) |
| GET | `/api/v1/conversations` | list (workspace + user scoped) |
| GET/DELETE | `/api/v1/conversations/:id` | messages / delete |

When signed in, `POST /api/v1/chat` also accepts `customAgentId`, `conversationId` and `threadKey` (the built-in agent
id or `custom:<id>` the thread belongs to). The server saves the conversation, sends a first SSE event
`{ "type": "conversation", "id" }`, loads history from the database instead of trusting the client, and records an
`AgentExecution` (status, provider, model, model calls, agent version) and `UsageRecord`s. A conversation id from
another user or workspace — or for a different agent — is a 404.

Security: state-changing requests that carry a session cookie must come from `BETTER_AUTH_URL`, `CORS_ORIGINS` or
the same host (403 otherwise); Better Auth applies the same origin check to `/api/auth/*` and rate-limits sign-in /
sign-up (3 per 10 s per IP) and reset / verification emails (3 per minute), answering 429 with `X-Retry-After`.

### Phase 3 (marketplace) — implemented

`GET /api/v1/agents/:id` now also returns `examples` (example prompts) and `workflows` (ids of workflows using the agent).
The marketplace needs a database; without one these answer 503 `FEATURE_UNAVAILABLE` (the client checks
`/meta` first and does not call them).

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/v1/marketplace/agents` | – | per built-in agent: `runsTotal`, `runs30d`, `successRate`, `rating`, `reviewCount` (+ `favorite` when signed in). Computed from recorded single-agent runs and reviews only. |
| GET | `/api/v1/marketplace/agents/:id` | – | `stats`, latest 20 `reviews` (author shown as first name + last initial), and for signed-in users `me`: runs, `canReview`, own review, own recent conversations in the workspace |
| PUT / DELETE | `/api/v1/marketplace/agents/:id/review` | ✓ | `{ rating: 1-5 integer, comment?: ≤1000 }`; one per user per agent; only after the user has run the agent (403 otherwise) |
| GET | `/api/v1/marketplace/favorites` | ✓ | favorite agent keys |
| PUT / DELETE | `/api/v1/marketplace/favorites/:key` | ✓ | `key` = built-in id or `custom:<id>` of a saved agent you can see (404 otherwise); idempotent |
| GET | `/api/v1/custom-agents/:id/versions` | ✓ | (Phase 2) now shown in the UI as version history |

### Phase 4 (execution engine) — implemented

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/v1/models` | – | `{ default, providers: [{ id, label, configured, models: [{ id, isDefault, capabilities }] }] }` — the models a saved agent may be pinned to |
| GET | `/api/v1/tools` | – | every tool with `available` and, if not, the `reason` |
| GET | `/api/v1/executions` | ✓ | `?status=&limit=&before=`; members see their own runs, owners/admins the workspace's |
| GET | `/api/v1/executions/:id` | ✓ | input, output, provider/model, agent version, model calls, tokens, tool invocations, `running` |
| POST | `/api/v1/executions/:id/cancel` | ✓ | starter or admin; 202 when stopped, 409 when already ended or running on another instance |

Saved agents accept `provider` + `model` (both or neither; must be listed in `/models`). Chat SSE gains
`{ type: 'tool', id, tool, label, status: running|done|error, input?, summary?, durationMs? }`, and the signed-in
`conversation` event carries `executionId`. Provider failures arrive as `error` events with a user-safe message.

### Phase 5 (orchestration) — implemented

Needs accounts; without them (or on a serverless host without `REDIS_URL`) these answer 503 `FEATURE_UNAVAILABLE`, and
`GET /meta` reports `orchestration: { available, durable, worker, reason? }`.

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/v1/orchestrations` | `{ goal }` (3–4000 chars). Optional `Idempotency-Key` header (8–100 of `A-Za-z0-9_.:-`): the same key in the workspace returns the same run (`200 { id, created: false }`, `409` if another user used it). `202 { id, created: true }`. 429 when 3 of your runs are in progress. |
| GET | `/api/v1/orchestrations` | latest 30: status, task counts (`total`, `done`, `waitingApproval`), model calls, tokens. Members see their own, owners/admins the workspace's. |
| GET | `/api/v1/orchestrations/:id` | goal, `planSummary`, `taskList` (key, title, agent, instruction, tools, dependsOn, status, attempt, output, error, tool calls, tokens, approval), `output`, `sources` (cited task keys), `durable`, `canManage` |
| POST | `/api/v1/orchestrations/:id/cancel` | starter or admin; 202, 409 when already ended |
| POST | `/api/v1/orchestrations/:id/tasks/:key/retry` | re-runs a FAILED task of a FAILED run and everything skipped because of it; 409 otherwise |
| GET | `/api/v1/approvals?status=PENDING` | approvals inbox (requester's own; owners/admins: workspace) |
| POST | `/api/v1/approvals/:id` | `{ decision: 'approve' \| 'reject', note? }` by the requester or an owner/admin; 409 when already decided |

Run statuses: `PLANNING → RUNNING → SYNTHESIZING → COMPLETED`, or `FAILED` / `CANCELLED`. Task statuses: `PENDING`
(waiting for inputs), `WAITING_APPROVAL`, `QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED` (out of attempts or permanent
error), `SKIPPED` (a dependency did not complete, or the approval was rejected), `CANCELLED`. Clients poll `GET /:id`
while a run is active (an SSE event bus arrives with Phase 9).

### Phase 6 (workflow studio) — implemented

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/v1/studio/node-types` | – | step types (with availability and reasons), agents, tools, and the validation context |
| GET | `/api/v1/studio/templates` | – | 6 template graphs (+ their validation issues) |
| POST | `/api/v1/studio/validate` | – | `{ graph }` → `{ graph, issues: [{ severity, message, nodeId?, edgeId? }] }` |
| GET / POST | `/api/v1/studio/workflows` | ✓ | list (workspace) / create `{ name, description?, templateId? \| graph? }` → version 1 |
| GET / PATCH / DELETE | `/api/v1/studio/workflows/:id` | ✓ | latest version with issues / rename / soft delete (creator or admin) |
| GET / POST | `/api/v1/studio/workflows/:id/versions` | ✓ | history / save `{ graph, note?, baseVersion? }` (409 when `baseVersion` is not the latest; drafts with errors allowed, `valid: false`) |
| GET | `/api/v1/studio/workflows/:id/versions/:v` | ✓ | one version |
| POST / GET | `/api/v1/studio/workflows/:id/runs` | ✓ | run `{ input, version? }` (`Idempotency-Key`; 400 with the errors if the version is invalid) → an orchestration id; list runs |
| POST | `/api/v1/orchestrations/:id/pause`, `/resume` | ✓ | starter or admin; 409 when not running / not paused |

Graph shape: `{ nodes: [{ id, kind, label, position: { x, y }, config }], edges: [{ id, source, target, sourceHandle?: 'true' \| 'false' }] }`
(max 25 steps, 60 connections). Runs appear in `/api/v1/orchestrations` with `workflow: { id, name, version }`, and each
task carries `kind` and `nodeId`.

### Later phases (shape reserved)

`/api/v1/executions/:id/events` (SSE) ·
`/api/v1/workflows/:id/versions`, `/runs` · `/api/v1/projects`, `/files` · `/api/v1/memory` ·
`/api/v1/integrations` · `/api/v1/webhooks/in/:id` · `/api/v1/notifications` · `/api/v1/analytics/*` ·
`/api/v1/billing/*`.

## OpenAPI

An OpenAPI 3.1 document is generated from the zod schemas and served at `/api/v1/openapi.json` once the route set
stabilises (Phase 2). Until then this file is the contract.
