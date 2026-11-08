import { FilePlus2, Upload, Wand2 } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card, CardTitle, PageHeader } from '../components/ui/Display';
import { AGENT_TEMPLATES } from '../lib/templates';
import { useWorkspace } from '../app/workspace';

const FIELDS: Array<[string, string]> = [
  ['Name and icon', 'How the agent appears in lists, chats and workflows.'],
  ['Description', 'One line about what it is for.'],
  ['System prompt', 'Its personality, expertise and rules. This is what makes it a specialist.'],
  ['Temperature', 'Lower is focused and repeatable; higher is more creative.'],
  ['Tool permissions', 'What it will be allowed to use once tools are connected (stored and exported today).']
];

export default function BuilderPage() {
  const ws = useWorkspace();
  const full = ws.customAgents.length >= ws.maxCustomAgents;
  return (
    <div>
      <PageHeader
        title="Agent Builder"
        description="Create a specialist agent: start from a proven template, from a blank page, or from an exported .json file."
        actions={<>
          <Button icon={<Upload size={15} aria-hidden />} onClick={() => ws.triggerImport(null)}>Import JSON</Button>
          <Button variant="primary" icon={<FilePlus2 size={15} aria-hidden />} onClick={() => ws.openCreator(null)} disabled={full}>Blank agent</Button>
        </>}
      />
      {full && <p role="status" className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">You have {ws.maxCustomAgents} agents, the most this browser keeps. Delete one in My Agents to create another.</p>}

      <section aria-labelledby="tpl-h">
        <h2 id="tpl-h" className="mb-3 font-display text-lg font-bold">Templates</h2>
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="builder-templates">
          {AGENT_TEMPLATES.map(t => (
            <Card as="li" key={t.id} className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <span aria-hidden className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-xl">{t.draft.icon}</span>
                <div className="min-w-0">
                  <h3 className="font-display text-sm font-semibold">{t.draft.name}</h3>
                  <p className="text-xs text-muted">{t.tagline}</p>
                </div>
              </div>
              <p className="line-clamp-3 text-xs text-muted">{t.draft.systemPrompt}</p>
              <Button size="sm" variant="primary" icon={<Wand2 size={13} aria-hidden />} className="self-start" disabled={full} onClick={() => ws.openCreator(null, t.draft)} aria-label={`Use the ${t.draft.name} template`}>Use template</Button>
            </Card>
          ))}
        </ul>
      </section>

      <Card as="section" className="mt-6" aria-labelledby="fields-h">
        <CardTitle id="fields-h">What you configure</CardTitle>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {FIELDS.map(([k, v]) => (
            <div key={k}><dt className="text-sm font-semibold">{k}</dt><dd className="text-sm text-muted">{v}</dd></div>
          ))}
        </dl>
        <p className="mt-4 text-xs text-muted">Provider and model choice, knowledge files, memory, input/output schemas and versioning are added to the builder in Phases 3–4 of the roadmap.</p>
      </Card>
    </div>
  );
}
