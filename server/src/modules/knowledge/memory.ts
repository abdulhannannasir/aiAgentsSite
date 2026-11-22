import type { Db } from '../../db/client.js';
import { Prisma } from '../../db/client.js';
import type { Logger } from '../../lib/logger.js';
import { canManage, type WorkspaceRole } from '../../middleware/session.js';
import { cosine, type Embedder } from './embeddings.js';

export type MemoryScopeT = 'USER' | 'PROJECT' | 'AGENT' | 'WORKSPACE';

/** Who is asking. Retrieval only ever returns what this person may see. */
export interface MemoryActor { workspaceId: string; userId: string; role: WorkspaceRole }

/**
 * What a search may look at, already permission-filtered: the person's own memories, the workspace knowledge base,
 * the given projects (ones they can see) and the given agents' memories.
 */
export interface SearchScope {
  workspaceId: string;
  userId: string;
  projectIds: string[];
  agentKeys: string[] | 'all';
  scopes?: MemoryScopeT[];
}

export interface SearchHit {
  id: string; title: string; content: string; scope: MemoryScopeT; source: 'NOTE' | 'FILE';
  projectId: string | null; fileId: string | null; agentKey: string | null; chunkIndex: number;
  score: number; match: 'semantic' | 'keyword' | 'both';
}

/** Projects a person can see: workspace projects, their own private ones, and every project for owners/admins. */
export const projectAccessWhere = (a: MemoryActor): Prisma.ProjectWhereInput => ({
  workspaceId: a.workspaceId,
  ...(canManage(a.role) ? {} : { OR: [{ visibility: 'WORKSPACE' }, { createdById: a.userId }] })
});

export async function accessibleProjectIds(db: Db, a: MemoryActor, opts: { includeArchived?: boolean } = {}): Promise<string[]> {
  const rows = await db.project.findMany({ where: { ...projectAccessWhere(a), ...(opts.includeArchived ? {} : { archivedAt: null }) }, select: { id: true } });
  return rows.map(r => r.id);
}

/** The visibility rule as a Prisma filter (lists) … */
export function visibleWhere(s: SearchScope): Prisma.MemoryRecordWhereInput {
  const want = (k: MemoryScopeT) => !s.scopes || s.scopes.includes(k);
  const or: Prisma.MemoryRecordWhereInput[] = [];
  if (want('USER')) or.push({ scope: 'USER', userId: s.userId });
  if (want('WORKSPACE')) or.push({ scope: 'WORKSPACE' });
  if (want('PROJECT') && s.projectIds.length) or.push({ scope: 'PROJECT', projectId: { in: s.projectIds } });
  if (want('AGENT') && (s.agentKeys === 'all' || s.agentKeys.length)) or.push({ scope: 'AGENT', ...(s.agentKeys === 'all' ? {} : { agentKey: { in: s.agentKeys } }) });
  return {
    workspaceId: s.workspaceId,
    AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, { OR: or.length ? or : [{ id: '__none__' }] }]
  };
}

/** … and the same rule as SQL (ranked searches). */
function visibleSql(s: SearchScope): Prisma.Sql {
  const want = (k: MemoryScopeT) => !s.scopes || s.scopes.includes(k);
  const or: Prisma.Sql[] = [];
  if (want('USER')) or.push(Prisma.sql`(scope = 'USER' AND "userId" = ${s.userId})`);
  if (want('WORKSPACE')) or.push(Prisma.sql`scope = 'WORKSPACE'`);
  if (want('PROJECT') && s.projectIds.length) or.push(Prisma.sql`(scope = 'PROJECT' AND "projectId" IN (${Prisma.join(s.projectIds)}))`);
  const agents = s.agentKeys;
  if (want('AGENT') && agents === 'all') or.push(Prisma.sql`scope = 'AGENT'`);
  else if (want('AGENT') && agents !== 'all' && agents.length) or.push(Prisma.sql`(scope = 'AGENT' AND "agentKey" IN (${Prisma.join(agents)}))`);
  return Prisma.sql`"workspaceId" = ${s.workspaceId} AND ("expiresAt" IS NULL OR "expiresAt" > now()) AND (${or.length ? Prisma.join(or, ' OR ') : Prisma.sql`false`})`;
}

/** Below this cosine similarity a semantic match is noise, not a match. */
export const MIN_SEMANTIC_SCORE = 0.25;
/** The in-app fallback compares against at most this many of the newest visible records. */
const IN_APP_CANDIDATES = 5000;

export interface MemoryService {
  readonly embedder: Embedder | null;
  /** 'pgvector' when the extension is installed in the database, else 'in-app' (or 'none' without embeddings). */
  vectorMode(): Promise<'pgvector' | 'in-app' | 'none'>;
  embed(texts: string[], actor: MemoryActor | null): Promise<{ vectors: number[][] | null; error?: string }>;
  search(scope: SearchScope, query: string, opts?: { limit?: number; actor?: MemoryActor }): Promise<{ hits: SearchHit[]; semantic: boolean; semanticError?: string }>;
}

export function createMemoryService(deps: { db: Db; embedder: Embedder | null; log: Logger }): MemoryService {
  const { db, embedder, log } = deps;
  let pgvector: { value: boolean; at: number } | null = null;

  const hasPgvector = async () => {
    if (pgvector && Date.now() - pgvector.at < 5 * 60_000) return pgvector.value;
    const rows = await db.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok FROM pg_extension WHERE extname = 'vector'`;
    pgvector = { value: rows.length > 0, at: Date.now() };
    return pgvector.value;
  };

  /** Embedding calls are metered like model calls (tokens only when the provider reports them). */
  const meter = async (actor: MemoryActor | null, calls: number, tokens: number | null) => {
    if (!actor || !embedder) return;
    const base = { workspaceId: actor.workspaceId, userId: actor.userId, provider: embedder.provider, model: embedder.model };
    await db.usageRecord.createMany({
      data: [{ ...base, kind: 'AI_REQUEST', quantity: calls }, ...(tokens != null ? [{ ...base, kind: 'INPUT_TOKENS' as const, quantity: tokens }] : [])]
    }).catch(err => log.warn({ err: err instanceof Error ? err.message : String(err) }, 'could not record embedding usage'));
  };

  const service: MemoryService = {
    embedder,
    async vectorMode() { return !embedder ? 'none' : (await hasPgvector()) ? 'pgvector' : 'in-app'; },

    async embed(texts, actor) {
      if (!embedder || !texts.length) return { vectors: null, error: embedder ? undefined : 'No embedding provider is configured.' };
      try {
        const r = await embedder.embed(texts);
        await meter(actor, Math.ceil(texts.length / 64), r.tokens);
        return { vectors: r.vectors };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn({ err: msg }, 'embedding failed');
        return { vectors: null, error: msg };
      }
    },

    async search(scope, query, opts = {}) {
      const limit = Math.max(1, Math.min(20, opts.limit ?? 8));
      const q = query.trim().slice(0, 1000);
      if (!q) return { hits: [], semantic: false };
      const vis = visibleSql(scope);

      // Keyword: PostgreSQL full-text search (index memory_records_fts_idx), then a substring fallback for word parts.
      type Row = { id: string; score: number };
      let keyword = await db.$queryRaw<Row[]>`
        SELECT id, ts_rank(to_tsvector('simple', "title" || ' ' || "content"), q)::float8 AS score
        FROM memory_records, websearch_to_tsquery('simple', ${q}) q
        WHERE ${vis} AND to_tsvector('simple', "title" || ' ' || "content") @@ q
        ORDER BY score DESC LIMIT ${limit}`;
      if (!keyword.length) {
        const terms = [...new Set(q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(t => t.length >= 3))].slice(0, 6);
        if (terms.length) {
          const likes = Prisma.join(terms.map(t => Prisma.sql`("title" || ' ' || "content") ILIKE ${`%${t.replace(/[%_\\]/g, '\\$&')}%`}`), ' OR ');
          keyword = await db.$queryRaw<Row[]>`SELECT id, 0.05::float8 AS score FROM memory_records WHERE ${vis} AND (${likes}) ORDER BY "updatedAt" DESC LIMIT ${limit}`;
        }
      }

      // Semantic: only against records embedded by the same model (same vector space and size).
      let semantic: Row[] = [];
      let semanticError: string | undefined;
      if (embedder) {
        const e = await service.embed([q], opts.actor ?? null);
        if (!e.vectors) semanticError = e.error;
        else {
          const v = e.vectors[0];
          const dims = v.length;
          if (Number.isInteger(dims) && dims > 0 && dims <= 4096 && await hasPgvector()) {
            const lit = `[${v.join(',')}]`;
            const d = Prisma.raw(String(dims));
            semantic = await db.$queryRaw<Row[]>`
              SELECT id, (1 - ("embedding"::vector(${d}) <=> ${lit}::vector(${d})))::float8 AS score
              FROM memory_records
              WHERE ${vis} AND "embeddingModel" = ${embedder.model} AND cardinality("embedding") = ${dims}
              ORDER BY "embedding"::vector(${d}) <=> ${lit}::vector(${d}) LIMIT ${limit}`;
          } else {
            const rows = await db.memoryRecord.findMany({
              where: { ...visibleWhere(scope), embeddingModel: embedder.model }, orderBy: { updatedAt: 'desc' }, take: IN_APP_CANDIDATES,
              select: { id: true, embedding: true }
            });
            semantic = rows.map(r => ({ id: r.id, score: cosine(r.embedding, v) })).sort((a, b) => b.score - a.score).slice(0, limit);
          }
          semantic = semantic.filter(r => r.score >= MIN_SEMANTIC_SCORE);
        }
      }

      // Reciprocal rank fusion of the two lists; each hit says how it matched.
      const fused = new Map<string, { rrf: number; score: number; s: boolean; k: boolean }>();
      semantic.forEach((r, i) => fused.set(r.id, { rrf: 1 / (60 + i), score: r.score, s: true, k: false }));
      keyword.forEach((r, i) => {
        const f = fused.get(r.id);
        if (f) { f.rrf += 1 / (60 + i); f.k = true; } else fused.set(r.id, { rrf: 1 / (60 + i), score: r.score, s: false, k: true });
      });
      const ids = [...fused.entries()].sort((a, b) => b[1].rrf - a[1].rrf).slice(0, limit).map(([id]) => id);
      const records = await db.memoryRecord.findMany({ where: { id: { in: ids } } });
      const byId = new Map(records.map(r => [r.id, r]));
      const hits: SearchHit[] = ids.filter(id => byId.has(id)).map(id => {
        const r = byId.get(id)!, f = fused.get(id)!;
        return {
          id, title: r.title, content: r.content, scope: r.scope, source: r.source, projectId: r.projectId, fileId: r.fileId, agentKey: r.agentKey,
          chunkIndex: r.chunkIndex, score: Math.round(f.score * 1000) / 1000, match: f.s && f.k ? 'both' : f.s ? 'semantic' : 'keyword'
        };
      });
      return { hits, semantic: !!embedder && !semanticError, ...(semanticError && { semanticError }) };
    }
  };
  return service;
}

/**
 * A search function for one caller and scope, as given to the knowledge tool: ranked hits assembled into a bounded,
 * labelled context. The scope is fixed by the server, so a model cannot widen what it can read.
 */
export function knowledgeSearcher(memory: MemoryService, scope: SearchScope, actor: MemoryActor | null, maxChars = 5000): (query: string) => Promise<string> {
  return async query => {
    const r = await memory.search(scope, query, { limit: 6, actor: actor ?? undefined });
    const ctx = assembleContext(r.hits, maxChars);
    if (!ctx.sources.length) return '';
    return ctx.text + (r.semantic ? '' : '\n\n(Keyword matching only: semantic search is not available right now.)');
  };
}

export interface ContextSource { ref: string; id: string; title: string; scope: MemoryScopeT; source: 'NOTE' | 'FILE'; fileId: string | null; projectId: string | null }

/**
 * Builds the context handed to a model: the best hits, each labelled [K1], [K2]… with where it came from, cut to a
 * character budget so retrieval can never flood the prompt. Returns the sources so answers can be attributed.
 */
export function assembleContext(hits: SearchHit[], maxChars = 6000): { text: string; sources: ContextSource[] } {
  const parts: string[] = [];
  const sources: ContextSource[] = [];
  let used = 0;
  for (const h of hits) {
    const ref = `K${sources.length + 1}`;
    const head = `[${ref}] ${h.title} (${h.source === 'FILE' ? `file, part ${h.chunkIndex + 1}` : 'note'}, ${h.scope.toLowerCase()} memory)`;
    const sep = parts.length ? 2 : 0; // the blank line between passages
    const room = maxChars - used - sep - head.length - 1;
    if (room < 200) break;
    const body = h.content.length > room ? `${h.content.slice(0, room - 1)}…` : h.content;
    parts.push(`${head}\n${body}`);
    used += sep + head.length + 1 + body.length;
    sources.push({ ref, id: h.id, title: h.title, scope: h.scope, source: h.source, fileId: h.fileId, projectId: h.projectId });
  }
  return { text: parts.join('\n\n'), sources };
}
