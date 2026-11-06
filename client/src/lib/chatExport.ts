import type { Message, StepStatus } from '../types';

const STATUS_LABEL: Record<StepStatus, string> = { pending: 'pending', active: 'in progress', complete: 'done', error: 'failed' };

export interface ChatExportInput {
  agentName: string;
  messages: Message[];
  exportedAt?: Date;
}

/** Renders a conversation as clean Markdown, including each reply's thought-stream steps. */
export function chatToMarkdown({ agentName, messages, exportedAt = new Date() }: ChatExportInput): string {
  const lines: string[] = [
    `# Chat with ${agentName}`,
    '',
    `_Exported ${exportedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC from AgentVerse_`,
    ''
  ];

  for (const m of messages) {
    if (m.role === 'assistant' && !m.content.trim() && m.status !== 'error') continue; // empty streaming placeholder
    lines.push('---', '', m.role === 'user' ? '### You' : `### ${agentName}`, '');
    if (m.role === 'assistant' && m.status === 'error') {
      lines.push(`> ⚠️ ${m.error ?? 'This reply failed.'}`, '');
      if (m.content.trim()) lines.push(m.content.trim(), '');
    } else {
      lines.push(m.content.trim(), '');
    }
    if (m.trace?.length) {
      lines.push('<details>', `<summary>Thought stream (${m.trace.length} step${m.trace.length === 1 ? '' : 's'})</summary>`, '');
      m.trace.forEach((s, i) => lines.push(`${i + 1}. **${s.role}** (${s.agentName}) - ${s.label} - _${STATUS_LABEL[s.status]}_`));
      lines.push('', '</details>', '');
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

export function chatFileName(agentName: string, at: Date = new Date()): string {
  const slug = agentName.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'chat';
  return `chat-${slug}-${at.toISOString().slice(0, 10)}.md`;
}

/** Downloads text as a file using a client-side Blob. */
export function downloadTextFile(filename: string, content: string, mime = 'text/plain'): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Copies text to the clipboard, falling back to a hidden textarea where the async API is unavailable. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
