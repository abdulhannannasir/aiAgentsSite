import { useState } from 'react';
import { Copy, FileJson, Lock, MessagesSquare, Pencil, Plus, Trash2, Upload, Users } from 'lucide-react';
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
  const signedIn = ws.account.status === 'signed-in';
  const workspaceName = ws.account.me?.workspace?.name ?? 'your workspace';
  const [moving, setMoving] = useState(false);

  return (
    <div>
      <PageHeader
        title="My Agents"
        description={signedIn
          ? `Agents saved in ${workspaceName}. Every edit is kept as a new version.`
          : `Agents you built or imported. They are saved in this browser (${ws.customAgents.length} of ${ws.maxCustomAgents}). Sign in to keep them in a workspace.`}
        actions={<>
          <Button icon={<Upload size={15} aria-hidden />} onClick={() => ws.triggerImport(null)}>Import JSON</Button>
          <Button variant="primary" icon={<Plus size={15} aria-hidden />} onClick={() => ws.openCreator(null)} disabled={full} title={full ? 'Delete an agent to make room' : undefined}>New agent</Button>
        </>}
      />

      {ws.localAgentsToImport.length > 0 && (
        <div role="status" data-testid="import-local-banner" className="mb-4 flex flex-col gap-3 rounded-2xl border border-line-strong bg-accent/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm">
            <strong>{ws.localAgentsToImport.length} agent{ws.localAgentsToImport.length === 1 ? '' : 's'}</strong> from before you signed in {ws.localAgentsToImport.length === 1 ? 'is' : 'are'} still only in this browser.
          </p>
          <Button variant="primary" size="sm" disabled={moving} onClick={async () => { setMoving(true); await ws.importLocalAgents(); setMoving(false); }}>
            {moving ? 'Moving…' : `Move to ${workspaceName}`}
          </Button>
        </div>
      )}

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
                    <p className="font-mono text-[10px] uppercase tracking-wider text-muted">Temperature {a.temperature.toFixed(1)} · {a.tools.length} tool{a.tools.length === 1 ? '' : 's'}{a.version ? ` · v${a.version}` : ''}</p>
                  </div>
                  {busy ? <Badge tone="accent">Active</Badge> : a.visibility === 'PRIVATE' ? <Badge><Lock size={9} aria-hidden /> Private</Badge> : a.visibility === 'WORKSPACE' ? <Badge tone="violet"><Users size={9} aria-hidden /> Shared</Badge> : null}
                </div>
                <p className="line-clamp-2 flex-1 text-sm text-muted">{a.description || 'No description.'}</p>
                <p className="text-[11px] text-muted">Updated {new Date(a.updatedAt).toLocaleDateString()}{a.createdByName ? ` · by ${a.createdByName}` : ''}</p>
                <div className="flex flex-wrap gap-1.5">
                  <Button variant="primary" size="sm" icon={<MessagesSquare size={13} aria-hidden />} onClick={() => ws.selectAgent(`custom:${a.id}`)} aria-label={`Chat with ${a.name}`}>Chat</Button>
                  {a.canEdit !== false && <Button size="sm" icon={<Pencil size={13} aria-hidden />} onClick={() => ws.editCustomAgent(a.id)} aria-label={`Edit ${a.name}`}>Edit</Button>}
                  <Button size="sm" icon={<Copy size={13} aria-hidden />} onClick={() => ws.duplicateCustomAgent(a.id)} disabled={full} aria-label={`Duplicate ${a.name}`}>Duplicate</Button>
                  <Button size="sm" variant="ghost" icon={<FileJson size={13} aria-hidden />} onClick={() => ws.exportCustomAgent(a.id)} aria-label={`Export ${a.name} as JSON`}>Export</Button>
                  {signedIn && a.canEdit && (
                    <Button size="sm" variant="ghost" icon={a.visibility === 'PRIVATE' ? <Users size={13} aria-hidden /> : <Lock size={13} aria-hidden />}
                      onClick={() => void ws.setAgentVisibility(a.id, a.visibility === 'PRIVATE' ? 'WORKSPACE' : 'PRIVATE')}
                      aria-label={a.visibility === 'PRIVATE' ? `Share ${a.name} with the workspace` : `Make ${a.name} private`}>
                      {a.visibility === 'PRIVATE' ? 'Share' : 'Make private'}
                    </Button>
                  )}
                  {a.canEdit !== false && <Button size="sm" variant="ghost" icon={<Trash2 size={13} aria-hidden />} onClick={() => setToDelete(a)} aria-label={`Delete ${a.name}`} className="hover:!text-rose-500">Delete</Button>}
                </div>
              </Card>
            );
          })}
        </ul>
      )}

      <Modal open={!!toDelete} onClose={() => setToDelete(null)} title={`Delete ${toDelete?.name ?? 'agent'}?`} size="sm">
        <div className="p-5">
          <p className="text-sm text-muted">{signedIn ? `This removes the agent and all its versions from ${workspaceName} for everyone.` : 'This removes the agent and its conversation from this browser.'} Export it first if you may want it back.</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={() => setToDelete(null)}>Cancel</Button>
            <Button variant="danger" icon={<Trash2 size={14} aria-hidden />} onClick={() => { if (toDelete) ws.removeCustomAgent(toDelete.id); setToDelete(null); }}>Delete agent</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
