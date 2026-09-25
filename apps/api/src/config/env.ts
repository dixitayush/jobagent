import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// One .env at the repo root configures every app. Containers get it via compose `env_file`;
// in local dev we load it here (existing process env always wins).
const repoEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../.env");
if (existsSync(repoEnv) && process.env.NODE_ENV !== "test") {
  const before = { ...process.env };
  process.loadEnvFile(repoEnv);
  Object.assign(process.env, before);
}

const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** Deployment environment. Security guards key on this (the local Docker stack runs NODE_ENV=production). */
  APP_ENV: z.enum(["local", "production"]).default("local"),
  SERVICE_NAME: z.string().default("api"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  PORT: z.coerce.number().int().default(4000),
  /** Internal API + /metrics. Never expose publicly. */
  INTERNAL_PORT: z.coerce.number().int().default(4001),
  INTERNAL_API_TOKEN: z.string().min(16).default("dev-internal-token-change-me"),
  WORKER_METRICS_PORT: z.coerce.number().int().default(9464),

  APP_URL: z.string().url().default("http://localhost:3000"),
  API_PUBLIC_URL: z.string().url().default("http://localhost:3000"),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),

  DATABASE_URL: z.string().default("postgres://jobagent:jobagent@localhost:5435/jobagent"),
  DATABASE_POOL_MAX: z.coerce.number().int().default(10),
  REDIS_URL: z.string().default("redis://localhost:6381"),

  JWT_SECRET: z.string().min(32).default("dev-jwt-secret-change-me-dev-jwt-secret-change-me"),
  SESSION_TTL_HOURS: z.coerce.number().int().default(168),
  GOOGLE_CLIENT_ID: z.string().optional(),
  AUTH_DEV_LOGIN: bool,
  ADMIN_EMAILS: z.string().default(""),

  /** 32-byte key, base64. Used for AES-256-GCM encryption of stored resumes. */
  ENCRYPTION_KEY: z.string().default("ZGV2LWVuY3J5cHRpb24ta2V5LTMyLWJ5dGVzLWxvbmc="),
  STORAGE_LOCAL_DIR: z.string().default("./.data/uploads"),
  MAX_RESUME_BYTES: z.coerce.number().int().default(5 * 1024 * 1024),

  LLM_PROVIDER: z.enum(["anthropic", "openai", "gemini", "none"]).default("openai"),
  LLM_MODEL: z.string().default("gpt-5"),
  LLM_SMALL_MODEL: z.string().default("gpt-5-mini"),
  /** Reasoning effort for the strong (match evaluation) and small (extraction) tiers. */
  LLM_REASONING_EFFORT: z.enum(["minimal", "low", "medium", "high"]).default("medium"),
  LLM_SMALL_REASONING_EFFORT: z.enum(["minimal", "low", "medium", "high"]).default("low"),
  LLM_TIMEOUT_MS: z.coerce.number().int().default(180000),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  EMBEDDING_PROVIDER: z.enum(["openai", "gemini", "local"]).default("openai"),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),

  EMAIL_PROVIDER: z.enum(["resend", "smtp", "console"]).default("resend"),
  EMAIL_FROM: z.string().default("AI Job Agent <jobs@localhost>"),
  SMTP_URL: z.string().default("smtp://localhost:1026"),
  RESEND_API_KEY: z.string().optional(),

  CRAWLER_USER_AGENT: z.string().default("JobAgentBot/1.0 (+https://example.com/bot)"),
  CRAWL_TIMEOUT_MS: z.coerce.number().int().default(20000),
  CRAWL_MAX_BYTES: z.coerce.number().int().default(8 * 1024 * 1024),
  /** Only for local fixture testing; never enable in production. */
  CRAWL_ALLOW_PRIVATE_NETWORKS: bool,

  LINKEDIN_PARTNER_API_KEY: z.string().optional(),
  NAUKRI_PARTNER_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

function load(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error("Invalid environment configuration", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment configuration");
  }
  const env = parsed.data;
  if (env.APP_ENV === "production") {
    const insecure: string[] = [];
    if (!env.APP_URL.startsWith("https://")) insecure.push("APP_URL must be https");
    if (env.JWT_SECRET.startsWith("dev-")) insecure.push("JWT_SECRET");
    if (env.INTERNAL_API_TOKEN.startsWith("dev-")) insecure.push("INTERNAL_API_TOKEN");
    if (env.ENCRYPTION_KEY === "ZGV2LWVuY3J5cHRpb24ta2V5LTMyLWJ5dGVzLWxvbmc=") insecure.push("ENCRYPTION_KEY");
    if (env.AUTH_DEV_LOGIN) insecure.push("AUTH_DEV_LOGIN must be false");
    if (env.CRAWL_ALLOW_PRIVATE_NETWORKS) insecure.push("CRAWL_ALLOW_PRIVATE_NETWORKS must be false");
    if (insecure.length) throw new Error(`Refusing to start with APP_ENV=production and insecure config: ${insecure.join(", ")}`);
  }
  return env;
}

export const env = load();

export const adminEmails = new Set(
  env.ADMIN_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

export const EMBEDDING_DIM = 1536;
