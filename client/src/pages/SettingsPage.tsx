import { useState } from 'react';
import { Keyboard, Trash2 } from 'lucide-react';
import { Modal } from '../components/Modal';
import { Button, LinkButton } from '../components/ui/Button';
import { authHref } from '../lib/route';
import { Badge, Card, CardTitle, PageHeader } from '../components/ui/Display';
import { Segmented } from '../components/ui/Form';
import { SERVICE_LABEL, type ServiceKey } from '../app/nav';
import { useWorkspace } from '../app/workspace';
import type { FxPref } from '../lib/fx/capability';
import type { Theme } from '../types';

export default function SettingsPage() {
  const ws = useWorkspace();
  const [confirmWipe, setConfirmWipe] = useState(false);
  const meta = ws.meta;
  const localCount = ws.account.status === 'signed-in' ? ws.localAgentsToImport.length : ws.customAgents.length;

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" description="Preferences for this browser, and what this server has configured." />

      <div className="flex flex-col gap-4">
        <Card as="section" aria-labelledby="set-appearance">
          <CardTitle id="set-appearance">Appearance</CardTitle>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div><p className="text-sm font-medium">Theme</p><p className="text-xs text-muted">The landing page always stays dark.</p></div>
              <Segmented<Theme> label="Theme" value={ws.theme} onChange={ws.setTheme} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div><p className="text-sm font-medium">Visual effects</p><p className="text-xs text-muted">3D background, custom cursor and motion. Lite and Off save battery.</p></div>
              <Segmented<FxPref> label="Visual effects" value={ws.fxPref} onChange={ws.setFxPref}
                options={[{ value: 'auto', label: 'Full', hint: 'Decided by your device' }, { value: 'low', label: 'Lite' }, { value: 'off', label: 'Off' }]} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <div><p className="text-sm font-medium">Keyboard shortcuts</p><p className="text-xs text-muted">⌘/Ctrl K, /, ?, Alt N and more.</p></div>
              <Button size="sm" icon={<Keyboard size={14} aria-hidden />} onClick={ws.openShortcuts}>View shortcuts</Button>
            </div>
          </div>
        </Card>

        <Card as="section" aria-labelledby="set-ai">
          <CardTitle id="set-ai">AI provider</CardTitle>
          {!meta ? <p className="text-sm text-muted">Provider status is unavailable from this server.</p> : (
            <>
              <p className="mb-3 text-sm">
                {meta.mode === 'live'
                  ? <>Agents answer with <strong>{meta.provider === 'gemini' ? 'Google Gemini' : 'OpenAI'}</strong>.</>
                  : <>No model key is set on the server, so agents give <strong>canned demo replies</strong>. An administrator can set <code>GEMINI_API_KEY</code> or <code>OPENAI_API_KEY</code>.</>}
              </p>
              <ul className="flex flex-col gap-2" data-testid="settings-providers">
                {(['openai', 'gemini'] as const).map(p => (
                  <li key={p} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
                    <span className="text-sm">{p === 'openai' ? 'OpenAI' : 'Google Gemini'}{meta.providers[p].model && <span className="text-muted"> · {meta.providers[p].model}</span>}</span>
                    <span className="flex gap-1.5">
                      {meta.provider === p && <Badge tone="accent">In use</Badge>}
                      <Badge tone={meta.providers[p].configured ? 'success' : 'neutral'}>{meta.providers[p].configured ? 'Key set' : 'No key'}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted">Keys live on the server only and are never sent to the browser. Saved agents can be pinned to any model listed in the agent editor.</p>
            </>
          )}
        </Card>

        <Card as="section" aria-labelledby="set-tools">
          <CardTitle id="set-tools">Tools</CardTitle>
          {!ws.toolInfo ? <p className="text-sm text-muted">Tool status is unavailable from this server.</p> : (
            <ul className="flex flex-col gap-2" data-testid="settings-tools">
              {ws.toolInfo.map(t => (
                <li key={t.id} className="flex items-start justify-between gap-3 text-sm">
                  <span className="min-w-0"><span className="block">{t.label}</span>{!t.available && t.reason && <span className="block text-xs text-muted">{t.reason}</span>}</span>
                  <Badge tone={t.available ? 'success' : 'neutral'}>{t.available ? 'Available' : 'Unavailable'}</Badge>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted">Agents only call the tools they are permitted, and only with a real model. Every call is shown in the reply's thought stream and, for signed-in users, recorded in Activity.</p>
        </Card>

        <Card as="section" aria-labelledby="set-services">
          <CardTitle id="set-services">Platform services</CardTitle>
          {!meta ? <p className="text-sm text-muted">Service status is unavailable from this server.</p> : (
            <ul className="flex flex-col gap-2">
              {(Object.keys(SERVICE_LABEL) as ServiceKey[]).map(k => (
                <li key={k} className="flex items-center justify-between gap-3 text-sm">
                  <span>{SERVICE_LABEL[k]}</span>
                  <Badge tone={meta.features[k] ? 'success' : 'neutral'}>{meta.features[k] ? 'Configured' : 'Not configured'}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card as="section" aria-labelledby="set-account">
          <CardTitle id="set-account">Account</CardTitle>
          {ws.account.status === 'signed-in' && ws.account.me ? (
            <div className="flex flex-col gap-3" data-testid="settings-account">
              <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                <div><dt className="text-xs text-muted">Name</dt><dd>{ws.account.me.user.name}</dd></div>
                <div><dt className="text-xs text-muted">Email</dt><dd className="flex items-center gap-2">{ws.account.me.user.email} <Badge tone={ws.account.me.user.emailVerified ? 'success' : 'warning'}>{ws.account.me.user.emailVerified ? 'Verified' : 'Not verified'}</Badge></dd></div>
                <div><dt className="text-xs text-muted">Workspace</dt><dd>{ws.account.me.workspace?.name} <span className="capitalize text-muted">({ws.account.me.workspace?.role})</span></dd></div>
                <div><dt className="text-xs text-muted">Workspaces</dt><dd>{ws.account.me.workspaces.length}</dd></div>
              </dl>
              <div><Button size="sm" onClick={() => void ws.account.signOut()}>Sign out</Button></div>
            </div>
          ) : ws.account.status === 'guest' ? (
            <>
              <p className="text-sm">You are using AgentVerse as a <strong>guest</strong>: custom agents stay in this browser and chats end when you refresh. Sign in to save them in a workspace.</p>
              <div className="mt-3 flex gap-2">
                <LinkButton href={authHref('sign-in')} size="sm" variant="primary">Sign in</LinkButton>
                <LinkButton href={authHref('sign-up')} size="sm">Create an account</LinkButton>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm">You are using AgentVerse as a <strong>guest</strong>. Your custom agents are saved in this browser; conversations last until you refresh the page.</p>
              <p className="mt-1 text-xs text-muted">Accounts need a database and an auth secret on the server (<code>DATABASE_URL</code>, <code>BETTER_AUTH_SECRET</code>).</p>
            </>
          )}
        </Card>

        <Card as="section" aria-labelledby="set-data">
          <CardTitle id="set-data">Data in this browser</CardTitle>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm">{localCount} custom agent{localCount === 1 ? '' : 's'} stored in this browser{ws.account.status === 'signed-in' ? ' (not in your workspace)' : ''}.</p>
            <Button size="sm" variant="danger" icon={<Trash2 size={14} aria-hidden />} disabled={!localCount} onClick={() => setConfirmWipe(true)}>Delete agents in this browser</Button>
          </div>
        </Card>
      </div>

      <Modal open={confirmWipe} onClose={() => setConfirmWipe(false)} title="Delete the agents in this browser?" size="sm">
        <div className="p-5">
          <p className="text-sm text-muted">This removes all {localCount} agents stored in this browser and their conversations. It cannot be undone; export any you want to keep first.</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={() => setConfirmWipe(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => { ws.removeAllCustomAgents(); setConfirmWipe(false); }}>Delete all</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
