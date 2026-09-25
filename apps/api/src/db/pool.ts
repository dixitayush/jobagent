import pg from "pg";
import pgvector from "pgvector/pg";
import { env } from "../config/env";
import { logger } from "../lib/logger";

// Return NUMERIC and BIGINT as JS numbers (counts, scores and years are well within range).
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => (v === null ? null : Number(v)));

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  idleTimeoutMillis: 30_000,
  statement_timeout: 30_000,
});

pool.on("error", (err) => logger.error({ err }, "postgres pool error"));

export type Queryable = Pick<pg.PoolClient, "query">;

export async function query<R extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
  db: Queryable = pool,
): Promise<R[]> {
  const res = await db.query<R>(text, params);
  return res.rows;
}

export async function queryOne<R extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
  db: Queryable = pool,
): Promise<R | null> {
  const rows = await query<R>(text, params, db);
  return rows[0] ?? null;
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export const toVectorSql = (v: number[]) => pgvector.toSql(v) as string;
