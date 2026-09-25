"use client";

import { Bookmark, BookmarkCheck, ExternalLink, EyeOff, RotateCcw } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useRef, useState } from "react";
import { DISMISS_REASON_LABELS, type DismissReason, type JobCard as JobCardT } from "@jobagent/shared";
import { useJobActions } from "@/lib/queries";
import { cn, pretty, timeAgo } from "@/lib/utils";
import { FitStrip, MatchScore } from "./fit-strip";
import { useToast } from "./toast";
import { Button } from "./ui/button";
import { MenuItem, Popover } from "./ui/popover";

export { MatchScore };

interface RowCallbacks {
  /** Removes the row from the list right away (optimistic); `undo` puts it back. */
  onRemove?: (id: string) => void;
  onRestore?: (id: string) => void;
}

/** One job in a list (PRD §39; mobile priorities per §97). */
export function JobCard({ job, onRemove, onRestore, index = 0 }: { job: JobCardT; index?: number } & RowCallbacks) {
  const { save, dismiss, track } = useJobActions();
  const toast = useToast();
  const reduce = useReducedMotion();
  const [menu, setMenu] = useState(false);
  const hideBtn = useRef<HTMLButtonElement>(null);
  const posted = job.postedAt && job.postedAt < job.firstSeenAt ? job.postedAt : job.firstSeenAt;
  const place = job.locations.slice(0, 2).join(", ") + (job.locations.length > 2 ? ` +${job.locations.length - 2}` : "");
  const meta = [place, pretty(job.workMode), pretty(job.employmentType)].filter(Boolean);

  const hide = (reason?: DismissReason) => {
    setMenu(false);
    onRemove?.(job.id);
    dismiss.mutate(
      { id: job.id, dismissed: true, reason },
      {
        onSuccess: () =>
          toast(reason ? `Hidden: ${DISMISS_REASON_LABELS[reason].toLowerCase()}` : "Job hidden", {
            label: "Undo",
            onClick: () => {
              onRestore?.(job.id);
              dismiss.mutate({ id: job.id, dismissed: false });
            },
          }),
        onError: () => {
          onRestore?.(job.id);
          toast("Couldn't hide the job. Try again.");
        },
      },
    );
  };
  const restore = () => {
    onRemove?.(job.id);
    dismiss.mutate({ id: job.id, dismissed: false }, { onSuccess: () => toast("Job restored to your feed") });
  };
  const toggleSave = () =>
    save.mutate({ id: job.id, saved: !job.saved }, { onSuccess: () => toast(job.saved ? "Removed from saved jobs" : "Saved for later") });

  return (
    <motion.article
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.25, delay: Math.min(index, 8) * 0.03 } }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0, transition: { duration: 0.28, ease: [0.4, 0, 0.2, 1] } }}
      className="group relative -mx-3 grid gap-3 overflow-hidden rounded-xl border-b border-rule px-3 py-5 transition-colors hover:bg-surface sm:grid-cols-[1fr_auto] sm:gap-x-8"
      aria-labelledby={`job-${job.id}`}
    >
      <div className="min-w-0">
        <h3 id={`job-${job.id}`} className="text-base font-semibold leading-snug tracking-tight">
          <Link href={`/jobs/${job.id}`} className="rounded-sm after:absolute after:inset-0 after:content-[''] group-hover:text-ink focus-visible:ring-0">
            {job.title}
          </Link>
        </h3>
        <p className="mt-0.5 text-sm text-ink">{job.company}</p>
        <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-graphite">
          {meta.map((m) => (
            <li key={m}>{m}</li>
          ))}
          <li>
            {job.freshness === "NEW" ? <span className="marker font-medium text-ink">New</span> : job.freshness === "UPDATED" ? <span className="font-medium text-ink">Updated</span> : null}{" "}
            {timeAgo(posted)}
          </li>
        </ul>
        {job.topSkills.length > 0 && (
          <p className="mt-2.5 line-clamp-2 text-xs text-graphite">
            <span className="sr-only">Matching skills: </span>
            {job.topSkills.join(", ")}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:w-56 sm:items-end">
        <div className="flex w-full items-center justify-between gap-4 sm:flex-col sm:items-end sm:gap-2">
          <MatchScore score={job.score} level={job.matchLevel} />
          <FitStrip fit={job.fit} className="w-32 sm:w-full" delay={Math.min(index, 8) * 0.04} />
        </div>
        {/* Sits above the row-wide link overlay so actions stay clickable. */}
        <div className="relative z-10 flex items-center gap-1 sm:justify-end">
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => track("JOB_CLICKED", job.id)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-ink transition-colors hover:bg-accent"
          >
            Apply <ExternalLink className="size-3.5" aria-hidden />
            <span className="sr-only">(opens {job.company}&apos;s careers site)</span>
          </a>
          <Button size="icon-sm" variant="ghost" onClick={toggleSave} aria-pressed={job.saved} aria-label={job.saved ? "Remove from saved" : "Save job"} title={job.saved ? "Saved" : "Save"}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={job.saved ? "on" : "off"}
                initial={reduce ? false : { scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.4, opacity: 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 18 }}
                className="grid place-items-center"
              >
                {job.saved ? <BookmarkCheck className="text-fit" /> : <Bookmark />}
              </motion.span>
            </AnimatePresence>
          </Button>
          {job.dismissed ? (
            <Button size="icon-sm" variant="ghost" onClick={restore} aria-label="Restore job" title="Restore">
              <RotateCcw />
            </Button>
          ) : (
            <Button ref={hideBtn} size="icon-sm" variant="ghost" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu} aria-label="Hide job" title="Hide">
              <EyeOff />
            </Button>
          )}
        </div>
      </div>

      <Popover open={menu} onClose={() => setMenu(false)} anchor={hideBtn} label="Why hide this job?">
        <p className="px-3 pb-1.5 pt-1 text-xs text-graphite">Why hide it? Your answer tunes future matches.</p>
        {(Object.entries(DISMISS_REASON_LABELS) as [DismissReason, string][]).map(([k, v]) => (
          <MenuItem key={k} onSelect={() => hide(k)}>
            {v}
          </MenuItem>
        ))}
        <div className="my-1 border-t" />
        <MenuItem muted onSelect={() => hide(undefined)}>
          Just hide it
        </MenuItem>
      </Popover>
    </motion.article>
  );
}

/** A list of job rows. Hidden/restored rows collapse out immediately, with Undo. */
export function JobRows({ jobs, className }: { jobs: JobCardT[]; className?: string }) {
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const onRemove = (id: string) => setRemoved((s) => new Set(s).add(id));
  const onRestore = (id: string) =>
    setRemoved((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
  const visible = jobs.filter((j) => !removed.has(j.id));
  return (
    <div className={cn("flex flex-col", className)}>
      <AnimatePresence initial={false}>
        {visible.map((j, i) => (
          <JobCard key={j.id} job={j} index={i} onRemove={onRemove} onRestore={onRestore} />
        ))}
      </AnimatePresence>
    </div>
  );
}

// Back-compat export used by older imports.
export const MatchBadge = ({ level, score, className }: { level: JobCardT["matchLevel"]; score: number | null; className?: string }) => (
  <MatchScore level={level} score={score} className={className} />
);
