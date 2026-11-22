import { createHash, randomUUID } from 'node:crypto';
import express, { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { AppConfig } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { HttpError, badRequest, notFound, unavailable } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import { authOf, canManage, requireAuth, type AuthContext } from '../../middleware/session.js';
import type { Platform } from '../../platform.js';
import { findAgent } from '../agents/registry.js';
import { findVisibleAgent } from '../agents/customAgents.js';
import { audit } from '../audit/audit.js';
import { attachmentHeader, downloadType } from '../storage/storage.js';
import { chunkText, extOf, extractText } from './extract.js';
import { accessibleProjectIds, assembleContext, projectAccessWhere, visibleWhere, type MemoryActor, type MemoryScopeT } from './memory.js';

const actorOf = (ctx: AuthContext): MemoryActor => ({ workspaceId: ctx.workspaceId, userId: ctx.user.id, role: ctx.workspaceRole });
const ms = (d: Date | null | undefined) => d?.getTime() ?? null;
const SCOPES = ['USER', 'PROJECT', 'AGENT', 'WORKSPACE'] as const;
const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/i;
const BY_EXT: Record<string, string> = { pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', html: 'text/html', htm: 'text/html', xml: 'application/xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

/** File names are shown, never used as paths: strip control characters and path parts, cap the length. */
export function cleanFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return clean && clean !== '.' && clean !== '..' ? clean : 'file';
}

type ProjectRow = { id: string; name: string; description: string; visibility: 'PRIVATE' | 'WORKSPACE'; createdById: string | null; archivedAt: Date | null; createdAt: Date; updatedAt: Date; createdBy?: { name: string } | null; _count?: { files: number; memories: number; workflows: number; orchestrations: number } };
const projectView = (p: ProjectRow, ctx: AuthContext) => ({
  id: p.id, name: p.name, description: p.description, visibility: p.visibility, archived: !!p.archivedAt, createdBy: p.createdBy?.name ?? null,
  canEdit: p.createdById === ctx.user.id || canManage(ctx.workspaceRole), createdAt: p.createdAt.getTime(), updatedAt: p.updatedAt.getTime(),
  counts: p._count ? { files: p._count.files, memories: p._count.memories, workflows: p._count.workflows, runs: p._count.orchestrations } : undefined
});

type FileRow = { id: string; name: string; mime: string; size: number; status: string; error: string | null; textChars: number | null; chunks: number; createdAt: Date; uploadedBy?: { name: string } | null; projectId: string };
const fileView = (f: FileRow) => ({
  id: f.id, projectId: f.projectId, name: f.name, mime: f.mime, size: f.size, status: f.status, error: f.error, textChars: f.textChars, chunks: f.chunks,
  searchable: f.chunks > 0, uploadedBy: f.uploadedBy?.name ?? null, createdAt: f.createdAt.getTime()
});

type NoteRow = { id: string; scope: MemoryScopeT; title: string; content: string; projectId: string | null; agentKey: string | null; userId: string | null; createdById: string | null; embeddingModel: string | null; expiresAt: Date | null; createdAt: Date; updatedAt: Date; createdBy?: { name: string } | null; project?: { name: string } | null };

const ProjectBody = z.object({
  name: z.string().trim().min(1, 'Give the project a name.').max(80),
  description: z.string().trim().max(1000).optional(),
  visibility: z.enum(['PRIVATE', 'WORKSPACE']).optional()
}).strict();
const ProjectPatch = ProjectBody.partial().extend({ archived: z.boolean().optional() }).strict();
const NoteBody = z.object({
  title: z.string().trim().max(120).optional(),
  content: z.string().trim().min(1, 'Write something to remember.').max(8000),
  scope: z.enum(SCOPES),
  projectId: z.string().max(60).optional(),
  agentKey: z.string().max(80).optional(),
  expiresInDays: z.number().int().min(1).max(3650).nullable().optional()
}).strict();
const NotePatch = NoteBody.pick({ title: true, content: true, expiresInDays: true }).partial().strict();
const SearchBody = z.object({
  query: z.string().trim().min(1).max(1000),
  projectId: z.string().max(60).optional(),
  scopes: z.array(z.enum(SCOPES)).max(4).optional(),
  limit: z.number().int().min(1).max(20).optional()
}).strict();

export function knowledgeRouters(deps: { cfg: AppConfig; platform: Platform; log: Logger }): { projects: Router; memory: Router } {
  const { cfg, platform, log } = deps;
  const db = (): Db => platform.db!;
  const memory = () => platform.memory!;

  /** A project the caller may see (404 otherwise, so ids do not leak). */
  const project = async (ctx: AuthContext, id: string) => {
    const p = await db().project.findFirst({ where: { id, ...projectAccessWhere(actorOf(ctx)) }, include: { createdBy: { select: { name: true } }, _count: { select: { files: true, memories: true, workflows: true, orchestrations: true } } } });
    if (!p) throw notFound('Project not found');
    return p;
  };
  const editable = (ctx: AuthContext, p: { createdById: string | null }) => {
    if (p.createdById !== ctx.user.id && !canManage(ctx.workspaceRole)) throw new HttpError('FORBIDDEN', 'Only the person who created this project, or a workspace admin, can change it.');
  };

  /** Extracts, chunks and indexes a stored file; records why when it cannot be searched. */
  async function indexFile(ctx: AuthContext | null, file: { id: string; workspaceId: string; projectId: string; name: string; mime: string; uploadedById: string | null }, body: Buffer) {
    await db().memoryRecord.deleteMany({ where: { fileId: file.id } });
    let extracted;
    try { extracted = await extractText(body, file.mime, file.name); }
    catch (err) {
      log.warn({ fileId: file.id, err: err instanceof Error ? err.message : String(err) }, 'text extraction crashed');
      return db().projectFile.update({ where: { id: file.id }, data: { status: 'FAILED', error: 'Text could not be extracted from this file.', textChars: null, chunks: 0 }, include: { uploadedBy: { select: { name: true } } } });
    }
    if (!extracted.text) {
      const broken = /could not be read|is not one/.test(extracted.reason ?? '');
      return db().projectFile.update({ where: { id: file.id }, data: { status: broken ? 'FAILED' : 'READY', error: extracted.reason ?? null, textChars: null, chunks: 0 }, include: { uploadedBy: { select: { name: true } } } });
    }
    const chunks = chunkText(extracted.text);
    const e = await memory().embed(chunks, ctx ? actorOf(ctx) : null);
    await db().memoryRecord.createMany({
      data: chunks.map((content, i) => ({
        workspaceId: file.workspaceId, scope: 'PROJECT' as const, projectId: file.projectId, source: 'FILE' as const, fileId: file.id, title: file.name,
        content, chunkIndex: i, embedding: e.vectors?.[i] ?? [], embeddingModel: e.vectors ? memory().embedder!.model : null, createdById: file.uploadedById
      }))
    });
    const note = !memory().embedder ? null : e.vectors ? null : `Indexed for keyword search only: semantic indexing failed (${(e.error ?? 'unknown error').slice(0, 200)}). Use Reindex to try again.`;
    return db().projectFile.update({ where: { id: file.id }, data: { status: 'READY', error: note, textChars: extracted.text.length, chunks: chunks.length }, include: { uploadedBy: { select: { name: true } } } });
  }

  // ------------------------------------------------------------------ projects

  const projects = Router();
  projects.use(requireAuth(platform));

  projects.get('/', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const rows = await db().project.findMany({
        where: { ...projectAccessWhere(actorOf(ctx)), ...(req.query.archived === '1' ? {} : { archivedAt: null }) }, orderBy: { updatedAt: 'desc' }, take: 200,
        include: { createdBy: { select: { name: true } }, _count: { select: { files: true, memories: true, workflows: true, orchestrations: true } } }
      });
      res.set('Cache-Control', 'private, no-store');
      res.json(rows.map(p => projectView(p, ctx)));
    } catch (err) { next(err); }
  });

  projects.post('/', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const body = ProjectBody.safeParse(req.body ?? {});
      if (!body.success) return next(badRequest(body.error.issues[0]?.message ?? 'Invalid request'));
      const p = await db().project.create({ data: { workspaceId: ctx.workspaceId, name: body.data.name, description: body.data.description ?? '', visibility: body.data.visibility ?? 'WORKSPACE', createdById: ctx.user.id } });
      await audit(db(), log, { workspaceId: ctx.workspaceId, actorId: ctx.user.id, action: 'project.created', targetType: 'project', targetId: p.id, ip: req.ip });
      res.status(201).json(projectView(await project(ctx, p.id), ctx));
    } catch (err) { next(err); }
  });

  projects.get('/:id', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      res.set('Cache-Control', 'private, no-store');
      res.json(projectView(await project(ctx, req.params.id), ctx));
    } catch (err) { next(err); }
  });

  projects.patch('/:id', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const body = ProjectPatch.safeParse(req.body ?? {});
      if (!body.success) return next(badRequest(body.error.issues[0]?.message ?? 'Invalid request'));
      const p = await project(ctx, req.params.id);
      editable(ctx, p);
      const { archived, ...rest } = body.data;
      await db().project.update({ where: { id: p.id }, data: { ...rest, ...(archived !== undefined && { archivedAt: archived ? new Date() : null }) } });
      res.json(projectView(await project(ctx, p.id), ctx));
    } catch (err) { next(err); }
  });

  // Permanent: removes the project's files from storage and its memory. Workflows and runs stay, unlinked.
  projects.delete('/:id', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const p = await project(ctx, req.params.id);
      editable(ctx, p);
      const files = await db().projectFile.findMany({ where: { projectId: p.id }, select: { storageKey: true } });
      for (const f of files) await platform.storage?.delete(f.storageKey).catch(err => log.warn({ key: f.storageKey, err: err instanceof Error ? err.message : String(err) }, 'could not delete a stored file'));
      await db().project.delete({ where: { id: p.id } });
      await audit(db(), log, { workspaceId: ctx.workspaceId, actorId: ctx.user.id, action: 'project.deleted', targetType: 'project', targetId: p.id, metadata: { files: files.length }, ip: req.ip });
      res.status(204).end();
    } catch (err) { next(err); }
  });

  projects.get('/:id/activity', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const p = await project(ctx, req.params.id);
      const [workflows, runs] = await Promise.all([
        db().workflow.findMany({ where: { projectId: p.id, deletedAt: null }, orderBy: { updatedAt: 'desc' }, take: 50, select: { id: true, name: true, updatedAt: true } }),
        db().orchestration.findMany({
          where: { projectId: p.id, workspaceId: ctx.workspaceId, ...(canManage(ctx.workspaceRole) ? {} : { userId: ctx.user.id }) }, orderBy: { createdAt: 'desc' }, take: 30,
          select: { id: true, goal: true, status: true, createdAt: true, workflow: { select: { name: true } } }
        })
      ]);
      res.set('Cache-Control', 'private, no-store');
      res.json({
        workflows: workflows.map(w => ({ id: w.id, name: w.name, updatedAt: w.updatedAt.getTime() })),
        runs: runs.map(o => ({ id: o.id, goal: o.goal.slice(0, 200), status: o.status, workflow: o.workflow?.name ?? null, createdAt: o.createdAt.getTime() }))
      });
    } catch (err) { next(err); }
  });

  // ------------------------------------------------------------------ files

  const needStorage = () => {
    if (!platform.storage) throw unavailable('File storage is not configured: set S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY (e.g. Cloudflare R2), or STORAGE_DIR on a server with a persistent disk.');
    return platform.storage;
  };

  projects.get('/:id/files', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const p = await project(ctx, req.params.id);
      const rows = await db().projectFile.findMany({ where: { projectId: p.id }, orderBy: { createdAt: 'desc' }, include: { uploadedBy: { select: { name: true } } } });
      res.set('Cache-Control', 'private, no-store');
      res.json(rows.map(fileView));
    } catch (err) { next(err); }
  });

  // The body is the file itself (Content-Type: application/octet-stream); its name and type come in headers.
  const rawBody = express.raw({ type: 'application/octet-stream', limit: cfg.storage.maxUploadBytes });
  const readFile: RequestHandler = (req, res, next) => rawBody(req, res, err => {
    if ((err as { type?: string } | undefined)?.type === 'entity.too.large') return next(badRequest(`The file is too large (max ${Math.round(cfg.storage.maxUploadBytes / 1024 / 1024)} MB).`));
    next(err);
  });
  projects.post('/:id/files', readFile, async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const storage = needStorage();
      const p = await project(ctx, req.params.id);
      if (p.archivedAt) return next(new HttpError('CONFLICT', 'This project is archived. Restore it to add files.'));
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || !body.length) return next(badRequest('Send the file as the request body with Content-Type: application/octet-stream.'));
      let rawName = '';
      try { rawName = decodeURIComponent(String(req.get('X-File-Name') ?? '')); } catch { return next(badRequest('X-File-Name must be URI-encoded.')); }
      const name = cleanFileName(rawName);
      const declared = String(req.get('X-File-Type') ?? '').toLowerCase();
      const mime = MIME.test(declared) && declared !== 'application/octet-stream' ? declared : BY_EXT[extOf(name)] ?? 'application/octet-stream';
      const sha256 = createHash('sha256').update(body).digest('hex');
      const dup = await db().projectFile.findFirst({ where: { projectId: p.id, sha256 }, select: { name: true } });
      if (dup) return next(new HttpError('CONFLICT', `This file is already in the project (as “${dup.name}”).`));
      const id = randomUUID().replace(/-/g, '');
      const storageKey = `ws/${ctx.workspaceId}/p/${p.id}/${id}`;
      await storage.put(storageKey, body, mime);
      let file;
      try {
        file = await db().projectFile.create({ data: { id, workspaceId: ctx.workspaceId, projectId: p.id, name, mime, size: body.length, sha256, storageKey, uploadedById: ctx.user.id } });
      } catch (err) {
        await storage.delete(storageKey).catch(() => undefined);
        throw err;
      }
      const indexed = await indexFile(ctx, file, body);
      await db().project.update({ where: { id: p.id }, data: { updatedAt: new Date() } });
      await audit(db(), log, { workspaceId: ctx.workspaceId, actorId: ctx.user.id, action: 'file.uploaded', targetType: 'file', targetId: id, metadata: { projectId: p.id, size: body.length, mime }, ip: req.ip });
      res.status(201).json(fileView(indexed));
    } catch (err) { next(err); }
  });

  const fileOf = async (ctx: AuthContext, projectId: string, fileId: string) => {
    const p = await project(ctx, projectId);
    const f = await db().projectFile.findFirst({ where: { id: fileId, projectId: p.id }, include: { uploadedBy: { select: { name: true } } } });
    if (!f) throw notFound('File not found');
    return { p, f };
  };

  // S3: redirect to a short-lived signed URL. Local storage: stream it here. Always as an attachment, never rendered inline.
  projects.get('/:id/files/:fileId/download', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const storage = needStorage();
      const { f } = await fileOf(ctx, req.params.id, req.params.fileId);
      const url = await storage.signedDownloadUrl(f.storageKey, { filename: f.name, mime: f.mime, expiresIn: 300 });
      res.set('Cache-Control', 'private, no-store');
      if (url) return res.redirect(302, url);
      const body = await storage.get(f.storageKey);
      res.set({ 'Content-Type': downloadType(f.mime), 'Content-Disposition': attachmentHeader(f.name), 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
      res.send(body);
    } catch (err) { next(err); }
  });

  projects.post('/:id/files/:fileId/reindex', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const storage = needStorage();
      const { f } = await fileOf(ctx, req.params.id, req.params.fileId);
      const body = await storage.get(f.storageKey);
      res.json(fileView(await indexFile(ctx, f, body)));
    } catch (err) { next(err); }
  });

  projects.delete('/:id/files/:fileId', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const { p, f } = await fileOf(ctx, req.params.id, req.params.fileId);
      if (f.uploadedById !== ctx.user.id && p.createdById !== ctx.user.id && !canManage(ctx.workspaceRole)) return next(new HttpError('FORBIDDEN', 'Only the uploader, the project creator or a workspace admin can delete this file.'));
      await platform.storage?.delete(f.storageKey).catch(err => log.warn({ key: f.storageKey, err: err instanceof Error ? err.message : String(err) }, 'could not delete a stored file'));
      await db().projectFile.delete({ where: { id: f.id } });
      await audit(db(), log, { workspaceId: ctx.workspaceId, actorId: ctx.user.id, action: 'file.deleted', targetType: 'file', targetId: f.id, metadata: { projectId: p.id }, ip: req.ip });
      res.status(204).end();
    } catch (err) { next(err); }
  });

  // ------------------------------------------------------------------ memory

  const mem = Router();
  mem.use(requireAuth(platform));

  const noteView = (n: NoteRow, ctx: AuthContext) => ({
    id: n.id, scope: n.scope, title: n.title, content: n.content, projectId: n.projectId, projectName: n.project?.name ?? null, agentKey: n.agentKey,
    agentName: n.agentKey ? findAgent(n.agentKey)?.name ?? n.agentKey : null, createdBy: n.createdBy?.name ?? null,
    embedded: !!n.embeddingModel, expiresAt: ms(n.expiresAt), createdAt: n.createdAt.getTime(), updatedAt: n.updatedAt.getTime(),
    canEdit: n.createdById === ctx.user.id || (n.scope !== 'USER' && canManage(ctx.workspaceRole))
  });
  const noteInclude = { createdBy: { select: { name: true } }, project: { select: { name: true } } } as const;

  /** Checks where a note may go: USER (yourself), WORKSPACE, a project you can see, or a known agent. */
  const placement = async (ctx: AuthContext, d: { scope: MemoryScopeT; projectId?: string; agentKey?: string }) => {
    if (d.scope === 'PROJECT') {
      if (!d.projectId || !(await accessibleProjectIds(db(), actorOf(ctx))).includes(d.projectId)) throw notFound('Project not found');
      return { projectId: d.projectId, agentKey: null, userId: null };
    }
    if (d.scope === 'AGENT') {
      const k = d.agentKey ?? '';
      const ok = findAgent(k) || (k.startsWith('custom:') && await findVisibleAgent(db(), ctx, k.slice(7)));
      if (!ok) throw notFound('Agent not found');
      return { projectId: null, agentKey: k, userId: null };
    }
    return { projectId: null, agentKey: null, userId: d.scope === 'USER' ? ctx.user.id : null };
  };

  mem.get('/status', async (_req, res, next) => {
    try {
      res.json({
        embeddings: memory().embedder ? { provider: memory().embedder!.provider, model: memory().embedder!.model } : null,
        vectorSearch: await memory().vectorMode(),
        storage: platform.storage?.driver ?? null,
        maxUploadMb: Math.round(cfg.storage.maxUploadBytes / 1024 / 1024)
      });
    } catch (err) { next(err); }
  });

  mem.get('/', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const scope = z.enum(SCOPES).optional().safeParse(req.query.scope);
      if (!scope.success) return next(badRequest('Invalid scope'));
      const projectIds = await accessibleProjectIds(db(), actorOf(ctx));
      const pid = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
      if (pid && !projectIds.includes(pid)) return next(notFound('Project not found'));
      // Expired memories are never returned; clean them up as we go.
      await db().memoryRecord.deleteMany({ where: { workspaceId: ctx.workspaceId, expiresAt: { lt: new Date() } } });
      const rows = await db().memoryRecord.findMany({
        where: { AND: [visibleWhere({ workspaceId: ctx.workspaceId, userId: ctx.user.id, projectIds: pid ? [pid] : projectIds, agentKeys: 'all', scopes: scope.data ? [scope.data] : pid ? ['PROJECT'] : undefined }), { source: 'NOTE' }] },
        orderBy: { updatedAt: 'desc' }, take: 200, include: noteInclude
      });
      res.set('Cache-Control', 'private, no-store');
      res.json(rows.map(n => noteView(n, ctx)));
    } catch (err) { next(err); }
  });

  mem.post('/', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const body = NoteBody.safeParse(req.body ?? {});
      if (!body.success) return next(badRequest(body.error.issues[0]?.message ?? 'Invalid request'));
      const where = await placement(ctx, body.data);
      const title = body.data.title || body.data.content.split('\n')[0].slice(0, 80);
      const e = await memory().embed([`${title}\n${body.data.content}`], actorOf(ctx));
      const n = await db().memoryRecord.create({
        data: {
          workspaceId: ctx.workspaceId, scope: body.data.scope, ...where, source: 'NOTE', title, content: body.data.content,
          embedding: e.vectors?.[0] ?? [], embeddingModel: e.vectors ? memory().embedder!.model : null, createdById: ctx.user.id,
          expiresAt: body.data.expiresInDays ? new Date(Date.now() + body.data.expiresInDays * 86_400_000) : null
        },
        include: noteInclude
      });
      res.status(201).json({ ...noteView(n, ctx), ...(e.error && memory().embedder && { warning: 'Saved for keyword search only: semantic indexing failed.' }) });
    } catch (err) { next(err); }
  });

  const editableNote = async (ctx: AuthContext, id: string) => {
    const projectIds = await accessibleProjectIds(db(), actorOf(ctx), { includeArchived: true });
    const n = await db().memoryRecord.findFirst({ where: { AND: [{ id, source: 'NOTE' }, visibleWhere({ workspaceId: ctx.workspaceId, userId: ctx.user.id, projectIds, agentKeys: 'all' })] } });
    if (!n) throw notFound('Memory not found');
    if (n.createdById !== ctx.user.id && !(n.scope !== 'USER' && canManage(ctx.workspaceRole))) throw new HttpError('FORBIDDEN', 'Only the person who wrote this memory, or a workspace admin, can change it.');
    return n;
  };

  mem.patch('/:id', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const body = NotePatch.safeParse(req.body ?? {});
      if (!body.success) return next(badRequest(body.error.issues[0]?.message ?? 'Invalid request'));
      const n = await editableNote(ctx, req.params.id);
      const title = body.data.title ?? n.title;
      const content = body.data.content ?? n.content;
      const changed = title !== n.title || content !== n.content;
      const e = changed ? await memory().embed([`${title}\n${content}`], actorOf(ctx)) : null;
      const updated = await db().memoryRecord.update({
        where: { id: n.id },
        data: {
          title, content,
          ...(e && { embedding: e.vectors?.[0] ?? [], embeddingModel: e.vectors ? memory().embedder!.model : null }),
          ...(body.data.expiresInDays !== undefined && { expiresAt: body.data.expiresInDays ? new Date(Date.now() + body.data.expiresInDays * 86_400_000) : null })
        },
        include: noteInclude
      });
      res.json(noteView(updated, ctx));
    } catch (err) { next(err); }
  });

  mem.delete('/:id', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const n = await editableNote(ctx, req.params.id);
      await db().memoryRecord.delete({ where: { id: n.id } });
      res.status(204).end();
    } catch (err) { next(err); }
  });

  // Searches everything the caller may see (or one project), and shows exactly what an agent would be given.
  mem.post('/search', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const body = SearchBody.safeParse(req.body ?? {});
      if (!body.success) return next(badRequest(body.error.issues[0]?.message ?? 'Invalid request'));
      const projectIds = await accessibleProjectIds(db(), actorOf(ctx));
      if (body.data.projectId && !projectIds.includes(body.data.projectId)) return next(notFound('Project not found'));
      const r = await memory().search(
        { workspaceId: ctx.workspaceId, userId: ctx.user.id, projectIds: body.data.projectId ? [body.data.projectId] : projectIds, agentKeys: 'all', scopes: body.data.scopes },
        body.data.query, { limit: body.data.limit ?? 8, actor: actorOf(ctx) }
      );
      const context = assembleContext(r.hits);
      const files = await db().projectFile.findMany({ where: { id: { in: r.hits.map(h => h.fileId).filter((x): x is string => !!x) } }, select: { id: true, name: true, projectId: true } });
      const fileById = new Map(files.map(f => [f.id, f]));
      res.json({
        mode: r.semantic ? 'semantic+keyword' : 'keyword', ...(r.semanticError && { semanticError: 'Semantic search failed for this query; showing keyword matches.' }),
        hits: r.hits.map((h, i) => ({ ...h, ref: context.sources[i]?.ref ?? null, file: h.fileId ? fileById.get(h.fileId) ?? null : null })),
        context: context.text
      });
    } catch (err) { next(err); }
  });

  // Embeds what is not yet embedded with the current model (e.g. after configuring an embedding provider). Admins only.
  mem.post('/reindex', async (_req, res, next) => {
    try {
      const ctx = authOf(res)!;
      if (!canManage(ctx.workspaceRole)) return next(new HttpError('FORBIDDEN', 'Only workspace owners and admins can reindex.'));
      const embedder = memory().embedder;
      if (!embedder) return next(unavailable('No embedding provider is configured (OPENAI_API_KEY or GEMINI_API_KEY).'));
      const rows = await db().memoryRecord.findMany({
        where: { workspaceId: ctx.workspaceId, OR: [{ embeddingModel: null }, { embeddingModel: { not: embedder.model } }] },
        take: 500, orderBy: { createdAt: 'asc' }, select: { id: true, title: true, content: true, source: true }
      });
      const e = await memory().embed(rows.map(r => (r.source === 'NOTE' ? `${r.title}\n${r.content}` : r.content)), actorOf(ctx));
      if (!e.vectors) return next(new HttpError('INTERNAL', `Embedding failed: ${e.error ?? 'unknown error'}`));
      await db().$transaction(rows.map((r, i) => db().memoryRecord.update({ where: { id: r.id }, data: { embedding: e.vectors![i], embeddingModel: embedder.model } })));
      const remaining = await db().memoryRecord.count({ where: { workspaceId: ctx.workspaceId, OR: [{ embeddingModel: null }, { embeddingModel: { not: embedder.model } }] } });
      res.json({ reindexed: rows.length, remaining });
    } catch (err) { next(err); }
  });

  return { projects, memory: mem };
}
