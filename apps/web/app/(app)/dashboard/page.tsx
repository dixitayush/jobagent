"use client";

import Link from "next/link";
import { PageHeader } from "@/components/app-shell";
import { ManualRunPanel, RunAgentButton } from "@/components/run-agent";
import { JobCard } from "@/components/job-card";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useJobs, useMe, useOverview } from "@/lib/queries";
import { formatDateTime, greeting } from "@/lib/utils";

function Stat({ label, value, href }: { label: string; value: number | string; href?: string }) {
  const body = (
    <Card className="h-full transition-colors hover:bg-accent/40">
      <CardContent className="p-4">
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        <p className="text-sm text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
  return href ? (
    <Link href={href} className="block rounded-lg">
      {body}
    </Link>
  ) : (
    body
  );
}

/** PRD §8.1 overview. */
export default function Dashboard() {
  const me = useMe();
  const o = useOverview();
  const top = useJobs({ view: "matches", sort: "BEST_MATCH", pageSize: 6, postedWithinDays: 7 });
  const tz = me.data?.timezone;

  if (!o.data) return <Skeleton className="h-64 w-full" />;
  const d = o.data;
  const setupMissing = !d.setup.hasResume || d.setup.sourceCount === 0 || !d.setup.hasLocations;

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${d.greetingName}`}
        description={`${d.newJobs} new jobs · ${d.strongMatches} strong matches · ${d.veryStrongMatches} very strong matches`}
        actions={<RunAgentButton />}
      />
      <ManualRunPanel />

      {setupMissing && (
        <Alert tone="warning" title="Finish setting up your agent" className="mb-6">
          <ul className="list-inside list-disc">
            {!d.setup.hasResume && (
              <li>
                <Link className="underline" href="/resume">
                  Upload your resume
                </Link>
              </li>
            )}
            {!d.setup.hasLocations && (
              <li>
                <Link className="underline" href="/preferences">
                  Choose preferred locations
                </Link>
              </li>
            )}
            {d.setup.sourceCount === 0 && (
              <li>
                <Link className="underline" href="/sources">
                  Add company career pages
                </Link>
              </li>
            )}
          </ul>
        </Alert>
      )}
      {d.failingSources.length > 0 && (
        <Alert tone="info" className="mb-6">
          {d.failingSources.slice(0, 3).join(", ")} couldn&apos;t be reached during the latest scan. We&apos;ll retry automatically.
        </Alert>
      )}

      <section aria-label="Statistics" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Jobs discovered today" value={d.jobsDiscoveredToday} href="/jobs?view=all" />
        <Stat label="New matching jobs" value={d.newJobs} href="/jobs" />
        <Stat label="Highly relevant" value={d.highlyRelevant} href="/jobs?matchLevel=GOOD" />
        <Stat label="Jobs sent today" value={d.jobsSentToday} href="/notifications" />
        <Stat label="Saved jobs" value={d.savedJobs} href="/saved" />
        <Stat label="Applications tracked" value={d.applicationsTracked} />
        <Stat label="Last agent run" value={d.lastAgentRun ? formatDateTime(d.lastAgentRun, tz) : "—"} />
        <Stat label="Next email" value={d.nextEmail ? formatDateTime(d.nextEmail, tz) : "Off"} href="/notifications" />
      </section>

      <Card className="mt-8">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Top matches this week</CardTitle>
          <Link href="/jobs" className="text-sm underline-offset-4 hover:underline">
            View all
          </Link>
        </CardHeader>
        <CardContent>
          {top.isLoading ? (
            <Skeleton className="h-40" />
          ) : top.data?.items.length ? (
            <div className="grid gap-4 md:grid-cols-2">
              {top.data.items.map((j) => (
                <JobCard key={j.id} job={j} />
              ))}
            </div>
          ) : (
            <div className="py-8 text-center">
              <p className="font-medium">No strong matches found yet.</p>
              <p className="mt-1 text-sm text-muted-foreground">We&apos;ll continue checking your configured sources.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
