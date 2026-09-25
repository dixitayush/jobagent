"use client";

import type { MatchBreakdown, MatchLevel } from "@jobagent/shared";
import { motion, useReducedMotion, type Variants } from "motion/react";
import Link from "next/link";
import { FitStrip, MatchScore } from "./fit-strip";

const SAMPLE: { title: string; company: string; place: string; posted: string; score: number; level: MatchLevel; fit: MatchBreakdown; isNew: boolean }[] = [
  {
    title: "Senior Backend Engineer",
    company: "Lumen Pay",
    place: "Bengaluru, hybrid",
    posted: "3 hours ago",
    score: 93,
    level: "VERY_STRONG",
    isNew: true,
    fit: { skills: 28, experience: 20, title: 14, semantic: 12, location: 10, seniority: 5, workMode: 4, personalization: 0 },
  },
  {
    title: "Software Engineer II, Platform",
    company: "Northwind Cloud",
    place: "Remote, India",
    posted: "7 hours ago",
    score: 84,
    level: "STRONG",
    isNew: true,
    fit: { skills: 24, experience: 18, title: 11, semantic: 12, location: 10, seniority: 4, workMode: 5, personalization: 0 },
  },
  {
    title: "Java Developer",
    company: "Harbor Analytics",
    place: "Pune, on-site",
    posted: "1 day ago",
    score: 72,
    level: "GOOD",
    isNew: false,
    fit: { skills: 21, experience: 15, title: 13, semantic: 9, location: 6, seniority: 5, workMode: 3, personalization: 0 },
  },
];

const ease = [0.22, 1, 0.36, 1] as const;

/** The landing page's single orchestrated moment: copy rises in, then the shortlist assembles itself. */
export function LandingHero() {
  const reduce = useReducedMotion();
  const rise: Variants = {
    hidden: reduce ? { opacity: 1 } : { opacity: 0, y: 18 },
    show: (i: number) => ({ opacity: 1, y: 0, transition: { duration: 0.7, delay: 0.08 + i * 0.12, ease } }),
  };
  const ROW_START = 0.75;
  return (
    <section className="relative mx-auto grid max-w-[1120px] items-center gap-12 px-4 pb-20 pt-10 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:pt-20">
      <div className="max-w-xl">
        <motion.h1 variants={rise} initial="hidden" animate="show" custom={0} className="text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[3.5rem]">
          The few new jobs worth your time, twice a day.
        </motion.h1>
        <motion.p variants={rise} initial="hidden" animate="show" custom={1} className="mt-6 text-base text-graphite sm:text-lg sm:leading-8">
          Job Agent watches the companies you choose, reads every new opening against your resume, and sends you a short list with a clear reason for each pick.
        </motion.p>
        <motion.div variants={rise} initial="hidden" animate="show" custom={2} className="mt-9 flex flex-wrap items-center gap-3">
          <Link
            href="/login"
            className="group inline-flex h-12 items-center gap-2 rounded-lg bg-ink px-6 text-base font-medium text-primary-foreground shadow-[0_1px_2px_hsl(var(--ink)/0.2)] transition-[background-color,box-shadow,transform] hover:bg-ink/90 hover:shadow-[0_10px_24px_-10px_hsl(var(--ink)/0.55)] active:scale-[0.98]"
          >
            Get started free
          </Link>
          <a href="#how" className="inline-flex h-12 items-center rounded-lg px-4 text-base font-medium text-ink transition-colors hover:bg-surface">
            How it works
          </a>
        </motion.div>
      </div>

      <div className="relative">
        {/* Ambient teal glow behind the preview */}
        <div aria-hidden className="animate-drift pointer-events-none absolute -inset-10 -z-10 rounded-[3rem] bg-[radial-gradient(closest-side,hsl(var(--fit)/0.18),transparent)] blur-2xl dark:bg-[radial-gradient(closest-side,hsl(var(--fit)/0.14),transparent)]" />
        <motion.figure
          initial={reduce ? false : { opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.35, ease }}
          className="rounded-2xl border bg-surface/90 p-2 shadow-[0_24px_60px_-30px_hsl(var(--ink)/0.35)] backdrop-blur"
        >
          <div className="flex items-center justify-between px-4 pb-2 pt-3">
            <p className="text-sm font-semibold">Your morning shortlist</p>
            <p className="flex items-center gap-2 text-xs text-graphite">
              <span className="relative flex size-2" aria-hidden>
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-fit opacity-60 motion-reduce:hidden" />
                <span className="relative inline-flex size-2 rounded-full bg-fit" />
              </span>
              3 of 214 new openings
            </p>
          </div>
          <ul className="divide-y overflow-hidden rounded-xl border bg-paper/40">
            {SAMPLE.map((j, i) => (
              <motion.li
                key={j.title}
                initial={reduce ? false : { opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, delay: ROW_START + i * 0.18, ease }}
                className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 p-4"
              >
                <div className="min-w-0">
                  <p className="font-semibold leading-snug tracking-tight">{j.title}</p>
                  <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-graphite">
                    <span className="text-ink">{j.company}</span>
                    <span>{j.place}</span>
                    <span>
                      {j.isNew ? <span className="marker font-medium text-ink">New</span> : null} {j.posted}
                    </span>
                  </p>
                </div>
                <MatchScore score={j.score} level={j.level} className="justify-end" animated delay={ROW_START + 0.15 + i * 0.18} />
                <FitStrip fit={j.fit} className="col-span-2" delay={ROW_START + 0.1 + i * 0.18} />
              </motion.li>
            ))}
          </ul>
          <figcaption className="px-4 pb-2 pt-3 text-xs text-graphite">Example shortlist. Each bar shows how a job scores on skills, experience, role, location and more.</figcaption>
        </motion.figure>
      </div>
    </section>
  );
}
