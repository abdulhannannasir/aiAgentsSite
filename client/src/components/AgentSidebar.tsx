import { useMemo, useRef, useState } from 'react';
import { FileJson, Pencil, Plus, Upload } from 'lucide-react';
import { AgentAvatar, CUSTOM_GRADIENT } from './AgentAvatar';
import { StatusChip } from './fx/AgentStatus';
import { TiltCard } from './fx/TiltCard';
import { trackSpot } from '../lib/fx/spot';
import type { Agent, CustomAgent } from '../types';

interface Props {
  agents: Agent[];
  customAgents: CustomAgent[];
  selectedKey: string | null;
  /** Keys of agents that are generating a reply right now (real state, shown as Active). */
  activeKeys: string[];
  onSelect: (key: string) => void;
  onCreate: () => void;
  onImport: () => void;
  onEditCustom: (id: string) => void;
  onExportCustom: (id: string) => void;
  onImportInto: (id: string) => void;
}

function CustomAgentCard({ agent, selected, active, onSelect, onEdit, onExport, onImportInto }: {
  agent: CustomAgent; selected: boolean; active: boolean; onSelect: () => void; onEdit: () => void; onExport: () => void; onImportInto: () => void;
}) {
  const btn = 'flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-muted transition hover:bg-hover hover:text-fg';
  return (
    <div data-testid="custom-agent-card" data-agent-name={agent.name} data-status={active ? 'active' : 'idle'} onPointerMove={trackSpot} className={`spot rounded-xl border p-2.5 transition ${selected ? 'border-accent bg-accent/10' : 'border-line hover:bg-hover'}`}>
      <button type="button" onClick={onSelect} aria-current={selected} className="flex w-full items-center gap-3 text-left">
        <AgentAvatar icon={agent.icon} gradient={CUSTOM_GRADIENT} size={36} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-sm font-semibold">{agent.name}</span>
          <span className="block truncate text-xs text-muted">{agent.description || 'Custom agent'}</span>
        </span>
        {active && <StatusChip status="active" />}
      </button>
      <div className="mt-2 flex flex-wrap gap-1 border-t border-line pt-2">
        <button type="button" onClick={onEdit} className={btn} aria-label={`Edit ${agent.name}`}><Pencil size={12} aria-hidden /> Edit</button>
        <button type="button" onClick={onExport} className={btn} aria-label={`Export ${agent.name} as JSON`}><FileJson size={12} aria-hidden /> Export</button>
        <button type="button" onClick={onImportInto} className={btn} aria-label={`Import a JSON file into ${agent.name}`}><Upload size={12} aria-hidden /> Import</button>
      </div>
    </div>
  );
}

export function AgentSidebar(p: Props) {
  const [category, setCategory] = useState('all');
  const list = useRef<HTMLDivElement>(null);
  const categories = useMemo(() => ['all', ...new Set(p.agents.map(a => a.category))], [p.agents]);
  const visible = useMemo(() => {
    const inCat = category === 'all' ? p.agents : p.agents.filter(a => a.category === category);
    return [...inCat].sort((a, b) => Number(b.mostUsed) - Number(a.mostUsed)); // popular first, otherwise stable
  }, [p.agents, category]);

  return (
    <aside aria-label="Agents" className="flex min-h-0 flex-col gap-4 lg:h-full">
      <section className="glass rounded-2xl p-4">
        <h2 className="mb-3 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-muted">Categories</h2>
        <div className="flex flex-wrap gap-1.5">
          {categories.map(c => (
            <button key={c} type="button" aria-pressed={category === c} onClick={() => { setCategory(c); list.current?.scrollTo({ top: 0 }); }}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${category === c ? 'bg-accent text-on-accent shadow' : 'border border-line text-muted hover:bg-hover hover:text-fg'}`}>
              {c === 'all' ? 'All' : c}
            </button>
          ))}
        </div>
      </section>

      <section className="glass rounded-2xl p-4" aria-labelledby="my-agents-h">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 id="my-agents-h" className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-muted">My agents</h2>
          <div className="flex gap-1.5">
            <button type="button" onClick={p.onImport} className="glass flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition hover:bg-hover" aria-label="Import agent from JSON file">
              <Upload size={13} aria-hidden /> Import
            </button>
            <button type="button" onClick={p.onCreate} className="flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-on-accent transition hover:brightness-110 active:scale-95" aria-label="Create a new agent">
              <Plus size={13} aria-hidden /> New
            </button>
          </div>
        </div>
        {p.customAgents.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs text-muted">
            Build your own agent from a template, or import one from a <code>.json</code> file.
          </p>
        ) : (
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {p.customAgents.map(a => (
              <CustomAgentCard key={a.id} agent={a} selected={p.selectedKey === `custom:${a.id}`} active={p.activeKeys.includes(`custom:${a.id}`)}
                onSelect={() => p.onSelect(`custom:${a.id}`)} onEdit={() => p.onEditCustom(a.id)} onExport={() => p.onExportCustom(a.id)} onImportInto={() => p.onImportInto(a.id)} />
            ))}
          </div>
        )}
      </section>

      <section className="glass flex min-h-0 flex-1 flex-col rounded-2xl p-4" aria-labelledby="all-agents-h">
        <div className="mb-3">
          <h2 id="all-agents-h" className="font-display text-base font-bold">{category === 'all' ? 'All agents' : category}</h2>
          <p className="text-xs text-muted">{visible.length} agent{visible.length === 1 ? '' : 's'} · popular first</p>
        </div>
        <div ref={list} className="no-scrollbar -mr-1 grid max-h-[460px] auto-rows-max content-start gap-2.5 overflow-y-auto pr-1 lg:max-h-none lg:flex-1" data-testid="agent-list">
          {visible.map(a => {
            const selected = p.selectedKey === a.id;
            const active = p.activeKeys.includes(a.id);
            return (
              <TiltCard
                key={a.id} as="button" max={4} cursor="magnet" selected={selected} status={active ? 'active' : 'idle'}
                onClick={() => p.onSelect(a.id)} aria-current={selected} data-agent={a.id}
              >
                <span className="flex items-start gap-3 p-3">
                  <span className="block [transform:translateZ(14px)]"><AgentAvatar icon={a.icon} gradient={a.gradient} size={44} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-display text-sm font-semibold">{a.name}</span>
                      {active ? <StatusChip status="active" className="shrink-0" /> : a.mostUsed && <span className="shrink-0 rounded-full bg-accent px-1.5 py-px font-mono text-[9px] font-bold uppercase text-on-accent">Popular</span>}
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-xs text-muted">{a.description}</span>
                    <span className="mt-1.5 flex justify-between gap-2 font-mono text-[10px] uppercase tracking-wider"><span className="truncate text-muted">{a.category}</span><span className="truncate text-accent">{a.useCase}</span></span>
                  </span>
                </span>
              </TiltCard>
            );
          })}
        </div>
      </section>
    </aside>
  );
}
