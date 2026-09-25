"use client";

import { Bookmark, BookmarkCheck, Briefcase, Clock, ExternalLink, MapPin, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DISMISS_REASON_LABELS, type DismissReason, type JobCard as JobCardT, type MatchLevel } from "@jobagent/shared";
import { useJobActions } from "@/lib/queries";
import { cn, LEVEL_STYLES, levelLabel, pretty, timeAgo } from "@/lib/utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Select } from "./ui/input";

export function MatchBadge({ level, score, className }: { level: MatchLevel | null; score: number | null; className?: string }) {
  if (!level) return <Badge className={cn("border-transparent bg-muted text-muted-foreground", className)}>Not scored yet</Badge>;
  return (
    <Badge className={cn("border-transparent font-semibold uppercase tracking-wide", LEVEL_STYLES[level], className)}>
      {levelLabel(level)}
      {score !== null && <span className="tabular-nums">· {score}%</span>}
    </Badge>
  );
}

/** PRD §39 dashboard job card (mobile-first per §97). */
export function JobCard({ job }: { job: JobCardT }) {
  const { save, dismiss, track } = useJobActions();
  const [askReason, setAskReason] = useState(false);
  const posted = job.postedAt && job.postedAt < job.firstSeenAt ? job.postedAt : job.firstSeenAt;

  return (
    <article className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm sm:p-5" aria-labelledby={`job-${job.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`job-${job.id}`} className="text-base font-semibold leading-snug">
            <Link href={`/jobs/${job.id}`} className="hover:underline">
              {job.title}
            </Link>
          </h3>
          <p className="text-sm text-muted-foreground">{job.company}</p>
        </div>
        <MatchBadge level={job.matchLevel} score={job.score} className="shrink-0" />
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {job.locations.length > 0 && (
          <li className="flex items-center gap-1.5">
            <MapPin className="size-3.5" aria-hidden />
            {job.locations.slice(0, 2).join(" · ")}
            {job.locations.length > 2 && ` +${job.locations.length - 2}`}
          </li>
        )}
        {(job.employmentType || job.workMode) && (
          <li className="flex items-center gap-1.5">
            <Briefcase className="size-3.5" aria-hidden />
            {[pretty(job.employmentType), pretty(job.workMode)].filter(Boolean).join(" · ")}
          </li>
        )}
        <li className="flex items-center gap-1.5">
          <Clock className="size-3.5" aria-hidden />
          {timeAgo(posted)}
          {job.freshness === "NEW" && <Badge className="ml-1 border-transparent bg-primary text-primary-foreground">New</Badge>}
          {job.freshness === "UPDATED" && <Badge className="ml-1">Updated</Badge>}
        </li>
      </ul>

      {job.topSkills.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Matching skills">
          {job.topSkills.map((s) => (
            <li key={s}>
              <Badge className="bg-secondary">
                {job.score !== null && <span aria-hidden>✓</span>} {s}
              </Badge>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <a href={job.url} target="_blank" rel="noopener noreferrer" onClick={() => track("JOB_CLICKED", job.id)} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          View job <ExternalLink className="size-3.5" aria-hidden />
        </a>
        <Button size="sm" variant="outline" onClick={() => save.mutate({ id: job.id, saved: !job.saved })} aria-pressed={job.saved}>
          {job.saved ? <BookmarkCheck /> : <Bookmark />}
          {job.saved ? "Saved" : "Save"}
        </Button>
        {job.dismissed ? (
          <Button size="sm" variant="ghost" onClick={() => dismiss.mutate({ id: job.id, dismissed: false })}>
            Restore
          </Button>
        ) : askReason ? (
          <div className="flex items-center gap-2">
            <label htmlFor={`reason-${job.id}`} className="sr-only">
              Why dismiss?
            </label>
            <Select
              id={`reason-${job.id}`}
              className="h-9 w-44"
              defaultValue=""
              autoFocus
              onChange={(e) => dismiss.mutate({ id: job.id, dismissed: true, reason: (e.target.value || undefined) as DismissReason | undefined })}
            >
              <option value="" disabled>
                Why? (optional)
              </option>
              {Object.entries(DISMISS_REASON_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="ghost" onClick={() => dismiss.mutate({ id: job.id, dismissed: true })}>
              Skip
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setAskReason(true)}>
            <X /> Dismiss
          </Button>
        )}
      </div>
    </article>
  );
}
