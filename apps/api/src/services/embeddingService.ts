import { candidateEmbeddingText, embeddingProvider, jobEmbeddingText } from "../ai/embeddings";
import { query, toVectorSql } from "../db/pool";
import type { CandidateProfileData } from "@jobagent/shared";

interface JobEmbedRow {
  id: string;
  title: string;
  company: string;
  description: string;
  content_hash: string;
  required: string[] | null;
  preferred: string[] | null;
  existing_hash: string | null;
  existing_model: string | null;
}

/**
 * PRD §84: embeddings are only (re)generated for new jobs or when content changed, and only
 * when the active embedding model differs from the stored one.
 */
export async function embedJobs(jobIds: string[]): Promise<{ embedded: number; skipped: number }> {
  if (!jobIds.length) return { embedded: 0, skipped: 0 };
  const provider = await embeddingProvider();
  const rows = await query<JobEmbedRow>(
    `SELECT j.id, j.title, c.name AS company, j.description, j.content_hash,
            (SELECT array_agg(skill_name) FROM job_skills WHERE job_id = j.id AND requirement = 'REQUIRED') AS required,
            (SELECT array_agg(skill_name) FROM job_skills WHERE job_id = j.id AND requirement = 'PREFERRED') AS preferred,
            e.content_hash AS existing_hash, e.model AS existing_model
     FROM jobs j JOIN companies c ON c.id = j.company_id
     LEFT JOIN job_embeddings e ON e.job_id = j.id
     WHERE j.id = ANY($1::uuid[])`,
    [jobIds],
  );
  const todo = rows.filter((r) => r.existing_hash !== r.content_hash || r.existing_model !== provider.model);
  for (let i = 0; i < todo.length; i += 32) {
    const batch = todo.slice(i, i + 32);
    const vectors = await provider.embed(
      batch.map((r) => jobEmbeddingText({ title: r.title, company: r.company, requiredSkills: r.required ?? [], preferredSkills: r.preferred ?? [], description: r.description })),
    );
    for (let k = 0; k < batch.length; k++) {
      await query(
        `INSERT INTO job_embeddings (job_id, embedding, model, content_hash) VALUES ($1, $2, $3, $4)
         ON CONFLICT (job_id) DO UPDATE SET embedding = EXCLUDED.embedding, model = EXCLUDED.model, content_hash = EXCLUDED.content_hash`,
        [batch[k]!.id, toVectorSql(vectors[k]!), provider.model, batch[k]!.content_hash],
      );
    }
  }
  return { embedded: todo.length, skipped: rows.length - todo.length };
}

export async function embedCandidateProfile(ctx: { tenantId: string; userId: string }, profileId: string, profile: CandidateProfileData): Promise<void> {
  const provider = await embeddingProvider();
  const [vector] = await provider.embed([candidateEmbeddingText(profile)]);
  await query(
    `INSERT INTO candidate_embeddings (tenant_id, user_id, profile_id, embedding, model) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (profile_id) DO UPDATE SET embedding = EXCLUDED.embedding, model = EXCLUDED.model`,
    [ctx.tenantId, ctx.userId, profileId, toVectorSql(vector!), provider.model],
  );
}
