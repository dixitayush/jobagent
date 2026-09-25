import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool";
import { logger } from "../lib/logger";

const here = path.dirname(fileURLToPath(import.meta.url));
// src/db → ../../migrations in dev; dist → ../migrations in the built image.
const candidates = [path.resolve(here, "../../migrations"), path.resolve(here, "../migrations")];

async function migrationsDir(): Promise<string> {
  for (const dir of candidates) {
    try {
      await readdir(dir);
      return dir;
    } catch {
      /* try next */
    }
  }
  throw new Error(`migrations directory not found (looked in ${candidates.join(", ")})`);
}

/** Forward-only SQL migrations, applied in filename order under an advisory lock. */
export async function migrate(): Promise<string[]> {
  const dir = await migrationsDir();
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock(727274)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const done = new Set((await client.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(dir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        applied.push(file);
        logger.info({ migration: file }, "migration applied");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(727274)").catch(() => undefined);
    client.release();
  }
  return applied;
}

const isMain = /[\\/]migrate\.(ts|js)$/.test(process.argv[1] ?? "");
if (isMain) {
  migrate()
    .then((applied) => {
      logger.info({ count: applied.length }, "migrations complete");
      return pool.end();
    })
    .catch((err) => {
      logger.error({ err }, "migration failed");
      process.exit(1);
    });
}
