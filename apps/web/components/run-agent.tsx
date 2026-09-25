"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Loader2, Play, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ManualRunState, ManualRunStep } from "@jobagent/shared";
import { ApiError, get, post } from "@/lib/api";
import { keys } from "@/lib/queries";
import { cn, timeAgo } from "@/lib/utils";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";

const STEPS: { step: ManualRunStep; label: string }[] = [
  { step: "CRAWLING", label: "Check career pages for new jobs" },
  { step: "MATCHING", label: "Match jobs against your profile" },
  { step: "EMAILING", label: "Email your new matches" },
];
const ORDER: ManualRunStep[] = ["QUEUED", "CRAWLING", "MATCHING", "EMAILING", "DONE"];
const isActive = (s: ManualRunState | null | undefined) => !!s && s.step !== "DONE" && s.step !== "FAILED";

export const useManualRun = () => {
  const q = useQuery({
    queryKey: ["agent-run-now"],
    queryFn: () => get<ManualRunState | null>("/agent/run-now"),
    refetchInterval: (query) => (isActive(query.state.data) ? 2000 : false),
  });
  return q;
};

/** "Run agent now": crawl → match → email, on demand, with live progress. */
export function RunAgentButton({ size = "default" }: { size?: "default" | "sm" }) {
  const qc = useQueryClient();
  const run = useManualRun();
  const [error, setError] = useState<string | null>(null);
  const running = isActive(run.data);

  const start = async () => {
    setError(null);
    try {
      qc.setQueryData(["agent-run-now"], await post<ManualRunState>("/agent/run-now"));
    } catch (e) {
      setError(e instanceof ApiError ? (e.status === 429 ? "You can run the agent 3 times per hour. Try again a little later." : e.message) : "Could not start the agent");
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size={size} onClick={start} loading={running} disabled={running}>
        {!running && <Play />}
        {running ? "Agent running…" : "Run agent now"}
      </Button>
      {error && (
        <p role="alert" className="max-w-xs text-right text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** Progress / result of the latest manual run. Refreshes job data when a run finishes. */
export function ManualRunPanel() {
  const qc = useQueryClient();
  const { data: s } = useManualRun();
  const lastStep = useRef<ManualRunStep | null>(null);

  useEffect(() => {
    if (!s) return;
    if (lastStep.current && lastStep.current !== s.step && (s.step === "DONE" || s.step === "FAILED")) {
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      void qc.invalidateQueries({ queryKey: keys.overview });
      void qc.invalidateQueries({ queryKey: keys.notifications });
      void qc.invalidateQueries({ queryKey: keys.sources });
    }
    lastStep.current = s.step;
  }, [s, qc]);

  if (!s) return null;
  const active = isActive(s);
  // Hide old results after a while; always show an active run.
  if (!active && s.finishedAt && Date.now() - new Date(s.finishedAt).getTime() > 6 * 3_600_000) return null;
  const current = ORDER.indexOf(s.step);

  if (!active) {
    return (
      <Alert tone={s.step === "FAILED" ? "error" : s.emailStatus === "SENT" ? "success" : "info"} title={s.step === "FAILED" ? "Agent run failed" : "Agent run complete"} className="mb-6">
        {s.message} <span className="text-muted-foreground">· {timeAgo(s.finishedAt)}</span>
      </Alert>
    );
  }

  return (
    <div className="mb-6 rounded-lg border p-4" role="status" aria-live="polite">
      <p className="mb-3 text-sm font-medium">Agent running · {s.message}</p>
      <ol className="space-y-2 text-sm">
        {STEPS.map(({ step, label }) => {
          const idx = ORDER.indexOf(step);
          const done = current > idx;
          const now = current === idx;
          return (
            <li key={step} className={cn("flex items-center gap-2", !done && !now && "text-muted-foreground")}>
              {done ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : now ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Circle className="size-4" aria-hidden />}
              {label}
              {step === "CRAWLING" && s.sourcesTotal > 0 && (
                <span className="text-xs text-muted-foreground">
                  ({s.sourcesCrawled + s.sourcesSkippedFresh}/{s.sourcesTotal})
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {s.sourcesFailed.length > 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <XCircle className="size-3.5" aria-hidden /> Couldn&apos;t reach: {s.sourcesFailed.join(", ")}
        </p>
      )}
    </div>
  );
}
