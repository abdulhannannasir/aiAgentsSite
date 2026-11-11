import { useState, type FormEvent, type ReactNode } from 'react';
import clsx from 'clsx';
import {
  Bell, BookOpen, Check, ChevronsLeft, ChevronsRight, ChevronsUpDown, Keyboard, LogIn, LogOut, Menu as MenuIcon, Moon, Plus, Search, Settings, Sun, UserPlus, UserRound
} from 'lucide-react';
import { Modal } from '../components/Modal';
import { Button } from '../components/ui/Button';
import { Field, Input } from '../components/ui/Form';
import { goAuth } from '../lib/route';
import { Magnetic } from '../components/fx/Magnetic';
import { IconButton } from '../components/ui/Button';

import { Badge } from '../components/ui/Display';
import { Drawer, Menu, Popover } from '../components/ui/Overlay';
import { MOD } from '../lib/platform';
import { pageHref, type PageId } from '../lib/route';
import { readStored, writeStored } from '../lib/storage';
import { NAV, NAV_SECTIONS, type NavItem } from './nav';
import { useWorkspace } from './workspace';

const SIDEBAR_KEY = 'agentverse.sidebarCollapsed';

/* ------------------------------------------------------------------ navigation list */

function NavLink({ item, active, collapsed, busy, onNavigate }: { item: NavItem; active: boolean; collapsed: boolean; busy?: boolean; onNavigate?: () => void }) {
  const Icon = item.icon;
  return (
    <a
      href={pageHref(item.id)} aria-current={active ? 'page' : undefined} onClick={onNavigate} data-nav={item.id}
      title={collapsed ? `${item.label}${item.status === 'planned' ? ' (planned)' : ''}` : undefined}
      className={clsx(
        'group relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition',
        active ? 'bg-accent/12 text-fg shadow-[inset_2px_0_0_rgb(var(--neon-cyan))]' : 'text-muted hover:bg-hover hover:text-fg',
        collapsed && 'justify-center px-0'
      )}
    >
      <Icon size={18} aria-hidden className={clsx('shrink-0', active && 'text-accent')} />
      {collapsed ? <span className="sr-only">{item.label}{item.status === 'planned' ? ' (planned)' : ''}</span> : (
        <>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.status === 'planned' && <Badge className="!px-1.5 !py-0 !text-[9px]">Soon</Badge>}
        </>
      )}
      {busy && <span aria-label="agent running" className={clsx('h-2 w-2 shrink-0 animate-pulse rounded-full bg-neon-cyan', collapsed && 'absolute right-2 top-2')} />}
    </a>
  );
}

function NavList({ page, collapsed, onNavigate }: { page: PageId; collapsed: boolean; onNavigate?: () => void }) {
  const { chat } = useWorkspace();
  return (
    <nav aria-label="Main" className="flex flex-col gap-4">
      {NAV_SECTIONS.map(section => (
        <div key={section}>
          {collapsed ? <div aria-hidden className="mx-3 mb-2 border-t border-line" /> : (
            <h2 className="mb-1.5 px-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-muted/80">{section}</h2>
          )}
          <ul className="flex flex-col gap-0.5">
            {NAV.filter(n => n.section === section).map(item => (
              <li key={item.id}>
                <NavLink item={item} active={page === item.id} collapsed={collapsed} onNavigate={onNavigate} busy={item.id === 'chat' && chat.streamingKeys.length > 0} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function NewWorkspaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ws = useWorkspace();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Give the workspace a name.'); return; }
    setBusy(true); setError(null);
    try { await ws.account.createWorkspace(name.trim()); setName(''); onClose(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not create the workspace.'); }
    finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="New workspace" description="A separate space with its own agents and chats. You'll be its owner." size="sm">
      <form onSubmit={submit} className="flex flex-col gap-4 p-5">
        <Field label="Workspace name" error={error ?? undefined}>{p => <Input {...p} maxLength={80} value={name} onChange={e => setName(e.target.value)} data-autofocus placeholder="e.g. Acme Legal" />}</Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Creating…' : 'Create workspace'}</Button>
        </div>
      </form>
    </Modal>
  );
}

const initial = (name: string) => (name.trim()[0] ?? 'W').toUpperCase();

/**
 * Which workspace you are in. Signed in: a real switcher (your memberships, plus "New workspace").
 * Guest: a plain label for the browser-local space — not a fake switcher.
 */
function WorkspaceLabel({ collapsed }: { collapsed: boolean }) {
  const { account } = useWorkspace();
  const [creating, setCreating] = useState(false);
  const me = account.me;
  if (account.status === 'signed-in' && me?.workspace) {
    const current = me.workspace;
    return (
      <>
        <Menu
          label={`Workspace: ${current.name}. Switch workspace`}
          align="left"
          triggerClassName={clsx('flex w-full items-center gap-2.5 rounded-xl border border-line text-left transition hover:bg-hover', collapsed ? 'h-10 w-10 justify-center' : 'px-2.5 py-2')}
          trigger={collapsed ? <span className="font-display text-sm font-bold">{initial(current.name)}</span> : (
            <>
              <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-neon-cyan/30 to-neon-violet/30 font-display text-sm font-bold">{initial(current.name)}</span>
              <span className="min-w-0 flex-1" data-testid="workspace-label">
                <span className="block truncate text-sm font-semibold">{current.name}</span>
                <span className="block truncate text-[11px] capitalize text-muted">{current.role}</span>
              </span>
              <ChevronsUpDown size={14} aria-hidden className="shrink-0 text-muted" />
            </>
          )}
          header={<p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Your workspaces</p>}
          items={[
            ...me.workspaces.map(w => ({
              id: w.id, label: w.name, hint: w.role,
              icon: w.id === current.id ? <Check size={15} className="text-accent" /> : <span className="inline-block w-[15px]" />,
              onSelect: w.id === current.id ? undefined : () => void account.switchWorkspace(w.id)
            })),
            { id: 'new', label: 'New workspace…', icon: <Plus size={15} />, onSelect: () => setCreating(true) }
          ]}
        />
        <NewWorkspaceDialog open={creating} onClose={() => setCreating(false)} />
      </>
    );
  }
  if (collapsed) {
    return <div title="Guest workspace — saved in this browser" className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-hover font-display text-sm font-bold">G</div>;
  }
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-line px-2.5 py-2" data-testid="workspace-label">
      <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-neon-cyan/30 to-neon-violet/30 font-display text-sm font-bold">G</span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">Guest workspace</span>
        <span className="block truncate text-[11px] text-muted">Saved in this browser</span>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ sidebar */

export function Sidebar({ page }: { page: PageId }) {
  const [collapsed, setCollapsed] = useState(() => readStored<boolean>(SIDEBAR_KEY, false, (v): v is boolean => typeof v === 'boolean'));
  const toggle = () => setCollapsed(c => { writeStored(SIDEBAR_KEY, !c); return !c; });
  return (
    <aside
      aria-label="Sidebar" data-collapsed={collapsed}
      className={clsx('glass sticky top-[57px] z-20 hidden h-[calc(100dvh-57px)] shrink-0 flex-col border-y-0 border-l-0 transition-[width] duration-200 lg:flex', collapsed ? 'w-[68px]' : 'w-60')}
    >
      <div className="p-3"><WorkspaceLabel collapsed={collapsed} /></div>
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-3"><NavList page={page} collapsed={collapsed} /></div>
      <div className="border-t border-line p-3">
        <button
          type="button" onClick={toggle} aria-expanded={!collapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={clsx('flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-muted transition hover:bg-hover hover:text-fg', collapsed && 'justify-center px-0')}
        >
          {collapsed ? <ChevronsRight size={16} aria-hidden /> : <><ChevronsLeft size={16} aria-hidden /> Collapse</>}
        </button>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ top bar */

function Notifications() {
  return (
    <Popover label="Notifications" trigger={<Bell size={18} aria-hidden />}>
      <p className="font-display text-sm font-bold">Notifications</p>
      <div className="mt-3 rounded-xl border border-dashed border-line px-3 py-5 text-center">
        <p className="text-sm font-medium">You're all caught up</p>
        <p className="mt-1 text-xs text-muted">Task completions, failures and approval requests will be saved here once accounts and execution history are enabled on this server.</p>
      </div>
    </Popover>
  );
}

function AccountMenu() {
  const ws = useWorkspace();
  const { status, me } = ws.account;
  const common = [
    { id: 'settings', label: 'Settings', icon: <Settings size={15} />, onSelect: () => ws.navigate('settings') },
    { id: 'theme', label: ws.theme === 'dark' ? 'Light theme' : 'Dark theme', icon: ws.theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />, onSelect: () => ws.setTheme(ws.theme === 'dark' ? 'light' : 'dark') },
    { id: 'shortcuts', label: 'Keyboard shortcuts', icon: <Keyboard size={15} />, onSelect: ws.openShortcuts },
    { id: 'docs', label: 'Documentation', icon: <BookOpen size={15} />, onSelect: ws.openDocs }
  ];
  if (status === 'signed-in' && me) {
    return (
      <Menu
        label="Account menu"
        trigger={<span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-neon-cyan to-neon-violet font-display text-xs font-bold text-on-accent">{initial(me.user.name)}</span>}
        header={<><p className="truncate text-sm font-semibold" data-testid="account-name">{me.user.name}</p><p className="truncate text-xs text-muted">{me.user.email}</p></>}
        items={[...common, { id: 'sign-out', label: 'Sign out', icon: <LogOut size={15} />, onSelect: () => void ws.account.signOut() }]}
      />
    );
  }
  const available = status === 'guest';
  return (
    <Menu
      label="Account menu"
      trigger={<UserRound size={18} aria-hidden />}
      header={<><p className="text-sm font-semibold">Guest</p><p className="text-xs text-muted">Not signed in · data stays in this browser</p></>}
      items={[
        available
          ? { id: 'sign-in', label: 'Sign in', icon: <LogIn size={15} />, onSelect: () => goAuth('sign-in') }
          : { id: 'sign-in', label: 'Sign in', icon: <LogIn size={15} />, disabled: true, hint: status === 'loading' ? 'Checking…' : 'Accounts are not enabled on this server' },
        ...(available ? [{ id: 'sign-up', label: 'Create an account', icon: <UserPlus size={15} />, onSelect: () => goAuth('sign-up') }] : []),
        ...common
      ]}
    />
  );
}

export function TopBar({ page, onHome, onOpenMobileNav }: { page: PageId; onHome: () => void; onOpenMobileNav: () => void }) {
  const ws = useWorkspace();
  const iconCls = 'hidden sm:flex';
  return (
    <header className="glass sticky top-0 z-30 h-[57px] border-x-0 border-t-0">
      <div className="flex h-full items-center gap-1.5 px-3 sm:gap-3 sm:px-4">
        <IconButton aria-label="Open navigation" onClick={onOpenMobileNav} className="lg:hidden"><MenuIcon size={19} /></IconButton>
        <button type="button" onClick={onHome} aria-label="AgentVerse home" title="Back to the home page" className="flex min-w-0 items-center gap-2.5 rounded-xl text-left">
          <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line-strong bg-gradient-to-br from-neon-cyan/30 to-neon-violet/30 text-lg">🤖</span>
          <span className="hidden min-w-0 sm:block">
            <span className="block font-display text-base font-bold leading-tight tracking-tight">Agent<span className="text-neon-cyan">Verse</span></span>
            <span className="block truncate font-mono text-[10px] uppercase tracking-wider text-muted">{ws.agents.length || 42} agents · workflows · builder</span>
          </span>
        </button>

        <button type="button" onClick={ws.openPalette} aria-label="Open command palette" data-testid="palette-button"
          className="glass ml-auto flex h-9 items-center gap-2 rounded-lg px-3 text-sm text-muted transition hover:bg-hover hover:text-fg sm:ml-4 sm:w-64 md:w-80">
          <Search size={15} aria-hidden />
          <span className="hidden flex-1 text-left sm:block">Search or run a command…</span>
          <span className="hidden items-center gap-1 sm:flex"><kbd>{MOD}</kbd><kbd>K</kbd></span>
        </button>

        <div className="flex items-center gap-0.5 sm:ml-auto sm:gap-1">
          {ws.mode && (
            <button type="button" onClick={() => ws.navigate('settings')} data-testid="mode-badge" title="AI provider status"
              className="mr-1 hidden items-center gap-1.5 rounded-full border border-line px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-muted transition hover:bg-hover md:flex">
              <span className={`h-2 w-2 rounded-full ${ws.mode === 'live' ? 'animate-pulse bg-neon-cyan shadow-[0_0_8px_rgb(var(--neon-cyan))]' : 'bg-amber-500'}`} />
              {ws.mode === 'live' ? 'Live AI' : 'Demo mode'}
            </button>
          )}
          {page !== 'builder' && (
            <Magnetic strength={0.25} radius={40}>
              <button type="button" onClick={() => ws.openCreator(null)} className="neo hidden h-9 items-center gap-1.5 rounded-lg bg-accent px-3 font-display text-xs font-bold uppercase tracking-wide text-on-accent md:flex" aria-label="Create a new agent">
                <Plus size={15} aria-hidden /> New agent
              </button>
            </Magnetic>
          )}
          <Notifications />
          <IconButton aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={ws.openShortcuts} className={iconCls}><Keyboard size={18} /></IconButton>
          <IconButton aria-label="Open documentation" title="Documentation" onClick={ws.openDocs} className={iconCls}><BookOpen size={18} /></IconButton>
          <IconButton aria-label={`Switch to ${ws.theme === 'dark' ? 'light' : 'dark'} theme`} title="Toggle theme" onClick={() => ws.setTheme(ws.theme === 'dark' ? 'light' : 'dark')} className={iconCls}>
            {ws.theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </IconButton>
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ mobile navigation */

export function MobileNav({ open, onClose, page }: { open: boolean; onClose: () => void; page: PageId }) {
  return (
    <Drawer open={open} onClose={onClose} title="Navigation" side="left" width="w-72">
      <div className="flex flex-col gap-4 p-3">
        <WorkspaceLabel collapsed={false} />
        <NavList page={page} collapsed={false} onNavigate={onClose} />
      </div>
    </Drawer>
  );
}

/** The app frame: top bar, collapsible sidebar (desktop), drawer navigation (phones and tablets). */
export function AppShell({ page, onHome, children }: { page: PageId; onHome: () => void; children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <>
      <TopBar page={page} onHome={onHome} onOpenMobileNav={() => setMobileOpen(true)} />
      <div className="relative z-10 flex">
        <Sidebar page={page} />
        <main id="main" className="min-w-0 flex-1 px-3 py-4 sm:px-6 lg:py-6">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
      <MobileNav open={mobileOpen} onClose={() => setMobileOpen(false)} page={page} />
    </>
  );
}
