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

### Later phases (shape reserved)

`/api/v1/executions` (list, get, cancel, events SSE) · `/api/v1/tools` · `/api/v1/orchestrations` ·
`/api/v1/workflows/:id/versions`, `/runs` · `/api/v1/projects`, `/files` · `/api/v1/memory` ·
`/api/v1/integrations` · `/api/v1/webhooks/in/:id` · `/api/v1/notifications` · `/api/v1/analytics/*` ·
`/api/v1/billing/*`.

## OpenAPI

An OpenAPI 3.1 document is generated from the zod schemas and served at `/api/v1/openapi.json` once the route set
stabilises (Phase 2). Until then this file is the contract.
