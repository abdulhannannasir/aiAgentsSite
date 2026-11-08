import type { ComponentProps } from 'react';
import { AgentSidebar } from '../components/AgentSidebar';
import { ChatWindow } from '../components/ChatWindow';
import { ErrorState } from '../components/ui/Display';
import { useWorkspace } from '../app/workspace';

/** The original workspace: agent list on the left, the selected agent's chat on the right (one at a time on phones). */
export function ChatPage({ selectedKey, onSelect, chatWindow }: {
  selectedKey: string | null;
  onSelect: (key: string) => void;
  chatWindow: ComponentProps<typeof ChatWindow>;
}) {
  const ws = useWorkspace();
  if (ws.loadError) {
    return (
      <div className="mx-auto mt-16 max-w-md">
        <ErrorState title="Could not load the agents" onRetry={ws.reload}>The server did not answer. Check your connection and try again.</ErrorState>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 lg:h-[calc(100dvh-105px)] lg:min-h-[620px] lg:grid-cols-12 lg:gap-6">
      <div className={`min-h-0 min-w-0 lg:col-span-5 lg:block ${selectedKey ? 'hidden' : 'block'}`}>
        <AgentSidebar
          agents={ws.agents} customAgents={ws.customAgents} selectedKey={selectedKey} activeKeys={ws.chat.streamingKeys} onSelect={onSelect}
          onCreate={() => ws.openCreator(null)} onImport={() => ws.triggerImport(null)}
          onEditCustom={ws.editCustomAgent} onExportCustom={ws.exportCustomAgent} onImportInto={id => ws.triggerImport(id)}
        />
      </div>
      <div className={`min-h-0 min-w-0 lg:col-span-7 lg:block ${selectedKey ? 'block' : 'hidden'}`}>
        <ChatWindow {...chatWindow} />
      </div>
    </div>
  );
}
