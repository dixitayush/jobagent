"use client";

import { ArrowLeft, Bookmark, BookmarkCheck, ExternalLink, ThumbsDown, ThumbsUp } from "lucide-react";
import Link from "next/link";
import { use, useState } from "react";
import { MatchBadge } from "@/components/job-card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";
import { useJob, useJobActions } from "@/lib/queries";
import { formatDateTime, pretty, timeAgo } from "@/lib/utils";

const BREAKDOWN_LABELS: Record<string, [string, number]> = {
  skills: ["Skills", 30],
  experience: ["Experience", 20],
  title: ["Job title", 15],
  semantic: ["Semantic similarity", 15],
  location: ["Location", 10],
  seniority: ["Seniority", 5],
  workMode: ["Work mode", 5],
};

/** PRD §41 job details with match explanation. */
export default function JobDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const job = useJob(id);
  const { save, feedback, track } = useJobActions();
  const [voted, setVoted] = useState<boolean | null>(null);

  if (job.error) return <Alert tone="error">{job.error instanceof ApiError && job.error.status === 404 ? "This job is not available." : "Could not load this job."}</Alert>;
  if (!job.data) return <Skeleton className="h-96" />;
  const j = job.data;
  const m = j.match;

  return (
    <>
      <Link href="/jobs" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Back to jobs
      </Link>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{j.title}</h1>
          <p className="text-muted-foreground">{j.company}</p>
          <div className="mt-3">
            <MatchBadge level={j.matchLevel} score={j.score} className="text-sm" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={j.url} target="_blank" rel="noopener noreferrer" onClick={() => track("JOB_CLICKED", j.id)} className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            Apply on {pretty(j.source)} <ExternalLink className="size-4" aria-hidden />
          </a>
          <Button variant="outline" onClick={() => save.mutate({ id: j.id, saved: !j.saved })} aria-pressed={j.saved}>
            {j.saved ? <BookmarkCheck /> : <Bookmark />} {j.saved ? "Saved" : "Save"}
          </Button>
          <Button variant="outline" onClick={() => track("JOB_APPLIED", j.id)}>
            I applied
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          {m ? (
            <Card>
              <CardHeader>
                <CardTitle>Why this job matches</CardTitle>
                <p className="text-sm text-muted-foreground">Based on the information in your resume and preferences — not a guarantee of fit.</p>
              </CardHeader>
              <CardContent className="space-y-5">
                {m.aiSummary && <p className="text-sm">{m.aiSummary}</p>}
                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <h3 className="mb-2 text-sm font-medium">Matched skills</h3>
                    <ul className="flex flex-wrap gap-1.5">
                      {m.skills.matched.map((s) => (
                        <li key={s}>
                          <Badge className="border-transparent bg-success/15">✓ {s}</Badge>
                        </li>
                      ))}
                      {m.skills.inferred.map((s) => (
                        <li key={s}>
                          <Badge title="Inferred from related experience">≈ {s}</Badge>
                        </li>
                      ))}
                      {!m.skills.matched.length && !m.skills.inferred.length && <li className="text-sm text-muted-foreground">No explicit skill overlap found.</li>}
                    </ul>
                  </div>
                  <div>
                    <h3 className="mb-2 text-sm font-medium">Missing skills</h3>
                    <ul className="flex flex-wrap gap-1.5">
                      {m.skills.missing.map((s) => (
                        <li key={s}>
                          <Badge className="border-transparent bg-warning/15">△ {s} · required</Badge>
                        </li>
                      ))}
                      {m.skills.preferredMissing.map((s) => (
                        <li key={s}>
                          <Badge>△ {s} · preferred</Badge>
                        </li>
                      ))}
                      {!m.skills.missing.length && !m.skills.preferredMissing.length && <li className="text-sm text-muted-foreground">None identified.</li>}
                    </ul>
                  </div>
                </div>
                <div>
                  <h3 className="mb-1 text-sm font-medium">Experience</h3>
                  <p className="text-sm text-muted-foreground">
                    {m.experience.requiredYears !== null ? `${m.experience.requiredYears}+ years requested` : "Required experience not stated"} · your resume shows ~{m.experience.candidateYears ?? 0} years
                    {m.experience.match === true && " ✓"}
                  </p>
                </div>
                <div>
                  <h3 className="mb-1 text-sm font-medium">Location</h3>
                  <p className="text-sm text-muted-foreground">
                    {m.location.match ? "✓" : "△"} {m.location.reason}
                  </p>
                </div>
                {m.concerns.length > 0 && (
                  <div>
                    <h3 className="mb-1 text-sm font-medium">Things to consider</h3>
                    <ul className="list-inside list-disc text-sm text-muted-foreground">
                      {m.concerns.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="flex items-center gap-2 border-t pt-4">
                  <span className="text-sm">Was this a good recommendation?</span>
                  {voted === null ? (
                    <>
                      <Button size="sm" variant="outline" onClick={() => (feedback.mutate({ id: j.id, helpful: true }), setVoted(true))} aria-label="Good recommendation">
                        <ThumbsUp />
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => (feedback.mutate({ id: j.id, helpful: false }), setVoted(false))} aria-label="Not relevant">
                        <ThumbsDown />
                      </Button>
                    </>
                  ) : (
                    <span className="text-sm text-muted-foreground">Thanks — this improves future matches.</span>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Alert title="Not scored yet">This job hasn&apos;t been evaluated against your profile. It will be during the next agent run.</Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Original description</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="whitespace-pre-line text-sm leading-relaxed">{j.description || "No description provided by the source."}</div>
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Location</dt>
                <dd>{j.locations.join(" · ") || "—"}</dd>
                <dt className="text-muted-foreground">Work mode</dt>
                <dd>{pretty(j.workMode) || "—"}</dd>
                <dt className="text-muted-foreground">Employment</dt>
                <dd>{pretty(j.employmentType) || "—"}</dd>
                <dt className="text-muted-foreground">Seniority</dt>
                <dd>{pretty(j.seniority) || "—"}</dd>
                <dt className="text-muted-foreground">Salary</dt>
                <dd>{j.salaryText || "Not disclosed"}</dd>
                <dt className="text-muted-foreground">Posted</dt>
                <dd>{j.postedAt ? formatDateTime(j.postedAt) : `First seen ${timeAgo(j.firstSeenAt)}`}</dd>
                <dt className="text-muted-foreground">Source</dt>
                <dd>{pretty(j.source)}</dd>
              </dl>
            </CardContent>
          </Card>
          {m && (
            <Card>
              <CardHeader>
                <CardTitle>Score breakdown</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {Object.entries(BREAKDOWN_LABELS).map(([k, [label, max]]) => {
                  const v = m.breakdown[k as keyof typeof m.breakdown] ?? 0;
                  return (
                    <div key={k}>
                      <div className="flex justify-between text-xs">
                        <span>{label}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {v.toFixed(1)} / {max}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-muted" role="presentation">
                        <div className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.min(100, (v / max) * 100)}%` }} />
                      </div>
                    </div>
                  );
                })}
                <p className="pt-2 text-xs text-muted-foreground">
                  Evaluated by {m.evaluatedBy === "LLM" ? "AI + rules" : m.evaluatedBy === "RULES_VECTOR" ? "rules + semantic search" : "rules"} · confidence {Math.round(m.confidence * 100)}%
                </p>
              </CardContent>
            </Card>
          )}
          {(j.requiredSkills.length > 0 || j.preferredSkills.length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle>Requirements</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {j.requiredSkills.length > 0 && <p>Required: {j.requiredSkills.join(", ")}</p>}
                {j.preferredSkills.length > 0 && <p className="text-muted-foreground">Preferred: {j.preferredSkills.join(", ")}</p>}
                {j.requiredYears !== null && <p className="text-muted-foreground">{j.requiredYears}+ years experience</p>}
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
