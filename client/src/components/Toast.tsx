import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';

type Kind = 'success' | 'error' | 'info';
interface Item { id: number; kind: Kind; message: string }

const Ctx = createContext<{ toast: (message: string, kind?: Kind) => void }>({ toast: () => undefined });
export const useToast = () => useContext(Ctx);

const ICON = { success: CheckCircle2, error: AlertTriangle, info: Info } as const;
const TONE = { success: 'text-emerald-500', error: 'text-rose-500', info: 'text-accent' } as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const seq = useRef(0);
  const toast = useCallback((message: string, kind: Kind = 'info') => {
    const id = ++seq.current;
    setItems(list => [...list.slice(-3), { id, kind, message }]);
    window.setTimeout(() => setItems(list => list.filter(i => i.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);
  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[80] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6">
        <AnimatePresence>
          {items.map(i => {
            const Icon = ICON[i.kind];
            return (
              <motion.div
                key={i.id}
                layout
                initial={{ opacity: 0, y: 16, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                className="glass bg-glass-strong pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-sm shadow-float"
              >
                <Icon size={16} className={`mt-0.5 shrink-0 ${TONE[i.kind]}`} aria-hidden />
                <span>{i.message}</span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
