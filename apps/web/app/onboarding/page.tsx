"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, CheckCircle2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Me, NotificationSettings, Preferences } from "@jobagent/shared";
import { LocationPicker } from "@/components/location-picker";
import { ResumeUpload } from "@/components/resume-upload";
import { SourceForm } from "@/components/source-form";
import { TagInput } from "@/components/tag-input";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label, Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ApiError, post, put } from "@/lib/api";
import { keys, useMe, useNotificationSettings, useOverview, usePreferences, useProfile, useResumes, useSources } from "@/lib/queries";
import { cn } from "@/lib/utils";

const STEPS = ["Welcome", "Resume", "Locations", "Roles", "Companies", "Notifications", "Finish"] as const;

export default function Onboarding() {
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const prefsQ = usePreferences();
  const notifQ = useNotificationSettings();
  const resumes = useResumes();
  const profile = useProfile();
  const sources = useSources();
  const [step, setStep] = useState(0);
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [notif, setNotif] = useState<NotificationSettings | null>(null);
  const [timezone, setTimezone] = useState<string>("Asia/Kolkata");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) router.replace("/login?next=/onboarding");
    if (me.data) setTimezone(me.data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, [me.error, me.data, router]);
  useEffect(() => void (prefsQ.data && !prefs && setPrefs(prefsQ.data)), [prefsQ.data, prefs]);
  useEffect(() => void (notifQ.data && !notif && setNotif(notifQ.data)), [notifQ.data, notif]);
  useEffect(() => {
    // Refresh the extracted profile once parsing completes so role suggestions appear.
    if (resumes.data?.[0]?.status === "PARSED") void qc.invalidateQueries({ queryKey: keys.profile });
  }, [resumes.data, qc]);

  const next = async () => {
    setError(null);
    setSaving(true);
    try {
      if ((step === 2 || step === 3) && prefs) await put("/preferences", prefs);
      if (step === 5 && notif) {
        await put("/notification-settings", notif);
        await put("/me", { timezone });
      }
      if (step === 5) {
        const updated = await put<Me>("/me", { onboardingCompleted: true });
        qc.setQueryData(keys.me, updated);
        await post("/agent/run").catch(() => undefined);
        setFinishing(true);
      }
      setStep((s) => Math.min(s + 1, STEPS.length - 1));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  const latest = resumes.data?.[0];
  const canContinue = step !== 1 || (latest && latest.status !== "FAILED");
  const suggestions = profile.data?.profile.jobTitles ?? [];

  return (
    <main id="main" className="container max-w-3xl py-10">
      <ol className="mb-8 flex flex-wrap gap-2" aria-label="Onboarding progress">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? "step" : undefined} className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium", i === step ? "border-primary bg-primary text-primary-foreground" : i < step ? "bg-secondary" : "text-muted-foreground")}>
            {i < step && <Check className="size-3" aria-hidden />}
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      <Card>
        {step === 0 && (
          <>
            <CardHeader>
              <CardTitle className="text-2xl">Welcome{me.data ? `, ${me.data.name.split(" ")[0]}` : ""}</CardTitle>
              <CardDescription>Tell us about your job search. It takes about two minutes.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>You&apos;ll upload your resume, choose locations and roles, add the companies you want to follow, and pick when you&apos;d like your digest.</p>
              <p>From then on the agent searches, filters, ranks and emails the strongest new matches every day.</p>
            </CardContent>
          </>
        )}

        {step === 1 && (
          <>
            <CardHeader>
              <CardTitle>Upload your resume</CardTitle>
              <CardDescription>We extract skills, experience and roles to build your candidate profile. You can edit it later.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ResumeUpload />
              {latest && (
                <Alert tone={latest.status === "FAILED" ? "error" : latest.status === "PARSED" ? "success" : "info"} title={latest.fileName}>
                  {latest.status === "PARSED" && `Resume analyzed — ${profile.data?.normalizedSkills.length ?? 0} skills identified.`}
                  {(latest.status === "UPLOADED" || latest.status === "PARSING") && "Analyzing your resume…"}
                  {latest.status === "FAILED" && (latest.error ?? "We couldn't read this file.")}
                </Alert>
              )}
            </CardContent>
          </>
        )}

        {step === 2 && prefs && (
          <>
            <CardHeader>
              <CardTitle>Where do you want to work?</CardTitle>
              <CardDescription>Select as many cities, states or remote options as you like.</CardDescription>
            </CardHeader>
            <CardContent>
              <LocationPicker value={prefs.locationIds} onChange={(locationIds) => setPrefs({ ...prefs, locationIds })} />
            </CardContent>
          </>
        )}

        {step === 3 && prefs && (
          <>
            <CardHeader>
              <CardTitle>Which roles are you looking for?</CardTitle>
              <CardDescription>Job titles help rank relevant postings higher.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label htmlFor="roles">Desired job titles</Label>
              <TagInput id="roles" value={prefs.jobTitles} onChange={(jobTitles) => setPrefs({ ...prefs, jobTitles })} placeholder="e.g. Backend Engineer" suggestions={suggestions} max={20} />
            </CardContent>
          </>
        )}

        {step === 4 && (
          <>
            <CardHeader>
              <CardTitle>Add companies to follow</CardTitle>
              <CardDescription>Paste a company&apos;s career page. We validate it and crawl it for you.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <SourceForm />
              {sources.data && sources.data.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {sources.data.map((s) => (
                    <li key={s.id} className="flex items-center gap-2">
                      <CheckCircle2 className="size-4 text-success" aria-hidden /> {s.companyName}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </>
        )}

        {step === 5 && notif && (
          <>
            <CardHeader>
              <CardTitle>When should we email you?</CardTitle>
              <CardDescription>Digests contain only new jobs you haven&apos;t been sent before.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="m">Morning digest · {notif.morningTime}</Label>
                <Switch id="m" label="Morning digest" checked={notif.morningEnabled} onChange={(morningEnabled) => setNotif({ ...notif, morningEnabled })} />
              </div>
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="e">Evening digest · {notif.eveningTime}</Label>
                <Switch id="e" label="Evening digest" checked={notif.eveningEnabled} onChange={(eveningEnabled) => setNotif({ ...notif, eveningEnabled })} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="count">Jobs per email</Label>
                  <Select id="count" value={notif.jobsPerNotification} onChange={(e) => setNotif({ ...notif, jobsPerNotification: Number(e.target.value) })}>
                    {[10, 15, 20, 25, 50].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tz">Timezone</Label>
                  <Select id="tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                    {Intl.supportedValuesOf("timeZone").map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            </CardContent>
          </>
        )}

        {step === 6 && <FirstRun active={finishing} onDone={() => router.replace("/dashboard")} />}

        {error && (
          <div className="px-5 pb-2">
            <Alert tone="error">{error}</Alert>
          </div>
        )}
        {step < 6 && (
          <div className="flex justify-between border-t p-5">
            <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
              Back
            </Button>
            <div className="flex gap-2">
              {(step === 3 || step === 4) && (
                <Button variant="ghost" onClick={() => setStep((s) => s + 1)}>
                  Skip
                </Button>
              )}
              <Button onClick={next} loading={saving} disabled={!canContinue}>
                {step === 5 ? "Finish setup" : "Continue"}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </main>
  );
}

/** PRD §95 first agent run. */
function FirstRun({ active, onDone }: { active: boolean; onDone: () => void }) {
  const overview = useOverview();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 6000);
    const poll = setInterval(() => void overview.refetch(), 2000);
    return () => (clearTimeout(t), clearInterval(poll));
  }, [overview]);
  const s = overview.data?.setup;
  const items = s
    ? [
        [s.hasResume, "Resume analyzed"],
        [s.skillCount > 0, `${s.skillCount} skills identified`],
        [s.hasRoles, "Job roles selected"],
        [s.hasLocations, "Locations selected"],
        [s.sourceCount > 0, `${s.sourceCount} companies configured`],
        [s.jobsIndexed > 0, `${s.jobsIndexed.toLocaleString()} jobs indexed`],
      ]
    : [];
  return (
    <>
      <CardHeader>
        <CardTitle>{ready ? "Your job feed is ready." : "Preparing your job feed…"}</CardTitle>
        <CardDescription>{ready ? "New companies keep indexing in the background." : "Finding your best matches…"}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 text-sm" aria-live="polite">
          {items.map(([ok, label]) => (
            <li key={String(label)} className="flex items-center gap-2">
              {ok ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />}
              {label}
            </li>
          ))}
        </ul>
        <Button className="mt-6" onClick={onDone} disabled={!active && !ready}>
          Go to dashboard
        </Button>
      </CardContent>
    </>
  );
}
