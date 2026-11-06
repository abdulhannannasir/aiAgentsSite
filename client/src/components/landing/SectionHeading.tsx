import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

/** Mono index tag + display headline + lede. Reveals once when scrolled into view. */
export function SectionHeading({ index, label, title, children, align = 'left' }: { index: string; label: string; title: ReactNode; children?: ReactNode; align?: 'left' | 'center' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 26 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-12% 0px' }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className={align === 'center' ? 'mx-auto max-w-3xl text-center' : 'max-w-3xl'}
    >
      <p className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-neon-cyan">
        <span className="text-muted">[{index}]</span> {label}
      </p>
      <h2 className="mt-3 font-display text-[clamp(2rem,4.6vw,3.4rem)] font-bold leading-[1.02] tracking-tight">{title}</h2>
      {children && <p className="mt-4 text-base leading-relaxed text-muted sm:text-lg">{children}</p>}
    </motion.div>
  );
}
