import { Activity, BrainCircuit, Pause, type LucideIcon } from 'lucide-react';

/** Lifecycle shown on agent cards. Colour is never the only signal: every state also has a label and an icon. */
export type AgentStatus = 'active' | 'training' | 'idle';

export const STATUS_META: Record<AgentStatus, { label: string; Icon: LucideIcon; text: string; bg: string }> = {
  active: { label: 'Active', Icon: Activity, text: 'text-neon-cyan', bg: 'bg-neon-cyan/12 border-neon-cyan/40' },
  training: { label: 'Training', Icon: BrainCircuit, text: 'text-neon-violet', bg: 'bg-neon-violet/12 border-neon-violet/40' },
  idle: { label: 'Idle', Icon: Pause, text: 'text-muted', bg: 'bg-hover border-line' }
};

export function StatusChip({ status, className = '' }: { status: AgentStatus; className?: string }) {
  const { label, Icon, text, bg } = STATUS_META[status];
  return (
    <span data-testid="status-chip" data-status-label={status} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${bg} ${text} ${className}`}>
      <Icon size={10} aria-hidden className={status === 'active' ? 'animate-pulse' : ''} />
      {label}
    </span>
  );
}
