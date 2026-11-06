import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { motion, useMotionValue, useSpring } from 'framer-motion';
import clsx from 'clsx';
import { useFx } from '../../lib/fx/capability';
import type { AgentStatus } from './AgentStatus';

interface Props {
  as?: 'div' | 'button';
  status?: AgentStatus;
  /** Max tilt in degrees. */
  max?: number;
  selected?: boolean;
  /** Render the status glow even for idle cards (the landing deck does; a 40-item list shouldn't). */
  glowIdle?: boolean;
  className?: string;
  cursorLabel?: string;
  /** How the custom cursor treats this card: a labelled disc (default) or a snapping ring that wraps it (for list rows). */
  cursor?: 'card' | 'magnet';
  onClick?: () => void;
  onKeyDown?: (e: KeyboardEvent) => void;
  children: ReactNode;
  style?: CSSProperties;
  [dataAttr: `data-${string}`]: string | boolean | undefined;
  'aria-current'?: boolean;
  'aria-label'?: string;
}

/**
 * A glass card that tilts toward the pointer in 3D, lights its border and surface under the cursor (spotlight),
 * and glows in the colour of its agent status. Children can pop out of the surface with [transform:translateZ(Npx)].
 * Tilt is mouse-only: touch and keyboard users get the glow and spotlight-free static card.
 */
export function TiltCard({ as = 'div', status, max = 9, selected, glowIdle, className, cursor = 'card', cursorLabel, onClick, onKeyDown, children, style, ...rest }: Props) {
  const { tier, finePointer } = useFx();
  const tilt = tier !== 'off' && finePointer;
  const el = useRef<HTMLElement | null>(null);
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const rotateX = useSpring(rx, { stiffness: 180, damping: 18, mass: 0.6 });
  const rotateY = useSpring(ry, { stiffness: 180, damping: 18, mass: 0.6 });

  const onMove = (e: PointerEvent<HTMLElement>) => {
    if (!tilt || e.pointerType !== 'mouse' || !el.current) return;
    const r = el.current.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    ry.set((px - 0.5) * 2 * max);
    rx.set(-(py - 0.5) * 2 * max);
    el.current.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
    el.current.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
  };
  const onLeave = () => { rx.set(0); ry.set(0); };

  const Tag = as === 'button' ? motion.button : motion.div;
  const glow = status && (status !== 'idle' || glowIdle || selected);

  return (
    <Tag
      ref={el as never}
      {...(as === 'button' ? { type: 'button' as const } : {})}
      {...rest}
      data-status={status}
      data-cursor={cursor}
      data-cursor-label={cursorLabel}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      whileTap={{ scale: 0.985 }}
      style={{ ...style, rotateX: tilt ? rotateX : 0, rotateY: tilt ? rotateY : 0, transformPerspective: 900, transformStyle: 'preserve-3d' }}
      className={clsx('spot group relative block w-full rounded-2xl text-left', selected && 'ring-1 ring-accent', className)}
    >
      {glow && (
        // A static box-shadow halo behind the card; only its opacity/scale animate, so the glow never repaints.
        <span
          aria-hidden
          data-testid="status-glow"
          className={clsx('pointer-events-none absolute inset-0 -z-10 rounded-[inherit] will-change-[opacity,transform]', status === 'active' && 'animate-glow-breathe', status === 'training' && 'animate-glow-breathe [animation-duration:4.2s]', status === 'idle' && 'animate-glow-slow')}
          style={{ boxShadow: '0 0 36px 2px rgb(var(--glow) / 0.5), 0 0 90px 10px rgb(var(--glow) / 0.18)' }}
        />
      )}
      {/* The glass plane is a separate layer so backdrop-filter doesn't flatten the 3D children above it. */}
      <span aria-hidden className="glass bg-glass-strong absolute inset-0 overflow-hidden rounded-[inherit]">
        {status === 'training' && <span className="absolute inset-x-0 top-0 h-1/4 animate-scan bg-gradient-to-b from-transparent via-[rgb(var(--glow)/0.22)] to-transparent" />}
      </span>
      <span className="relative block [transform-style:preserve-3d]">{children}</span>
    </Tag>
  );
}
