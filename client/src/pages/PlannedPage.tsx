import { Compass, Construction } from 'lucide-react';
import { LinkButton } from '../components/ui/Button';
import { Badge, Card, CardTitle, PageHeader } from '../components/ui/Display';
import { SERVICE_LABEL, type NavItem } from '../app/nav';
import { useWorkspace } from '../app/workspace';
import { pageHref } from '../lib/route';

/**
 * An honest page for a module that is not built yet: what it will do, which roadmap phase delivers it, and
 * whether this server already has what it needs. No fake controls.
 */
export default function PlannedPage({ item }: { item: NavItem }) {
  const { meta } = useWorkspace();
  return (
    <div className="max-w-3xl" data-testid="planned-page" data-page={item.id}>
      <PageHeader title={item.label} description={item.description} eyebrow={<Badge tone="violet"><Construction size={10} aria-hidden /> Planned · Phase {item.phase}</Badge>} />
      <Card as="section" aria-labelledby="planned-what">
        <CardTitle id="planned-what">What this module will do</CardTitle>
        <ul className="list-disc space-y-1.5 pl-5 text-sm">
          {item.capabilities?.map(c => <li key={c}>{c}</li>)}
        </ul>
      </Card>
      {item.requires?.length ? (
        <Card as="section" className="mt-4" aria-labelledby="planned-needs">
          <CardTitle id="planned-needs">What it needs on the server</CardTitle>
          <ul className="flex flex-col gap-2">
            {item.requires.map(k => (
              <li key={k} className="flex items-center justify-between gap-3 text-sm">
                <span>{SERVICE_LABEL[k]}</span>
                {meta ? <Badge tone={meta.features[k] ? 'success' : 'neutral'}>{meta.features[k] ? 'Configured' : 'Not configured'}</Badge> : <Badge>Unknown</Badge>}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <p className="mt-4 text-sm text-muted">Until then, everything you can do today is in the Workspace section of the navigation.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <LinkButton href={pageHref('command-center')} size="sm" icon={<Compass size={14} aria-hidden />}>Go to the Command Center</LinkButton>
        <LinkButton href={pageHref('chat')} size="sm" variant="primary">Open chat</LinkButton>
      </div>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="mx-auto mt-10 max-w-md text-center" data-testid="not-found">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">404</p>
      <h1 className="mt-1 font-display text-2xl font-bold">This page doesn't exist</h1>
      <p className="mt-2 text-sm text-muted">The link may be old or mistyped.</p>
      <LinkButton href={pageHref('command-center')} variant="primary" className="mt-5">Go to the Command Center</LinkButton>
    </div>
  );
}
