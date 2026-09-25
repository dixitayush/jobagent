"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

const useIsMobile = () => {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return mobile;
};

/**
 * A menu anchored to a trigger, rendered in a top-level layer so it never slides under
 * neighbouring content. Flips above the trigger when there's no room below; becomes a
 * bottom sheet on phones. Closes on Escape, outside click, scroll or resize.
 */
export function Popover({ open, onClose, anchor, label, width = 240, children }: { open: boolean; onClose: () => void; anchor: RefObject<HTMLElement | null>; label: string; width?: number; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const mobile = useIsMobile();
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (!open || mobile || !anchor.current) return;
    const place = () => {
      const r = anchor.current!.getBoundingClientRect();
      const h = panel.current?.offsetHeight ?? 320;
      const above = r.bottom + 8 + h > window.innerHeight && r.top - 8 - h > 0;
      const left = Math.min(Math.max(8, r.right - width), window.innerWidth - width - 8);
      setPos({ top: above ? r.top - 8 - h : r.bottom + 8, left, above });
    };
    place();
    const raf = requestAnimationFrame(place); // re-measure once the panel has rendered
    return () => cancelAnimationFrame(raf);
  }, [open, mobile, anchor, width]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (onClose(), anchor.current?.focus());
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !anchor.current?.contains(t)) onClose();
    };
    const onMove = () => !mobile && onClose();
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, { passive: true, capture: true });
    const focusFirst = setTimeout(() => panel.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus(), 30);
    return () => {
      clearTimeout(focusFirst);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, { capture: true });
    };
  }, [open, onClose, anchor, mobile]);

  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open &&
        (mobile ? (
          <motion.div key="sheet" className="fixed inset-0 z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <button type="button" aria-label="Close" className="absolute inset-0 bg-black/45 backdrop-blur-[1px]" onClick={onClose} />
            <motion.div
              ref={panel}
              role="menu"
              aria-label={label}
              className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t bg-surface px-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3 shadow-2xl"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 32, stiffness: 360 }}
            >
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-rule" aria-hidden />
              {children}
            </motion.div>
          </motion.div>
        ) : (
          <motion.div
            key="menu"
            ref={panel}
            role="menu"
            aria-label={label}
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width, transformOrigin: pos?.above ? "bottom right" : "top right" }}
            className="fixed z-50 rounded-xl border bg-surface p-1.5 shadow-[0_16px_40px_-12px_hsl(var(--ink)/0.3)]"
            initial={{ opacity: 0, scale: 0.96, y: pos?.above ? 4 : -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
          >
            {children}
          </motion.div>
        ))}
    </AnimatePresence>,
    document.body,
  );
}

export function MenuItem({ children, onSelect, muted }: { children: ReactNode; onSelect: () => void; muted?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={`block w-full rounded-lg px-3 py-2.5 text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-0 sm:py-2 ${muted ? "text-graphite" : "text-ink"}`}
    >
      {children}
    </button>
  );
}
