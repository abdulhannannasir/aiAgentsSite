import { prefersReducedMotion } from '../../lib/platform';
import type { StepStatus } from '../../types';

export interface GraphStep {
  id: string;
  icon: string;
  role: string;
  name: string;
  status: StepStatus;
}

const STROKE: Record<StepStatus, string> = {
  pending: 'rgb(var(--muted) / 0.45)',
  active: 'rgb(var(--neon-cyan))',
  complete: 'rgb(var(--neon-cyan))',
  error: '#fb7185'
};

/**
 * Agents as nodes, handoffs as links. Driven entirely by step status, so it shows what is really happening:
 * a finished link is solid, the link into the running step carries a travelling packet, later links stay dim.
 * Used live in the workspace (from the streamed workflow trace) and as a preview on the landing page.
 */
export function CollabGraph({ steps, compact = false, className = '' }: { steps: GraphStep[]; compact?: boolean; className?: string }) {
  if (steps.length === 0) return null;
  const gap = compact ? 118 : 156;
  const pad = compact ? 54 : 74;
  const W = pad * 2 + gap * (steps.length - 1);
  const H = compact ? 92 : 128;
  const cy = compact ? 34 : 50;
  const r = compact ? 17 : 24;
  const x = (i: number) => pad + i * gap;
  const still = prefersReducedMotion();
  const summary = steps.map(s => `${s.role} (${s.status === 'error' ? 'failed' : s.status})`).join(', then ');

  return (
    <div className={`overflow-x-auto no-scrollbar ${className}`}>
      <svg role="img" aria-label={`Agent handoffs: ${summary}`} data-testid="collab-graph" viewBox={`0 0 ${W} ${H}`} className="mx-auto block h-auto" style={{ width: Math.min(W, compact ? 420 : 560), minWidth: Math.min(W, 260) }}>
        {steps.slice(0, -1).map((s, i) => {
          const next = steps[i + 1];
          const flowing = next.status === 'active' && s.status === 'complete';
          const done = s.status === 'complete' && next.status === 'complete';
          const failed = next.status === 'error';
          const x1 = x(i) + r + 3, x2 = x(i + 1) - r - 3;
          return (
            <g key={`${s.id}-${next.id}`} data-link={flowing ? 'flowing' : done ? 'done' : failed ? 'failed' : 'idle'}>
              <line x1={x1} y1={cy} x2={x2} y2={cy} stroke={failed ? STROKE.error : done || flowing ? STROKE.complete : STROKE.pending}
                strokeWidth={done || flowing ? 2 : 1.5} strokeDasharray={done ? undefined : '6 6'} strokeLinecap="round" className={flowing ? 'animate-flow' : ''} />
              {flowing && !still && (
                <circle r={3.5} cy={cy} fill="rgb(var(--neon-cyan))" style={{ filter: 'drop-shadow(0 0 5px rgb(var(--neon-cyan)))' }}>
                  <animate attributeName="cx" from={x1} to={x2} dur="1.1s" repeatCount="indefinite" />
                </circle>
              )}
            </g>
          );
        })}

        {steps.map((s, i) => (
          <g key={s.id} data-node={s.id} data-status={s.status}>
            {s.status === 'active' && !still && (
              <circle cx={x(i)} cy={cy} r={r} fill="none" stroke={STROKE.active} strokeWidth={1.5} className="animate-ping-slow" style={{ transformOrigin: `${x(i)}px ${cy}px` }} />
            )}
            <circle cx={x(i)} cy={cy} r={r} fill="var(--glass-strong)" stroke={STROKE[s.status]} strokeWidth={s.status === 'pending' ? 1.2 : 2}
              style={s.status === 'active' || s.status === 'complete' ? { filter: 'drop-shadow(0 0 6px rgb(var(--neon-cyan) / 0.55))' } : undefined} />
            <text x={x(i)} y={cy + (compact ? 5 : 7)} textAnchor="middle" fontSize={compact ? 15 : 21} opacity={s.status === 'pending' ? 0.55 : 1}>{s.icon}</text>
            <text x={x(i)} y={cy + r + (compact ? 15 : 19)} textAnchor="middle" fontSize={compact ? 10 : 11.5} fontWeight={600} fill="rgb(var(--fg))" fontFamily="'JetBrains Mono Variable', monospace">{s.role}</text>
            {!compact && <text x={x(i)} y={cy + r + 34} textAnchor="middle" fontSize={9.5} fill="rgb(var(--muted))" fontFamily="'JetBrains Mono Variable', monospace">{s.status === 'error' ? 'failed' : s.status}</text>}
          </g>
        ))}
      </svg>
    </div>
  );
}
