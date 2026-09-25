import { pino } from "pino";
import { env } from "../config/env";

/**
 * Structured JSON logger (PRD §62). Redacts credentials and resume content —
 * never log OAuth tokens, API keys, cookies or raw resume text.
 */
export const logger = pino({
  level: env.NODE_ENV === "test" ? "silent" : env.LOG_LEVEL,
  base: { service: env.SERVICE_NAME },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: { level: (label) => ({ level: label.toUpperCase() }) },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'res.headers["set-cookie"]',
      "*.credential",
      "*.token",
      "*.apiKey",
      "*.password",
      "*.resumeText",
      "*.rawText",
      "*.accessToken",
      "*.refreshToken",
    ],
    censor: "[REDACTED]",
  },
});

export type Logger = typeof logger;
