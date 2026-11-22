import type { HTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Loader2 } from 'lucide-react';

/** A glass surface. `as` lets a card be a section/article/li for the right semantics. */
export function Card({ as: Tag = 'div', className, padded = true, ...rest }: HTMLAttributes<HTMLElement> & { as?: 'div' | 'section' | 'article' | 'li'; padded?: boolean }) {
  return <Tag className={clsx('glass rounded-2xl', padded && 'p-4 sm:p-5', className)} {...rest} />;
}

export function CardTitle({ children, action, id }: { children: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 id={id} className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{children}</h2>
      {action}
    </div>
  );
}

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'violet';
const TONES: Record<Tone, string> = {
  neutral: 'border-line bg-hover text-muted',
  accent: 'border-neon-cyan/40 bg-neon-cyan/10 text-accent',
  success: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  warning: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  danger: 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400',
  violet: 'border-neon-violet/40 bg-neon-violet/10 text-neon-violet'
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider', TONES[tone], className)}>
      {children}
    </span>
  );
}

const DOT: Record<Tone, string> = {
  neutral: 'bg-slate-400', accent: 'bg-neon-cyan shadow-[0_0_8px_rgb(var(--neon-cyan))]', success: 'bg-emerald-500',
  warning: 'bg-amber-500', danger: 'bg-rose-500', violet: 'bg-neon-violet'
};

/** A coloured dot with a text label (colour is never the only signal). */
export function StatusDot({ tone, label, pulse }: { tone: Tone; label: string; pulse?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span aria-hidden className={clsx('h-2 w-2 shrink-0 rounded-full', DOT[tone], pulse && 'animate-pulse')} />
      {label}
    </span>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5">{eyebrow}</div>}
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line px-6 py-10 text-center">
      {icon && <div aria-hidden className="mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-line-strong bg-accent/10 text-accent">{icon}</div>}
      <p className="font-display text-base font-semibold">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', children, onRetry }: { title?: string; children?: ReactNode; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center rounded-2xl border border-rose-500/30 bg-rose-500/5 px-6 py-8 text-center">
      <AlertTriangle aria-hidden className="mb-2 text-rose-500" size={22} />
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
      {onRetry && <button type="button" onClick={onRetry} className="mt-4 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-on-accent">Retry</button>}
    </div>
  );
}

export function Spinner({ label = 'Loading', size = 16 }: { label?: string; size?: number }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-muted">
      <Loader2 aria-hidden size={size} className="animate-spin motion-reduce:animate-none" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={clsx('animate-pulse rounded-lg bg-hover motion-reduce:animate-none', className)} />;
}

/** Determinate progress (value 0..1). */
export function ProgressBar({ value, label }: { value: number; label: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-1.5 w-full overflow-hidden rounded-full bg-hover">
      <div className="h-full rounded-full bg-gradient-to-r from-neon-cyan to-neon-violet transition-[width] duration-500" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** A label/value stat tile. */
export function Stat({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <Card className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-muted">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em]">{label}</span>
        {icon && <span aria-hidden>{icon}</span>}
      </div>
      <div className="font-display text-2xl font-bold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </Card>
  );
}
