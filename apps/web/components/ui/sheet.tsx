"use client";

import { X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, type ReactNode } from "react";

/** Bottom sheet for phones: slides up, dims the page, closes on backdrop tap, Escape or the close button. */
export function Sheet({ open, onClose, title, id, children, footer }: { open: boolean; onClose: () => void; title: string; id?: string; children: ReactNode; footer?: ReactNode }) {
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={title} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <button type="button" className="absolute inset-0 bg-black/45 backdrop-blur-[1px]" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose} />
          <motion.div
            id={id}
            className="absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col rounded-t-2xl border-t bg-paper shadow-2xl"
            initial={reduce ? false : { y: "100%" }}
            animate={{ y: 0 }}
            exit={reduce ? { opacity: 0 } : { y: "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 340 }}
          >
            <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-rule" aria-hidden />
            <div className="flex items-center justify-between px-4 pb-2 pt-3">
              <p className="font-semibold">{title}</p>
              <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-lg transition-colors hover:bg-surface" aria-label={`Close ${title.toLowerCase()}`}>
                <X className="size-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 pb-4">{children}</div>
            {footer && <div className="border-t px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
