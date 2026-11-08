import { useState } from 'react';
import { Copy, FileJson, MessagesSquare, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { AgentAvatar, CUSTOM_GRADIENT } from '../components/AgentAvatar';
import { Modal } from '../components/Modal';
import { Button } from '../components/ui/Button';
import { Badge, Card, EmptyState, PageHeader } from '../components/ui/Display';
import { useWorkspace } from '../app/workspace';
import type { CustomAgent } from '../types';

export default function MyAgentsPage() {
  const ws = useWorkspace();
  const [toDelete, setToDelete] = useState<CustomAgent | null>(null);
  const full = ws.customAgents.length >= ws.maxCustomAgents;

  return (
    <div>
      <PageHeader
        title="My Agents"
        description={`Agents you built or imported. They are saved in this browser (${ws.customAgents.length} of ${ws.maxCustomAgents}).`}
        actions={<>
          <Button icon={<Upload size={15} aria-hidden />} onClick={() => ws.triggerImport(null)}>Import JSON</Button>
          <Button variant="primary" icon={<Plus size={15} aria-hidden />} onClick={() => ws.openCreator(null)} disabled={full} title={full ? 'Delete an agent to make room' : undefined}>New agent</Button>
        </>}
      />

      {ws.customAgents.length === 0 ? (
        <EmptyState icon={<Plus size={20} />} title="You haven't built an agent yet"
          action={<div className="flex flex-wrap justify-center gap-2"><Button variant="primary" size="sm" onClick={() => ws.navigate('builder')}>Start from a template</Button><Button size="sm" onClick={() => ws.triggerImport(null)}>Import a .json file</Button></div>}>
          Give an agent a name, a personality and instructions, then chat with it like any built-in agent.
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="my-agents-grid">
          {ws.customAgents.map(a => {
            const busy = ws.chat.streamingKeys.includes(`custom:${a.id}`);
            return (
              <Card as="li" key={a.id} data-my-agent={a.name} className="flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <AgentAvatar icon={a.icon} gradient={CUSTOM_GRADIENT} size={44} />
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate font-display text-sm font-semibold">{a.name}</h2>
                    <p className="font-mono text-[10px] uppercase tracking-wider text-muted">Temperature {a.temperature.toFixed(1)} · {a.tools.length} tool{a.tools.length === 1 ? '' : 's'}</p>
                  </div>
                  {busy && <Badge tone="accent">Active</Badge>}
                </div>
                <p className="line-clamp-2 flex-1 text-sm text-muted">{a.description || 'No description.'}</p>
                <p className="text-[11px] text-muted">Updated {new Date(a.updatedAt).toLocaleDateString()}</p>
                <div className="flex flex-wrap gap-1.5">
                  <Button variant="primary" size="sm" icon={<MessagesSquare size={13} aria-hidden />} onClick={() => ws.selectAgent(`custom:${a.id}`)} aria-label={`Chat with ${a.name}`}>Chat</Button>
                  <Button size="sm" icon={<Pencil size={13} aria-hidden />} onClick={() => ws.editCustomAgent(a.id)} aria-label={`Edit ${a.name}`}>Edit</Button>
                  <Button size="sm" icon={<Copy size={13} aria-hidden />} onClick={() => ws.duplicateCustomAgent(a.id)} disabled={full} aria-label={`Duplicate ${a.name}`}>Duplicate</Button>
                  <Button size="sm" variant="ghost" icon={<FileJson size={13} aria-hidden />} onClick={() => ws.exportCustomAgent(a.id)} aria-label={`Export ${a.name} as JSON`}>Export</Button>
                  <Button size="sm" variant="ghost" icon={<Trash2 size={13} aria-hidden />} onClick={() => setToDelete(a)} aria-label={`Delete ${a.name}`} className="hover:!text-rose-500">Delete</Button>
                </div>
              </Card>
            );
          })}
        </ul>
      )}

      <Modal open={!!toDelete} onClose={() => setToDelete(null)} title={`Delete ${toDelete?.name ?? 'agent'}?`} size="sm">
        <div className="p-5">
          <p className="text-sm text-muted">This removes the agent and its conversation from this browser. Export it first if you may want it back.</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={() => setToDelete(null)}>Cancel</Button>
            <Button variant="danger" icon={<Trash2 size={14} aria-hidden />} onClick={() => { if (toDelete) ws.removeCustomAgent(toDelete.id); setToDelete(null); }}>Delete agent</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
