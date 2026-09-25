"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentRunStatus,
  AuthConfig,
  CandidateProfile,
  FeatureFlag,
  JobCard,
  JobDetails,
  JobListQuery,
  JobSource,
  Location,
  Me,
  NotificationItem,
  NotificationSettings,
  Overview,
  PlatformSettings,
  Portal,
  Preferences,
  Resume,
} from "@jobagent/shared";
import { ApiError, del, get, post, put, toQuery } from "./api";

export const keys = {
  me: ["me"] as const,
  overview: ["overview"] as const,
  profile: ["profile"] as const,
  resumes: ["resumes"] as const,
  preferences: ["preferences"] as const,
  locations: ["locations"] as const,
  sources: ["sources"] as const,
  portals: ["portals"] as const,
  jobs: (q: Partial<JobListQuery>) => ["jobs", q] as const,
  job: (id: string) => ["job", id] as const,
  notificationSettings: ["notification-settings"] as const,
  notifications: ["notifications"] as const,
  agent: ["agent-status"] as const,
};

export const useAuthConfig = () => useQuery({ queryKey: ["auth-config"], queryFn: () => get<AuthConfig>("/auth/config"), staleTime: Infinity });

export const useMe = () =>
  useQuery({
    queryKey: keys.me,
    queryFn: () => get<Me>("/me"),
    retry: (count, err) => !(err instanceof ApiError && err.status === 401) && count < 2,
    staleTime: 60_000,
  });

export const useOverview = () => useQuery({ queryKey: keys.overview, queryFn: () => get<Overview>("/overview"), refetchInterval: 60_000 });
export const useProfile = () => useQuery({ queryKey: keys.profile, queryFn: () => get<CandidateProfile | null>("/profile") });
export const useResumes = (poll = false) =>
  useQuery({
    queryKey: keys.resumes,
    queryFn: () => get<Resume[]>("/resumes"),
    refetchInterval: (q) => (poll || q.state.data?.some((r) => r.status === "UPLOADED" || r.status === "PARSING") ? 2500 : false),
  });
export const usePreferences = () => useQuery({ queryKey: keys.preferences, queryFn: () => get<Preferences>("/preferences") });
export const useLocations = () => useQuery({ queryKey: keys.locations, queryFn: () => get<Location[]>("/locations"), staleTime: Infinity });
export const useSources = () => useQuery({ queryKey: keys.sources, queryFn: () => get<JobSource[]>("/sources"), refetchInterval: 30_000 });
export const usePortals = () => useQuery({ queryKey: keys.portals, queryFn: () => get<Portal[]>("/portals") });
export const useJobs = (q: Partial<JobListQuery>) =>
  useQuery({ queryKey: keys.jobs(q), queryFn: () => get<{ items: JobCard[]; total: number; page: number; pageSize: number }>(`/jobs${toQuery(q)}`), placeholderData: (prev) => prev });
export const useJob = (id: string) => useQuery({ queryKey: keys.job(id), queryFn: () => get<JobDetails>(`/jobs/${id}`) });
export const useNotificationSettings = () => useQuery({ queryKey: keys.notificationSettings, queryFn: () => get<NotificationSettings>("/notification-settings") });
export const useNotifications = () => useQuery({ queryKey: keys.notifications, queryFn: () => get<NotificationItem[]>("/notifications") });
export const useAgentStatus = (poll: boolean) => useQuery({ queryKey: keys.agent, queryFn: () => get<AgentRunStatus>("/agent/status"), refetchInterval: poll ? 3000 : false });

/** Save / dismiss / feedback with cache invalidation of every job list. */
export function useJobActions() {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["jobs"] });
    void qc.invalidateQueries({ queryKey: ["job"] });
    void qc.invalidateQueries({ queryKey: keys.overview });
  };
  return {
    save: useMutation({ mutationFn: ({ id, saved }: { id: string; saved: boolean }) => (saved ? post(`/jobs/${id}/save`) : del(`/jobs/${id}/save`)), onSuccess: refresh }),
    dismiss: useMutation({
      mutationFn: ({ id, dismissed, reason }: { id: string; dismissed: boolean; reason?: string }) => (dismissed ? post(`/jobs/${id}/dismiss`, { reason }) : del(`/jobs/${id}/dismiss`)),
      onSuccess: refresh,
    }),
    feedback: useMutation({ mutationFn: ({ id, helpful }: { id: string; helpful: boolean }) => post(`/jobs/${id}/feedback`, { helpful }) }),
    track: (type: string, jobId?: string) => void post("/interactions", { type, jobId }).catch(() => undefined),
  };
}

export const useAdmin = {
  overview: () => useQuery({ queryKey: ["admin", "overview"], queryFn: () => get<Record<string, unknown> & { queues: { queue: string; waiting: number; active: number; delayed: number; failed: number }[]; llmByModel: { model: string; purpose: string; calls: number; cost: number; avg_latency: number }[] }>("/admin/overview"), refetchInterval: 30_000 }),
  sources: () => useQuery({ queryKey: ["admin", "sources"], queryFn: () => get<AdminSource[]>("/admin/sources"), refetchInterval: 30_000 }),
  settings: () => useQuery({ queryKey: ["admin", "settings"], queryFn: () => get<PlatformSettings>("/admin/settings") }),
  flags: () => useQuery({ queryKey: ["admin", "flags"], queryFn: () => get<FeatureFlag[]>("/admin/flags") }),
  runs: () => useQuery({ queryKey: ["admin", "runs"], queryFn: () => get<AdminRun[]>("/admin/runs"), refetchInterval: 30_000 }),
};

export interface AdminSource {
  id: string;
  company: string;
  connectorType: string;
  sourceUrl: string;
  status: string;
  crawlIntervalMinutes: number;
  rateLimitPerMinute: number;
  subscribers: number;
  health: JobSource["health"];
}

export interface AdminRun {
  id: string;
  type: string;
  trigger: string;
  status: string;
  started_at: string;
  jobs_discovered: number;
  jobs_matched: number;
  tokens_used: number;
  estimated_cost: number;
  error: string | null;
  user_email: string | null;
  company: string | null;
}

export { put, post, del, get };
