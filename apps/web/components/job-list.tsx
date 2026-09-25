"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ConnectorType, EmploymentType, JobSort, MatchLevel, WorkMode, type JobListQuery } from "@jobagent/shared";
import { PageHeader } from "@/components/app-shell";
import { JobCard } from "@/components/job-card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useJobs } from "@/lib/queries";
import { levelLabel, pretty } from "@/lib/utils";

type Filters = Partial<JobListQuery>;
const FILTER_KEYS = ["q", "company", "location", "matchLevel", "minScore", "postedWithinDays", "workMode", "employmentType", "skill", "source", "sort", "view", "page"] as const;

function readFilters(sp: URLSearchParams): Filters {
  const f: Record<string, string | number> = {};
  for (const k of FILTER_KEYS) {
    const v = sp.get(k);
    if (v) f[k] = ["minScore", "postedWithinDays", "page"].includes(k) ? Number(v) : v;
  }
  return f as Filters;
}

/** PRD §40 job search with filters and sorting, state kept in the URL. */
export function JobList({ fixedView, title, description }: { fixedView?: JobListQuery["view"]; title: string; description: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filters = { view: fixedView ?? "matches", sort: "BEST_MATCH", ...readFilters(sp), ...(fixedView ? { view: fixedView } : {}) } as Filters;
  const [q, setQ] = useState(filters.q ?? "");
  const jobs = useJobs({ ...filters, pageSize: 20 });

  const set = (patch: Filters) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries({ ...patch, page: patch.page ?? undefined })) {
      if (v === undefined || v === "" || v === null) next.delete(k);
      else next.set(k, String(v));
    }
    if (!("page" in patch)) next.delete("page");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  useEffect(() => {
    const t = setTimeout(() => q !== (filters.q ?? "") && set({ q }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const page = filters.page ?? 1;
  const total = jobs.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 20));

  return (
    <>
      <PageHeader title={title} description={description} />
      <form role="search" className="mb-6 grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(e) => e.preventDefault()}>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="q">Search</Label>
          <Input id="q" placeholder="Title or company" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {!fixedView && (
          <div className="space-y-1.5">
            <Label htmlFor="view">Show</Label>
            <Select id="view" value={filters.view} onChange={(e) => set({ view: e.target.value as JobListQuery["view"] })}>
              <option value="matches">Matched jobs</option>
              <option value="all">All jobs from my sources</option>
              <option value="dismissed">Dismissed</option>
            </Select>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="sort">Sort by</Label>
          <Select id="sort" value={filters.sort} onChange={(e) => set({ sort: e.target.value as JobListQuery["sort"] })}>
            {JobSort.options.map((s) => (
              <option key={s} value={s}>
                {pretty(s)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="matchLevel">Match level (at least)</Label>
          <Select id="matchLevel" value={filters.matchLevel ?? ""} onChange={(e) => set({ matchLevel: (e.target.value || undefined) as MatchLevel | undefined })}>
            <option value="">Any</option>
            {MatchLevel.options.map((l) => (
              <option key={l} value={l}>
                {levelLabel(l)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="minScore">Minimum score</Label>
          <Select id="minScore" value={filters.minScore ?? ""} onChange={(e) => set({ minScore: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">Any</option>
            {[90, 80, 70, 55].map((s) => (
              <option key={s} value={s}>
                {s}%+
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="posted">Date posted</Label>
          <Select id="posted" value={filters.postedWithinDays ?? ""} onChange={(e) => set({ postedWithinDays: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">Any time</option>
            <option value="1">Last 24 hours</option>
            <option value="3">Last 3 days</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="workMode">Work mode</Label>
          <Select id="workMode" value={filters.workMode ?? ""} onChange={(e) => set({ workMode: (e.target.value || undefined) as WorkMode | undefined })}>
            <option value="">Any</option>
            {WorkMode.options.map((w) => (
              <option key={w} value={w}>
                {pretty(w)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="employmentType">Employment type</Label>
          <Select id="employmentType" value={filters.employmentType ?? ""} onChange={(e) => set({ employmentType: (e.target.value || undefined) as EmploymentType | undefined })}>
            <option value="">Any</option>
            {EmploymentType.options.map((w) => (
              <option key={w} value={w}>
                {pretty(w)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="company">Company</Label>
          <Input id="company" defaultValue={filters.company} onBlur={(e) => set({ company: e.target.value || undefined })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="location">Location</Label>
          <Input id="location" defaultValue={filters.location} onBlur={(e) => set({ location: e.target.value || undefined })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="skill">Skill</Label>
          <Input id="skill" defaultValue={filters.skill} placeholder="e.g. Kubernetes" onBlur={(e) => set({ skill: e.target.value || undefined })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="source">Source</Label>
          <Select id="source" value={filters.source ?? ""} onChange={(e) => set({ source: (e.target.value || undefined) as ConnectorType | undefined })}>
            <option value="">Any</option>
            {ConnectorType.options.map((s) => (
              <option key={s} value={s}>
                {pretty(s)}
              </option>
            ))}
          </Select>
        </div>
      </form>

      <p className="mb-3 text-sm text-muted-foreground" aria-live="polite">
        {jobs.isFetching ? "Loading…" : `${total} job${total === 1 ? "" : "s"}`}
      </p>
      {jobs.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      ) : jobs.data?.items.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {jobs.data.items.map((j) => (
            <JobCard key={j.id} job={j} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border py-12 text-center">
          <p className="font-medium">No jobs match these filters.</p>
          <p className="mt-1 text-sm text-muted-foreground">We&apos;ll continue checking your configured sources.</p>
        </div>
      )}
      {pages > 1 && (
        <nav aria-label="Pagination" className="mt-6 flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => set({ page: page - 1 })}>
            Previous
          </Button>
          <span className="text-sm tabular-nums">
            Page {page} of {pages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => set({ page: page + 1 })}>
            Next
          </Button>
        </nav>
      )}
    </>
  );
}
