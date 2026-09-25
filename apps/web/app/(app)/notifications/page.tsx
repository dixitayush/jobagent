"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { JOBS_PER_NOTIFICATION_OPTIONS, MatchLevel, type NotificationSettings } from "@jobagent/shared";
import { PageHeader } from "@/components/app-shell";
import { ManualRunPanel, RunAgentButton } from "@/components/run-agent";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, put } from "@/lib/api";
import { keys, useMe, useNotifications, useNotificationSettings } from "@/lib/queries";
import { levelText } from "@/components/fit-strip";
import { formatDateTime, pretty } from "@/lib/utils";

/** "2026-09-25:morning" → "Morning", "2026-09-25:manual-153012" → "Manual run". */
const windowLabel = (w: string) => {
  const label = w.split(":")[1] ?? "";
  return label.startsWith("manual") ? "Manual run" : pretty(label);
};

/** PRD §35, §68: digest schedule, job count, timezone and history. */
export default function NotificationsPage() {
  const qc = useQueryClient();
  const me = useMe();
  const q = useNotificationSettings();
  const history = useNotifications();
  const [s, setS] = useState<NotificationSettings | null>(null);
  const [tz, setTz] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => void (q.data && setS(q.data)), [q.data]);
  useEffect(() => void (me.data && setTz(me.data.timezone)), [me.data]);

  if (!s) return <Skeleton className="h-96" />;
  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      qc.setQueryData(keys.notificationSettings, await put<NotificationSettings>("/notification-settings", s));
      if (tz && tz !== me.data?.timezone) qc.setQueryData(keys.me, await put("/me", { timezone: tz }));
      void qc.invalidateQueries({ queryKey: keys.overview });
      setMsg({ tone: "success", text: "Notification settings saved." });
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof ApiError ? e.message : "Could not save settings" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Email digests"
        description="A short email with new jobs that fit, sent only when there's something new. Use Run agent now to check and get an email straight away."
        actions={
          <>
            <Button variant="outline" onClick={save} loading={saving}>
              Save
            </Button>
            <RunAgentButton />
          </>
        }
      />
      <ManualRunPanel />
      {msg && <Alert tone={msg.tone} className="mb-6">{msg.text}</Alert>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Email digest</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="email-on">Email notifications</Label>
              <Switch id="email-on" label="Email notifications" checked={s.emailEnabled} onChange={(emailEnabled) => setS({ ...s, emailEnabled })} />
            </div>
            {(
              [
                ["morning", "Morning email", s.morningTime, s.morningEnabled],
                ["evening", "Evening email", s.eveningTime, s.eveningEnabled],
              ] as const
            ).map(([key, label, time, on]) => (
              <div key={key} className="flex flex-wrap items-center justify-between gap-3">
                <Label htmlFor={`${key}-time`}>{label}</Label>
                <div className="flex items-center gap-3">
                  <Input
                    id={`${key}-time`}
                    type="time"
                    className="w-32"
                    value={time}
                    disabled={!on}
                    onChange={(e) => setS({ ...s, [`${key}Time`]: e.target.value })}
                  />
                  <Switch label={label} checked={on} onChange={(v) => setS({ ...s, [`${key}Enabled`]: v })} />
                </div>
              </div>
            ))}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="count">Jobs per notification</Label>
                <Select id="count" value={s.jobsPerNotification} onChange={(e) => setS({ ...s, jobsPerNotification: Number(e.target.value) })}>
                  {JOBS_PER_NOTIFICATION_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-muted-foreground">Your plan ({me.data?.plan}) sets the maximum.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="level">Include matches from</Label>
                <Select id="level" value={s.minMatchLevel} onChange={(e) => setS({ ...s, minMatchLevel: e.target.value as NotificationSettings["minMatchLevel"] })}>
                  {MatchLevel.options.map((l) => (
                    <option key={l} value={l}>
                      {levelText(l)} or better
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tz">Timezone</Label>
              <Select id="tz" value={tz} onChange={(e) => setTz(e.target.value)}>
                {Intl.supportedValuesOf("timeZone").map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
            <CardDescription>Recent digests.</CardDescription>
          </CardHeader>
          <CardContent>
            {history.data?.length ? (
              <ul className="divide-y">
                {history.data.map((n) => (
                  <li key={n.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{n.subject ?? `${windowLabel(n.window)} digest`}</p>
                      <p className="text-xs text-muted-foreground">
                        <span className="mr-3">{windowLabel(n.window)}</span>
                        <span className="mr-3 tabular">{n.jobCount} {n.jobCount === 1 ? "job" : "jobs"}</span>
                        <span>{formatDateTime(n.sentAt ?? n.createdAt, tz)}</span>
                      </p>
                    </div>
                    <Badge>{n.status === "SKIPPED" ? "No new matches" : pretty(n.status)}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No digests yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
