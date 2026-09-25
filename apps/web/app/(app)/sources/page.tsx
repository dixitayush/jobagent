"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Pause, Play, Trash2 } from "lucide-react";
import { useState } from "react";
import type { JobSource, Portal } from "@jobagent/shared";
import { PageHeader } from "@/components/app-shell";
import { SourceForm } from "@/components/source-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, del, put } from "@/lib/api";
import { keys, usePortals, useSources } from "@/lib/queries";
import { pretty, timeAgo } from "@/lib/utils";

function StatusBadge({ s }: { s: JobSource }) {
  if (s.status === "PAUSED") return <Badge>⏸ Paused</Badge>;
  if (s.globalStatus === "DEGRADED") return <Badge className="border-transparent bg-warning/15">Retrying</Badge>;
  if (!s.health.lastSuccessAt) return <Badge>Indexing…</Badge>;
  return <Badge className="border-transparent bg-success/15">✓ Active</Badge>;
}

/** PRD §43–45: company management, source health, job portals. */
export default function SourcesPage() {
  const qc = useQueryClient();
  const sources = useSources();
  const portals = usePortals();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => void qc.invalidateQueries({ queryKey: keys.sources });
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Action failed");
    }
  };

  return (
    <>
      <PageHeader title="Sources" description="Companies you track. Each career page is crawled once and shared across everyone who follows it." actions={<Button onClick={() => setAdding((a) => !a)}>{adding ? "Close" : "+ Add career page"}</Button>} />
      {adding && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Add a career page</CardTitle>
          </CardHeader>
          <CardContent>
            <SourceForm onSaved={() => setAdding(false)} />
          </CardContent>
        </Card>
      )}
      {error && <Alert tone="error" className="mb-4">{error}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Company career pages</CardTitle>
        </CardHeader>
        <CardContent>
          {sources.isLoading ? (
            <Skeleton className="h-32" />
          ) : sources.data?.length ? (
            <ul className="divide-y">
              {sources.data.map((s) => (
                <li key={s.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{s.companyName}</span>
                      <StatusBadge s={s} />
                      <Badge>{pretty(s.connectorType)}</Badge>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{s.sourceUrl}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {s.health.jobsFound} open jobs · last crawl {timeAgo(s.health.lastCrawledAt)}
                      {s.health.consecutiveFailures > 0 && ` · couldn't be reached during the latest scan, we'll retry automatically`}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="outline" onClick={() => act(() => put(`/sources/${s.id}`, { status: s.status === "ACTIVE" ? "PAUSED" : "ACTIVE" }))}>
                      {s.status === "ACTIVE" ? <Pause /> : <Play />} {s.status === "ACTIVE" ? "Pause" : "Resume"}
                    </Button>
                    <Button size="icon" variant="ghost" aria-label={`Remove ${s.companyName}`} onClick={() => confirm(`Stop tracking ${s.companyName}?`) && act(() => del(`/sources/${s.id}`))}>
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">No career pages yet. Add one to start discovering jobs.</p>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Job portals</CardTitle>
          <CardDescription>Portals are only used through official partner APIs or licensed feeds — never by scraping.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {(portals.data ?? []).map((p: Portal) => (
              <li key={p.type} className="flex items-center justify-between gap-4 py-3">
                <div>
                  <p className="font-medium">
                    {p.name} {p.enabled ? <Badge className="ml-1 border-transparent bg-success/15">✓ Connected</Badge> : !p.available && <Badge className="ml-1">Not available</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">{p.note}</p>
                </div>
                <Switch label={`Enable ${p.name}`} checked={p.enabled} disabled={!p.available} onChange={(enabled) => act(() => put(`/portals/${p.type}`, { enabled }).then(() => qc.invalidateQueries({ queryKey: keys.portals })))} />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
