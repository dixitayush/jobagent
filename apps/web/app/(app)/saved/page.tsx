"use client";

import { Suspense } from "react";
import { JobList } from "@/components/job-list";

export default function SavedPage() {
  return (
    <Suspense>
      <JobList fixedView="saved" title="Saved jobs" description="Jobs you bookmarked. Saving also teaches the agent what you like." />
    </Suspense>
  );
}
