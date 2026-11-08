import { useState } from 'react';
import { Keyboard, Trash2 } from 'lucide-react';
import { Modal } from '../components/Modal';
import { Button } from '../components/ui/Button';
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
              <p className="mt-2 text-xs text-muted">Keys live on the server only and are never sent to the browser. Per-agent provider and model choice arrives in Phase 4.</p>
            </>
          )}
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
          <p className="text-sm">You are using AgentVerse as a <strong>guest</strong>. Your custom agents are saved in this browser; conversations last until you refresh the page.</p>
          <p className="mt-1 text-xs text-muted">{meta?.features.auth ? 'This server is ready for accounts; sign-in screens arrive with Phase 2.' : 'Accounts need a database and an auth secret on the server (Phase 2).'}</p>
        </Card>

        <Card as="section" aria-labelledby="set-data">
          <CardTitle id="set-data">Data in this browser</CardTitle>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm">{ws.customAgents.length} custom agent{ws.customAgents.length === 1 ? '' : 's'} saved locally.</p>
            <Button size="sm" variant="danger" icon={<Trash2 size={14} aria-hidden />} disabled={!ws.customAgents.length} onClick={() => setConfirmWipe(true)}>Delete all custom agents</Button>
          </div>
        </Card>
      </div>

      <Modal open={confirmWipe} onClose={() => setConfirmWipe(false)} title="Delete all custom agents?" size="sm">
        <div className="p-5">
          <p className="text-sm text-muted">This removes all {ws.customAgents.length} of your agents and their conversations from this browser. It cannot be undone; export any you want to keep first.</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={() => setConfirmWipe(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => { ws.removeAllCustomAgents(); setConfirmWipe(false); }}>Delete all</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
