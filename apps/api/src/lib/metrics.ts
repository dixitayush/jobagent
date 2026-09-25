import client from "prom-client";

/** Prometheus metrics (PRD §61). Exposed on the internal port only. */
export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: "jobagent_" });

const counter = (name: string, help: string, labelNames: string[] = []) =>
  new client.Counter({ name: `jobagent_${name}`, help, labelNames, registers: [registry] });
const histogram = (name: string, help: string, labelNames: string[], buckets: number[]) =>
  new client.Histogram({ name: `jobagent_${name}`, help, labelNames, buckets, registers: [registry] });

export const metrics = {
  httpDuration: histogram("http_request_duration_seconds", "HTTP request latency", ["method", "route", "status"], [0.01, 0.05, 0.1, 0.3, 1, 3, 10]),
  crawls: counter("crawls_total", "Source crawls", ["connector", "outcome"]),
  crawlDuration: histogram("crawl_duration_seconds", "Crawl duration", ["connector"], [0.5, 1, 2, 5, 10, 30, 60, 120]),
  jobsDiscovered: counter("jobs_discovered_total", "Jobs discovered", ["connector", "kind"]),
  duplicates: counter("jobs_duplicates_total", "Duplicate jobs detected", ["method"]),
  matchingDuration: histogram("matching_duration_seconds", "Per-user matching latency", [], [0.1, 0.5, 1, 2, 5, 10, 30, 60]),
  llmLatency: histogram("llm_latency_seconds", "LLM call latency", ["provider", "model", "purpose"], [0.5, 1, 2, 5, 10, 20, 40, 90]),
  llmCost: counter("llm_cost_usd_total", "Estimated LLM cost (USD)", ["provider", "model", "purpose"]),
  llmTokens: counter("llm_tokens_total", "LLM tokens", ["provider", "model", "direction"]),
  llmErrors: counter("llm_errors_total", "LLM failures", ["provider", "model", "purpose"]),
  emailsSent: counter("emails_sent_total", "Emails sent", ["provider", "outcome"]),
  emailEvents: counter("email_events_total", "Email opens/clicks", ["event"]),
  agentRuns: counter("agent_runs_total", "Agent runs", ["type", "status"]),
  queueJobs: counter("queue_jobs_total", "Queue jobs processed", ["queue", "outcome"]),
  queueDepth: new client.Gauge({ name: "jobagent_queue_depth", help: "Waiting jobs per queue", labelNames: ["queue", "state"], registers: [registry] }),
};
