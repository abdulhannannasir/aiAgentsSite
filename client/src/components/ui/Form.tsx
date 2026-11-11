import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import clsx from 'clsx';

const CONTROL = 'w-full rounded-lg border border-line bg-glass px-3 text-sm text-fg placeholder:text-muted/70 transition focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60';

export const inputClass = (className?: string) => clsx(CONTROL, 'h-10', className);

/** A labelled form control with optional hint and error, wired up for screen readers. */
export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string; children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode }) {
  const id = useId();
  const described = [hint && `${id}-hint`, error && `${id}-err`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      {children({ id, 'aria-describedby': described, 'aria-invalid': error ? true : undefined })}
      {hint && <p id={`${id}-hint`} className="text-xs text-muted">{hint}</p>}
      {error && <p id={`${id}-err`} className="text-xs font-medium text-rose-500">{error}</p>}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={inputClass(className)} {...rest} />;
}

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={inputClass(clsx('pr-8', className))} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx(CONTROL, 'min-h-24 py-2', className)} {...rest} />;
}

/** A group of mutually exclusive options rendered as segmented buttons (radio semantics). */
export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ value: T; label: string; hint?: string }>; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-xl border border-line p-1">
      {options.map(o => (
        <button
          key={o.value} type="button" role="radio" aria-checked={value === o.value} title={o.hint}
          onClick={() => onChange(o.value)}
          className={clsx('rounded-lg px-3 py-1.5 text-xs font-medium transition', value === o.value ? 'bg-accent text-on-accent shadow' : 'text-muted hover:bg-hover hover:text-fg')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
