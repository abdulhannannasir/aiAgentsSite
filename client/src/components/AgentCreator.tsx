import { useId, useRef, useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, FileJson, Trash2, Upload } from 'lucide-react';
import { Modal } from './Modal';
import { useToast } from './Toast';
import { LIMITS, MAX_AGENT_FILE_BYTES, parseAgentFile, validateDraft } from '../lib/agentFile';
import { AGENT_TEMPLATES } from '../lib/templates';
import { TOOL_IDS, type AgentDraft, type ToolId } from '../types';

const EMOJI = ['🤖', '🧠', '⚖️', '🐞', '🔎', '📈', '✍️', '🎨', '🛠️', '🎓', '🩺', '🚀', '🧾', '🌍'];
const TOOL_LABEL: Record<ToolId, string> = {
  web_search: 'Web search', code_interpreter: 'Code interpreter', file_reader: 'File reader', ticket_system: 'Ticket system',
  email_sender: 'Email sender', knowledge_base: 'Knowledge base', calculator: 'Calculator'
};

interface Props {
  open: boolean;
  onClose: () => void;
  /** What the form starts with: empty, a template, an existing agent or an imported file. */
  initial: AgentDraft;
  initialWarnings?: string[];
  editing: boolean;
  onSave: (draft: AgentDraft) => void;
  onDelete?: () => void;
  onExport: (draft: AgentDraft) => void;
}

function Form({ initial, initialWarnings = [], editing, onClose, onSave, onDelete, onExport }: Omit<Props, 'open'>) {
  const { toast } = useToast();
  const ids = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<AgentDraft>(initial);
  const [showErrors, setShowErrors] = useState(false);
  const [template, setTemplate] = useState<string | null>(null);
  const [importState, setImportState] = useState<{ kind: 'error' | 'ok'; text: string } | null>(
    initialWarnings.length ? { kind: 'ok', text: initialWarnings.join(' ') } : null
  );
  const [confirmDelete, setConfirmDelete] = useState(false);

  const errors = validateDraft(draft);
  const visible = showErrors ? errors : {};
  const set = <K extends keyof AgentDraft>(key: K, value: AgentDraft[K]) => setDraft(d => ({ ...d, [key]: value }));

  const applyTemplate = (id: string) => {
    const t = AGENT_TEMPLATES.find(x => x.id === id);
    if (!t) return;
    setDraft(t.draft);
    setTemplate(id);
    setShowErrors(false);
    setImportState(null);
    toast(`Loaded template: ${t.draft.name}`, 'success');
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_AGENT_FILE_BYTES) { setImportState({ kind: 'error', text: `That file is too large (max ${Math.round(MAX_AGENT_FILE_BYTES / 1000)} KB).` }); return; }
    let text: string;
    try { text = await file.text(); } catch { setImportState({ kind: 'error', text: 'Could not read that file.' }); return; }
    const result = parseAgentFile(text);
    if (!result.ok) { setImportState({ kind: 'error', text: result.error }); return; }
    setDraft(result.draft);
    setTemplate(null);
    setShowErrors(false);
    setImportState({ kind: 'ok', text: `Imported "${result.draft.name}". Review it, then save.${result.warnings.length ? ' ' + result.warnings.join(' ') : ''}` });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setShowErrors(true);
    if (Object.keys(errors).length) return;
    onSave({ ...draft, name: draft.name.trim(), systemPrompt: draft.systemPrompt.trim(), description: draft.description.trim() });
  };

  const fieldCls = (bad?: string) => `w-full rounded-xl border bg-transparent px-3 py-2 text-sm outline-none transition placeholder:text-muted focus:border-accent focus:ring-1 focus:ring-accent ${bad ? 'border-rose-500' : 'border-line'}`;
  const Err = ({ id, msg }: { id: string; msg?: string }) => (msg ? <p id={id} role="alert" className="mt-1 text-xs text-rose-600 dark:text-rose-400">{msg}</p> : null);

  return (
    <form onSubmit={submit} noValidate className="max-h-[82vh] overflow-y-auto">
      <div className="space-y-5 p-5">
        {/* Start from a template */}
        <section aria-labelledby={`${ids}-tpl`}>
          <h3 id={`${ids}-tpl`} className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Start from a template</h3>
          <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Agent templates">
            {AGENT_TEMPLATES.map(t => (
              <motion.button
                key={t.id} type="button" whileTap={{ scale: 0.98 }} onClick={() => applyTemplate(t.id)} data-testid="template-card" aria-pressed={template === t.id}
                className={`flex items-start gap-3 rounded-xl border p-3 text-left transition hover:bg-hover ${template === t.id ? 'border-accent bg-accent/10' : 'border-line'}`}
              >
                <span className="text-2xl" aria-hidden>{t.draft.icon}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold leading-tight">{t.draft.name}</span>
                  <span className="mt-0.5 block text-xs text-muted">{t.tagline}</span>
                </span>
              </motion.button>
            ))}
          </div>
        </section>

        {/* Import */}
        <section className="flex flex-wrap items-center gap-2">
          <input ref={fileInput} type="file" accept=".json,application/json" className="sr-only" aria-label="Import agent JSON file" data-testid="creator-import-input"
            onChange={e => { void importFile(e.target.files?.[0]); e.target.value = ''; }} />
          <button type="button" onClick={() => fileInput.current?.click()} className="glass flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-medium transition hover:bg-hover">
            <Upload size={14} aria-hidden /> Import .json
          </button>
          <button type="button" onClick={() => { setShowErrors(true); if (Object.keys(errors).length === 0) onExport(draft); }} className="glass flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-medium transition hover:bg-hover">
            <FileJson size={14} aria-hidden /> Export .json
          </button>
          {importState && (
            <p role={importState.kind === 'error' ? 'alert' : 'status'} data-testid="import-message"
              className={`flex w-full items-start gap-1.5 text-xs ${importState.kind === 'error' ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
              {importState.kind === 'error' ? <AlertTriangle size={14} className="mt-px shrink-0" aria-hidden /> : <CheckCircle2 size={14} className="mt-px shrink-0" aria-hidden />}
              <span>{importState.text}</span>
            </p>
          )}
        </section>

        <hr className="border-line" />

        {/* Fields */}
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <div>
            <label htmlFor={`${ids}-name`} className="mb-1 block text-xs font-semibold">Name</label>
            <input id={`${ids}-name`} data-autofocus value={draft.name} maxLength={LIMITS.name + 20} onChange={e => set('name', e.target.value)}
              aria-invalid={!!visible.name} aria-describedby={visible.name ? `${ids}-name-e` : undefined} placeholder="e.g. Contract Reviewer" className={fieldCls(visible.name)} />
            <Err id={`${ids}-name-e`} msg={visible.name} />
          </div>
          <div>
            <label htmlFor={`${ids}-icon`} className="mb-1 block text-xs font-semibold">Icon</label>
            <input id={`${ids}-icon`} value={draft.icon} maxLength={LIMITS.icon} onChange={e => set('icon', e.target.value)} className={`${fieldCls()} w-20 text-center text-lg`} />
          </div>
        </div>
        <div className="-mt-2 flex flex-wrap gap-1" role="group" aria-label="Icon suggestions">
          {EMOJI.map(e => (
            <button key={e} type="button" onClick={() => set('icon', e)} aria-label={`Use icon ${e}`} aria-pressed={draft.icon === e}
              className={`h-8 w-8 rounded-lg text-base transition hover:bg-hover ${draft.icon === e ? 'bg-accent/15 ring-1 ring-accent' : ''}`}>{e}</button>
          ))}
        </div>

        <div>
          <label htmlFor={`${ids}-desc`} className="mb-1 block text-xs font-semibold">Description <span className="font-normal text-muted">(optional)</span></label>
          <input id={`${ids}-desc`} value={draft.description} onChange={e => set('description', e.target.value)} placeholder="One line about what it does" className={fieldCls(visible.description)} />
          <Err id={`${ids}-desc-e`} msg={visible.description} />
        </div>

        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <label htmlFor={`${ids}-prompt`} className="text-xs font-semibold">System prompt</label>
            <span className={`text-[11px] ${draft.systemPrompt.length > LIMITS.systemPrompt ? 'text-rose-500' : 'text-muted'}`}>{draft.systemPrompt.length.toLocaleString()} / {LIMITS.systemPrompt.toLocaleString()}</span>
          </div>
          <textarea id={`${ids}-prompt`} rows={8} value={draft.systemPrompt} onChange={e => set('systemPrompt', e.target.value)}
            aria-invalid={!!visible.systemPrompt} aria-describedby={visible.systemPrompt ? `${ids}-prompt-e` : undefined}
            placeholder="You are a… Explain who the agent is, how it should answer and what it must never do." className={`${fieldCls(visible.systemPrompt)} resize-y font-mono text-[13px] leading-relaxed`} />
          <Err id={`${ids}-prompt-e`} msg={visible.systemPrompt} />
        </div>

        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <label htmlFor={`${ids}-temp`} className="text-xs font-semibold">Temperature</label>
            <output htmlFor={`${ids}-temp`} className="text-xs font-semibold tabular-nums text-accent">{draft.temperature.toFixed(1)}</output>
          </div>
          <input id={`${ids}-temp`} type="range" min={0} max={2} step={0.1} value={draft.temperature} onChange={e => set('temperature', Number(e.target.value))} className="w-full accent-[rgb(var(--accent))]" />
          <div className="flex justify-between text-[11px] text-muted"><span>Precise</span><span>Balanced</span><span>Creative</span></div>
        </div>

        <fieldset>
          <legend className="mb-1 text-xs font-semibold">Tool permissions</legend>
          <p className="mb-2 text-[11px] text-muted">Tools are simulated in this demo: permissions are saved and exported, but nothing is actually searched, run or sent.</p>
          <div className="flex flex-wrap gap-2">
            {TOOL_IDS.map(tool => {
              const on = draft.tools.includes(tool);
              return (
                <label key={tool} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition hover:bg-hover ${on ? 'border-accent bg-accent/10' : 'border-line'}`}>
                  <input type="checkbox" checked={on} onChange={() => set('tools', on ? draft.tools.filter(t => t !== tool) : [...draft.tools, tool])} className="accent-[rgb(var(--accent))]" />
                  {TOOL_LABEL[tool]}
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-line bg-[var(--surface)] px-5 py-3 shadow-[0_-10px_16px_-12px_rgba(0,0,0,0.35)]">
        <div>
          {editing && onDelete && (confirmDelete ? (
            <span className="flex items-center gap-2 text-xs">
              <span className="text-muted">Delete this agent?</span>
              <button type="button" onClick={onDelete} className="rounded-lg bg-rose-500 px-2.5 py-1.5 font-semibold text-white">Yes, delete</button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-lg px-2 py-1.5 text-muted hover:bg-hover">Keep</button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-500/10 dark:text-rose-400">
              <Trash2 size={14} aria-hidden /> Delete
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="rounded-xl px-3.5 py-2 text-sm font-medium text-muted transition hover:bg-hover hover:text-fg">Cancel</button>
          <button type="submit" className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 active:scale-95">{editing ? 'Save changes' : 'Create agent'}</button>
        </div>
      </div>
    </form>
  );
}

export function AgentCreator(props: Props) {
  return (
    <Modal open={props.open} onClose={props.onClose} size="xl" title={props.editing ? 'Agent settings' : 'Create an agent'}
      description="Write a system prompt, pick a temperature, or start from a template. Export and import as JSON.">
      {props.open && <Form {...props} />}
    </Modal>
  );
}
