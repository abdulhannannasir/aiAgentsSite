import { useMemo, useState } from 'react';
import { Info, MessagesSquare, Search, Workflow as WorkflowIcon } from 'lucide-react';
import { AgentAvatar, workflowIcon } from '../components/AgentAvatar';
import { Button } from '../components/ui/Button';
import { Badge, Card, EmptyState, PageHeader, Skeleton } from '../components/ui/Display';
import { Input, Select } from '../components/ui/Form';
import { Drawer } from '../components/ui/Overlay';
import { rankBy } from '../lib/search';
import { useWorkspace } from '../app/workspace';
import type { Agent } from '../types';

type Sort = 'popular' | 'name' | 'category';

const TOOL_LABEL: Record<string, string> = {
  web_search: 'Web search', code_interpreter: 'Code interpreter', file_reader: 'File reader', ticket_system: 'Ticket system',
  email_sender: 'Email sender', knowledge_base: 'Knowledge base', calculator: 'Calculator'
};

export default function DiscoverPage() {
  const ws = useWorkspace();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState<Sort>('popular');
  const [detail, setDetail] = useState<Agent | null>(null);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of ws.agents) counts.set(a.category, (counts.get(a.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [ws.agents]);

  const visible = useMemo(() => {
    const inCat = category === 'all' ? ws.agents : ws.agents.filter(a => a.category === category);
    if (query.trim()) return rankBy(inCat, query, a => `${a.name} ${a.category} ${a.description} ${a.useCase} ${a.tools.join(' ')}`);
    const list = [...inCat];
    if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'category') list.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    else list.sort((a, b) => Number(b.mostUsed) - Number(a.mostUsed));
    return list;
  }, [ws.agents, category, query, sort]);

  const workflowsUsing = (id: string) => ws.workflows.filter(w => w.steps.some(s => s.agentId === id));

  return (
    <div>
      <PageHeader title="Discover Agents" description={`${ws.agents.length} specialist agents, ready to chat or to work together in workflows.`} />

      <Card className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input type="search" aria-label="Search agents" placeholder="Search by name, skill or use case…" value={query} onChange={e => setQuery(e.target.value)} className="pl-9" data-testid="discover-search" />
        </div>
        <Select aria-label="Category" value={category} onChange={e => setCategory(e.target.value)} className="sm:w-56" data-testid="discover-category">
          <option value="all">All categories ({ws.agents.length})</option>
          {categories.map(([c, n]) => <option key={c} value={c}>{c} ({n})</option>)}
        </Select>
        <Select aria-label="Sort by" value={sort} onChange={e => setSort(e.target.value as Sort)} disabled={!!query.trim()} title={query.trim() ? 'Results are ranked by relevance while searching' : undefined} className="sm:w-44">
          <option value="popular">Popular first</option>
          <option value="name">Name A–Z</option>
          <option value="category">Category</option>
        </Select>
      </Card>

      <p className="mb-3 text-sm text-muted" aria-live="polite" data-testid="discover-count">{visible.length} agent{visible.length === 1 ? '' : 's'}{query.trim() ? ` matching “${query.trim()}”` : ''}</p>

      {ws.loading && !ws.agents.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-40" />)}</div>
      ) : visible.length === 0 ? (
        <EmptyState icon={<Search size={20} />} title="No agents match" action={<Button size="sm" onClick={() => { setQuery(''); setCategory('all'); }}>Clear filters</Button>}>
          Try a different word, or build exactly the agent you need in the Agent Builder.
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="discover-grid">
          {visible.map(a => (
            <Card as="li" key={a.id} data-discover-agent={a.id} className="flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <AgentAvatar icon={a.icon} gradient={a.gradient} size={44} />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-display text-sm font-semibold">{a.name}</h2>
                  <p className="truncate font-mono text-[10px] uppercase tracking-wider text-muted">{a.category}</p>
                </div>
                {a.mostUsed && <Badge tone="accent">Popular</Badge>}
              </div>
              <p className="line-clamp-2 flex-1 text-sm text-muted">{a.description}</p>
              <p className="text-xs"><span className="text-muted">Best for: </span>{a.useCase}</p>
              <div className="flex gap-2">
                <Button variant="primary" size="sm" className="flex-1" icon={<MessagesSquare size={14} aria-hidden />} onClick={() => ws.selectAgent(a.id)} aria-label={`Chat with ${a.name}`}>Chat</Button>
                <Button size="sm" icon={<Info size={14} aria-hidden />} onClick={() => setDetail(a)} aria-label={`Details for ${a.name}`}>Details</Button>
              </div>
            </Card>
          ))}
        </ul>
      )}

      <Drawer open={!!detail} onClose={() => setDetail(null)} title={detail?.name ?? 'Agent'}>
        {detail && (
          <div className="flex flex-col gap-5 p-4" data-testid="agent-detail">
            <div className="flex items-center gap-3">
              <AgentAvatar icon={detail.icon} gradient={detail.gradient} size={56} />
              <div>
                <p className="font-mono text-[11px] uppercase tracking-wider text-muted">{detail.category}</p>
                <p className="text-sm">{detail.description}</p>
              </div>
            </div>
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Best for</h3>
              <p className="text-sm">{detail.useCase}</p>
            </section>
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Tool permissions</h3>
              {detail.tools.length ? (
                <>
                  <div className="flex flex-wrap gap-1.5">{detail.tools.map(t => <Badge key={t}>{TOOL_LABEL[t] ?? t}</Badge>)}</div>
                  <p className="mt-1.5 text-xs text-muted">Labels only for now: tools are not connected yet, so the agent answers from the model's own knowledge.</p>
                </>
              ) : <p className="text-sm text-muted">None — a pure conversation agent.</p>}
            </section>
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Used in workflows</h3>
              {workflowsUsing(detail.id).length ? (
                <ul className="flex flex-col gap-1.5">
                  {workflowsUsing(detail.id).map(w => {
                    const Icon = workflowIcon(w.icon);
                    const roles = w.steps.filter(s => s.agentId === detail.id).map(s => s.role).join(', ');
                    return (
                      <li key={w.id}>
                        <button type="button" onClick={() => { setDetail(null); ws.startWorkflow(w); }} className="flex w-full items-center gap-2 rounded-lg border border-line px-3 py-2 text-left text-sm transition hover:bg-hover">
                          <Icon size={15} aria-hidden className="text-accent" />
                          <span className="flex-1">{w.name} <span className="text-muted">({roles})</span></span>
                          <WorkflowIcon size={13} aria-hidden className="text-muted" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="text-sm text-muted">Not part of a built-in workflow.</p>}
            </section>
            <Button variant="primary" icon={<MessagesSquare size={15} aria-hidden />} onClick={() => { const id = detail.id; setDetail(null); ws.selectAgent(id); }}>Start a chat</Button>
          </div>
        )}
      </Drawer>
    </div>
  );
}
