"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Pause, Play, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import type { JobSource, Portal } from "@jobagent/shared";
import { PageHeader } from "@/components/app-shell";
import { SourceForm } from "@/components/source-form";
import { useToast } from "@/components/toast";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, del, put } from "@/lib/api";
import { keys, usePortals, useSources } from "@/lib/queries";
import { cn, pretty, timeAgo } from "@/lib/utils";

function Status({ s }: { s: JobSource }) {
  const [label, dot] =
    s.status === "PAUSED"
      ? ["Paused", "bg-graphite"]
      : s.globalStatus === "DEGRADED" || s.health.consecutiveFailures > 0
        ? ["Retrying", "bg-caution"]
        : !s.health.lastSuccessAt
          ? ["Checking for jobs", "bg-graphite animate-pulse"]
          : ["Active", "bg-fit"];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-graphite">
      <span className={cn("size-2 rounded-full", dot)} aria-hidden />
      {label}
    </span>
  );
}

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

/** PRD §43–45: companies you follow, their health, and job portals. */
export default function SourcesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const sources = useSources();
  const portals = usePortals();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setError(null);
    try {
      await fn();
      void qc.invalidateQueries({ queryKey: keys.sources });
      if (done) toast(done);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That didn't work. Try again.");
    }
  };

  return (
    <>
      <PageHeader
        title="Companies"
        description="Career pages the agent checks for new openings. Each page is checked once and shared by everyone who follows it."
        actions={
          <Button onClick={() => setAdding((a) => !a)} variant={adding ? "outline" : "default"}>
            {adding ? <X /> : <Plus />} {adding ? "Close" : "Add company"}
          </Button>
        }
      />

      {adding && (
        <section aria-label="Add a company" className="animate-sheet-in mb-8 rounded-xl border bg-surface p-5 sm:p-6">
          <h2 className="font-semibold tracking-tight">Add a company</h2>
          <p className="mb-5 mt-1 text-sm text-graphite">Paste the page where the company lists its jobs. We'll check it and tell you how many openings we can read.</p>
          <SourceForm onSaved={() => (setAdding(false), toast("Company added. Its jobs are being checked now."))} />
        </section>
      )}
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      <section aria-labelledby="followed">
        <h2 id="followed" className="border-b pb-3 text-base font-semibold tracking-tight">
          Following {sources.data ? `(${sources.data.length})` : ""}
        </h2>
        {sources.isLoading ? (
          <div className="space-y-3 py-4">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : sources.data?.length ? (
          <ul className="divide-y">
            {sources.data.map((s) => (
              <li key={s.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-medium">{s.companyName}</span>
                    <Status s={s} />
                  </div>
                  <p className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-graphite">
                    <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer" className="truncate underline-offset-4 hover:text-ink hover:underline">
                      {hostOf(s.sourceUrl)}
                    </a>
                    <span>{pretty(s.connectorType)}</span>
                    <span className="tabular">{s.health.jobsFound.toLocaleString()} open jobs</span>
                    <span>Checked {timeAgo(s.health.lastCrawledAt)}</span>
                  </p>
                  {s.health.consecutiveFailures > 0 && <p className="mt-1 text-xs text-caution">Couldn't be reached on the last check. It will be retried automatically.</p>}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="outline" onClick={() => act(() => put(`/sources/${s.id}`, { status: s.status === "ACTIVE" ? "PAUSED" : "ACTIVE" }), s.status === "ACTIVE" ? `Paused ${s.companyName}` : `Resumed ${s.companyName}`)}>
                    {s.status === "ACTIVE" ? <Pause /> : <Play />} {s.status === "ACTIVE" ? "Pause" : "Resume"}
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Stop following ${s.companyName}`}
                    title="Stop following"
                    onClick={() => confirm(`Stop following ${s.companyName}? Its jobs will leave your feed.`) && act(() => del(`/sources/${s.id}`), `Stopped following ${s.companyName}`)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="py-12">
            <p className="font-medium">You're not following any companies yet.</p>
            <p className="mt-1 max-w-md text-sm text-graphite">Add the career pages of companies you'd like to work at. The agent checks them for new openings every few hours.</p>
            <Button className="mt-4" onClick={() => setAdding(true)}>
              <Plus /> Add your first company
            </Button>
          </div>
        )}
      </section>

      <section aria-labelledby="portals" className="mt-12">
        <h2 id="portals" className="border-b pb-3 text-base font-semibold tracking-tight">
          Job portals
        </h2>
        <p className="mt-3 text-sm text-graphite">Portals are only used through their official partner programs. They're never scraped.</p>
        <ul className="mt-2 divide-y">
          {(portals.data ?? []).map((p: Portal) => (
            <li key={p.type} className="flex items-center justify-between gap-4 py-4">
              <div>
                <p className="font-medium">{p.name}</p>
                <p className="mt-0.5 text-xs text-graphite">{p.available ? (p.enabled ? "Connected" : "Available to connect") : "Not available yet. It needs an approved partner integration."}</p>
              </div>
              <Switch
                label={`Use ${p.name}`}
                checked={p.enabled}
                disabled={!p.available}
                onChange={(enabled) => act(() => put(`/portals/${p.type}`, { enabled }).then(() => qc.invalidateQueries({ queryKey: keys.portals })), enabled ? `${p.name} connected` : `${p.name} turned off`)}
              />
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
