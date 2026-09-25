"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ApiError, del, put } from "@/lib/api";
import { keys, useMe } from "@/lib/queries";
import { formatDateTime } from "@/lib/utils";

/** PRD §67: export data, delete account/resume/history, disable personalization. */
export default function SettingsPage() {
  const me = useMe();
  const qc = useQueryClient();
  const router = useRouter();
  const [confirmText, setConfirmText] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  if (!me.data) return null;
  const u = me.data;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "success", text: ok });
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof ApiError ? e.message : "Action failed" });
    }
  };

  return (
    <>
      <PageHeader title="Account & privacy" description="Control your data. Resumes are encrypted and never shared." />
      {msg && <Alert tone={msg.tone} className="mb-6">{msg.text}</Alert>}
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Name</dt>
              <dd>{u.name}</dd>
              <dt className="text-muted-foreground">Email</dt>
              <dd>{u.email}</dd>
              <dt className="text-muted-foreground">Plan</dt>
              <dd className="capitalize">{u.plan}</dd>
              <dt className="text-muted-foreground">Member since</dt>
              <dd>{formatDateTime(u.createdAt, u.timezone)}</dd>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Personalization</CardTitle>
            <CardDescription>When on, the agent gently boosts jobs similar to ones you save and apply to (only after enough signals).</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <Label htmlFor="personalization">Learn from my activity</Label>
            <Switch
              id="personalization"
              label="Learn from my activity"
              checked={u.personalizationEnabled}
              onChange={(v) => run(async () => qc.setQueryData(keys.me, await put("/me", { personalizationEnabled: v })), v ? "Personalization enabled." : "Personalization disabled.")}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your data</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">Export my data</p>
                <p className="text-sm text-muted-foreground">Download everything we store about you as JSON.</p>
              </div>
              <a href="/api/v1/me/export" className="inline-flex h-10 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent">
                Download export
              </a>
            </div>
            <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">Delete job history</p>
                <p className="text-sm text-muted-foreground">Removes matches, saved and dismissed jobs, activity and notification history.</p>
              </div>
              <Button variant="outline" onClick={() => confirm("Delete your job history?") && run(async () => (await del("/me/history"), qc.invalidateQueries()), "Job history deleted.")}>
                Delete history
              </Button>
            </div>
            <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">Delete my resume</p>
                <p className="text-sm text-muted-foreground">Manage versions on the Resume page — deleting one also removes its embeddings.</p>
              </div>
              <Button variant="outline" onClick={() => router.push("/resume")}>
                Manage resumes
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">Delete account</CardTitle>
            <CardDescription>Permanently deletes your account, resumes, embeddings, matches and notifications. This cannot be undone.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Label htmlFor="confirm">
              Type <strong>DELETE</strong> to confirm
            </Label>
            <div className="flex gap-2">
              <Input id="confirm" className="max-w-40" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
              <Button
                variant="destructive"
                disabled={confirmText !== "DELETE"}
                onClick={() =>
                  run(async () => {
                    await del("/me");
                    qc.clear();
                    router.replace("/");
                  }, "Account deleted.")
                }
              >
                Delete account
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
