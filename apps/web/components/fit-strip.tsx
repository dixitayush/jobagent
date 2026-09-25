"use client";

import { animate, motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { MatchBreakdown, MatchLevel } from "@jobagent/shared";
import { cn } from "@/lib/utils";

/**
 * The fit strip: one bar split into the real scoring weights (PRD §24), each segment filled by how
 * much of its weight the job earned. Reads at a glance on a row; labelled on the job page.
 */
export const FIT_PARTS: { key: keyof MatchBreakdown; label: string; weight: number }[] = [
  { key: "skills", label: "Skills", weight: 30 },
  { key: "experience", label: "Experience", weight: 20 },
  { key: "title", label: "Role", weight: 15 },
  { key: "semantic", label: "Overall fit", weight: 15 },
  { key: "location", label: "Location", weight: 10 },
  { key: "seniority", label: "Level", weight: 5 },
  { key: "workMode", label: "Work mode", weight: 5 },
];

const ratio = (fit: MatchBreakdown, key: keyof MatchBreakdown, weight: number) => Math.max(0, Math.min(1, (fit[key] ?? 0) / weight));

/** Fill that grows in once, left to right, the first time the strip scrolls into view. */
function Fill({ pct, index, run, className }: { pct: number; index: number; run: boolean; className: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { width: 0 }}
      animate={run || reduce ? { width: `${pct}%` } : { width: 0 }}
      transition={{ duration: 0.55, delay: 0.05 + index * 0.06, ease: [0.22, 1, 0.36, 1] }}
    />
  );
}

export function FitStrip({ fit, size = "sm", className, delay = 0 }: { fit: MatchBreakdown | null; size?: "sm" | "lg"; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -40px 0px" });
  const [run, setRun] = useState(false);
  useEffect(() => {
    if (!inView) return;
    const t = setTimeout(() => setRun(true), delay * 1000);
    return () => clearTimeout(t);
  }, [inView, delay]);
  if (!fit) return null;
  const summary = FIT_PARTS.map((p) => `${p.label} ${Math.round(fit[p.key] ?? 0)} of ${p.weight}`).join(", ");
  return (
    <div className={className} ref={ref}>
      <div role="img" aria-label={`Score breakdown: ${summary}`} className={cn("flex w-full gap-[3px]", size === "sm" ? "h-1.5" : "h-2.5")}>
        {FIT_PARTS.map((p, i) => (
          <div key={p.key} className="relative overflow-hidden rounded-full bg-rule" style={{ flexGrow: p.weight, flexBasis: 0 }} title={`${p.label}: ${Math.round(fit[p.key] ?? 0)} of ${p.weight}`}>
            <Fill pct={ratio(fit, p.key, p.weight) * 100} index={i} run={run} className="absolute inset-y-0 left-0 rounded-full bg-fit" />
          </div>
        ))}
      </div>
      {size === "lg" && (
        <dl className="mt-4 space-y-2 text-sm">
          {FIT_PARTS.map((p, i) => (
            <div key={p.key} className="grid grid-cols-[6.5rem_1fr_3.25rem] items-center gap-3">
              <dt className="text-graphite">{p.label}</dt>
              <div className="h-1 overflow-hidden rounded-full bg-rule" aria-hidden>
                <Fill pct={ratio(fit, p.key, p.weight) * 100} index={i + 2} run={run} className="h-full rounded-full bg-fit" />
              </div>
              <dd className="tabular text-right font-medium text-ink">
                {Math.round(fit[p.key] ?? 0)}
                <span className="font-normal text-graphite">/{p.weight}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

const LEVEL_TEXT: Record<MatchLevel, string> = {
  VERY_STRONG: "Very strong match",
  STRONG: "Strong match",
  GOOD: "Good match",
  PARTIAL: "Partial match",
  LOW: "Low match",
};
export const levelText = (l: MatchLevel | null | undefined) => (l ? LEVEL_TEXT[l] : "Not scored yet");
export const levelColor = (l: MatchLevel | null | undefined) =>
  l === "VERY_STRONG" || l === "STRONG" ? "text-fit" : l === "GOOD" ? "text-ink" : l === "PARTIAL" ? "text-caution" : "text-graphite";

/** Counts up to `value` once when it first appears (instant under reduced motion). */
export function CountUp({ value, delay = 0, duration = 0.9 }: { value: number; delay?: number; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);
  useEffect(() => {
    if (!inView) return;
    if (reduce) return setShown(value);
    const controls = animate(0, value, { duration, delay, ease: [0.22, 1, 0.36, 1], onUpdate: (v) => setShown(Math.round(v)) });
    return () => controls.stop();
  }, [inView, value, delay, duration, reduce]);
  return <span ref={ref}>{shown}</span>;
}

/** Score + level. The number carries the weight; the level names it in words. */
export function MatchScore({ score, level, size = "sm", className, animated = size === "lg", delay = 0 }: { score: number | null; level: MatchLevel | null; size?: "sm" | "lg"; className?: string; animated?: boolean; delay?: number }) {
  if (score === null || !level) return <span className={cn("text-xs text-graphite", className)}>Not scored yet</span>;
  return (
    <div className={cn("flex items-baseline gap-2", className)}>
      <span className={cn("tabular font-semibold tracking-tight", levelColor(level), size === "lg" ? "text-2xl" : "text-lg")}>{animated ? <CountUp value={score} delay={delay} /> : score}</span>
      <span className={cn("text-graphite", size === "lg" ? "text-sm" : "text-xs")}>{levelText(level)}</span>
    </div>
  );
}
