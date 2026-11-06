import { lazy, Suspense } from 'react';
import type { Agent, AgentDraft, Workflow } from '../../types';
import { FxBoundary } from '../fx/FxBackground';
import { Hero } from './Hero';
import { LandingNav, scrollToSection } from './LandingNav';

const BelowFold = lazy(() => import('./BelowFold'));

export interface LandingProps {
  agents: Agent[];
  workflows: Workflow[];
  mode: 'live' | 'demo' | null;
  onLaunch: () => void;
  onOpenAgent: (agentId: string) => void;
  onRunWorkflow: (workflow: Workflow) => void;
  onOpenBuilder: (draft?: AgentDraft) => void;
  onOpenPalette: () => void;
  onOpenDocs: () => void;
  onOpenShortcuts: () => void;
}

/** The marketing front door. Always rendered in the dark "obsidian" theme, whatever the workspace theme is. */
export function LandingPage(p: LandingProps) {
  return (
    // Transparent on purpose: the fixed swarm canvas (with its own obsidian backdrop) sits behind this and must show through.
    <div className="dark relative min-h-dvh bg-aurora font-sans text-fg">
      <LandingNav onLaunch={p.onLaunch} onOpenPalette={p.onOpenPalette} />
      <main className="relative z-10">
        <Hero agentCount={p.agents.length} workflowCount={p.workflows.length} mode={p.mode} onLaunch={p.onLaunch} onSeeHow={() => scrollToSection('agents')} />
        <FxBoundary onError={() => undefined}>
          <Suspense fallback={<div aria-hidden className="h-[60vh]" />}>
            <BelowFold {...p} />
          </Suspense>
        </FxBoundary>
      </main>
    </div>
  );
}
