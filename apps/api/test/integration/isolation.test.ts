/**
 * PRD §134: "A user must never be able to access another user's resume, matches,
 * preferences or another tenant's data. Test this explicitly."
 *
 * Needs Postgres + Redis (docker compose up -d db redis). Run: npm run test:integration
 */
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.INTEGRATION === "1";

describe.skipIf(!enabled)("tenant isolation (integration)", async () => {
  const { createApp } = await import("../../src/app");
  const { migrate } = await import("../../src/db/migrate");
  const { seed } = await import("../../src/db/seed");
  const { pool, query, queryOne } = await import("../../src/db/pool");
  const { closeQueues } = await import("../../src/queue/queues");
  const { redis } = await import("../../src/lib/redis");

  const app = createApp();
  const suffix = Date.now();
  const a = request.agent(app);
  const b = request.agent(app);
  let csrfA = "";
  let csrfB = "";
  let ctxA: { tenantId: string; userId: string };
  let resumeId = "";
  let jobId = "";
  let sourceId = "";

  const csrfOf = (res: request.Response) => {
    const cookies = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
    return cookies.find((c) => c.startsWith("ja_csrf="))!.split(";")[0]!.split("=")[1]!;
  };

  beforeAll(async () => {
    await migrate();
    await seed();
    const ra = await a.post("/api/v1/auth/dev").send({ email: `a-${suffix}@example.com`, name: "User A" }).expect(200);
    const rb = await b.post("/api/v1/auth/dev").send({ email: `b-${suffix}@example.com`, name: "User B" }).expect(200);
    csrfA = csrfOf(ra);
    csrfB = csrfOf(rb);
    ctxA = { tenantId: ra.body.tenantId, userId: ra.body.id };
    expect(ra.body.tenantId).not.toBe(rb.body.tenantId);

    // Seed user A's private data directly.
    const company = await queryOne<{ id: string }>("INSERT INTO companies (name, normalized_name) VALUES ($1, $1) RETURNING id", [`iso-co-${suffix}`]);
    const sc = await queryOne<{ id: string }>(
      "INSERT INTO source_connectors (company_id, connector_type, source_url, canonical_key, source_identifier) VALUES ($1, 'GREENHOUSE', 'https://boards.greenhouse.io/x', $2, 'x') RETURNING id",
      [company!.id, `GREENHOUSE:iso-${suffix}`],
    );
    const js = await queryOne<{ id: string }>("INSERT INTO job_sources (tenant_id, user_id, source_connector_id, display_name) VALUES ($1,$2,$3,'Iso') RETURNING id", [ctxA.tenantId, ctxA.userId, sc!.id]);
    sourceId = js!.id;
    const job = await queryOne<{ id: string }>(
      `INSERT INTO jobs (source_connector_id, company_id, source, source_job_id, canonical_url, title, normalized_title, url, content_hash, dedupe_hash, description_hash)
       VALUES ($1,$2,'GREENHOUSE','1','https://x/1','Private Job','private job','https://x/1','h','d-${suffix}','dh') RETURNING id`,
      [sc!.id, company!.id],
    );
    jobId = job!.id;
    await query(
      `INSERT INTO job_matches (tenant_id, user_id, job_id, profile_version, job_version, prefs_hash, score, rank_score, match_level, confidence, result, evaluated_by)
       VALUES ($1,$2,$3,1,1,'p',90,90,'VERY_STRONG',0.9,'{}','RULES')`,
      [ctxA.tenantId, ctxA.userId, jobId],
    );
    const resume = await queryOne<{ id: string }>(
      "INSERT INTO resumes (tenant_id, user_id, version, file_name, mime_type, size_bytes, storage_key, sha256) VALUES ($1,$2,1,'a.pdf','application/pdf',1,'resumes/none','x') RETURNING id",
      [ctxA.tenantId, ctxA.userId],
    );
    resumeId = resume!.id;
  });

  afterAll(async () => {
    await query("DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM users WHERE email LIKE $1)", [`%-${suffix}@example.com`]);
    await query("DELETE FROM companies WHERE name = $1", [`iso-co-${suffix}`]);
    await closeQueues();
    await redis().quit();
    await pool.end();
  });

  it("owner can see their own data", async () => {
    await a.get(`/api/v1/jobs/${jobId}`).expect(200);
    const list = await a.get("/api/v1/jobs?view=matches").expect(200);
    expect(list.body.items.map((j: { id: string }) => j.id)).toContain(jobId);
  });

  it("other users cannot read or modify it", async () => {
    await b.get(`/api/v1/jobs/${jobId}`).expect(404);
    await b.post(`/api/v1/jobs/${jobId}/save`).set("x-csrf-token", csrfB).expect(404);
    await b.post(`/api/v1/jobs/${jobId}/dismiss`).set("x-csrf-token", csrfB).send({}).expect(404);
    await b.get(`/api/v1/resumes/${resumeId}/download-url`).expect(404);
    await b.delete(`/api/v1/resumes/${resumeId}`).set("x-csrf-token", csrfB).expect(404);
    await b.put(`/api/v1/sources/${sourceId}`).set("x-csrf-token", csrfB).send({ status: "PAUSED" }).expect(404);
    await b.delete(`/api/v1/sources/${sourceId}`).set("x-csrf-token", csrfB).expect(404);
    const list = await b.get("/api/v1/jobs?view=matches").expect(200);
    expect(list.body.total).toBe(0);
    const resumes = await b.get("/api/v1/resumes").expect(200);
    expect(resumes.body).toEqual([]);
  });

  it("ignores client-supplied tenant ids", async () => {
    const res = await b.put("/api/v1/me").set("x-csrf-token", csrfB).send({ tenantId: ctxA.tenantId, userId: ctxA.userId, name: "B renamed" }).expect(200);
    expect(res.body.tenantId).not.toBe(ctxA.tenantId);
    expect(res.body.id).not.toBe(ctxA.userId);
  });

  it("requires auth, CSRF and admin role where applicable", async () => {
    await request(app).get("/api/v1/me").expect(401);
    await a.put("/api/v1/me").send({ name: "x" }).expect(403); // missing CSRF header
    await b.get("/api/v1/admin/overview").expect(403);
    expect(csrfA).toBeTruthy();
  });
});
