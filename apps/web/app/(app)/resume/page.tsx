"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Download, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Seniority, WorkMode, type CandidateProfileData } from "@jobagent/shared";
import { PageHeader } from "@/components/app-shell";
import { ResumeUpload } from "@/components/resume-upload";
import { TagInput } from "@/components/tag-input";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, del, get, put } from "@/lib/api";
import { keys, useProfile, useResumes } from "@/lib/queries";
import { formatDateTime, pretty } from "@/lib/utils";

/** PRD §9–10: upload / replace / version / download resume; view and edit the extracted profile. */
export default function ResumePage() {
  const qc = useQueryClient();
  const resumes = useResumes();
  const profile = useProfile();
  const [draft, setDraft] = useState<CandidateProfileData | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile.data) setDraft(profile.data.profile);
  }, [profile.data]);
  useEffect(() => {
    if (resumes.data?.[0]?.status === "PARSED") void qc.invalidateQueries({ queryKey: keys.profile });
  }, [resumes.data, qc]);

  const download = async (id: string) => {
    const { url } = await get<{ url: string }>(`/resumes/${id}/download-url`);
    window.location.href = url;
  };
  const remove = async (id: string) => {
    if (!confirm("Delete this resume version? Its extracted profile and embeddings are deleted too.")) return;
    await del(`/resumes/${id}`);
    void qc.invalidateQueries({ queryKey: keys.resumes });
    void qc.invalidateQueries({ queryKey: keys.profile });
  };
  const saveProfile = async () => {
    if (!draft) return;
    setSaving(true);
    setMsg(null);
    try {
      await put("/profile", draft);
      await qc.invalidateQueries({ queryKey: keys.profile });
      setMsg({ tone: "success", text: "Profile saved as a new version. Matches are being refreshed." });
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof ApiError ? e.message : "Could not save profile" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader title="Resume & profile" description="The agent matches jobs against the profile read from your resume. Your resume file is stored encrypted." />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Upload or replace</CardTitle>
              <CardDescription>A new upload becomes your active resume. Previous versions are kept.</CardDescription>
            </CardHeader>
            <CardContent>
              <ResumeUpload compact />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Versions</CardTitle>
            </CardHeader>
            <CardContent>
              {resumes.isLoading ? (
                <Skeleton className="h-20" />
              ) : resumes.data?.length ? (
                <ul className="divide-y">
                  {resumes.data.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {r.fileName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          <span className="mr-3">Version {r.version}</span>
                          <span className="mr-3">{formatDateTime(r.createdAt)}</span>
                          {r.status !== "PARSED" && <span className="mr-3">{r.status === "FAILED" ? "Couldn't be read" : "Reading…"}</span>}
                          {r.isActive && <span className="font-medium text-fit">In use</span>}
                        </p>
                        {r.error && <p className="text-xs text-destructive">{r.error}</p>}
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button size="icon" variant="ghost" onClick={() => download(r.id)} aria-label={`Download ${r.fileName}`}>
                          <Download />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => remove(r.id)} aria-label={`Delete ${r.fileName}`}>
                          <Trash2 />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No resume uploaded yet.</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Candidate profile</CardTitle>
            <CardDescription>
              {profile.data ? (profile.data.editedByUser ? `Version ${profile.data.version}, edited by you.` : `Version ${profile.data.version}, read from your resume. Correct anything that's off.`) : "Appears once your resume has been read."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!draft ? (
              <p className="text-sm text-muted-foreground">{resumes.data?.some((r) => r.status === "PARSING" || r.status === "UPLOADED") ? "Analyzing your resume…" : "Upload a resume to build your profile."}</p>
            ) : (
              <div className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="p-years">Years of experience</Label>
                    <Input id="p-years" type="number" min={0} max={60} step={0.5} value={draft.yearsOfExperience} onChange={(e) => setDraft({ ...draft, yearsOfExperience: Number(e.target.value) })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="p-seniority">Seniority</Label>
                    <Select id="p-seniority" value={draft.seniority ?? ""} onChange={(e) => setDraft({ ...draft, seniority: (e.target.value || null) as CandidateProfileData["seniority"] })}>
                      <option value="">Not set</option>
                      {Seniority.options.map((s) => (
                        <option key={s} value={s}>
                          {pretty(s)}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-summary">Summary</Label>
                  <Textarea id="p-summary" value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-tech">Technical skills</Label>
                  <TagInput id="p-tech" value={draft.technicalSkills} onChange={(technicalSkills) => setDraft({ ...draft, technicalSkills, skills: [...new Set([...technicalSkills, ...draft.softSkills])] })} placeholder="Add a skill" max={100} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-soft">Soft skills</Label>
                  <TagInput id="p-soft" value={draft.softSkills} onChange={(softSkills) => setDraft({ ...draft, softSkills, skills: [...new Set([...draft.technicalSkills, ...softSkills])] })} max={30} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-titles">Job titles held</Label>
                  <TagInput id="p-titles" value={draft.jobTitles} onChange={(jobTitles) => setDraft({ ...draft, jobTitles })} max={10} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-companies">Companies</Label>
                  <TagInput id="p-companies" value={draft.companies} onChange={(companies) => setDraft({ ...draft, companies })} max={20} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-certs">Certifications</Label>
                  <TagInput id="p-certs" value={draft.certifications} onChange={(certifications) => setDraft({ ...draft, certifications })} max={20} />
                </div>
                <fieldset>
                  <legend className="mb-2 text-sm font-medium">Preferred work mode</legend>
                  <div className="flex flex-wrap gap-4">
                    {WorkMode.options.map((w) => (
                      <Checkbox
                        key={w}
                        label={pretty(w)}
                        checked={draft.preferredWorkMode.includes(w)}
                        onChange={(e) => setDraft({ ...draft, preferredWorkMode: e.target.checked ? [...draft.preferredWorkMode, w] : draft.preferredWorkMode.filter((x) => x !== w) })}
                      />
                    ))}
                  </div>
                </fieldset>
                {draft.education.length > 0 && (
                  <div>
                    <p className="mb-2 text-sm font-medium">Education</p>
                    <ul className="flex flex-wrap gap-2">
                      {draft.education.map((e, i) => (
                        <li key={i}>
                          <Badge>{[e.degree, e.field, e.institution, e.year].filter(Boolean).join(", ")}</Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
                <Button onClick={saveProfile} loading={saving}>
                  Save profile
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
