# AI Job Agent

A multi-tenant job discovery and matching agent built from [`prd.md`](./prd.md). Users sign in with Google, upload a resume, choose locations and companies. The agent then crawls those career pages and ranks new jobs against the resume. At 10:00 and 21:00 in each user's timezone it emails the strongest matches, each with a score and an explanation.

```
Internet → Traefik (gateway/, TLS) → Caddy :80 ─┬─ /api, /health, /ready → api (Express)
                                                └─ everything else     → web (Next.js)
api ─┐                                     worker (BullMQ) ── crawl → normalize → dedupe → embed
     ├── Postgres 16 + pgvector            ├── LangGraph matching agent (rules → vectors → LLM → rank)
     └── Redis (queues, cache, limits)     └── LangGraph digest agent → email
scheduler (one tick/min cluster-wide) ── only enqueues work
```

## Stack

| Layer | Choice |
| --- | --- |
| Frontend | Next.js 15 (App Router), React 19, TypeScript strict, Tailwind, shadcn/ui-style components, TanStack Query, React Hook Form + Zod |
| Backend | Node.js 22, **Express 5**, TypeScript, Zod validation, OpenAPI generated from shared schemas |
| Agent / AI | **LangGraph** (`StateGraph`) orchestration; **LangChain** chat models with structured output. Primary provider **OpenAI** (`ChatOpenAI`, `OpenAIEmbeddings`); Anthropic and Gemini are switchable alternatives. |
| Data | PostgreSQL 16 + pgvector (HNSW), SQL migrations |
| Queues | Redis + BullMQ (retries, backoff, dead-letter queue, per-queue concurrency) |
| Email | **Resend** (official SDK, idempotent sends). SMTP and a console logger remain as alternatives. |
| Runtime | Docker only: one compose file for local, one for the VPS. No Kubernetes, no cloud services. |

Monorepo layout:

```
apps/api      Express API + workers + scheduler (one image, three commands)
  src/agent       LangGraph graphs (matchingGraph, digestGraph) + least-privilege tools
  src/ai          LangChain providers, gateway (cost/latency/caching), prompts, extractors
  src/connectors  Greenhouse, Lever, Ashby, SmartRecruiters, Workday, JSON-LD generic, portals
  src/crawl       SSRF-safe HTTP client, robots.txt, per-host rate limiting
  src/domain      pure logic: skills taxonomy, locations, normalization, scoring, schedules
  migrations/     SQL schema (tenants → users → … → audit_logs)
  test/           unit + connector fixture + integration (tenant isolation) tests
  eval/           labelled matching dataset + Precision@k / NDCG / FPR runner
apps/web      Next.js dashboard
packages/shared  Zod API contract shared by both apps
deploy/Caddyfile, Dockerfile, docker-compose.yml, docker-compose.prod.yml, deploy.sh, deploy-local.sh
```

## Configuration: one `.env`

Every app reads the single root `.env` (see [`.env.example`](./.env.example), which documents every key). Compose passes it to each container and rewrites only the in-network hostnames.

The keys you'll normally set:

| Key | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Google OAuth web client. Authorized JS origins: `http://localhost:3000`, `http://localhost:8081`, `https://<JOBAGENT_HOST>` |
| `OPENAI_API_KEY` | Chat models and embeddings. Without it the agent runs on rules plus free local embeddings. Anthropic and Gemini are optional alternatives via `LLM_PROVIDER`. |
| `LLM_MODEL` / `LLM_SMALL_MODEL` | Strong model for borderline matches (default `gpt-5`). Small model for resume parsing and job understanding (default `gpt-5-mini`, the PRD §49 cost tier). |
| `LLM_REASONING_EFFORT` / `LLM_SMALL_REASONING_EFFORT` | GPT-5 reasoning effort per tier (defaults `medium` / `low`). |
| `EMBEDDING_PROVIDER` | `openai` (default, `text-embedding-3-small` at 1536 dims), `gemini`, or `local` (free, offline). Switching models re-embeds jobs and profiles automatically. |
| `RESEND_API_KEY`, `EMAIL_FROM` | Digest delivery through Resend. `EMAIL_FROM` must use a domain verified in Resend. Without a key, emails are only logged. |
| `ADMIN_EMAILS` | Who gets the admin dashboard |

`./deploy.sh` generates `JWT_SECRET`, `INTERNAL_API_TOKEN`, `ENCRYPTION_KEY` and the Postgres password on the server. **Back up the server `.env`**: `ENCRYPTION_KEY` is required to decrypt stored resumes.

## Run locally

**Option A: full Docker stack** (same images as production):

```bash
./deploy-local.sh            # http://localhost:8081
./deploy-local.sh logs | down | status | reset
```

**Option B: hot-reload dev** (infrastructure in Docker, apps on the host):

```bash
cp .env.example .env
./deploy-local.sh infra      # Postgres :5435, Redis :6381
npm install
npm run migrate -w @jobagent/api && npm run seed
npm run dev                  # api :4000, worker, scheduler, web :3000
```

Sign in with the local dev form, which is enabled when `AUTH_DEV_LOGIN=true` and never in production. Or use Google once `GOOGLE_CLIENT_ID` is set. Try `https://boards.greenhouse.io/stripe` as a first source.

Host ports (5435, 6381, 8081) avoid clashing with Chaibook and Hideout running at the same time.

## Deploy to the VPS

This uses the same pattern as the other apps in `ayush-work` (see `../DEPLOYMENT.md`). Traefik in `gateway/` is the only thing with public ports. This stack's Caddy joins the external `proxy` network; api, web, db and redis stay on `jobagent_internal`.

1. DNS: add an A record `jobagent.ayushdixit.work → 200.234.41.108`.
2. Gateway: `../setup.sh` has already run on the VPS (Traefik plus the `proxy` network).
3. From your laptop:

   ```bash
   ./deploy.sh
   # or: JOBAGENT_HOST=jobs.example.com OPENAI_API_KEY=... RESEND_API_KEY=... GOOGLE_CLIENT_ID=... ./deploy.sh
   ```

   It rsyncs the repo to `/opt/shurbe-data/jobagent` (never your `.env`) and re-runs itself on the server. There it fills in `.env` (generating secrets), checks Traefik is up, and builds the images. It then starts migrate → api/worker/scheduler → web → caddy and waits for health.

Day-2 operations:

```bash
cd /opt/shurbe-data/jobagent
docker compose -f docker-compose.prod.yml logs -f api worker scheduler
docker compose -f docker-compose.prod.yml exec -T db pg_dump -U jobagent jobagent | gzip > jobagent-$(date +%F).sql.gz
./deploy.sh      # redeploy after pulling/rsyncing new code
```

`docker compose down` keeps the volumes. Only `down -v` wipes Postgres, the queues and uploaded resumes.

## How the agent works

1. **Global discovery (PRD §16, §81).** A career page is one `source_connectors` row, no matter how many users follow it. It is crawled once and matched for everyone.
   - **Connectors:** specialized JSON APIs (Greenhouse, Lever, Ashby, SmartRecruiters, Workday), then schema.org `JobPosting` JSON-LD for custom pages, iCIMS, Taleo and SuccessFactors. Validation also detects ATS boards embedded in custom career pages.
   - **Incremental crawling:** ETag / Last-Modified, a content hash of each listing, and detail pages fetched only for new jobs.
   - **Failures:** a failing source backs off 1m → 5m → 30m → exponential. After 4 consecutive failures it is marked `DEGRADED` and admins are alerted.
   - **Portals:** LinkedIn and Naukri are never scraped. They stay disabled until an official partner feed is configured.
2. **Normalize → dedupe → freshness (§17–19).**
   - Canonical job schema.
   - Duplicates are caught by source id, canonical URL, or `SHA256(company + title + location + description)`.
   - Freshness is NEW, RECENT, EXISTING, UPDATED, CLOSED or EXPIRED. It is based on when we first saw the job, so old reposts don't look new.
3. **Matching agent, a LangGraph `StateGraph`:** `loadContext → retrieve → score → [llmRefine] → persist`.
   - **Hard filters** in SQL and code: location hierarchy (city, state, country, remote-by-country), employment type, work mode, experience gap, blocked companies, dismissed jobs.
   - **pgvector retrieval** of the top N jobs against the candidate embedding.
   - **Deterministic score** with the PRD §24 weights: skills 30, experience 20, title 15, semantic 15, location 10, seniority 5, work mode 5. It distinguishes required, preferred and inferred skills and adds a bounded personalization boost, which only applies after 10 or more interaction signals.
   - **LLM refinement for borderline scores only (60–85, capped per run):**
     - The small model extracts job requirements. This is cached globally by description hash, so every user tracking the job shares one call.
     - The strong model returns structured *evidence*, and the deterministic formula turns it into the final score. The LLM never picks the score.
     - Results are cached by candidate profile version + job version + preferences hash.
4. **Digest agent (LangGraph):** eligibility → refresh matches → select top N NEW jobs → compose → dispatch.
   - Idempotent: `UNIQUE(user_id, notification_window)` and `UNIQUE(user_id, job_id, notification_window)`.
   - A job is re-sent only if its content changed. Resend also receives an idempotency key per digest, so a queue retry can't send the same digest twice.
   - The email is responsive and table-based. It shows match level, score, matched skills, gaps, experience and location, with signed click/open tracking.
5. **Run agent now (manual run).** The **Run agent now** button on the Dashboard and Notifications pages runs the whole pipeline for that user on demand:
   - Crawls the user's sources. Sources checked in the last 10 minutes are reused, not re-crawled.
   - Embeds new jobs and matches them against the profile.
   - Emails any new matches straight away.

   The same no-repeat rule applies, so jobs already emailed aren't sent again. Progress is shown live and stored in Redis at `agent:user:{id}:state`. Limits: one run at a time per user and 3 runs per hour. Manual emails don't count toward the scheduled-digest quota. API: `POST/GET /api/v1/agent/run-now`.
6. **Graceful degradation (§130).** With no LLM key, or when a provider fails, matching falls back to rules plus vectors. A failed email retries with backoff. One failed crawler never blocks the others.

How the LLM harness gets accurate output from GPT-5:

- **Prompts (v2):** each prompt has sections for role, rules, a step-by-step decision procedure, worked examples for hard cases, a self-check before answering, and an output contract. Structured outputs enforce the JSON schema. Reasoning depth comes from `reasoning_effort`, and `verbosity` is `low`.
- **Prompt caching:** the long static instructions come first, then the candidate's profile and memory (identical for every job in a run), and the job last. Every job after the first in a run reuses the cached prefix at the cached-input price, which is 90% cheaper. `prompt_cache_key` routes a user's requests to the same cache.
- **"Any one of" requirements:** "Java, Go or Ruby" is one requirement met by any member. The unused alternatives are not reported as gaps.
- **Verification:** matched skills must exist in the candidate profile (otherwise they are demoted to inferred), and reported gaps must appear in the job posting. Unsupported claims are dropped.
- **Stored memory:** a per-user summary lives in the `agent_memory` table, rebuilt from saved, applied and dismissed jobs (with reasons) and thumbs feedback. For each job, pgvector also recalls the user's decisions on the most similar past jobs. The model reports whether the job fits those preferences. That nudges the score by at most −2 / +1, and only after 3 or more signals. Memory never overrides the resume or hard filters.
- **Retries:** LangChain re-requests when structured output fails to parse.

Every LLM call is recorded in `llm_requests` with provider, model, input/cached/output tokens, latency, estimated cost and prompt version. Prompts are versioned (`resume_parser_v1`, `job_understanding_v1`, `job_match_v1`). Resume and job text is sent as delimited, sanitized data, and contact details are redacted before a resume leaves the server.

## Security and privacy

- **Tenant isolation:** every tenant-owned query filters on `tenant_id` and `user_id` taken from the session, never from the client. `npm run test:integration` checks this.
- **Sessions:** httpOnly `SameSite=Lax` session cookie plus a double-submit CSRF header. Google ID tokens are verified server-side, and no OAuth access tokens are stored.
- **SSRF protection:** http/https only, a port allow-list, blocked private, loopback and metadata ranges checked at connect time (so DNS rebinding can't bypass it), re-validated redirects, size and time caps, and robots.txt for HTML. JavaScript from crawled pages is never executed.
- **Resumes:** AES-256-GCM encrypted on a private volume. Magic-byte type checks, 5-minute signed download links, and deletion cascades to profiles and embeddings.
- **Privacy controls:** export my data, delete job history, delete account, and turn personalization off.
- **Rate limits:** Redis-backed, per IP and per user. Plan limits are configuration-driven (free tier: 5 sources, 10 jobs per email, 2 emails per day).
- **Internal endpoints:** `/internal/*` and `/metrics` listen on port 4001, are never routed by Caddy, and require a bearer token.
- **Production guard:** with `APP_ENV=production`, the app refuses to boot with dev secrets, non-https URLs, or dev login enabled.

## Observability and admin

- **Logs:** structured JSON (pino) with redaction.
- **Metrics:** Prometheus at `api:4001/metrics` and `worker:9464/metrics`, covering crawls, duplicates, LLM latency, cost and tokens, emails, queue depth and HTTP latency.
- **Admin dashboard (`/admin`):**
  - Platform overview: users, jobs, LLM cost, email volume, open and click rate, error rate.
  - Queue depth and LLM usage by model.
  - Source health, with enable/disable, crawl interval and crawl-now controls.
  - Platform controls: pause crawling or notifications, LLM provider and model, thresholds, limits.
  - Feature flags and recent agent runs.

## Tests and evaluation

```bash
npm test                    # 106 unit + connector-fixture tests (no network, no DB)
npm run test:integration    # tenant isolation against real Postgres + Redis
npm run eval                # Precision@5/10, NDCG@10, recall, false-positive rate on eval/dataset.json
```

Connector tests replay recorded API responses from `apps/api/test/fixtures/<platform>/`, so a change in a source's format fails CI. The eval dataset is a seed set; grow it toward PRD §102's 100 candidates × 500 jobs. Rerun `npm run eval` whenever you change weights, thresholds, prompts or the embedding model, and recalibrate `SIMILARITY_CALIBRATION` when switching embedding models.

## Not built yet (PRD V2+)

- LinkedIn and Naukri adapters. The partner-API hook exists, but no licensed feed is wired in.
- Application tracking beyond the "I applied" signal.
- Billing.
- OpenTelemetry tracing. Metrics and structured logs are in place.
- Prometheus and Grafana containers.
- Neo4j.
