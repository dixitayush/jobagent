"use client";

import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { PlatformSettings } from "@jobagent/shared";
import { PageHeader } from "@/components/app-shell";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, post, put } from "@/lib/api";
import { useAdmin, useMe } from "@/lib/queries";
import { cn, formatDateTime, pretty, timeAgo } from "@/lib/utils";

const usd = (n: unknown) => `$${Number(n ?? 0).toFixed(Number(n ?? 0) < 1 ? 4 : 2)}`;

/** PRD §72–74 admin dashboard and controls. */
export default function AdminPage() {
  const me = useMe();
  const qc = useQueryClient();
  const overview = useAdmin.overview();
  const sources = useAdmin.sources();
  const settingsQ = useAdmin.settings();
  const flags = useAdmin.flags();
  const runs = useAdmin.runs();
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  useEffect(() => void (settingsQ.data && setSettings(settingsQ.data)), [settingsQ.data]);

  if (me.data && me.data.role !== "admin") return <Alert tone="error">Admin access required.</Alert>;
  const o = overview.data;
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setMsg(null);
    try {
      await fn();
      void qc.invalidateQueries({ queryKey: ["admin"] });
      if (ok) setMsg({ tone: "success", text: ok });
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof ApiError ? e.message : "Action failed" });
    }
  };

  return (
    <>
      <PageHeader title="Admin" description="Platform health, cost and controls." />
      {msg && <Alert tone={msg.tone} className="mb-6">{msg.text}</Alert>}

      {!o ? (
        <Skeleton className="h-32" />
      ) : (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Platform metrics">
          {[
            ["Total users", o.total_users],
            ["Active users (30d)", o.active_users],
            ["Open jobs", o.jobs_total],
            ["Jobs today", o.jobs_today],
            ["LLM cost (24h)", usd(o.llm_cost_24h)],
            ["LLM cost (30d)", usd(o.llm_cost_30d)],
            ["Emails sent (24h)", o.emails_24h],
            ["Email failures (24h)", o.email_failures_24h],
            ["LLM calls / errors (24h)", `${o.llm_calls_24h} / ${o.llm_errors_24h}`],
            ["Agent error rate (24h)", `${(Number(o.errorRate24h ?? 0) * 100).toFixed(1)}%`],
            ["Sources / degraded", `${o.sources_total} / ${o.sources_degraded}`],
            ["Open / click rate (30d)", (() => {
              const e = o.email30d as { sent: number; opened: number; clicked: number } | null;
              return e?.sent ? `${Math.round((e.opened / e.sent) * 100)}% / ${Math.round((e.clicked / e.sent) * 100)}%` : "—";
            })()],
          ].map(([label, value]) => (
            <Card key={String(label)}>
              <CardContent className="p-4">
                <p className="text-xl font-semibold tabular-nums">{String(value ?? 0)}</p>
                <p className="text-xs text-muted-foreground">{String(label)}</p>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Queue depth</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium">Queue</th>
                  <th className="font-medium">Waiting</th>
                  <th className="font-medium">Active</th>
                  <th className="font-medium">Delayed</th>
                  <th className="font-medium">Failed</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {(o?.queues ?? []).map((q) => (
                  <tr key={q.queue} className="border-t">
                    <td className="py-1.5">{q.queue}</td>
                    <td>{q.waiting}</td>
                    <td>{q.active}</td>
                    <td>{q.delayed}</td>
                    <td className={cn(q.failed > 0 && "text-destructive")}>{q.failed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>LLM usage (7 days)</CardTitle>
          </CardHeader>
          <CardContent>
            {o?.llmByModel.length ? (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 font-medium">Model</th>
                    <th className="font-medium">Purpose</th>
                    <th className="font-medium">Calls</th>
                    <th className="font-medium">Cost</th>
                    <th className="font-medium">Avg ms</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {o.llmByModel.map((r) => (
                    <tr key={`${r.model}-${r.purpose}`} className="border-t">
                      <td className="py-1.5">{r.model}</td>
                      <td>{r.purpose}</td>
                      <td>{r.calls}</td>
                      <td>{usd(r.cost)}</td>
                      <td>{r.avg_latency}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-muted-foreground">No LLM calls yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Source monitoring</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 font-medium">Source</th>
                <th className="font-medium">Status</th>
                <th className="font-medium">Last crawl</th>
                <th className="font-medium">Jobs</th>
                <th className="font-medium">Failures</th>
                <th className="font-medium">Interval</th>
                <th className="font-medium">Users</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(sources.data ?? []).map((s) => (
                <tr key={s.id} className="border-t align-top">
                  <td className="py-2">
                    <p className="font-medium">{s.company}</p>
                    <p className="text-xs text-muted-foreground">{pretty(s.connectorType)}</p>
                    {s.health.lastError && <p className="max-w-xs truncate text-xs text-destructive" title={s.health.lastError}>{s.health.lastError}</p>}
                  </td>
                  <td>
                    <Badge className={cn(s.status === "ACTIVE" && "bg-success/15", s.status === "DEGRADED" && "bg-warning/15")}>{s.status === "ACTIVE" ? "Healthy" : pretty(s.status)}</Badge>
                  </td>
                  <td className="text-xs">{timeAgo(s.health.lastCrawledAt)}</td>
                  <td className="tabular-nums">{s.health.jobsFound}</td>
                  <td className="tabular-nums">{s.health.failureCount}</td>
                  <td>
                    <Select
                      aria-label={`Crawl interval for ${s.company}`}
                      className="h-8 w-28 text-xs"
                      value={s.crawlIntervalMinutes}
                      onChange={(e) => act(() => put(`/admin/sources/${s.id}`, { crawlIntervalMinutes: Number(e.target.value) }))}
                    >
                      {[60, 180, 360, 720, 1440].map((m) => (
                        <option key={m} value={m}>
                          {m >= 60 ? `${m / 60}h` : `${m}m`}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="tabular-nums">{s.subscribers}</td>
                  <td className="whitespace-nowrap">
                    <Button size="sm" variant="ghost" aria-label={`Crawl ${s.company} now`} onClick={() => act(() => post(`/admin/sources/${s.id}/crawl`), `Crawl queued for ${s.company}`)}>
                      <RefreshCw />
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => act(() => put(`/admin/sources/${s.id}`, { status: s.status === "DISABLED" ? "ACTIVE" : "DISABLED" }))}>
                      {s.status === "DISABLED" ? "Enable" : "Disable"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Platform controls</CardTitle>
          </CardHeader>
          <CardContent>
            {!settings ? (
              <Skeleton className="h-40" />
            ) : (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(() => put("/admin/settings", settings), "Settings saved.");
                }}
              >
                <div className="flex items-center justify-between">
                  <Label htmlFor="pc">Pause crawling</Label>
                  <Switch id="pc" label="Pause crawling" checked={settings.crawlingPaused} onChange={(v) => setSettings({ ...settings, crawlingPaused: v })} />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="pn">Pause notifications</Label>
                  <Switch id="pn" label="Pause notifications" checked={settings.notificationsPaused} onChange={(v) => setSettings({ ...settings, notificationsPaused: v })} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="prov">LLM provider</Label>
                    <Select id="prov" value={settings.llmProvider} onChange={(e) => setSettings({ ...settings, llmProvider: e.target.value as PlatformSettings["llmProvider"] })}>
                      {["anthropic", "openai", "gemini", "none"].map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="emb">Embeddings</Label>
                    <Select id="emb" value={settings.embeddingProvider} onChange={(e) => setSettings({ ...settings, embeddingProvider: e.target.value as PlatformSettings["embeddingProvider"] })}>
                      {["local", "openai", "gemini"].map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="model">Strong model (borderline matches)</Label>
                    <Input id="model" value={settings.llmModel} onChange={(e) => setSettings({ ...settings, llmModel: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="small">Small model (extraction)</Label>
                    <Input id="small" value={settings.llmSmallModel} onChange={(e) => setSettings({ ...settings, llmSmallModel: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="maxjobs">Global max jobs / notification</Label>
                    <Input id="maxjobs" type="number" min={1} max={100} value={settings.maxJobsPerNotification} onChange={(e) => setSettings({ ...settings, maxJobsPerNotification: Number(e.target.value) })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="llmmax">LLM evaluations / user run</Label>
                    <Input id="llmmax" type="number" min={0} max={500} value={settings.llmMaxJobsPerRun} onChange={(e) => setSettings({ ...settings, llmMaxJobsPerRun: Number(e.target.value) })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="interval">Default crawl interval (min)</Label>
                    <Input id="interval" type="number" min={15} value={settings.defaultCrawlIntervalMinutes} onChange={(e) => setSettings({ ...settings, defaultCrawlIntervalMinutes: Number(e.target.value) })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="retr">Vector retrieval limit</Label>
                    <Input id="retr" type="number" min={10} max={1000} value={settings.retrievalLimit} onChange={(e) => setSettings({ ...settings, retrievalLimit: Number(e.target.value) })} />
                  </div>
                </div>
                <fieldset className="grid grid-cols-4 gap-2">
                  <legend className="mb-1.5 text-sm font-medium">Match thresholds (Very strong / Strong / Good / Partial)</legend>
                  {(["veryStrong", "strong", "good", "partial"] as const).map((k) => (
                    <Input key={k} aria-label={k} type="number" min={0} max={100} value={settings.matchThresholds[k]} onChange={(e) => setSettings({ ...settings, matchThresholds: { ...settings.matchThresholds, [k]: Number(e.target.value) } })} />
                  ))}
                </fieldset>
                <Button type="submit">Save settings</Button>
              </form>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Feature flags</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {(flags.data ?? []).map((f) => (
                <li key={f.key} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="font-mono text-xs">{f.key}</p>
                    <p className="text-xs text-muted-foreground">{f.description}</p>
                  </div>
                  <Switch label={f.key} checked={f.enabled} onChange={(enabled) => act(() => put(`/admin/flags/${f.key}`, { enabled }))} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Recent agent runs</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 font-medium">Started</th>
                <th className="font-medium">Type</th>
                <th className="font-medium">Subject</th>
                <th className="font-medium">Status</th>
                <th className="font-medium">Discovered</th>
                <th className="font-medium">Matched</th>
                <th className="font-medium">Tokens</th>
                <th className="font-medium">Cost</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {(runs.data ?? []).map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="py-1.5 text-xs">{formatDateTime(r.started_at)}</td>
                  <td>{r.type}</td>
                  <td className="max-w-48 truncate text-xs">{r.company ?? r.user_email ?? r.trigger}</td>
                  <td title={r.error ?? undefined} className={cn(r.status === "FAILED" && "text-destructive")}>
                    {pretty(r.status)}
                  </td>
                  <td>{r.jobs_discovered}</td>
                  <td>{r.jobs_matched}</td>
                  <td>{r.tokens_used}</td>
                  <td>{usd(r.estimated_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}
