import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, ClipboardCopy, FileDown, Home, Keyboard, MessageSquarePlus, Moon, Plus, Rocket, Sparkles, Sun, Upload } from 'lucide-react';
import { AgentCreator } from './components/AgentCreator';
import { AgentExportModal } from './components/AgentExportModal';
import { AgentAvatar, CUSTOM_GRADIENT, workflowIcon } from './components/AgentAvatar';
import { AgentSidebar } from './components/AgentSidebar';
import { ChatWindow } from './components/ChatWindow';
import { CommandPalette } from './components/CommandPalette';
import { DocsModal } from './components/DocsModal';
import { Navbar } from './components/Navbar';
import { ShortcutsModal } from './components/ShortcutsModal';
import { useToast } from './components/Toast';
import { useChat } from './hooks/useChat';
import { fetchAgents, fetchHealth, fetchWorkflows } from './lib/api';
import { EMPTY_DRAFT, MAX_AGENT_FILE_BYTES, isStoredAgent, parseAgentFile } from './lib/agentFile';
import { chatFileName, chatToMarkdown, copyToClipboard, downloadTextFile } from './lib/chatExport';
import { MOD, isEditableTarget } from './lib/platform';
import { readStored, writeStored } from './lib/storage';
import { useFx, type FxPref } from './lib/fx/capability';
import { useView } from './lib/route';
import { CustomCursor } from './components/fx/CustomCursor';
import { FxBackground } from './components/fx/FxBackground';
import { LandingPage } from './components/landing/LandingPage';
import type { ActiveAgent, Agent, AgentDraft, Command, CustomAgent, Theme, Workflow } from './types';

const THEME_KEY = 'agentverse.theme';
const AGENTS_KEY = 'agentverse.customAgents';
const MAX_CUSTOM_AGENTS = 30;
const EMPTY_COMPOSER: { value: string; workflow: Workflow | null } = { value: '', workflow: null };

const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
const isTheme = (v: unknown): v is Theme => v === 'dark' || v === 'light';
const draftOf = (a: CustomAgent): AgentDraft => ({ name: a.name, description: a.description, icon: a.icon, systemPrompt: a.systemPrompt, temperature: a.temperature, tools: a.tools });
const isDesktop = () => window.matchMedia('(min-width: 1024px)').matches;

interface CreatorState { open: boolean; editingId: string | null; draft: AgentDraft; warnings: string[] }

export default function App() {
  const { toast } = useToast();
  const chat = useChat();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [view, go] = useView();
  const fx = useFx();

  // ---- data from the server
  const [agents, setAgents] = useState<Agent[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [mode, setMode] = useState<'live' | 'demo' | null>(null);
  const [loadError, setLoadError] = useState(false);
  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const [a, w, h] = await Promise.all([fetchAgents(), fetchWorkflows().catch(() => [] as Workflow[]), fetchHealth().catch(() => null)]);
      setAgents(a);
      setWorkflows(w);
      setMode(h?.mode ?? null);
    } catch {
      setLoadError(true);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // ---- persistent client settings
  const [theme, setTheme] = useState<Theme>(() => readStored<Theme>(THEME_KEY, 'dark', isTheme));
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#05060a' : '#eef2f9');
    writeStored(THEME_KEY, theme);
  }, [theme]);

  const [customAgents, setCustomAgents] = useState<CustomAgent[]>(() => {
    const raw = readStored<unknown>(AGENTS_KEY, []);
    return Array.isArray(raw) ? (raw.filter(isStoredAgent) as CustomAgent[]).slice(0, MAX_CUSTOM_AGENTS) : [];
  });
  useEffect(() => { writeStored(AGENTS_KEY, customAgents); }, [customAgents]);

  // ---- selection, composer and dialogs
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [composer, setComposer] = useState(EMPTY_COMPOSER);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const [creator, setCreator] = useState<CreatorState>({ open: false, editingId: null, draft: EMPTY_DRAFT, warnings: [] });
  const [exportDraft, setExportDraft] = useState<AgentDraft | null>(null);

  const selectedCustom = useMemo(() => customAgents.find(a => `custom:${a.id}` === selectedKey), [customAgents, selectedKey]);
  const activeAgent = useMemo<ActiveAgent | null>(() => {
    if (!selectedKey) return null;
    if (selectedCustom) {
      return { key: selectedKey, name: selectedCustom.name, icon: selectedCustom.icon, custom: true, gradient: CUSTOM_GRADIENT,
        subtitle: selectedCustom.description ? `Custom agent • ${selectedCustom.description}` : 'Custom agent' };
    }
    const a = agents.find(x => x.id === selectedKey);
    return a ? { key: a.id, name: a.name, icon: a.icon, custom: false, gradient: a.gradient, subtitle: `${a.category} • ${a.useCase}` } : null;
  }, [selectedKey, selectedCustom, agents]);

  const messages = (selectedKey && chat.threads[selectedKey]) || [];
  const streaming = !!selectedKey && chat.streamingKeys.includes(selectedKey);

  const focusComposer = useCallback((force = false) => {
    if (!force && !isDesktop()) return; // don't pop the on-screen keyboard open on phones
    window.setTimeout(() => inputRef.current?.focus(), 60);
  }, []);

  const selectAgent = useCallback((key: string) => {
    setSelectedKey(key);
    setComposer(EMPTY_COMPOSER);
    go('app'); // from the landing page or the palette: open the workspace on this agent
    focusComposer();
  }, [focusComposer, go]);

  const newChat = useCallback(() => {
    if (!selectedKey) return;
    chat.clear(selectedKey);
    setComposer(EMPTY_COMPOSER);
    focusComposer(true);
    toast('Started a new chat');
  }, [selectedKey, chat, focusComposer, toast]);

  const send = useCallback(() => {
    if (!activeAgent) return;
    const text = composer.value.trim();
    if (!text) return;
    if (composer.workflow && text === composer.workflow.promptStarter.trim()) {
      toast(`Add your topic after ${composer.workflow.command} first.`);
      return;
    }
    void chat.send({ agent: activeAgent, customAgent: selectedCustom, workflow: composer.workflow, text });
    setComposer(EMPTY_COMPOSER);
  }, [activeAgent, composer, selectedCustom, chat, toast]);

  const startWorkflow = useCallback((w: Workflow) => {
    if (!selectedKey) {
      const lead = agents.find(a => a.id === w.steps[0]?.agentId) ?? agents[0];
      if (lead) setSelectedKey(lead.id);
    }
    setComposer({ value: w.promptStarter, workflow: w });
    go('app');
    focusComposer(true);
  }, [selectedKey, agents, focusComposer, go]);

  // ---- chat export
  const markdown = useCallback(() => chatToMarkdown({ agentName: activeAgent?.name ?? 'Agent', messages }), [activeAgent, messages]);
  const copyChat = useCallback(async () => {
    if (!messages.length) { toast('Nothing to export yet.'); return; }
    const ok = await copyToClipboard(markdown());
    toast(ok ? 'Chat copied as Markdown' : 'Could not copy to the clipboard. Try downloading instead.', ok ? 'success' : 'error');
  }, [messages.length, markdown, toast]);
  const downloadChat = useCallback(() => {
    if (!messages.length) { toast('Nothing to export yet.'); return; }
    const name = chatFileName(activeAgent?.name ?? 'chat');
    downloadTextFile(name, markdown(), 'text/markdown');
    toast(`Downloaded ${name}`, 'success');
  }, [messages.length, activeAgent, markdown, toast]);

  // ---- custom agents
  const openCreator = useCallback((editingId: string | null, draft: AgentDraft = EMPTY_DRAFT, warnings: string[] = []) => setCreator({ open: true, editingId, draft, warnings }), []);
  const closeCreator = useCallback(() => setCreator(c => ({ ...c, open: false })), []);

  const saveAgent = (draft: AgentDraft) => {
    const now = Date.now();
    if (creator.editingId) {
      setCustomAgents(list => list.map(a => (a.id === creator.editingId ? { ...a, ...draft, updatedAt: now } : a)));
      toast(`Saved ${draft.name}`, 'success');
    } else {
      if (customAgents.length >= MAX_CUSTOM_AGENTS) { toast(`You can keep up to ${MAX_CUSTOM_AGENTS} custom agents. Delete one first.`, 'error'); return; }
      const id = uid();
      setCustomAgents(list => [...list, { ...draft, id, createdAt: now, updatedAt: now }]);
      toast(`Created ${draft.name}`, 'success');
      selectAgent(`custom:${id}`);
    }
    closeCreator();
  };

  const deleteAgent = () => {
    const id = creator.editingId;
    if (!id) return;
    const key = `custom:${id}`;
    chat.clear(key);
    setCustomAgents(list => list.filter(a => a.id !== id));
    setSelectedKey(k => (k === key ? null : k));
    closeCreator();
    toast('Agent deleted');
  };

  const importInput = useRef<HTMLInputElement>(null);
  const importTarget = useRef<string | null>(null);
  const triggerImport = (targetId: string | null = null) => { importTarget.current = targetId; importInput.current?.click(); };
  const onImportFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_AGENT_FILE_BYTES) { toast(`That file is too large (max ${Math.round(MAX_AGENT_FILE_BYTES / 1000)} KB).`, 'error'); return; }
    let text: string;
    try { text = await file.text(); } catch { toast('Could not read that file.', 'error'); return; }
    const result = parseAgentFile(text);
    if (!result.ok) { toast(`Import failed: ${result.error}`, 'error'); return; }
    openCreator(importTarget.current, result.draft, [`Loaded "${result.draft.name}" from ${file.name}. Review it, then save.`, ...result.warnings]);
  };

  // ---- command palette
  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];
    list.push(view === 'app'
      ? { id: 'go-home', group: 'Navigate', label: 'Go to the home page', keywords: 'landing overview intro', icon: <Home size={15} />, run: () => go('landing') }
      : { id: 'go-app', group: 'Navigate', label: 'Open the workspace', keywords: 'launch chat agents app', icon: <Rocket size={15} />, run: () => go('app') });
    if (view === 'app' && activeAgent) {
      list.push({ id: 'new-chat', group: 'Chat', label: 'New chat', hint: `Clear the conversation with ${activeAgent.name}`, shortcut: `${MOD}N`, keywords: 'clear reset', icon: <MessageSquarePlus size={15} />, run: newChat });
      if (messages.length) {
        list.push({ id: 'chat-copy', group: 'Chat', label: 'Copy chat as Markdown', keywords: 'export clipboard', icon: <ClipboardCopy size={15} />, run: () => void copyChat() });
        list.push({ id: 'chat-download', group: 'Chat', label: 'Download chat as .md', keywords: 'export save file markdown', icon: <FileDown size={15} />, run: downloadChat });
      }
    }
    for (const w of workflows) {
      const Icon = workflowIcon(w.icon);
      list.push({ id: `wf-${w.id}`, group: 'Workflows', label: `Run ${w.command}: ${w.name}`, hint: w.steps.map(s => s.role).join(' → '), keywords: `workflow team multi-agent ${w.description}`, icon: <Icon size={15} />, run: () => startWorkflow(w) });
    }
    list.push({ id: 'agent-new', group: 'Create', label: 'Create a new agent…', keywords: 'custom builder template', icon: <Plus size={15} />, run: () => openCreator(null) });
    list.push({ id: 'agent-import', group: 'Create', label: 'Import an agent from JSON…', keywords: 'upload file', icon: <Upload size={15} />, run: () => triggerImport(null) });
    for (const c of customAgents) {
      list.push({ id: `agent-c-${c.id}`, group: 'Agents', label: `Switch to ${c.name}`, hint: 'Custom agent', keywords: `custom ${c.description}`, icon: <AgentAvatar icon={c.icon} gradient={CUSTOM_GRADIENT} size={24} />, run: () => selectAgent(`custom:${c.id}`) });
    }
    for (const a of agents) {
      list.push({ id: `agent-${a.id}`, group: 'Agents', label: `Switch to ${a.name}`, hint: `${a.category} • ${a.useCase}`, keywords: `${a.category} ${a.description} ${a.useCase}`, icon: <AgentAvatar icon={a.icon} gradient={a.gradient} size={24} />, run: () => selectAgent(a.id) });
    }
    list.push({ id: 'theme', group: 'Appearance', label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', keywords: 'toggle dark light mode appearance', icon: theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />, run: () => setTheme(t => (t === 'dark' ? 'light' : 'dark')) });
    const nextFx: FxPref = fx.pref === 'auto' ? 'low' : fx.pref === 'low' ? 'off' : 'auto';
    const fxName = { auto: 'full (automatic)', low: 'lite', off: 'off' } as const;
    list.push({ id: 'fx', group: 'Appearance', label: `Visual effects: ${fxName[fx.pref]} — switch to ${fxName[nextFx]}`, keywords: 'effects animation 3d cursor performance motion reduce lite', icon: <Sparkles size={15} />, run: () => { fx.setPref(nextFx); toast(`Visual effects: ${fxName[nextFx]}`); } });
    list.push({ id: 'shortcuts', group: 'Help', label: 'Keyboard shortcuts', shortcut: '?', keywords: 'help keys cheatsheet', icon: <Keyboard size={15} />, run: () => setShortcutsOpen(true) });
    list.push({ id: 'docs', group: 'Help', label: 'Open documentation', keywords: 'help guide how to docs', icon: <BookOpen size={15} />, run: () => setDocsOpen(true) });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, go, fx.pref, activeAgent, messages.length, workflows, customAgents, agents, theme, newChat, copyChat, downloadChat, startWorkflow, selectAgent, openCreator]);

  // ---- global keyboard shortcuts
  const anyModalOpen = paletteOpen || shortcutsOpen || docsOpen || creator.open || !!exportDraft;
  const live = useRef({ anyModalOpen, newChat, hasAgent: !!activeAgent, inApp: view === 'app' });
  live.current = { anyModalOpen, newChat, hasAgent: !!activeAgent, inApp: view === 'app' };
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { anyModalOpen: modal, newChat: startNew, hasAgent, inApp } = live.current;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(o => !o); return; }
      if (modal) return;
      // Cmd/Ctrl+N is often reserved by the browser; Alt+N is the dependable alternative.
      if (inApp && e.code === 'KeyN' && ((mod && !e.shiftKey) || (e.altKey && !mod))) { e.preventDefault(); startNew(); return; }
      if (isEditableTarget(e.target) || mod || e.altKey) return;
      if (e.key === '?') { e.preventDefault(); setShortcutsOpen(true); return; }
      if (inApp && e.key === '/' && hasAgent) {
        e.preventDefault();
        setComposer(c => (c.value || c.workflow ? c : { ...c, value: '/' }));
        focusComposer(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [focusComposer]);

  // The landing page is always dark; the workspace follows the theme. The swarm only shows on dark surfaces.
  const darkSurface = view === 'landing' || theme === 'dark';
  const openBuilder = useCallback((draft?: AgentDraft) => { go('app'); openCreator(null, draft ?? EMPTY_DRAFT); }, [go, openCreator]);

  return (
    <div className="relative min-h-dvh">
      {darkSurface && <FxBackground view={view} />}
      {darkSurface && <div aria-hidden className="grain" />}
      <CustomCursor />

      {view === 'landing' ? (
        <LandingPage
          agents={agents} workflows={workflows} mode={mode}
          onLaunch={() => go('app')} onOpenAgent={selectAgent} onRunWorkflow={startWorkflow}
          onOpenBuilder={openBuilder} onOpenPalette={() => setPaletteOpen(true)}
          onOpenDocs={() => setDocsOpen(true)} onOpenShortcuts={() => setShortcutsOpen(true)}
        />
      ) : (
      <>
      <Navbar
        agentCount={agents.length} mode={mode} theme={theme}
        onToggleTheme={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
        onOpenPalette={() => setPaletteOpen(true)} onOpenShortcuts={() => setShortcutsOpen(true)} onOpenDocs={() => setDocsOpen(true)}
        onCreateAgent={() => openCreator(null)} onHome={() => go('landing')}
      />

      <main className="relative z-10 mx-auto max-w-7xl px-3 py-4 sm:px-6 lg:py-6">
        {loadError ? (
          <div role="alert" className="glass mx-auto mt-16 max-w-md rounded-2xl p-8 text-center">
            <p className="text-lg font-semibold">Could not load the agents</p>
            <p className="mt-1 text-sm text-muted">The server did not answer. Check your connection and try again.</p>
            <button type="button" onClick={() => void load()} className="mt-4 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-on-accent">Retry</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:h-[calc(100dvh-132px)] lg:min-h-[620px] lg:grid-cols-12 lg:gap-6">
            <div className={`min-h-0 min-w-0 lg:col-span-4 lg:block ${selectedKey ? 'hidden' : 'block'}`}>
              <AgentSidebar
                agents={agents} customAgents={customAgents} selectedKey={selectedKey} activeKeys={chat.streamingKeys} onSelect={selectAgent}
                onCreate={() => openCreator(null)} onImport={() => triggerImport(null)}
                onEditCustom={id => { const a = customAgents.find(x => x.id === id); if (a) openCreator(id, draftOf(a)); }}
                onExportCustom={id => { const a = customAgents.find(x => x.id === id); if (a) setExportDraft(draftOf(a)); }}
                onImportInto={id => triggerImport(id)}
              />
            </div>
            <div className={`min-h-0 min-w-0 lg:col-span-8 lg:block ${selectedKey ? 'block' : 'hidden'}`}>
              <ChatWindow
                agent={activeAgent} messages={messages} streaming={streaming} workflows={workflows}
                value={composer.value} workflow={composer.workflow}
                onValueChange={value => setComposer(c => ({ ...c, value }))}
                onWorkflowChange={workflow => setComposer(c => ({ ...c, workflow }))}
                onSend={send} onStop={() => selectedKey && chat.stop(selectedKey)} onNewChat={newChat} onBack={() => setSelectedKey(null)}
                onCopyChat={() => void copyChat()} onDownloadChat={downloadChat} inputRef={inputRef}
              />
            </div>
          </div>
        )}
      </main>
      </>
      )}

      <input ref={importInput} type="file" accept=".json,application/json" className="sr-only" tabIndex={-1} aria-hidden data-testid="global-import-input"
        onChange={e => { void onImportFile(e.target.files?.[0]); e.target.value = ''; }} />

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <DocsModal open={docsOpen} onClose={() => setDocsOpen(false)} />
      <AgentCreator
        open={creator.open} onClose={closeCreator} initial={creator.draft} initialWarnings={creator.warnings} editing={!!creator.editingId}
        onSave={saveAgent} onDelete={deleteAgent} onExport={setExportDraft}
      />
      <AgentExportModal draft={exportDraft} onClose={() => setExportDraft(null)} />
    </div>
  );
}
