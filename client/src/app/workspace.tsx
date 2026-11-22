import { createContext, useContext } from 'react';
import type { MetaResponse } from '../../../server/src/contracts';
import type { useChat } from '../hooks/useChat';
import type { Me } from '../lib/account';
import type { AgentStats } from '../lib/marketplace';
import type { ModelCatalog, ToolInfo } from '../lib/tools';
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
  /** Tools and models available on this server (null until loaded or if the server is older). */
  toolInfo: ToolInfo[] | null;
  models: ModelCatalog | null;
  loading: boolean;
  loadError: boolean;
  reload: () => void;

  /** Accounts: 'unavailable' when the server has no database/auth configured. */
  account: {
    status: 'loading' | 'unavailable' | 'guest' | 'signed-in';
    me: Me | null;
    signOut: () => Promise<void>;
    switchWorkspace: (id: string) => Promise<void>;
    createWorkspace: (name: string) => Promise<void>;
  };

  /** Guests: agents in this browser. Signed in: agents saved in the active workspace. */
  customAgents: CustomAgent[];
  maxCustomAgents: number;
  /** Signed in: agents still sitting in this browser from guest use, which can be moved into the workspace. */
  localAgentsToImport: CustomAgent[];
  importLocalAgents: () => Promise<void>;
  setAgentVisibility: (id: string, visibility: 'PRIVATE' | 'WORKSPACE') => Promise<void>;
  duplicateCustomAgent: (id: string) => void;
  removeCustomAgent: (id: string) => void;
  removeAllCustomAgents: () => void;

  /** Real per-agent usage and ratings; null when the server has no database (then nothing is shown). */
  stats: Map<string, AgentStats> | null;
  refreshStats: () => void;
  /** Signed in: favorite agent keys (built-in ids or "custom:<id>"). */
  favorites: Set<string>;
  toggleFavorite: (key: string) => Promise<void>;

  chat: ReturnType<typeof useChat>;
  selectAgent: (key: string) => void;
  /** Opens the chat with an agent and puts `text` in the message box (e.g. an example prompt). */
  startChatWith: (key: string, text: string) => void;
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
