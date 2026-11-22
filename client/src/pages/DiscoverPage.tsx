import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Heart, MessagesSquare, Search, Star } from 'lucide-react';
import { AgentAvatar } from '../components/AgentAvatar';
import { Button, LinkButton } from '../components/ui/Button';
import { Badge, Card, EmptyState, PageHeader, Skeleton } from '../components/ui/Display';
import { Input, Select } from '../components/ui/Form';
import { formatCount } from '../lib/marketplace';
import { agentHref } from '../lib/route';
import { rankBy } from '../lib/search';
import { useWorkspace } from '../app/workspace';

type Sort = 'featured' | 'used' | 'rated' | 'name' | 'category';

export default function DiscoverPage() {
  const ws = useWorkspace();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState<Sort>('featured');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const signedIn = ws.account.status === 'signed-in';
  const stats = ws.stats;
  // Usage and rating sorts only exist when the server records them; never sort by numbers we don't have.
  const effectiveSort: Sort = !stats && (sort === 'used' || sort === 'rated') ? 'featured' : sort;

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of ws.agents) counts.set(a.category, (counts.get(a.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [ws.agents]);

  const visible = useMemo(() => {
    let list = category === 'all' ? ws.agents : ws.agents.filter(a => a.category === category);
    if (favoritesOnly) list = list.filter(a => ws.favorites.has(a.id));
    if (query.trim()) return rankBy(list, query, a => `${a.name} ${a.category} ${a.description} ${a.useCase} ${a.tools.join(' ')}`);
    const out = [...list];
    const s = (id: string) => stats?.get(id);
    if (effectiveSort === 'name') out.sort((a, b) => a.name.localeCompare(b.name));
    else if (effectiveSort === 'category') out.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    else if (effectiveSort === 'used') out.sort((a, b) => (s(b.id)?.runs30d ?? 0) - (s(a.id)?.runs30d ?? 0) || (s(b.id)?.runsTotal ?? 0) - (s(a.id)?.runsTotal ?? 0));
    else if (effectiveSort === 'rated') out.sort((a, b) => (s(b.id)?.rating ?? -1) - (s(a.id)?.rating ?? -1) || (s(b.id)?.reviewCount ?? 0) - (s(a.id)?.reviewCount ?? 0));
    else out.sort((a, b) => Number(b.mostUsed) - Number(a.mostUsed));
    return out;
  }, [ws.agents, ws.favorites, category, favoritesOnly, query, effectiveSort, stats]);

  return (
    <div>
      <PageHeader title="Discover Agents" description={`${ws.agents.length} specialist agents, ready to chat or to work together in workflows.${stats ? ' Usage and ratings come from recorded runs and reviews.' : ''}`} />

      <Card className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input type="search" aria-label="Search agents" placeholder="Search by name, skill or use case…" value={query} onChange={e => setQuery(e.target.value)} className="pl-9" data-testid="discover-search" />
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Select aria-label="Category" value={category} onChange={e => setCategory(e.target.value)} className="sm:w-56" data-testid="discover-category">
            <option value="all">All categories ({ws.agents.length})</option>
            {categories.map(([c, n]) => <option key={c} value={c}>{c} ({n})</option>)}
          </Select>
          <Select aria-label="Sort by" value={effectiveSort} onChange={e => setSort(e.target.value as Sort)} disabled={!!query.trim()} title={query.trim() ? 'Results are ranked by relevance while searching' : undefined} className="sm:w-48" data-testid="discover-sort">
            <option value="featured">Featured first</option>
            {stats && <option value="used">Most used (30 days)</option>}
            {stats && <option value="rated">Highest rated</option>}
            <option value="name">Name A–Z</option>
            <option value="category">Category</option>
          </Select>
          {signedIn && (
            <button type="button" aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly(f => !f)} data-testid="favorites-only"
              className={clsx('flex h-10 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm transition', favoritesOnly ? 'border-rose-500/50 bg-rose-500/10 text-fg' : 'border-line text-muted hover:bg-hover hover:text-fg')}>
              <Heart size={14} aria-hidden className={clsx(favoritesOnly && 'fill-rose-500 text-rose-500')} /> Favorites
            </button>
          )}
        </div>
      </Card>

      <p className="mb-3 text-sm text-muted" aria-live="polite" data-testid="discover-count">{visible.length} agent{visible.length === 1 ? '' : 's'}{query.trim() ? ` matching “${query.trim()}”` : ''}{favoritesOnly ? ' in your favorites' : ''}</p>

      {ws.loading && !ws.agents.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-40" />)}</div>
      ) : visible.length === 0 ? (
        favoritesOnly && !query.trim() && category === 'all' ? (
          <EmptyState icon={<Heart size={20} />} title="No favorites yet" action={<Button size="sm" onClick={() => setFavoritesOnly(false)}>Show all agents</Button>}>Open an agent and press Favorite to keep it here.</EmptyState>
        ) : (
          <EmptyState icon={<Search size={20} />} title="No agents match" action={<Button size="sm" onClick={() => { setQuery(''); setCategory('all'); setFavoritesOnly(false); }}>Clear filters</Button>}>
            Try a different word, or build exactly the agent you need in the Agent Builder.
          </EmptyState>
        )
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="discover-grid">
          {visible.map(a => {
            const st = stats?.get(a.id);
            const fav = ws.favorites.has(a.id);
            return (
              <Card as="li" key={a.id} data-discover-agent={a.id} className="flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <AgentAvatar icon={a.icon} gradient={a.gradient} size={44} />
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate font-display text-sm font-semibold"><a href={agentHref(a.id)} className="hover:underline">{a.name}</a></h2>
                    <p className="truncate font-mono text-[10px] uppercase tracking-wider text-muted">{a.category}</p>
                  </div>
                  {a.mostUsed && <Badge tone="accent">Featured</Badge>}
                  {signedIn && (
                    <button type="button" aria-pressed={fav} aria-label={fav ? `Remove ${a.name} from favorites` : `Add ${a.name} to favorites`} onClick={() => void ws.toggleFavorite(a.id)} className="-mr-1 -mt-1 rounded-lg p-1 text-muted transition hover:bg-hover hover:text-fg">
                      <Heart size={16} aria-hidden className={clsx(fav && 'fill-rose-500 text-rose-500')} />
                    </button>
                  )}
                </div>
                <p className="line-clamp-2 flex-1 text-sm text-muted">{a.description}</p>
                {st ? (
                  <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted" data-testid="agent-card-stats">
                    <span>{st.rating !== null ? <><Star size={11} aria-hidden className="mr-0.5 inline fill-amber-400 text-amber-400" />{st.rating.toFixed(1)} ({st.reviewCount})</> : 'No reviews yet'}</span>
                    <span>{formatCount(st.runs30d)} run{st.runs30d === 1 ? '' : 's'} in 30 days</span>
                  </p>
                ) : <p className="text-xs"><span className="text-muted">Best for: </span>{a.useCase}</p>}
                <div className="flex gap-2">
                  <Button variant="primary" size="sm" className="flex-1" icon={<MessagesSquare size={14} aria-hidden />} onClick={() => ws.selectAgent(a.id)} aria-label={`Chat with ${a.name}`}>Chat</Button>
                  <LinkButton size="sm" href={agentHref(a.id)} aria-label={`Details for ${a.name}`}>Details</LinkButton>
                </div>
              </Card>
            );
          })}
        </ul>
      )}
    </div>
  );
}
