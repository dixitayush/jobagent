"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { EmploymentType, WorkMode, type Preferences } from "@jobagent/shared";
import { PageHeader } from "@/components/app-shell";
import { LocationPicker } from "@/components/location-picker";
import { TagInput } from "@/components/tag-input";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Label } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, put } from "@/lib/api";
import { keys, usePreferences, useProfile } from "@/lib/queries";
import { pretty } from "@/lib/utils";

/** PRD §42 settings. */
export default function PreferencesPage() {
  const qc = useQueryClient();
  const q = usePreferences();
  const profile = useProfile();
  const [p, setP] = useState<Preferences | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => void (q.data && setP(q.data)), [q.data]);

  if (!p) return <Skeleton className="h-96" />;
  const toggle = <T,>(list: T[], v: T, on: boolean) => (on ? [...new Set([...list, v])] : list.filter((x) => x !== v));

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      qc.setQueryData(keys.preferences, await put<Preferences>("/preferences", p));
      setMsg({ tone: "success", text: "Preferences saved. Your matches are being refreshed." });
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof ApiError ? e.message : "Could not save preferences" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader title="Preferences" description="The agent filters and ranks jobs using these settings." actions={<Button onClick={save} loading={saving}>Save preferences</Button>} />
      {msg && <Alert tone={msg.tone} className="mb-6">{msg.text}</Alert>}
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Job titles</CardTitle>
            <CardDescription>Roles you want. Titles close to these rank higher.</CardDescription>
          </CardHeader>
          <CardContent>
            <TagInput id="titles" value={p.jobTitles} onChange={(jobTitles) => setP({ ...p, jobTitles })} placeholder="e.g. Senior Software Engineer" suggestions={profile.data?.profile.jobTitles ?? []} max={20} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Locations</CardTitle>
            <CardDescription>Jobs outside these locations are filtered out before any AI evaluation.</CardDescription>
          </CardHeader>
          <CardContent>
            <LocationPicker value={p.locationIds} onChange={(locationIds) => setP({ ...p, locationIds })} />
          </CardContent>
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Work mode</CardTitle>
              <CardDescription>Leave all unchecked to accept any.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-5">
              {WorkMode.options.map((w) => (
                <Checkbox key={w} label={pretty(w)} checked={p.workModes.includes(w)} onChange={(e) => setP({ ...p, workModes: toggle(p.workModes, w, e.target.checked) })} />
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Employment type</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-5">
              {EmploymentType.options.map((t) => (
                <Checkbox key={t} label={pretty(t)} checked={p.employmentTypes.includes(t)} onChange={(e) => setP({ ...p, employmentTypes: toggle(p.employmentTypes, t, e.target.checked) })} />
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Experience</CardTitle>
              <CardDescription>Years of experience the role should ask for.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="min">Minimum</Label>
                <Input id="min" type="number" min={0} max={50} value={p.minExperience ?? ""} onChange={(e) => setP({ ...p, minExperience: e.target.value === "" ? null : Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="max">Maximum</Label>
                <Input id="max" type="number" min={0} max={60} value={p.maxExperience ?? ""} onChange={(e) => setP({ ...p, maxExperience: e.target.value === "" ? null : Number(e.target.value) })} />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Freshness</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-4">
              <Label htmlFor="recent" className="font-normal">
                Also email jobs first seen in the last 7 days (not just the last 24 hours)
              </Label>
              <Switch id="recent" label="Include recent jobs" checked={p.includeRecentJobs} onChange={(includeRecentJobs) => setP({ ...p, includeRecentJobs })} />
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Preferred companies</CardTitle>
              <CardDescription>Get a small ranking boost.</CardDescription>
            </CardHeader>
            <CardContent>
              <TagInput id="pref-co" value={p.preferredCompanies} onChange={(preferredCompanies) => setP({ ...p, preferredCompanies })} placeholder="Company name" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Blocked companies</CardTitle>
              <CardDescription>Never shown or emailed.</CardDescription>
            </CardHeader>
            <CardContent>
              <TagInput id="block-co" value={p.blockedCompanies} onChange={(blockedCompanies) => setP({ ...p, blockedCompanies })} placeholder="Company name" />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
