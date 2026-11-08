import { createContext, useContext } from 'react';
import type { MetaResponse } from '../../../server/src/contracts';
import type { useChat } from '../hooks/useChat';
import type { FxPref } from '../lib/fx/capability';
import type { PageId } from '../lib/route';
import type { Agent, AgentDraft, CustomAgent, Theme, Workflow } from '../types';

/** Everything the app pages share. Provided once by App so pages don't need a dozen props each. */
export interface WorkspaceApi {
  agents: Agent[];
  workflows: Workflow[];
  mode: 'live' | 'demo' | null;
  /** What the server has configured; null until loaded (or if the server is older than /api/v1/meta). */
  meta: MetaResponse | null;
  loading: boolean;
  loadError: boolean;
  reload: () => void;

  customAgents: CustomAgent[];
  maxCustomAgents: number;
  duplicateCustomAgent: (id: string) => void;
  removeCustomAgent: (id: string) => void;
  removeAllCustomAgents: () => void;

  chat: ReturnType<typeof useChat>;
  selectAgent: (key: string) => void;
  startWorkflow: (w: Workflow) => void;
  openCreator: (editingId: string | null, draft?: AgentDraft, warnings?: string[]) => void;
  editCustomAgent: (id: string) => void;
  exportCustomAgent: (id: string) => void;
  triggerImport: (targetId?: string | null) => void;

  theme: Theme;
  setTheme: (t: Theme) => void;
  fxPref: FxPref;
  setFxPref: (p: FxPref) => void;

  navigate: (page: PageId) => void;
  openPalette: () => void;
  openShortcuts: () => void;
  openDocs: () => void;
}

export const WorkspaceContext = createContext<WorkspaceApi | null>(null);

export function useWorkspace(): WorkspaceApi {
  const ws = useContext(WorkspaceContext);
  if (!ws) throw new Error('useWorkspace must be used inside <WorkspaceContext.Provider>');
  return ws;
}
