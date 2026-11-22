import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, Heart, MessagesSquare, Play, Star, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { AgentAvatar, workflowIcon } from '../components/AgentAvatar';
import { Button, LinkButton } from '../components/ui/Button';
import { Badge, Card, CardTitle, EmptyState, ErrorState, Skeleton, Stat } from '../components/ui/Display';
import { Textarea } from '../components/ui/Form';
import { useToast } from '../components/Toast';
import { ApiError } from '../lib/api';
import { fetchAgentDetail, formatCount, marketplace, type MarketplaceDetail } from '../lib/marketplace';
import { authHref, pageHref } from '../lib/route';
import { timeAgo } from '../lib/sessionStats';
import { toolLabel } from '../lib/tools';
import { useWorkspace } from '../app/workspace';
import type { PublicAgentDetail } from '../../../server/src/contracts';


/** Read-only stars, with the number as text for screen readers. */
export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center" aria-label={`${value} out of 5 stars`} role="img">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} size={size} aria-hidden className={i <= Math.round(value) ? 'fill-amber-400 text-amber-400' : 'text-muted/50'} />
      ))}
    </span>
  );
}

/** A 1-5 star picker with radio semantics (arrow keys work, each star has a name). */
function StarInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div role="radiogroup" aria-label="Your rating" className="flex gap-1">
      {[1, 2, 3, 4, 5].map(i => (
        <button
          key={i} type="button" role="radio" aria-checked={value === i} aria-label={`${i} star${i === 1 ? '' : 's'}`}
          tabIndex={value === i || (!value && i === 1) ? 0 : -1}
          onClick={() => onChange(i)}
          onKeyDown={e => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onChange(Math.min(5, (value || 0) + 1)); }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onChange(Math.max(1, (value || 2) - 1)); }
          }}
          className="rounded p-0.5 transition hover:scale-110"
        >
          <Star size={22} aria-hidden className={i <= value ? 'fill-amber-400 text-amber-400' : 'text-muted'} />
        </button>
      ))}
    </div>
  );
}

function ReviewForm({ agentId, initial, onSaved }: { agentId: string; initial: { rating: number; comment: string } | null; onSaved: () => void }) {
  const { toast } = useToast();
  const [rating, setRating] = useState(initial?.rating ?? 0);
  const [comment, setComment] = useState(initial?.comment ?? '');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!rating) { toast('Choose a rating from 1 to 5 stars.', 'error'); return; }
    setBusy(true);
    try { await marketplace.saveReview(agentId, rating, comment); toast(initial ? 'Review updated' : 'Thanks for the review', 'success'); onSaved(); }
    catch (err) { toast(err instanceof Error ? err.message : 'Could not save the review.', 'error'); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try { await marketplace.deleteReview(agentId); setRating(0); setComment(''); toast('Review deleted'); onSaved(); }
    catch (err) { toast(err instanceof Error ? err.message : 'Could not delete the review.', 'error'); }
    finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3" data-testid="review-form">
      <StarInput value={rating} onChange={setRating} />
      <Textarea aria-label="Your review (optional)" placeholder="What worked well, what didn't? (optional)" maxLength={1000} value={comment} onChange={e => setComment(e.target.value)} className="min-h-20" />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={busy}>{initial ? 'Update review' : 'Post review'}</Button>
        {initial && <Button size="sm" variant="ghost" icon={<Trash2 size={13} aria-hidden />} onClick={() => void remove()} disabled={busy}>Delete my review</Button>}
      </div>
    </form>
  );
}

export default function AgentDetailPage({ agentId }: { agentId: string }) {
  const ws = useWorkspace();
  const [agent, setAgent] = useState<PublicAgentDetail | null>(null);
  const [error, setError] = useState<'missing' | 'failed' | null>(null);
  const [market, setMarket] = useState<MarketplaceDetail | null | 'unavailable' | 'error'>(null);

  const hasDatabase = ws.meta?.features.database ?? true;
  const loadMarket = useCallback(() => {
    if (!hasDatabase) { setMarket('unavailable'); return; }
    marketplace.detail(agentId).then(setMarket).catch(err => setMarket(err instanceof ApiError && err.status === 503 ? 'unavailable' : 'error'));
  }, [agentId, hasDatabase]);
  // The agent list is already loaded: an id that isn't in it doesn't exist, so don't ask the server.
  const known = !ws.agents.length || ws.agents.some(a => a.id === agentId);
  useEffect(() => {
    if (!known) { setError('missing'); return; }
    fetchAgentDetail(agentId).then(setAgent).catch(err => setError(err instanceof ApiError && err.status === 404 ? 'missing' : 'failed'));
    loadMarket();
  }, [agentId, known, loadMarket, ws.account.status]);

  if (error === 'missing') {
    return <EmptyState title="This agent doesn't exist" action={<LinkButton href={pageHref('discover')} variant="primary" size="sm">Browse agents</LinkButton>}>The link may be old or mistyped.</EmptyState>;
  }
  if (error) return <ErrorState title="Could not load this agent" onRetry={() => { setError(null); fetchAgentDetail(agentId).then(setAgent).catch(() => setError('failed')); }} />;
  if (!agent) return <div className="flex flex-col gap-4"><Skeleton className="h-24" /><Skeleton className="h-40" /></div>;

  const signedIn = ws.account.status === 'signed-in';
  const favorite = ws.favorites.has(agent.id);
  const m = market && market !== 'unavailable' && market !== 'error' ? market : null;
  const workflows = ws.workflows.filter(w => agent.workflows.includes(w.id));
  const provider = ws.meta ? (ws.meta.mode === 'live' ? `${ws.meta.provider === 'gemini' ? 'Google Gemini' : 'OpenAI'} · ${ws.meta.providers[ws.meta.provider as 'openai' | 'gemini']?.model ?? ''}` : 'Demo replies (no model key on the server)') : '—';
  const refresh = () => { loadMarket(); ws.refreshStats(); };

  return (
    <div data-testid="agent-detail-page" data-agent-detail={agent.id}>
      <a href={pageHref('discover')} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-fg"><ArrowLeft size={15} aria-hidden /> All agents</a>

      <header className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start">
        <AgentAvatar icon={agent.icon} gradient={agent.gradient} size={64} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{agent.name}</h1>
            {agent.mostUsed && <Badge tone="accent">Featured</Badge>}
          </div>
          <p className="mt-0.5 font-mono text-[11px] uppercase tracking-wider text-muted">{agent.category} · best for {agent.useCase}</p>
          <p className="mt-2 max-w-2xl text-sm">{agent.description}</p>
          {m && m.stats.rating !== null && (
            <p className="mt-2 flex items-center gap-2 text-sm"><Stars value={m.stats.rating} /> <span className="font-semibold">{m.stats.rating.toFixed(1)}</span> <span className="text-muted">({m.stats.reviewCount} review{m.stats.reviewCount === 1 ? '' : 's'})</span></p>
          )}
        </div>
        <div className="flex gap-2">
          {signedIn && (
            <Button icon={<Heart size={15} aria-hidden className={clsx(favorite && 'fill-rose-500 text-rose-500')} />} aria-pressed={favorite} onClick={() => void ws.toggleFavorite(agent.id)}>
              {favorite ? 'Favorited' : 'Favorite'}
            </Button>
          )}
          <Button variant="primary" icon={<MessagesSquare size={15} aria-hidden />} onClick={() => ws.selectAgent(agent.id)}>Chat</Button>
        </div>
      </header>

      <section aria-label="Usage" className="mb-4">
        {m ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="agent-stats">
            <Stat label="Runs · 30 days" value={formatCount(m.stats.runs30d)} />
            <Stat label="Runs · all time" value={formatCount(m.stats.runsTotal)} />
            <Stat label="Completed" value={m.stats.successRate === null ? '—' : `${Math.round(m.stats.successRate * 100)}%`} hint={m.stats.successRate === null ? 'No runs recorded yet' : 'of recorded runs'} />
            <Stat label="Your runs" value={m.me ? m.me.runs : '—'} hint={m.me ? undefined : 'Sign in to track yours'} />
          </div>
        ) : market === 'unavailable' ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-3 text-sm text-muted" data-testid="stats-unavailable">Usage numbers and reviews need a database on this server, so none are shown.</p>
        ) : market === 'error' ? (
          <ErrorState title="Could not load usage and reviews" onRetry={loadMarket} />
        ) : <Skeleton className="h-24" />}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card as="section" aria-labelledby="ad-try">
            <CardTitle id="ad-try">Try it</CardTitle>
            <ul className="flex flex-col gap-2" data-testid="example-prompts">
              {agent.examples.map(ex => (
                <li key={ex}>
                  <button type="button" onClick={() => ws.startChatWith(agent.id, ex)} className="flex w-full items-start gap-3 rounded-xl border border-line p-3 text-left text-sm transition hover:border-line-strong hover:bg-hover">
                    <Play size={14} aria-hidden className="mt-0.5 shrink-0 text-accent" /> <span>{ex}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          <Card as="section" aria-labelledby="ad-reviews">
            <CardTitle id="ad-reviews">Reviews</CardTitle>
            {market === 'unavailable' ? <p className="text-sm text-muted">Reviews need a database on this server.</p> : market === 'error' ? <p className="text-sm text-muted">Reviews could not be loaded.</p> : !m ? <Skeleton className="h-20" /> : (
              <>
                <div className="mb-4">
                  {!signedIn ? (
                    ws.account.status === 'guest'
                      ? <p className="text-sm text-muted"><a className="text-accent hover:underline" href={authHref('sign-in')}>Sign in</a> to review this agent.</p>
                      : null
                  ) : m.me?.canReview ? (
                    <ReviewForm key={m.me.review ? `${m.me.review.rating}-${m.me.review.comment}` : 'new'} agentId={agent.id} initial={m.me.review} onSaved={refresh} />
                  ) : (
                    <p className="text-sm text-muted">Chat with this agent at least once to review it. Reviews only come from people who have used it.</p>
                  )}
                </div>
                {m.reviews.length === 0 ? <p className="text-sm text-muted">No reviews yet.</p> : (
                  <ul className="flex flex-col divide-y divide-line" data-testid="review-list">
                    {m.reviews.map(r => (
                      <li key={r.id} className="py-3">
                        <div className="flex items-center gap-2 text-sm"><Stars value={r.rating} size={13} /><span className="font-semibold">{r.author}</span>{r.mine && <Badge>You</Badge>}<span className="text-xs text-muted">{timeAgo(r.updatedAt)}</span></div>
                        {r.comment && <p className="mt-1 text-sm">{r.comment}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card as="section" aria-labelledby="ad-config">
            <CardTitle id="ad-config">Configuration</CardTitle>
            <dl className="flex flex-col gap-3 text-sm">
              <div><dt className="text-xs text-muted">Model</dt><dd>{provider}</dd><dd className="text-xs text-muted">Built-in agents use the server's default. Your own agents can be pinned to a model.</dd></div>
              <div>
                <dt className="text-xs text-muted">Tool permissions</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">{agent.tools.length ? agent.tools.map(t => <Badge key={t}>{toolLabel(t)}</Badge>) : <span className="text-muted">None</span>}</dd>
                {agent.tools.length > 0 && (
                  <dd className="mt-1 text-xs text-muted">
                    {ws.toolInfo
                      ? (() => {
                          const off = agent.tools.map(t => ws.toolInfo!.find(i => i.id === t)).filter(i => i && !i.available);
                          return off.length ? `Not on this server: ${off.map(i => `${i!.label} (${i!.reason})`).join('; ')}` : 'All available on this server. Tools only run with a real model.';
                        })()
                      : 'Tools only run with a real model.'}
                  </dd>
                )}
              </div>
              <div><dt className="text-xs text-muted">Input</dt><dd>Plain text, up to 4,000 characters per message.</dd></div>
              <div><dt className="text-xs text-muted">Output</dt><dd>Markdown (headings, lists, tables, code).</dd></div>
              <div><dt className="text-xs text-muted">Instructions</dt><dd className="text-muted">Built in and kept on the server. Want to change them? Build your own agent in the Agent Builder.</dd></div>
            </dl>
          </Card>

          {workflows.length > 0 && (
            <Card as="section" aria-labelledby="ad-workflows">
              <CardTitle id="ad-workflows">Part of these workflows</CardTitle>
              <ul className="flex flex-col gap-1.5">
                {workflows.map(w => {
                  const Icon = workflowIcon(w.icon);
                  return (
                    <li key={w.id}>
                      <button type="button" onClick={() => ws.startWorkflow(w)} className="flex w-full items-center gap-2 rounded-lg border border-line px-3 py-2 text-left text-sm transition hover:bg-hover" aria-label={`Run ${w.name}`}>
                        <Icon size={15} aria-hidden className="text-accent" /><span className="flex-1">{w.name}</span>
                        <span className="text-xs text-muted">as {w.steps.filter(s => s.agentId === agent.id).map(s => s.role).join(', ')}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          {m?.me && (
            <Card as="section" aria-labelledby="ad-history">
              <CardTitle id="ad-history">Your conversations</CardTitle>
              {m.me.conversations.length === 0 ? <p className="text-sm text-muted">None yet in this workspace.</p> : (
                <ul className="flex flex-col gap-1.5 text-sm" data-testid="my-conversations">
                  {m.me.conversations.map(c => <li key={c.id} className="flex justify-between gap-2"><span className="truncate">{c.title}</span><span className="shrink-0 text-xs text-muted">{c.messageCount} msg · {timeAgo(c.updatedAt)}</span></li>)}
                </ul>
              )}
              <Button size="sm" className="mt-3" onClick={() => ws.selectAgent(agent.id)}>Continue the latest</Button>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
