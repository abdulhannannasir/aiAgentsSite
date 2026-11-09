import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, ClipboardCopy, FileDown, Home, Keyboard, LogIn, LogOut, MessageSquarePlus, Moon, Plus, Sparkles, Sun, Upload } from 'lucide-react';
import type { MetaResponse } from '../../server/src/contracts';
import { AgentCreator } from './components/AgentCreator';
import { AgentExportModal } from './components/AgentExportModal';
import { AgentAvatar, CUSTOM_GRADIENT, workflowIcon } from './components/AgentAvatar';
import { CommandPalette } from './components/CommandPalette';
import { DocsModal } from './components/DocsModal';
import { ShortcutsModal } from './components/ShortcutsModal';
import { useToast } from './components/Toast';
import { Spinner } from './components/ui/Display';
import { useChat } from './hooks/useChat';
import { ApiError, fetchAgents, fetchHealth, fetchMeta, fetchWorkflows } from './lib/api';
import { account as accountApi, auth as authApi, conversations, savedAgents, type Me, type SavedAgent } from './lib/account';
import { marketplace, type AgentStats } from './lib/marketplace';
import { EMPTY_DRAFT, MAX_AGENT_FILE_BYTES, isStoredAgent, parseAgentFile } from './lib/agentFile';
import { chatFileName, chatToMarkdown, copyToClipboard, downloadTextFile } from './lib/chatExport';
import { MOD, isEditableTarget } from './lib/platform';
import { readStored, writeStored } from './lib/storage';
import { useFx, type FxPref } from './lib/fx/capability';
import { goAuth, useRoute, useView } from './lib/route';
import { CustomCursor } from './components/fx/CustomCursor';
import { FxBackground } from './components/fx/FxBackground';
import { LandingPage } from './components/landing/LandingPage';
import { AppShell } from './app/Shell';
import { NAV, navItem } from './app/nav';
import { WorkspaceContext, type WorkspaceApi } from './app/workspace';
import { ChatPage } from './pages/ChatPage';
import type { ActiveAgent, Agent, AgentDraft, Command, CustomAgent, Theme, Workflow } from './types';

// Pages other than chat load on demand, so the workspace doesn't pay for code it isn't showing.
const CommandCenterPage = lazy(() => import('./pages/CommandCenterPage'));
const DiscoverPage = lazy(() => import('./pages/DiscoverPage'));
const MyAgentsPage = lazy(() => import('./pages/MyAgentsPage'));
const BuilderPage = lazy(() => import('./pages/BuilderPage'));
const WorkflowsPage = lazy(() => import('./pages/WorkflowsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const PlannedPage = lazy(() => import('./pages/PlannedPage'));
const AgentDetailPage = lazy(() => import('./pages/AgentDetailPage'));
const AuthPage = lazy(() => import('./pages/AuthPage'));
const NotFoundPage = lazy(() => import('./pages/PlannedPage').then(m => ({ default: m.NotFoundPage })));

const THEME_KEY = 'agentverse.theme';
const AGENTS_KEY = 'agentverse.customAgents';
const MAX_CUSTOM_AGENTS = 30;
const EMPTY_COMPOSER: { value: string; workflow: Workflow | null } = { value: '', workflow: null };

const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
const isTheme = (v: unknown): v is Theme => v === 'dark' || v === 'light';
const draftOf = (a: CustomAgent): AgentDraft => ({ name: a.name, description: a.description, icon: a.icon, systemPrompt: a.systemPrompt, temperature: a.temperature, tools: a.tools });
const isDesktop = () => window.matchMedia('(min-width: 1024px)').matches;
const fromSaved = (a: SavedAgent): CustomAgent => ({
  id: a.id, name: a.name, description: a.description, icon: a.icon, systemPrompt: a.systemPrompt, temperature: a.temperature, tools: a.tools as CustomAgent['tools'],
  createdAt: a.createdAt, updatedAt: a.updatedAt, canEdit: a.canEdit, visibility: a.visibility, createdByName: a.createdByName, version: a.version
});
const failure = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong. Please try again.');

interface CreatorState { open: boolean; editingId: string | null; draft: AgentDraft; warnings: string[] }

export default function App() {
  const { toast } = useToast();
  const chat = useChat();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [route, navigate] = useRoute();
  const [, go] = useView();
  const view = route.view;
  const page = route.page;
  const fx = useFx();

  // ---- data from the server
  const [agents, setAgents] = useState<Agent[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [mode, setMode] = useState<'live' | 'demo' | null>(null);
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const load = useCallback(async () => {
    setLoadError(false);
    setLoading(true);
    try {
      const [a, w, h, m] = await Promise.all([fetchAgents(), fetchWorkflows().catch(() => [] as Workflow[]), fetchHealth().catch(() => null), fetchMeta().catch(() => null)]);
      setAgents(a);
      setWorkflows(w);
      setMode(h?.mode ?? null);
      setMeta(m);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
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

  // Guests keep custom agents in this browser; signed-in users keep them in their workspace.
  const [localAgents, setLocalAgents] = useState<CustomAgent[]>(() => {
    const raw = readStored<unknown>(AGENTS_KEY, []);
    return Array.isArray(raw) ? (raw.filter(isStoredAgent) as CustomAgent[]).slice(0, MAX_CUSTOM_AGENTS) : [];
  });
  useEffect(() => { writeStored(AGENTS_KEY, localAgents); }, [localAgents]);

  // ---- account
  const [me, setMe] = useState<Me | null>(null);
  const [accountStatus, setAccountStatus] = useState<'loading' | 'unavailable' | 'guest' | 'signed-in'>('loading');
  const [savedList, setSavedList] = useState<CustomAgent[]>([]);
  const signedIn = accountStatus === 'signed-in';
  const customAgents = signedIn ? savedList : localAgents;
  const setCustomAgents = signedIn ? setSavedList : setLocalAgents;
  const maxAgents = signedIn ? 200 : MAX_CUSTOM_AGENTS;

  const refreshAccount = useCallback(async (): Promise<boolean> => {
    try {
      const [m, list] = await Promise.all([accountApi.me(), savedAgents.list()]);
      setMe(m);
      setSavedList(list.map(fromSaved));
      setAccountStatus('signed-in');
      return true;
    } catch (err) {
      setMe(null);
      setSavedList([]);
      setAccountStatus(err instanceof ApiError && err.status === 401 ? 'guest' : 'unavailable');
      return false;
    }
  }, []);
  useEffect(() => {
    if (loading) return;
    if (meta && !meta.features.auth) { setAccountStatus('unavailable'); return; }
    void refreshAccount();
  }, [loading, meta, refreshAccount]);

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
  const onChatPage = view === 'app' && page === 'chat' && !route.unknown;

  const focusComposer = useCallback((force = false) => {
    if (!force && !isDesktop()) return; // don't pop the on-screen keyboard open on phones
    window.setTimeout(() => inputRef.current?.focus(), 60);
  }, []);

  const selectAgent = useCallback((key: string) => {
    setSelectedKey(key);
    setComposer(EMPTY_COMPOSER);
    go('app'); // from the landing page, the palette or any app page: open the chat on this agent
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
    void chat.send({ agent: activeAgent, customAgent: selectedCustom, workflow: composer.workflow, text, persist: signedIn, savedAgentId: signedIn ? selectedCustom?.id : undefined });
    setComposer(EMPTY_COMPOSER);
  }, [activeAgent, composer, selectedCustom, chat, toast, signedIn]);

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

  const saveAgent = async (draft: AgentDraft) => {
    const now = Date.now();
    if (signedIn) {
      try {
        if (creator.editingId) {
          const saved = fromSaved(await savedAgents.update(creator.editingId, draft));
          setSavedList(list => list.map(a => (a.id === saved.id ? saved : a)));
          toast(`Saved ${draft.name} (version ${saved.version})`, 'success');
        } else {
          const saved = fromSaved(await savedAgents.create(draft));
          setSavedList(list => [...list, saved]);
          toast(`Created ${draft.name} in ${me?.workspace?.name ?? 'your workspace'}`, 'success');
          selectAgent(`custom:${saved.id}`);
        }
        closeCreator();
      } catch (err) { toast(`Could not save: ${failure(err)}`, 'error'); }
      return;
    }
    if (creator.editingId) {
      setCustomAgents(list => list.map(a => (a.id === creator.editingId ? { ...a, ...draft, updatedAt: now } : a)));
      toast(`Saved ${draft.name}`, 'success');
    } else {
      if (customAgents.length >= maxAgents) { toast(`You can keep up to ${maxAgents} custom agents. Delete one first.`, 'error'); return; }
      const id = uid();
      setCustomAgents(list => [...list, { ...draft, id, createdAt: now, updatedAt: now }]);
      toast(`Created ${draft.name}`, 'success');
      selectAgent(`custom:${id}`);
    }
    closeCreator();
  };

  const removeCustomAgent = useCallback(async (id: string) => {
    const key = `custom:${id}`;
    if (signedIn) {
      try { await savedAgents.remove(id); } catch (err) { toast(`Could not delete: ${failure(err)}`, 'error'); return; }
    }
    chat.clear(key);
    setCustomAgents(list => list.filter(a => a.id !== id));
    setSelectedKey(k => (k === key ? null : k));
    toast('Agent deleted');
  }, [chat, toast, signedIn, setCustomAgents]);

  const deleteAgent = () => {
    if (!creator.editingId) return;
    void removeCustomAgent(creator.editingId);
    closeCreator();
  };

  const duplicateCustomAgent = useCallback(async (id: string) => {
    const a = customAgents.find(x => x.id === id);
    if (!a) return;
    if (customAgents.length >= maxAgents) { toast(`You can keep up to ${maxAgents} custom agents. Delete one first.`, 'error'); return; }
    const now = Date.now();
    const name = `${a.name.slice(0, 53)} (copy)`;
    if (signedIn) {
      try {
        const saved = fromSaved(await savedAgents.create({ ...draftOf(a), name }));
        setSavedList(list => [...list, saved]);
      } catch (err) { toast(`Could not duplicate: ${failure(err)}`, 'error'); return; }
    } else {
      setLocalAgents(list => [...list, { ...draftOf(a), name, id: uid(), createdAt: now, updatedAt: now }]);
    }
    toast(`Created ${name}`, 'success');
  }, [customAgents, toast, signedIn, maxAgents]);

  /** Deletes the agents kept in this browser (never the workspace's saved agents). */
  const removeAllCustomAgents = useCallback(() => {
    for (const a of localAgents) chat.clear(`custom:${a.id}`);
    if (!signedIn) setSelectedKey(k => (k?.startsWith('custom:') ? null : k));
    setLocalAgents([]);
    toast(signedIn ? 'Deleted the agents stored in this browser' : 'All custom agents deleted');
  }, [localAgents, chat, toast, signedIn]);

  const importLocalAgents = useCallback(async () => {
    if (!signedIn || !localAgents.length) return;
    try {
      const created = await savedAgents.importMany(localAgents.map(draftOf));
      setSavedList(list => [...list, ...created.map(fromSaved)]);
      setLocalAgents([]);
      toast(`Moved ${created.length} agent${created.length === 1 ? '' : 's'} into ${me?.workspace?.name ?? 'your workspace'}`, 'success');
    } catch (err) { toast(`Could not move the agents: ${failure(err)}`, 'error'); }
  }, [signedIn, localAgents, me, toast]);

  const setAgentVisibility = useCallback(async (id: string, visibility: 'PRIVATE' | 'WORKSPACE') => {
    try {
      const saved = fromSaved(await savedAgents.update(id, { visibility }));
      setSavedList(list => list.map(a => (a.id === id ? saved : a)));
      toast(visibility === 'PRIVATE' ? 'Only you can see this agent now' : 'Shared with your workspace', 'success');
    } catch (err) { toast(`Could not change sharing: ${failure(err)}`, 'error'); }
  }, [toast]);

  // ---- account actions: every change of who/where you are starts clean, so nothing leaks between accounts
  const startFresh = useCallback(() => { chat.reset(); setSelectedKey(null); setComposer(EMPTY_COMPOSER); }, [chat]);
  const onSignedIn = useCallback(async () => {
    startFresh();
    if (await refreshAccount()) { toast('Signed in', 'success'); navigate('command-center'); }
    else toast('Could not load your account. Please try again.', 'error');
  }, [startFresh, refreshAccount, toast, navigate]);
  const signOut = useCallback(async () => {
    try { await authApi.signOut(); } catch (err) { toast(`Could not sign out: ${failure(err)}`, 'error'); return; }
    startFresh();
    setMe(null); setSavedList([]); setAccountStatus('guest');
    toast('Signed out');
  }, [startFresh, toast]);
  const switchWorkspace = useCallback(async (id: string) => {
    try {
      const ws = await accountApi.activateWorkspace(id);
      startFresh();
      await refreshAccount();
      toast(`Switched to ${ws.name}`, 'success');
    } catch (err) { toast(`Could not switch: ${failure(err)}`, 'error'); }
  }, [startFresh, refreshAccount, toast]);
  const createWorkspace = useCallback(async (name: string) => {
    const ws = await accountApi.createWorkspace(name); // errors surface in the dialog
    startFresh();
    await refreshAccount();
    toast(`Created ${ws.name}`, 'success');
  }, [startFresh, refreshAccount, toast]);

  // ---- marketplace: real stats (needs a database) and favorites (signed in)
  const [stats, setStats] = useState<Map<string, AgentStats> | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const hasDatabase = meta?.features.database ?? true; // unknown (older server): try, and accept a 503
  const refreshStats = useCallback(() => {
    if (!hasDatabase) { setStats(null); return; } // the server said there is nothing to ask for
    marketplace.stats()
      .then(list => {
        setStats(new Map(list.map(x => [x.id, x])));
        setFavorites(prev => {
          const next = new Set([...prev].filter(k => k.startsWith('custom:')));
          for (const x of list) if (x.favorite) next.add(x.id);
          return next;
        });
      })
      .catch(() => setStats(null)); // no database: show no numbers at all rather than made-up ones
  }, [hasDatabase]);
  useEffect(() => {
    if (accountStatus === 'loading' || loading) return;
    refreshStats();
    if (accountStatus !== 'signed-in') setFavorites(new Set());
    else fetch('/api/v1/marketplace/favorites', { credentials: 'same-origin' }).then(r => (r.ok ? r.json() : [])).then((keys: string[]) => setFavorites(new Set(keys))).catch(() => undefined);
  }, [accountStatus, loading, me?.workspace?.id, refreshStats]);
  const toggleFavorite = useCallback(async (key: string) => {
    const on = !favorites.has(key);
    setFavorites(prev => { const n = new Set(prev); if (on) n.add(key); else n.delete(key); return n; });
    try { await marketplace.setFavorite(key, on); }
    catch (err) {
      setFavorites(prev => { const n = new Set(prev); if (on) n.delete(key); else n.add(key); return n; });
      toast(`Could not update favorites: ${failure(err)}`, 'error');
    }
  }, [favorites, toast]);
  // Usage numbers change when a reply finishes: refresh them then (only if the server has stats at all).
  const wasStreaming = useRef(false);
  useEffect(() => {
    const now = chat.streamingKeys.length > 0;
    if (wasStreaming.current && !now && stats) refreshStats();
    wasStreaming.current = now;
  }, [chat.streamingKeys.length, stats, refreshStats]);

  const startChatWith = useCallback((key: string, text: string) => {
    selectAgent(key);
    setComposer({ value: text, workflow: null });
    focusComposer(true);
  }, [selectAgent, focusComposer]);

  // Signed in: opening an agent brings back your latest saved conversation with it.
  const restore = chat.restore;
  useEffect(() => {
    if (signedIn && onChatPage && selectedKey) void restore(selectedKey, conversations.latest);
  }, [signedIn, onChatPage, selectedKey, restore]);

  const importInput = useRef<HTMLInputElement>(null);
  const importTarget = useRef<string | null>(null);
  const triggerImport = useCallback((targetId: string | null = null) => { importTarget.current = targetId; importInput.current?.click(); }, []);
  const onImportFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_AGENT_FILE_BYTES) { toast(`That file is too large (max ${Math.round(MAX_AGENT_FILE_BYTES / 1000)} KB).`, 'error'); return; }
    let text: string;
    try { text = await file.text(); } catch { toast('Could not read that file.', 'error'); return; }
    const result = parseAgentFile(text);
    if (!result.ok) { toast(`Import failed: ${result.error}`, 'error'); return; }
    openCreator(importTarget.current, result.draft, [`Loaded "${result.draft.name}" from ${file.name}. Review it, then save.`, ...result.warnings]);
  };

  // ---- shared workspace API for the pages and the shell
  const ws = useMemo<WorkspaceApi>(() => ({
    agents, workflows, mode, meta, loading, loadError, reload: () => void load(),
    account: { status: accountStatus, me, signOut, switchWorkspace, createWorkspace },
    customAgents, maxCustomAgents: maxAgents, localAgentsToImport: signedIn ? localAgents : [], importLocalAgents, setAgentVisibility,
    duplicateCustomAgent: id => void duplicateCustomAgent(id), removeCustomAgent: id => void removeCustomAgent(id), removeAllCustomAgents,
    stats, refreshStats, favorites, toggleFavorite,
    chat, selectAgent, startChatWith, startWorkflow, openCreator,
    editCustomAgent: id => { const a = customAgents.find(x => x.id === id); if (a) openCreator(id, draftOf(a)); },
    exportCustomAgent: id => { const a = customAgents.find(x => x.id === id); if (a) setExportDraft(draftOf(a)); },
    triggerImport,
    theme, setTheme, fxPref: fx.pref, setFxPref: (p: FxPref) => fx.setPref(p),
    navigate,
    openPalette: () => setPaletteOpen(true), openShortcuts: () => setShortcutsOpen(true), openDocs: () => setDocsOpen(true)
  }), [agents, workflows, mode, meta, loading, loadError, load, accountStatus, me, signOut, switchWorkspace, createWorkspace,
    customAgents, maxAgents, signedIn, localAgents, importLocalAgents, setAgentVisibility, duplicateCustomAgent, removeCustomAgent, removeAllCustomAgents,
    stats, refreshStats, favorites, toggleFavorite, startChatWith,
    chat, selectAgent, startWorkflow, openCreator, triggerImport, theme, fx, navigate]);

  // ---- command palette
  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];
    if (view === 'app') {
      list.push({ id: 'go-home', group: 'Navigate', label: 'Go to the home page', keywords: 'landing overview intro', icon: <Home size={15} />, run: () => go('landing') });
    }
    for (const n of NAV) {
      if (view === 'app' && n.id === page && !route.unknown) continue;
      const Icon = n.icon;
      list.push({
        id: `go-${n.id}`, group: 'Navigate', label: n.id === 'chat' && view !== 'app' ? 'Open the workspace' : `Go to ${n.label}`,
        hint: n.status === 'planned' ? `Planned · Phase ${n.phase}` : n.description,
        keywords: `${n.section} ${n.description} page open launch app`, icon: <Icon size={15} />, run: () => navigate(n.id)
      });
    }
    if (onChatPage && activeAgent) {
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
    if (accountStatus === 'guest') list.push({ id: 'sign-in', group: 'Account', label: 'Sign in', keywords: 'login log in account', icon: <LogIn size={15} />, run: () => goAuth('sign-in') });
    if (accountStatus === 'guest') list.push({ id: 'sign-up', group: 'Account', label: 'Create an account', keywords: 'register sign up', icon: <LogIn size={15} />, run: () => goAuth('sign-up') });
    if (signedIn) list.push({ id: 'sign-out', group: 'Account', label: 'Sign out', keywords: 'logout log out', icon: <LogOut size={15} />, run: () => void signOut() });
    list.push({ id: 'shortcuts', group: 'Help', label: 'Keyboard shortcuts', shortcut: '?', keywords: 'help keys cheatsheet', icon: <Keyboard size={15} />, run: () => setShortcutsOpen(true) });
    list.push({ id: 'docs', group: 'Help', label: 'Open documentation', keywords: 'help guide how to docs', icon: <BookOpen size={15} />, run: () => setDocsOpen(true) });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountStatus, signedIn, signOut, view, page, route.unknown, onChatPage, go, navigate, fx.pref, activeAgent, messages.length, workflows, customAgents, agents, theme, newChat, copyChat, downloadChat, startWorkflow, selectAgent, openCreator, triggerImport]);

  // ---- global keyboard shortcuts
  const anyModalOpen = paletteOpen || shortcutsOpen || docsOpen || creator.open || !!exportDraft;
  const live = useRef({ anyModalOpen, newChat, hasAgent: !!activeAgent, inChat: onChatPage });
  live.current = { anyModalOpen, newChat, hasAgent: !!activeAgent, inChat: onChatPage };
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { anyModalOpen: modal, newChat: startNew, hasAgent, inChat } = live.current;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(o => !o); return; }
      if (modal) return;
      // Cmd/Ctrl+N is often reserved by the browser; Alt+N is the dependable alternative.
      if (inChat && e.code === 'KeyN' && ((mod && !e.shiftKey) || (e.altKey && !mod))) { e.preventDefault(); startNew(); return; }
      if (isEditableTarget(e.target) || mod || e.altKey) return;
      if (e.key === '?') { e.preventDefault(); setShortcutsOpen(true); return; }
      if (inChat && e.key === '/' && hasAgent) {
        e.preventDefault();
        setComposer(c => (c.value || c.workflow ? c : { ...c, value: '/' }));
        focusComposer(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [focusComposer]);

  // Name each page in the tab title, so history and screen readers say where you are.
  useEffect(() => {
    document.title = view === 'landing' ? 'AgentVerse | AI Agent Platform'
      : view === 'auth' ? `${{ 'sign-in': 'Sign in', 'sign-up': 'Create account', 'forgot-password': 'Reset password', 'reset-password': 'New password', verified: 'Email confirmed' }[route.authPage ?? 'sign-in']} · AgentVerse`
      : `${route.unknown ? 'Not found' : route.agentId ? agents.find(a => a.id === route.agentId)?.name ?? 'Agent' : navItem(page).label} · AgentVerse`;
  }, [view, page, route.unknown, route.authPage, route.agentId, agents]);

  // The landing page is always dark; the workspace follows the theme. The swarm only shows on dark surfaces.
  const darkSurface = view !== 'app' || theme === 'dark';
  const openBuilder = useCallback((draft?: AgentDraft) => { go('app'); openCreator(null, draft ?? EMPTY_DRAFT); }, [go, openCreator]);

  const renderPage = () => {
    if (route.unknown) return <NotFoundPage />;
    switch (page) {
      case 'chat':
        return (
          <ChatPage
            selectedKey={selectedKey} onSelect={selectAgent}
            chatWindow={{
              agent: activeAgent, messages, streaming, workflows, value: composer.value, workflow: composer.workflow,
              onValueChange: value => setComposer(c => ({ ...c, value })),
              onWorkflowChange: workflow => setComposer(c => ({ ...c, workflow })),
              onSend: send, onStop: () => selectedKey && chat.stop(selectedKey), onNewChat: newChat, onBack: () => setSelectedKey(null),
              onCopyChat: () => void copyChat(), onDownloadChat: downloadChat, inputRef
            }}
          />
        );
      case 'command-center': return <CommandCenterPage />;
      case 'discover': return route.agentId ? <AgentDetailPage key={route.agentId} agentId={route.agentId} /> : <DiscoverPage />;
      case 'my-agents': return <MyAgentsPage />;
      case 'builder': return <BuilderPage />;
      case 'workflows': return <WorkflowsPage />;
      case 'settings': return <SettingsPage />;
      default: return <PlannedPage item={navItem(page)} />;
    }
  };

  return (
    <WorkspaceContext.Provider value={ws}>
      <div className="relative min-h-dvh">
        {darkSurface && <FxBackground view={view === 'landing' ? 'landing' : 'app'} />}
        {darkSurface && <div aria-hidden className="grain" />}
        <CustomCursor />

        {view === 'auth' ? (
          <div className="dark text-fg">
            <Suspense fallback={<div className="flex min-h-dvh items-center justify-center"><Spinner label="Loading" size={20} /></div>}>
              <AuthPage page={route.authPage ?? 'sign-in'} params={route.params ?? {}} meta={meta} onSignedIn={onSignedIn} />
            </Suspense>
          </div>
        ) : view === 'landing' ? (
          <LandingPage
            agents={agents} workflows={workflows} mode={mode}
            onLaunch={() => go('app')} onOpenAgent={selectAgent} onRunWorkflow={startWorkflow}
            onOpenBuilder={openBuilder} onOpenPalette={() => setPaletteOpen(true)}
            onOpenDocs={() => setDocsOpen(true)} onOpenShortcuts={() => setShortcutsOpen(true)}
          />
        ) : (
          <AppShell page={route.unknown ? 'chat' : page} onHome={() => go('landing')}>
            <Suspense fallback={<div className="flex justify-center py-20"><Spinner label="Loading page" size={20} /></div>}>
              {renderPage()}
            </Suspense>
          </AppShell>
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
    </WorkspaceContext.Provider>
  );
}
