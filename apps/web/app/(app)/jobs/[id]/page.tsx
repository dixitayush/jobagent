"use client";

import { ArrowLeft, Bookmark, BookmarkCheck, Check, ExternalLink, Minus, ThumbsDown, ThumbsUp } from "lucide-react";
import Link from "next/link";
import { use, useState } from "react";
import { FitStrip, MatchScore } from "@/components/fit-strip";
import { useToast } from "@/components/toast";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";
import { useJob, useJobActions } from "@/lib/queries";
import { cn, formatDateTime, pretty, timeAgo } from "@/lib/utils";

function SkillList({ title, items, tone, empty }: { title: string; items: string[]; tone: "have" | "close" | "gap"; empty: string }) {
  const Icon = tone === "have" ? Check : tone === "close" ? Minus : Minus;
  return (
    <div>
      <h3 className="text-sm font-medium">{title}</h3>
      {items.length ? (
        <ul className="mt-2 space-y-1.5">
          {items.map((s) => (
            <li key={s} className="flex items-start gap-2 text-sm">
              <Icon className={cn("mt-0.5 size-4 shrink-0", tone === "have" ? "text-fit" : tone === "close" ? "text-graphite" : "text-caution")} aria-hidden />
              {s}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-graphite">{empty}</p>
      )}
    </div>
  );
}

/** PRD §41 job details with the match explanation. */
export default function JobDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const job = useJob(id);
  const { save, feedback, track } = useJobActions();
  const toast = useToast();
  const [voted, setVoted] = useState<boolean | null>(null);

  if (job.error)
    return (
      <Alert tone="error" title={job.error instanceof ApiError && job.error.status === 404 ? "This job isn't available" : "Couldn't load this job"}>
        <Link href="/jobs" className="underline underline-offset-4">
          Back to the job feed
        </Link>
      </Alert>
    );
  if (!job.data)
    return (
      <div className="space-y-4" aria-busy>
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-72" />
      </div>
    );

  const j = job.data;
  const m = j.match;
  const posted = j.postedAt ? `Posted ${timeAgo(j.postedAt)}` : `First seen ${timeAgo(j.firstSeenAt)}`;
  const toggleSave = () => save.mutate({ id: j.id, saved: !j.saved }, { onSuccess: () => toast(j.saved ? "Removed from saved jobs" : "Saved for later") });
  const vote = (helpful: boolean) => {
    feedback.mutate({ id: j.id, helpful });
    setVoted(helpful);
    toast("Thanks. This tunes your future matches.");
  };
  const apply = (
    <a
      href={j.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => track("JOB_CLICKED", j.id)}
      className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-ink px-5 font-medium text-primary-foreground hover:bg-ink/85"
    >
      Apply on {j.company}'s site <ExternalLink className="size-4" aria-hidden />
    </a>
  );

  return (
    <>
      <Link href="/jobs" className="mb-6 inline-flex items-center gap-1.5 text-sm text-graphite hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Job feed
      </Link>

      <header className="mb-8 max-w-3xl">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{j.title}</h1>
        <p className="mt-1.5 text-base">{j.company}</p>
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-graphite">
          {j.locations.length > 0 && <li>{j.locations.join(", ")}</li>}
          {j.workMode && <li>{pretty(j.workMode)}</li>}
          {j.employmentType && <li>{pretty(j.employmentType)}</li>}
          <li>
            {j.freshness === "NEW" && <span className="marker font-medium text-ink">New</span>} {posted}
          </li>
        </ul>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_340px] lg:gap-12">
        {/* Score panel: first on mobile, sticky on the right on desktop */}
        <aside className="lg:order-2">
          <div className="space-y-5 rounded-xl border bg-surface p-5 lg:sticky lg:top-8">
            <div>
              <MatchScore score={j.score} level={j.matchLevel} size="lg" />
              {m && (
                <p className="mt-1 text-xs text-graphite">
                  {m.evaluatedBy === "LLM" ? "Checked by AI against your resume" : "Scored from your resume and preferences"}. Confidence {Math.round(m.confidence * 100)}%.
                </p>
              )}
            </div>
            {m && <FitStrip fit={m.breakdown} size="lg" />}
            <div className="hidden gap-2 lg:flex">{apply}</div>
            <div className="hidden gap-2 lg:flex">
              <Button variant="outline" className="flex-1" onClick={toggleSave} aria-pressed={j.saved}>
                {j.saved ? <BookmarkCheck className="text-fit" /> : <Bookmark />} {j.saved ? "Saved" : "Save"}
              </Button>
              <Button variant="outline" className="flex-1" onClick={() => (track("JOB_APPLIED", j.id), toast("Marked as applied"))}>
                I applied
              </Button>
            </div>
            <dl className="divide-y border-t text-sm">
              {[
                ["Salary", j.salaryText || "Not listed"],
                ["Level", pretty(j.seniority) || "Not stated"],
                ["Experience asked", j.requiredYears !== null ? `${j.requiredYears}+ years` : "Not stated"],
                ["Found on", pretty(j.source)],
                ["Posted", j.postedAt ? formatDateTime(j.postedAt) : `First seen ${timeAgo(j.firstSeenAt)}`],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 py-2.5">
                  <dt className="text-graphite">{k}</dt>
                  <dd className="text-right font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </aside>

        <div className="min-w-0 space-y-10 lg:order-1">
          {m ? (
            <section aria-labelledby="why">
              <h2 id="why" className="text-lg font-semibold tracking-tight">
                Why it fits
              </h2>
              {m.aiSummary && <p className="mt-3 max-w-prose text-base leading-7">{m.aiSummary}</p>}
              <div className="mt-6 grid gap-6 sm:grid-cols-3">
                <SkillList title="You have" items={m.skills.matched} tone="have" empty="No direct overlap found." />
                <SkillList title="Close to what they ask" items={m.skills.inferred} tone="close" empty="Nothing inferred." />
                <SkillList title="Gaps" items={[...m.skills.missing, ...m.skills.preferredMissing.map((s) => `${s} (nice to have)`)]} tone="gap" empty="No gaps found." />
              </div>
              <ul className="mt-6 space-y-2 text-sm">
                <li className="flex gap-2">
                  {m.experience.match ? <Check className="mt-0.5 size-4 shrink-0 text-fit" aria-hidden /> : <Minus className="mt-0.5 size-4 shrink-0 text-caution" aria-hidden />}
                  <span>
                    {m.experience.requiredYears !== null ? `Asks for ${m.experience.requiredYears}+ years` : "Experience not stated"}. Your resume shows about {m.experience.candidateYears ?? 0} years.
                  </span>
                </li>
                <li className="flex gap-2">
                  {m.location.match ? <Check className="mt-0.5 size-4 shrink-0 text-fit" aria-hidden /> : <Minus className="mt-0.5 size-4 shrink-0 text-caution" aria-hidden />}
                  <span>{m.location.reason}</span>
                </li>
              </ul>
              {m.concerns.length > 0 && (
                <div className="mt-6 rounded-xl border border-caution/25 bg-caution/5 p-4">
                  <h3 className="text-sm font-medium">Worth checking before you apply</h3>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-graphite">
                    {m.concerns.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
                <span className="text-graphite">Was this a good pick for you?</span>
                {voted === null ? (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => vote(true)}>
                      <ThumbsUp /> Yes
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => vote(false)}>
                      <ThumbsDown /> No
                    </Button>
                  </div>
                ) : (
                  <span>{voted ? "Marked as a good pick." : "Marked as not relevant."}</span>
                )}
              </div>
            </section>
          ) : (
            <Alert title="Not scored yet">This job will be checked against your profile on the agent's next run.</Alert>
          )}

          <section aria-labelledby="desc">
            <h2 id="desc" className="text-lg font-semibold tracking-tight">
              About the role
            </h2>
            <div className="mt-3 max-w-prose whitespace-pre-line text-[15px] leading-7">{j.description || "The company didn't include a description. Open the listing to read more."}</div>
          </section>
        </div>
      </div>

      <div className="h-20 lg:hidden" aria-hidden />
      {/* Mobile action bar */}
      <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+62px)] z-20 flex gap-2 border-t bg-paper/95 px-4 py-3 backdrop-blur lg:hidden">
        {apply}
        <Button variant="outline" size="icon" className="size-11" onClick={toggleSave} aria-pressed={j.saved} aria-label={j.saved ? "Remove from saved" : "Save job"}>
          {j.saved ? <BookmarkCheck className="text-fit" /> : <Bookmark />}
        </Button>
      </div>
    </>
  );
}
