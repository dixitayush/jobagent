"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { CountUp } from "@/components/fit-strip";
import { JobRows } from "@/components/job-card";
import { ManualRunPanel, RunAgentButton } from "@/components/run-agent";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useJobs, useMe, useOverview } from "@/lib/queries";
import { cn, formatTime, formatWhen, greeting, timeAgo } from "@/lib/utils";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** PRD §8.1 overview: what's new today, and what the agent is doing. */
export default function Dashboard() {
  const me = useMe();
  const o = useOverview();
  const top = useJobs({ view: "matches", sort: "BEST_MATCH", pageSize: 6, postedWithinDays: 7 });
  const tz = me.data?.timezone;

  if (!o.data) {
    return (
      <div className="space-y-6" aria-busy>
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  const d = o.data;
  const setup = [
    { done: d.setup.hasResume, label: "Upload your resume", href: "/resume" },
    { done: d.setup.hasLocations, label: "Choose where you want to work", href: "/preferences" },
    { done: d.setup.sourceCount > 0, label: "Add companies to follow", href: "/sources" },
  ];
  const setupDone = setup.every((s) => s.done);
  const headline = d.newJobs === 0 ? "No new matches yet today" : `${plural(d.newJobs, "new job")} worth a look today`;
  const summary = [
    d.veryStrongMatches || d.strongMatches ? `${d.veryStrongMatches} very strong and ${d.strongMatches} strong matches this week.` : null,
    d.nextEmail ? `Next email at ${formatTime(d.nextEmail, tz)}.` : "Email digests are off.",
  ]
    .filter(Boolean)
    .join(" ");

  const facts: [string, string, string?][] = [
    ["Last checked", d.lastAgentRun ? timeAgo(d.lastAgentRun) : "Not yet"],
    ["Next email", d.nextEmail ? formatWhen(d.nextEmail, tz) : "Off", "/notifications"],
    ["Found today", plural(d.jobsDiscoveredToday, "opening"), "/jobs?view=all"],
    ["Emailed today", plural(d.jobsSentToday, "job"), "/notifications"],
    ["Saved", plural(d.savedJobs, "job"), "/saved"],
    ["Companies", `${d.setup.sourceCount} followed`, "/sources"],
    ["Open jobs tracked", d.setup.jobsIndexed.toLocaleString()],
  ];

  return (
    <>
      <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="text-sm text-graphite">
            {greeting()}, {d.greetingName}
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
            {d.newJobs === 0 ? (
              headline
            ) : (
              <>
                <span className="tabular">
                  <CountUp value={d.newJobs} duration={0.7} />
                </span>{" "}
                new {d.newJobs === 1 ? "job" : "jobs"} worth a look today
              </>
            )}
          </h1>
          <p className="mt-2 text-sm text-graphite">{summary}</p>
        </div>
        <RunAgentButton />
      </div>

      <ManualRunPanel />

      {d.failingSources.length > 0 && (
        <Alert tone="warning" className="mb-6" title="Some career pages couldn't be reached">
          {d.failingSources.slice(0, 3).join(", ")} didn&apos;t respond during the latest check. They&apos;ll be retried automatically.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_300px] lg:gap-10">
        <section aria-labelledby="shortlist" className="min-w-0">
          <div className="flex items-baseline justify-between border-b pb-3">
            <h2 id="shortlist" className="text-base font-semibold tracking-tight">
              Best matches this week
            </h2>
            <Link href="/jobs" className="text-sm text-graphite underline-offset-4 hover:text-ink hover:underline">
              Open job feed
            </Link>
          </div>
          {top.isLoading ? (
            <div className="space-y-4 py-5">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
          ) : top.data?.items.length ? (
            <JobRows jobs={top.data.items} />
          ) : (
            <div className="py-12">
              <p className="font-medium">Nothing strong enough to show yet.</p>
              <p className="mt-1 max-w-md text-sm text-graphite">
                {setupDone ? "The agent keeps checking your companies. Run it now to check immediately." : "Finish the setup steps and the agent will start matching jobs for you."}
              </p>
            </div>
          )}
        </section>

        <aside className="space-y-6">
          {!setupDone && (
            <section aria-labelledby="setup" className="rounded-xl border bg-surface p-5">
              <h2 id="setup" className="font-semibold tracking-tight">
                Finish setting up
              </h2>
              <ol className="mt-3 space-y-1">
                {setup.map((s, i) => (
                  <li key={s.label}>
                    <Link href={s.href} className={cn("flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-accent", s.done && "text-graphite line-through decoration-rule")}>
                      <span className={cn("grid size-6 shrink-0 place-items-center rounded-full border text-xs tabular", s.done && "border-fit bg-fit text-white dark:text-paper")}>
                        {s.done ? <Check className="size-3.5" aria-label="Done" /> : i + 1}
                      </span>
                      {s.label}
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
          )}
          <section aria-labelledby="agent" className="rounded-xl border bg-surface p-5">
            <h2 id="agent" className="font-semibold tracking-tight">
              Your agent
            </h2>
            <dl className="mt-3 divide-y text-sm">
              {facts.map(([k, v, href]) => (
                <div key={k} className="flex items-baseline justify-between gap-4 py-2.5">
                  <dt className="text-graphite">{k}</dt>
                  <dd className="text-right font-medium">
                    {href ? (
                      <Link href={href} className="underline-offset-4 hover:underline">
                        {v}
                      </Link>
                    ) : (
                      v
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </aside>
      </div>
    </>
  );
}
