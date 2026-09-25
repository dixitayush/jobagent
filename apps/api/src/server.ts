import { createApp, createInternalApp } from "./app";
import { env } from "./config/env";
import { pool } from "./db/pool";
import { logger } from "./lib/logger";
import { closeQueues } from "./queue/queues";

const server = createApp().listen(env.PORT, () => logger.info({ port: env.PORT }, "api listening"));
const internal = createInternalApp().listen(env.INTERNAL_PORT, () => logger.info({ port: env.INTERNAL_PORT }, "internal api listening"));

async function shutdown(signal: string) {
  logger.info({ signal }, "api shutting down");
  server.close();
  internal.close();
  await closeQueues();
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
