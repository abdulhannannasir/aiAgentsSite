import { useMemo } from 'react';
import { Copy, Download } from 'lucide-react';
import { Modal } from './Modal';
import { useToast } from './Toast';
import { agentFileName, serializeAgent } from '../lib/agentFile';
import { copyToClipboard, downloadTextFile } from '../lib/chatExport';
import type { AgentDraft } from '../types';

interface Props {
  draft: AgentDraft | null;
  onClose: () => void;
}

/** Shows the exact JSON that will be exported, with one-click download (client-side Blob) and copy. */
export function AgentExportModal({ draft, onClose }: Props) {
  const { toast } = useToast();
  const json = useMemo(() => (draft ? serializeAgent(draft) : ''), [draft]);
  const filename = draft ? agentFileName(draft.name) : '';

  const download = () => {
    downloadTextFile(filename, json, 'application/json');
    toast(`Downloaded ${filename}`, 'success');
  };
  const copy = async () => {
    const ok = await copyToClipboard(json);
    toast(ok ? 'Agent JSON copied to clipboard' : 'Could not copy. Select the text and copy it manually.', ok ? 'success' : 'error');
  };

  return (
    <Modal open={!!draft} onClose={onClose} title="Export agent" description="A portable .json file with the agent's name, system prompt, temperature and tool permissions." size="lg">
      <div className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-3 text-xs text-muted">
          <span>File: <code className="rounded bg-hover px-1.5 py-0.5 text-fg">{filename}</code></span>
          <span>{json.length.toLocaleString()} characters</span>
        </div>
        <pre tabIndex={0} aria-label="Exported JSON" data-testid="export-json" className="max-h-72 overflow-auto rounded-xl border border-line bg-[var(--code-bg)] p-3 text-xs leading-relaxed">{json}</pre>
        <p className="text-xs text-muted">Anyone can load this file with <strong>Import</strong> in the agent creator. It contains your prompt, so only share it with people you trust.</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={copy} className="glass flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition hover:bg-hover">
            <Copy size={15} aria-hidden /> Copy JSON
          </button>
          <button type="button" data-autofocus onClick={download} className="flex items-center gap-2 rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-on-accent transition hover:brightness-110 active:scale-95">
            <Download size={15} aria-hidden /> Download .json
          </button>
        </div>
      </div>
    </Modal>
  );
}
