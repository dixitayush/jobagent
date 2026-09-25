"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ConnectorType, EmploymentType, MatchLevel, WorkMode, type JobListQuery } from "@jobagent/shared";
import { PageHeader } from "@/components/app-shell";
import { JobRows } from "@/components/job-card";
import { levelText } from "@/components/fit-strip";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useJobs } from "@/lib/queries";
import { pretty } from "@/lib/utils";

type Filters = Partial<JobListQuery>;
const FILTER_KEYS = ["q", "company", "location", "matchLevel", "minScore", "postedWithinDays", "workMode", "employmentType", "skill", "source", "sort", "view", "page"] as const;
const DETAIL_KEYS = ["matchLevel", "minScore", "postedWithinDays", "workMode", "employmentType", "company", "location", "skill", "source"] as const;

const SORT_LABELS: Record<JobListQuery["sort"], string> = { BEST_MATCH: "Best match", NEWEST: "Newest", SCORE: "Highest score", COMPANY: "Company A–Z" };
const POSTED_LABELS: Record<string, string> = { "1": "Last 24 hours", "3": "Last 3 days", "7": "Last 7 days", "30": "Last 30 days" };

function readFilters(sp: URLSearchParams): Filters {
  const f: Record<string, string | number> = {};
  for (const k of FILTER_KEYS) {
    const v = sp.get(k);
    if (v) f[k] = ["minScore", "postedWithinDays", "page"].includes(k) ? Number(v) : v;
  }
  return f as Filters;
}

function chipLabel(k: (typeof DETAIL_KEYS)[number], v: string | number): string {
  if (k === "matchLevel") return `${levelText(v as MatchLevel)} or better`;
  if (k === "minScore") return `Score ${v}+`;
  if (k === "postedWithinDays") return POSTED_LABELS[String(v)] ?? `${v} days`;
  if (k === "company" || k === "location" || k === "skill") return String(v);
  return pretty(String(v));
}

/** PRD §40 job search. Filter state lives in the URL so views can be shared and bookmarked. */
export function JobList({ fixedView, title, description }: { fixedView?: JobListQuery["view"]; title: string; description: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filters = { view: fixedView ?? "matches", sort: "BEST_MATCH", ...readFilters(sp), ...(fixedView ? { view: fixedView } : {}) } as Filters;
  const [q, setQ] = useState(filters.q ?? "");
  const [panel, setPanel] = useState(false);
  const jobs = useJobs({ ...filters, pageSize: 20 });
  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const set = (patch: Filters) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
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
  const active = DETAIL_KEYS.filter((k) => filters[k] !== undefined && filters[k] !== "");

  const detailFields = (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div className="space-y-1.5">
        <Label htmlFor="matchLevel">Match level</Label>
        <Select id="matchLevel" value={filters.matchLevel ?? ""} onChange={(e) => set({ matchLevel: (e.target.value || undefined) as MatchLevel | undefined })}>
          <option value="">Any</option>
          {MatchLevel.options.map((l) => (
            <option key={l} value={l}>
              {levelText(l)} or better
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
              {s} or higher
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="posted">Posted</Label>
        <Select id="posted" value={filters.postedWithinDays ?? ""} onChange={(e) => set({ postedWithinDays: e.target.value ? Number(e.target.value) : undefined })}>
          <option value="">Any time</option>
          {Object.entries(POSTED_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
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
        <Input id="company" key={`c-${filters.company ?? ""}`} defaultValue={filters.company} placeholder="Any company" onBlur={(e) => set({ company: e.target.value || undefined })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="location">Location</Label>
        <Input id="location" key={`l-${filters.location ?? ""}`} defaultValue={filters.location} placeholder="Any location" onBlur={(e) => set({ location: e.target.value || undefined })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="skill">Skill</Label>
        <Input id="skill" key={`s-${filters.skill ?? ""}`} defaultValue={filters.skill} placeholder="e.g. Kubernetes" onBlur={(e) => set({ skill: e.target.value || undefined })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="source">Found on</Label>
        <Select id="source" value={filters.source ?? ""} onChange={(e) => set({ source: (e.target.value || undefined) as ConnectorType | undefined })}>
          <option value="">Any site</option>
          {ConnectorType.options.map((s) => (
            <option key={s} value={s}>
              {pretty(s)}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );

  return (
    <>
      <PageHeader title={title} description={description} />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-graphite" aria-hidden />
          <label htmlFor="q" className="sr-only">
            Search jobs
          </label>
          <Input id="q" type="search" placeholder="Search by title or company" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!fixedView && (
            <Segmented
              label="Which jobs"
              value={filters.view ?? "matches"}
              onChange={(view) => set({ view })}
              options={[
                { value: "matches", label: "Matches" },
                { value: "all", label: "All openings" },
                { value: "dismissed", label: "Hidden" },
              ]}
            />
          )}
          <label htmlFor="sort" className="sr-only">
            Sort by
          </label>
          <Select id="sort" className="w-40" value={filters.sort} onChange={(e) => set({ sort: e.target.value as JobListQuery["sort"] })}>
            {Object.entries(SORT_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
          <Button variant="outline" onClick={() => setPanel((p) => !p)} aria-expanded={panel} aria-controls="filters">
            <SlidersHorizontal /> Filters
            {active.length > 0 && <span className="tabular grid size-5 place-items-center rounded-full bg-ink text-[11px] text-primary-foreground">{active.length}</span>}
          </Button>
        </div>
      </div>

      {/* Desktop: inline panel that expands in place. Mobile: bottom sheet. */}
      <AnimatePresence initial={false}>
        {panel && isDesktop && (
          <motion.div
            id="filters"
            key="filters"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-4 rounded-xl border bg-surface p-5">{detailFields}</div>
          </motion.div>
        )}
      </AnimatePresence>
      <Sheet
        open={panel && !isDesktop}
        onClose={() => setPanel(false)}
        title="Filters"
        footer={
          <Button className="w-full" onClick={() => setPanel(false)}>
            Show {total.toLocaleString()} {total === 1 ? "job" : "jobs"}
          </Button>
        }
      >
        {detailFields}
      </Sheet>

      {active.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <AnimatePresence initial={false}>
            {active.map((k) => (
              <motion.button
                key={k}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                type="button"
                onClick={() => set({ [k]: undefined })}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border bg-surface px-3 text-sm transition-colors hover:border-graphite/40 hover:bg-accent"
                aria-label={`Remove filter: ${chipLabel(k, filters[k]!)}`}
              >
                {chipLabel(k, filters[k]!)} <X className="size-3.5 text-graphite" aria-hidden />
              </motion.button>
            ))}
          </AnimatePresence>
          <button type="button" onClick={() => set(Object.fromEntries(DETAIL_KEYS.map((k) => [k, undefined])))} className="h-8 px-2 text-sm text-graphite underline-offset-4 hover:text-ink hover:underline">
            Clear all
          </button>
        </div>
      )}

      <p className="mt-6 pb-1 text-sm text-graphite" aria-live="polite">
        {jobs.isFetching && !jobs.data ? "Loading jobs" : `${total.toLocaleString()} ${total === 1 ? "job" : "jobs"}`}
      </p>
      {jobs.isLoading ? (
        <div className="space-y-4 py-5">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : jobs.data?.items.length ? (
        <JobRows jobs={jobs.data.items} />
      ) : (
        <div className="py-16">
          <p className="font-medium">{active.length || filters.q ? "No jobs match these filters." : fixedView === "saved" ? "You haven't saved any jobs yet." : "No jobs here yet."}</p>
          <p className="mt-1 max-w-md text-sm text-graphite">
            {active.length || filters.q
              ? "Try removing a filter or searching for something broader."
              : fixedView === "saved"
                ? "Use the bookmark on any job to keep it here. Saving also helps the agent learn what you like."
                : "The agent keeps checking your companies and adds new openings as they appear."}
          </p>
        </div>
      )}

      {pages > 1 && (
        <nav aria-label="Pagination" className="mt-6 flex items-center justify-between border-t pt-4">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => set({ page: page - 1 })}>
            Previous
          </Button>
          <span className="tabular text-sm text-graphite">
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
