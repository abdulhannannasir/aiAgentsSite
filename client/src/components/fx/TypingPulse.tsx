/** Three pulsing dots, shown from the moment a reply is requested until its first token arrives. */
export function TypingPulse({ label = 'Thinking' }: { label?: string }) {
  return (
    <span role="status" aria-label={`${label}…`} data-testid="typing-pulse" className="inline-flex items-center gap-2 py-1">
      <span aria-hidden className="inline-flex items-end gap-1">
        {[0, 1, 2].map(i => (
          <span key={i} className="h-1.5 w-1.5 animate-dot-bounce rounded-full bg-neon-cyan shadow-[0_0_8px_rgb(var(--neon-cyan)/0.8)]" style={{ animationDelay: `${i * 0.16}s` }} />
        ))}
      </span>
      <span className="font-mono text-[11px] uppercase tracking-wider text-muted">{label}</span>
    </span>
  );
}
