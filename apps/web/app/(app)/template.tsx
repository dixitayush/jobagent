"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

/** Re-mounts on every navigation: a short fade-and-rise so page changes feel continuous. */
export default function AppTemplate({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </motion.div>
  );
}
