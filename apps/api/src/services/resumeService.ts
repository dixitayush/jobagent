import mammoth from "mammoth";
import { extractText as extractPdfText, getDocumentProxy } from "unpdf";
import type { CandidateProfile, CandidateProfileData, Resume } from "@jobagent/shared";
import { extractResumeProfile } from "../ai/resumeExtractor";
import { query, queryOne, withTransaction } from "../db/pool";
import type { TenantContext } from "../db/tenant";
import { badRequest, notFound } from "../lib/errors";
import { sha256 } from "../lib/hash";
import { logger } from "../lib/logger";
import { enqueue } from "../queue/queues";
import { planLimits } from "../settings/platformSettings";
import { storage } from "../storage/storage";
import { finishRun, runEvent, startRun } from "./agentRuns";
import { embedCandidateProfile } from "./embeddingService";
import { skillIds } from "./referenceData";

export const SUPPORTED_TYPES: Record<string, "pdf" | "docx" | "txt"> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
};

/** Verifies magic bytes so a renamed binary can't masquerade as a resume. */
export function detectKind(buf: Buffer, mime: string, fileName: string): "pdf" | "docx" | "txt" | null {
  const ext = fileName.toLowerCase().split(".").pop();
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (buf[0] === 0x50 && buf[1] === 0x4b && (ext === "docx" || SUPPORTED_TYPES[mime] === "docx")) return "docx";
  if ((ext === "txt" || mime === "text/plain") && !buf.subarray(0, 4096).includes(0)) return "txt";
  return null;
}

export async function extractResumeText(buf: Buffer, kind: "pdf" | "docx" | "txt"): Promise<string> {
  if (kind === "pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractPdfText(pdf, { mergePages: true });
    return text;
  }
  if (kind === "docx") return (await mammoth.extractRawText({ buffer: buf })).value;
  return buf.toString("utf8");
}

interface ResumeRow {
  id: string;
  version: number;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  status: Resume["status"];
  is_active: boolean;
  error: string | null;
  created_at: Date;
  storage_key: string;
}

export const toResume = (r: ResumeRow): Resume => ({
  id: r.id,
  version: r.version,
  fileName: r.file_name,
  mimeType: r.mime_type,
  sizeBytes: r.size_bytes,
  status: r.status,
  isActive: r.is_active,
  error: r.error,
  createdAt: r.created_at.toISOString(),
});

export async function listResumes(ctx: TenantContext): Promise<Resume[]> {
  const rows = await query<ResumeRow>("SELECT * FROM resumes WHERE tenant_id = $1 AND user_id = $2 ORDER BY version DESC", [ctx.tenantId, ctx.userId]);
  return rows.map(toResume);
}

export async function getResumeRow(ctx: TenantContext, id: string): Promise<ResumeRow> {
  const row = await queryOne<ResumeRow>("SELECT * FROM resumes WHERE id = $1 AND tenant_id = $2 AND user_id = $3", [id, ctx.tenantId, ctx.userId]);
  if (!row) throw notFound("Resume not found");
  return row;
}

export async function uploadResume(ctx: TenantContext, plan: string, file: { buffer: Buffer; originalname: string; mimetype: string; size: number }): Promise<Resume> {
  const kind = detectKind(file.buffer, file.mimetype, file.originalname);
  if (!kind) throw badRequest("Unsupported file. Upload a PDF, DOCX or TXT resume.");
  const limits = await planLimits(plan);
  const fileName = file.originalname.replace(/[^\w.\- ]+/g, "_").slice(0, 120);
  const mime = Object.entries(SUPPORTED_TYPES).find(([, k]) => k === kind)![0];

  const row = await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`resume:${ctx.userId}`]);
    const next = (await client.query<{ v: number }>("SELECT COALESCE(max(version), 0) + 1 AS v FROM resumes WHERE user_id = $1", [ctx.userId])).rows[0]!.v;
    const key = `resumes/${ctx.tenantId}/${ctx.userId}/${next}-${sha256(file.buffer).slice(0, 16)}`;
    await storage().put(key, file.buffer);
    await client.query("UPDATE resumes SET is_active = false WHERE tenant_id = $1 AND user_id = $2", [ctx.tenantId, ctx.userId]);
    const inserted = (
      await client.query<ResumeRow>(
        `INSERT INTO resumes (tenant_id, user_id, version, file_name, mime_type, size_bytes, storage_key, sha256)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [ctx.tenantId, ctx.userId, next, fileName, mime, file.size, key, sha256(file.buffer)],
      )
    ).rows[0]!;
    // Keep only the configured number of versions (plan limit).
    const stale = (
      await client.query<{ id: string; storage_key: string }>(
        "SELECT id, storage_key FROM resumes WHERE tenant_id = $1 AND user_id = $2 ORDER BY version DESC OFFSET $3",
        [ctx.tenantId, ctx.userId, Math.max(1, limits.maxResumeVersions)],
      )
    ).rows;
    for (const s of stale) {
      await client.query("DELETE FROM resumes WHERE id = $1", [s.id]);
      await storage().delete(s.storage_key).catch(() => undefined);
    }
    return inserted;
  });
  await enqueue("resume-process", { tenantId: ctx.tenantId, userId: ctx.userId, resumeId: row.id }, { jobId: `resume:${row.id}` });
  return toResume(row);
}

/** Deletes a resume, its profiles and all derived embeddings (PRD §65 — cascade). */
export async function deleteResume(ctx: TenantContext, id: string): Promise<void> {
  const row = await getResumeRow(ctx, id);
  await withTransaction(async (client) => {
    await client.query("DELETE FROM resumes WHERE id = $1 AND tenant_id = $2 AND user_id = $3", [id, ctx.tenantId, ctx.userId]);
    if (row.is_active) {
      await client.query(
        `UPDATE resumes SET is_active = true WHERE id = (SELECT id FROM resumes WHERE tenant_id = $1 AND user_id = $2 ORDER BY version DESC LIMIT 1)`,
        [ctx.tenantId, ctx.userId],
      );
      await client.query(
        `UPDATE candidate_profiles SET is_active = true WHERE id = (
           SELECT cp.id FROM candidate_profiles cp WHERE cp.tenant_id = $1 AND cp.user_id = $2 ORDER BY cp.version DESC LIMIT 1)`,
        [ctx.tenantId, ctx.userId],
      );
    }
  });
  await storage().delete(row.storage_key).catch((err) => logger.warn({ err: (err as Error).message }, "failed to delete resume object"));
}

/* ───────────────────────────── Candidate profiles ───────────────────────────── */

interface ProfileRow {
  id: string;
  version: number;
  resume_id: string | null;
  profile: CandidateProfileData;
  normalized_skills: string[];
  edited_by_user: boolean;
  created_at: Date;
  updated_at: Date;
  has_embedding: boolean;
}

export async function getActiveProfile(ctx: TenantContext): Promise<CandidateProfile | null> {
  const r = await queryOne<ProfileRow>(
    `SELECT cp.*, EXISTS (SELECT 1 FROM candidate_embeddings ce WHERE ce.profile_id = cp.id) AS has_embedding
     FROM candidate_profiles cp WHERE cp.tenant_id = $1 AND cp.user_id = $2 AND cp.is_active ORDER BY cp.version DESC LIMIT 1`,
    [ctx.tenantId, ctx.userId],
  );
  if (!r) return null;
  return {
    id: r.id,
    version: r.version,
    resumeId: r.resume_id,
    profile: r.profile,
    normalizedSkills: r.normalized_skills,
    editedByUser: r.edited_by_user,
    hasEmbedding: r.has_embedding,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

/**
 * Every change creates a new immutable profile version (PRD §87) so matches stay
 * reproducible and the matching cache can key on profile version (PRD §86).
 */
export async function saveProfileVersion(
  ctx: TenantContext,
  profile: CandidateProfileData,
  opts: { resumeId: string | null; editedByUser: boolean; promptVersion: string | null },
): Promise<string> {
  const ids = await skillIds();
  const profileId = await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`profile:${ctx.userId}`]);
    const next = (await client.query<{ v: number }>("SELECT COALESCE(max(version), 0) + 1 AS v FROM candidate_profiles WHERE user_id = $1", [ctx.userId])).rows[0]!.v;
    await client.query("UPDATE candidate_profiles SET is_active = false WHERE tenant_id = $1 AND user_id = $2", [ctx.tenantId, ctx.userId]);
    const id = (
      await client.query<{ id: string }>(
        `INSERT INTO candidate_profiles (tenant_id, user_id, resume_id, version, profile, normalized_skills, years_of_experience, seniority, edited_by_user, prompt_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [ctx.tenantId, ctx.userId, opts.resumeId, next, JSON.stringify(profile), profile.skills, profile.yearsOfExperience, profile.seniority, opts.editedByUser, opts.promptVersion],
      )
    ).rows[0]!.id;
    for (const s of profile.skills) {
      await client.query(
        `INSERT INTO candidate_skills (tenant_id, user_id, profile_id, skill_id, skill_name, source) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [ctx.tenantId, ctx.userId, id, ids.get(s.toLowerCase()) ?? null, s, opts.editedByUser ? "USER" : "EXTRACTED"],
      );
    }
    return id;
  });
  await embedCandidateProfile(ctx, profileId, profile);
  return profileId;
}

/** Worker: parse → structured extraction (LLM or rules) → profile version → embedding → rematch. */
export async function processResume(ctx: TenantContext, resumeId: string): Promise<void> {
  const row = await getResumeRow(ctx, resumeId);
  const runId = await startRun("RESUME", { ...ctx, trigger: "UPLOAD" });
  await query("UPDATE resumes SET status = 'PARSING', error = NULL WHERE id = $1", [resumeId]);
  try {
    const buf = await storage().get(row.storage_key);
    const kind = detectKind(buf, row.mime_type, row.file_name);
    if (!kind) throw new Error("Unsupported file type");
    const text = (await extractResumeText(buf, kind)).replace(/\u0000/g, "").trim();
    if (text.length < 50) throw new Error("Could not extract text from this resume. If it is a scanned image, upload a text-based PDF or DOCX.");
    const extraction = await extractResumeProfile(text, { agentRunId: runId, ...ctx });
    await saveProfileVersion(ctx, extraction.profile, { resumeId, editedByUser: false, promptVersion: extraction.promptVersion });
    await query("UPDATE resumes SET status = 'PARSED' WHERE id = $1", [resumeId]);
    await runEvent(runId, "RESUME_PARSED", { method: extraction.method, skills: extraction.profile.skills.length });
    await finishRun(runId, "RESUME", "SUCCEEDED", { tokensUsed: extraction.tokens, estimatedCost: extraction.cost });
    await enqueue("match", { ...ctx, trigger: "PROFILE_UPDATED" }, { jobId: `match:${ctx.userId}:${Date.now()}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await query("UPDATE resumes SET status = 'FAILED', error = $2 WHERE id = $1", [resumeId, message.slice(0, 500)]);
    await finishRun(runId, "RESUME", "FAILED", {}, message);
    throw err;
  }
}
