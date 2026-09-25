"use client";

import { Suspense } from "react";
import { JobList } from "@/components/job-list";

export default function JobsPage() {
  return (
    <Suspense>
      <JobList title="Job feed" description="Openings from the companies you follow, ranked by how well they fit your profile." />
    </Suspense>
  );
}
