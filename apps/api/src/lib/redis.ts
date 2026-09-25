import { Redis } from "ioredis";
import { env } from "../config/env";
import { logger } from "./logger";

/** BullMQ requires maxRetriesPerRequest=null on its connections. */
export function createRedis(name: string): Redis {
  const client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true, connectionName: `jobagent:${name}` });
  client.on("error", (err) => logger.warn({ err: err.message, conn: name }, "redis error"));
  return client;
}

let shared: Redis | null = null;
export function redis(): Redis {
  shared ??= createRedis("shared");
  return shared;
}

/** Tiny JSON cache helper (PRD §29: source metadata, locations, safe LLM responses). */
export async function cached<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  try {
    const hit = await redis().get(key);
    if (hit) return JSON.parse(hit) as T;
  } catch {
    /* cache unavailable → fall through to source of truth */
  }
  const value = await load();
  redis()
    .set(key, JSON.stringify(value), "EX", ttlSeconds)
    .catch(() => undefined);
  return value;
}

export async function invalidate(...keys: string[]): Promise<void> {
  if (keys.length) await redis().del(...keys).catch(() => undefined);
}
