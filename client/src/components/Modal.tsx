import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useIsPresent } from 'framer-motion';
import { X } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';

const SIZES = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' } as const;

// Esc closes only the top-most dialog when several are stacked (e.g. export over the agent editor).
const stack: symbol[] = [];
let lockCount = 0;

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: keyof typeof SIZES;
  placement?: 'center' | 'top';
  /** Hide the visible header (the title is still used as the accessible name). */
  bare?: boolean;
  description?: string;
}

function Dialog({ onClose, title, children, size = 'md', placement = 'center', bare, description }: Omit<ModalProps, 'open'>) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const present = useIsPresent(); // false while the dialog is animating out
  useFocusTrap(ref, present);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // A dialog takes part in Esc handling and scroll locking only while it is actually open. Once it starts
  // closing it steps aside immediately, so Esc and clicks reach whatever is underneath (or opens next).
  useEffect(() => {
    if (!present) return;
    const id = Symbol('modal');
    stack.push(id);
    if (lockCount++ === 0) document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stack[stack.length - 1] === id) { e.preventDefault(); closeRef.current(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
      if (--lockCount === 0) document.body.style.overflow = '';
    };
  }, [present]);

  const quick = { duration: 0.12 };
  return (
    <div
      aria-hidden={present ? undefined : true} // a closing dialog is gone for assistive tech immediately
      className={`fixed inset-0 z-[70] flex justify-center overflow-y-auto p-3 sm:p-6 ${present ? '' : 'pointer-events-none'} ${placement === 'top' ? 'items-start pt-[10vh]' : 'items-center'}`}
    >
      <motion.div
        aria-hidden
        className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: quick }}
        onMouseDown={() => closeRef.current()}
      />
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? `${titleId}-d` : undefined}
        tabIndex={-1}
        initial={{ opacity: 0, y: placement === 'top' ? -12 : 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98, transition: quick }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        className={`glass bg-glass-strong relative w-full ${SIZES[size]} overflow-hidden rounded-2xl shadow-float`}
      >
        {bare ? (
          <h2 id={titleId} className="sr-only">{title}</h2>
        ) : (
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <h2 id={titleId} className="text-base font-bold">{title}</h2>
              {description && <p id={`${titleId}-d`} className="mt-0.5 text-xs text-muted">{description}</p>}
            </div>
            <button type="button" onClick={onClose} aria-label="Close dialog" className="rounded-lg p-1.5 text-muted transition hover:bg-hover hover:text-fg">
              <X size={18} />
            </button>
          </div>
        )}
        {children}
      </motion.div>
    </div>
  );
}

export function Modal(props: ModalProps) {
  // Every open gets a fresh Dialog (new key). Otherwise reopening while the previous one is still animating
  // out would revive that instance and its old state (typed text, errors, search query) in the new session.
  const opens = useRef(0);
  const wasOpen = useRef(false);
  if (props.open && !wasOpen.current) opens.current += 1;
  wasOpen.current = props.open;
  return createPortal(<AnimatePresence>{props.open && <Dialog key={opens.current} {...props} />}</AnimatePresence>, document.body);
}
