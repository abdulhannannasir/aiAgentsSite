# AgentVerse — Database Design

PostgreSQL 16, accessed through Prisma 7 (`@prisma/adapter-pg`). Schema source: `prisma/schema.prisma`.
Migrations: `prisma/migrations/*` (applied with `prisma migrate deploy`; never `db push` in production).

## Principles

* **Tenant = workspace.** Every business row carries `workspaceId` and every query filters by it. The id comes
  from the authenticated session's active membership, never from the request body.
* Ids are `text` (cuid/uuid strings) — Better Auth generates its own ids and we keep one convention.
* Every table has `createdAt`; mutable tables have `updatedAt`. Soft delete only where history matters
  (`archivedAt` on projects, `deletedAt` on agents that have executions).
* Foreign keys always declared; `onDelete: Cascade` from workspace → its data, `Restrict` where an execution must
  keep pointing at the agent version it used.
* Secrets (integration credentials) are stored encrypted (AES-256-GCM, key from `ENCRYPTION_KEY`), never in plain text.
* Usage and audit tables are append-only.

## Entity overview

```
User ─┬─ Session            (Better Auth)
      ├─ Account            (Better Auth: credentials / OAuth)
      ├─ Member ── Workspace (Better Auth organization plugin; role owner|admin|member)
      └─ Notification
Verification                (Better Auth: email verification + password reset tokens)
Invitation ── Workspace

Workspace ─┬─ Agent ── AgentVersion ── AgentExecution ── ExecutionLog
           │     └─ AgentFavorite, AgentReview
           ├─ Conversation ── Message
           ├─ Project ── ProjectFile
           ├─ Workflow ── WorkflowVersion (graph: nodes + edges JSON) ── WorkflowExecution ── Task
           ├─ MemoryRecord (pgvector embedding)
           ├─ Integration ── ApiCredential (encrypted)
           ├─ UsageRecord
           ├─ Subscription ── Invoice
           └─ AuditLog
```

## Phase 2 tables (implemented first)

| Model | Key columns | Constraints / indexes |
| --- | --- | --- |
| `User` | id, name, email, emailVerified, image, role (`user`/`admin`/`superadmin`), banned, createdAt | `email` unique |
| `Session` | id, token, userId, expiresAt, ipAddress, userAgent, activeOrganizationId | `token` unique, idx userId |
| `Account` | id, userId, providerId, accountId, password (scrypt hash), tokens | idx userId |
| `Verification` | id, identifier, value, expiresAt | idx identifier |
| `Workspace` (`organization`) | id, name, slug, logo, metadata, createdAt | `slug` unique |
| `Member` | id, organizationId, userId, role, createdAt | unique (organizationId, userId) |
| `Invitation` | id, organizationId, email, role, status, expiresAt, inviterId | idx organizationId |
| `Agent` | id, workspaceId?, slug, name, description, icon, category, tags[], visibility (`system`/`private`/`workspace`), isSystem, currentVersionId, createdById, deletedAt | unique (workspaceId, slug); idx (workspaceId, deletedAt) |
| `AgentVersion` | id, agentId, version, systemPrompt, provider, model, temperature, tools[], config JSON, createdById, createdAt | unique (agentId, version); immutable |
| `Conversation` | id, workspaceId, userId, agentId?, agentVersionId?, workflowId?, title, createdAt, updatedAt | idx (workspaceId, userId, updatedAt desc) |
| `Message` | id, conversationId, role, content, status, trace JSON, executionId?, createdAt | idx (conversationId, createdAt) |
| `AgentExecution` | id, workspaceId, userId, agentId?, agentVersionId?, conversationId?, status, provider, model, input, output, error, inputTokens, outputTokens, usageEstimated, startedAt, endedAt | idx (workspaceId, createdAt desc), idx (workspaceId, status) |
| `UsageRecord` | id, workspaceId, userId?, kind (`ai_request`/`tokens`/`workflow_run`/`storage`/…), quantity, provider, model, executionId?, occurredAt | idx (workspaceId, kind, occurredAt) |
| `AuditLog` | id, workspaceId?, actorId?, action, targetType, targetId, metadata JSON, ip, createdAt | idx (workspaceId, createdAt desc) |
| `Notification` | id, userId, workspaceId?, kind, title, body, link, readAt, createdAt | idx (userId, readAt, createdAt desc) |

Implementation note: the Prisma models keep Better Auth's names (`User`, `Session`, `Account`, `Verification`,
`Organization`, `Member`, `Invitation`) and map them to plural snake_case tables (`users`, `workspaces`,
`workspace_members`, `workspace_invitations`, …), so the auth library and the domain share one schema and one migration
history. The custom-agent domain model is `Agent` (one row per agent, `visibility` PRIVATE | WORKSPACE) +
`AgentVersion`; `Conversation.agentKey` is the built-in agent id or `custom:<agentId>`. Migration:
`prisma/migrations/20261108213506_init`.

## Later-phase tables (added in their phase's migration)

| Phase | Models |
| --- | --- |
| 3 ✅ | `AgentFavorite` (unique userId+agentKey), `AgentReview` (rating 1–5, unique userId+agentKey) — migration `20261109003328_marketplace`, plus an index on `agent_executions(agentKey, createdAt)` for usage stats. Built-in agents stay defined in code and are referenced by `agentKey`; they are not copied into the database. |
| 4 ✅ | `ToolInvocation` (executionId, toolId, input JSON, status SUCCEEDED/FAILED, summary, durationMs) — migration `20261111090513_tool_invocations`. Token counts live on `AgentExecution` and as `INPUT_TOKENS`/`OUTPUT_TOKENS` usage records (only when the provider reports them). A separate `ExecutionLog` table was not needed yet; structured logs carry the per-call detail. |
| 5 | `Task` (workflowExecutionId/executionId, parentId, agentId, status, dependsOn[], attempt, idempotencyKey unique, result JSON) , `ApprovalRequest` |
| 6 | `Workflow`, `WorkflowVersion` (graph JSON validated by zod), `WorkflowExecution`, `WorkflowNodeRun` |
| 7 | `Project`, `ProjectMember`, `ProjectFile` (storageKey, mime, size, sha256, extractedText), `MemoryRecord` (scope enum user/project/conversation/agent/knowledge, content, embedding `vector(1536)`, sourceId, expiresAt) with HNSW index |
| 8 | `Integration` (provider, status, scopes[], lastCheckedAt, error), `ApiCredential` (ciphertext, iv, tag, keyVersion), `Webhook`, `WebhookDelivery` |
| 10 | `Plan` (limits JSON, prices), `Subscription` (provider, externalId unique, status, periodEnd), `Invoice` |

## Workspace isolation checklist

1. Repository functions take `workspaceId` as a required first argument — there are no unscoped finders.
2. Integration tests create two workspaces and assert every read/write endpoint rejects cross-workspace ids (404,
   not 403, so ids do not leak existence).
3. Postgres row-level security can be layered on later (Phase 11) as defence in depth.

## Backups and destructive changes

* Managed Postgres with daily snapshots + PITR (Railway/Neon/RDS).
* Migrations are additive by default. Any destructive migration ships with a written plan, a backup step and owner
  approval (see `PRODUCTION_CHECKLIST.md`, Phase 11).
