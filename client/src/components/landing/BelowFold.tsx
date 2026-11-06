import { AgentDeck } from './AgentDeck';
import { Architecture } from './Architecture';
import { BentoGrid } from './BentoGrid';
import { CtaFooter } from './CtaFooter';
import { Stats } from './Stats';
import { Story } from './Story';
import type { LandingProps } from './LandingPage';

/** Everything under the hero. Loaded as its own chunk (it carries GSAP) so the hero can paint first. */
export default function BelowFold(p: LandingProps) {
  return (
    <>
      <AgentDeck agents={p.agents} onOpenAgent={p.onOpenAgent} onLaunch={p.onLaunch} />
      <Story agents={p.agents} workflows={p.workflows} />
      <BentoGrid workflows={p.workflows} onRunWorkflow={p.onRunWorkflow} onOpenBuilder={p.onOpenBuilder} onOpenPalette={p.onOpenPalette} />
      <Stats agents={p.agents} workflows={p.workflows} />
      <Architecture />
      <CtaFooter mode={p.mode} onLaunch={p.onLaunch} onOpenBuilder={() => p.onOpenBuilder()} onOpenDocs={p.onOpenDocs} onOpenShortcuts={p.onOpenShortcuts} />
    </>
  );
}
