"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Loader2, Play, XCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { ManualRunState, ManualRunStep } from "@jobagent/shared";
import { ApiError, get, post } from "@/lib/api";
import { keys } from "@/lib/queries";
import { cn, timeAgo } from "@/lib/utils";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";

const STEPS: { step: ManualRunStep; label: string }[] = [
  { step: "CRAWLING", label: "Check career pages" },
  { step: "MATCHING", label: "Match against your profile" },
  { step: "EMAILING", label: "Email new matches" },
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

  const visible = !!s && (isActive(s) || !s.finishedAt || Date.now() - new Date(s.finishedAt).getTime() < 6 * 3_600_000);
  return (
    <AnimatePresence initial={false} mode="wait">
      {visible && s && (
        <motion.div
          key={isActive(s) ? "running" : `done-${s.runKey}`}
          initial={{ opacity: 0, y: -6, height: 0 }}
          animate={{ opacity: 1, y: 0, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
          className="overflow-hidden"
        >
          {isActive(s) ? <RunProgress s={s} /> : <RunResult s={s} />}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function RunResult({ s }: { s: ManualRunState }) {
  return (
    <Alert tone={s.step === "FAILED" ? "error" : s.emailStatus === "SENT" ? "success" : "info"} title={s.step === "FAILED" ? "The agent run didn't finish" : "Agent run complete"} className="mb-6">
      {s.message}. <span className="text-graphite">Finished {timeAgo(s.finishedAt)}.</span>
    </Alert>
  );
}

/** Overall progress: steps are weighted, and crawling advances per company checked. */
function progressOf(s: ManualRunState): number {
  if (s.step === "QUEUED") return 4;
  if (s.step === "CRAWLING") {
    const done = s.sourcesCrawled + s.sourcesSkippedFresh;
    return 8 + (s.sourcesTotal ? (done / s.sourcesTotal) * 44 : 44);
  }
  if (s.step === "MATCHING") return 62;
  if (s.step === "EMAILING") return 88;
  return 100;
}

function RunProgress({ s }: { s: ManualRunState }) {
  const current = ORDER.indexOf(s.step);
  return (
    <div className="mb-6 rounded-xl border bg-surface p-5" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-medium">{s.message}</p>
        <span className="tabular text-xs text-graphite">{Math.round(progressOf(s))}%</span>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-rule" aria-hidden>
        <motion.div className="h-full rounded-full bg-fit" initial={{ width: 0 }} animate={{ width: `${progressOf(s)}%` }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} />
      </div>
      <ol className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
        {STEPS.map(({ step, label }) => {
          const idx = ORDER.indexOf(step);
          const done = current > idx;
          const now = current === idx;
          return (
            <li key={step} className={cn("flex items-center gap-2 transition-colors", !done && !now && "text-graphite")}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.span key={done ? "done" : now ? "now" : "todo"} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={{ duration: 0.18 }} className="grid place-items-center">
                  {done ? <CheckCircle2 className="size-4 text-fit" aria-hidden /> : now ? <Loader2 className="size-4 animate-spin text-ink" aria-hidden /> : <Circle className="size-4" aria-hidden />}
                </motion.span>
              </AnimatePresence>
              {label}
              {step === "CRAWLING" && s.sourcesTotal > 0 && (
                <span className="tabular text-xs text-graphite">
                  {s.sourcesCrawled + s.sourcesSkippedFresh}/{s.sourcesTotal}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {s.sourcesFailed.length > 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-graphite">
          <XCircle className="size-3.5" aria-hidden /> Couldn&apos;t reach {s.sourcesFailed.join(", ")}
        </p>
      )}
    </div>
  );
}
