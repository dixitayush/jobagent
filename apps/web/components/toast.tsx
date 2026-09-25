"use client";

import { X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

interface Toast {
  id: number;
  message: string;
  action?: { label: string; onClick: () => void };
  ms: number;
}

const ToastContext = createContext<(message: string, action?: Toast["action"]) => void>(() => undefined);

/** Brief confirmations for user actions ("Saved", "Job hidden, Undo"). Announced to screen readers. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const reduce = useReducedMotion();
  const close = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (message: string, action?: Toast["action"]) => {
      const id = next.current++;
      const ms = action ? 6000 : 3200;
      setToasts((t) => [...t.slice(-2), { id, message, action, ms }]);
      setTimeout(() => close(id), ms);
    },
    [close],
  );
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout={!reduce}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.96, transition: { duration: 0.15 } }}
              transition={{ type: "spring", stiffness: 420, damping: 30 }}
              className="pointer-events-auto relative flex w-full max-w-sm items-center gap-3 overflow-hidden rounded-xl bg-ink px-4 py-3 text-sm text-primary-foreground shadow-[0_12px_32px_-8px_hsl(var(--ink)/0.45)]"
            >
              <span className="flex-1">{t.message}</span>
              {t.action && (
                <button
                  type="button"
                  className="rounded-md px-2 py-1 font-semibold text-fit-soft underline-offset-4 transition-colors hover:bg-white/10 dark:text-fit"
                  onClick={() => {
                    t.action!.onClick();
                    close(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              )}
              <button type="button" onClick={() => close(t.id)} aria-label="Close" className="rounded-md p-1 opacity-60 transition-opacity hover:opacity-100">
                <X className="size-4" />
              </button>
              {/* Time left to act */}
              {!reduce && (
                <motion.span className="absolute bottom-0 left-0 h-0.5 bg-fit" initial={{ width: "100%" }} animate={{ width: 0 }} transition={{ duration: t.ms / 1000, ease: "linear" }} aria-hidden />
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
