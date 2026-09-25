-- AI Job Discovery & Matching Agent — initial schema.
-- Conventions: every table has id / created_at / updated_at; tenant-owned tables carry tenant_id + user_id.
-- Global (shared) tables: companies, source_connectors, jobs and their children, skills, locations.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────── Tenancy & identity ───────────────────────────

CREATE TABLE tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  plan        text NOT NULL DEFAULT 'free',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  google_subject_id        text NOT NULL UNIQUE,
  email                    text NOT NULL,
  name                     text NOT NULL DEFAULT '',
  profile_picture          text,
  role                     text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  timezone                 text NOT NULL DEFAULT 'Asia/Kolkata',
  onboarding_completed     boolean NOT NULL DEFAULT false,
  personalization_enabled  boolean NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  last_login_at            timestamptz
);
CREATE INDEX users_tenant_idx ON users (tenant_id);
CREATE INDEX users_email_idx ON users (lower(email));

-- ─────────────────────────── Reference data ───────────────────────────

CREATE TABLE locations (
  id            serial PRIMARY KEY,
  name          text NOT NULL,
  type          text NOT NULL CHECK (type IN ('COUNTRY', 'STATE', 'CITY', 'REMOTE')),
  parent_id     integer REFERENCES locations(id) ON DELETE CASCADE,
  country_code  text,
  aliases       text[] NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (type, name, parent_id)
);
CREATE INDEX locations_parent_idx ON locations (parent_id);

CREATE TABLE skills (
  id               serial PRIMARY KEY,
  name             text NOT NULL UNIQUE,
  category         text NOT NULL DEFAULT 'general',
  parent_skill_id  integer REFERENCES skills(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE skill_aliases (
  id          serial PRIMARY KEY,
  skill_id    integer NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  alias       text NOT NULL UNIQUE, -- stored lower-case
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────── User-owned configuration ───────────────────────────

CREATE TABLE user_preferences (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id              uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  job_titles           text[] NOT NULL DEFAULT '{}',
  location_ids         integer[] NOT NULL DEFAULT '{}',
  preferred_companies  text[] NOT NULL DEFAULT '{}',
  blocked_companies    text[] NOT NULL DEFAULT '{}',
  min_experience       integer,
  max_experience       integer,
  work_modes           text[] NOT NULL DEFAULT '{}',
  employment_types     text[] NOT NULL DEFAULT '{FULL_TIME}',
  include_recent_jobs  boolean NOT NULL DEFAULT false,
  enabled_portals      text[] NOT NULL DEFAULT '{}',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_preferences_tenant_idx ON user_preferences (tenant_id, user_id);

CREATE TABLE notification_settings (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id                uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  morning_enabled        boolean NOT NULL DEFAULT true,
  morning_time           text NOT NULL DEFAULT '10:00',
  evening_enabled        boolean NOT NULL DEFAULT true,
  evening_time           text NOT NULL DEFAULT '21:00',
  jobs_per_notification  integer NOT NULL DEFAULT 10,
  min_match_level        text NOT NULL DEFAULT 'GOOD',
  email_enabled          boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────── Resume & candidate profile ───────────────────────────

CREATE TABLE resumes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version      integer NOT NULL,
  file_name    text NOT NULL,
  mime_type    text NOT NULL,
  size_bytes   integer NOT NULL,
  storage_key  text NOT NULL,
  sha256       text NOT NULL,
  status       text NOT NULL DEFAULT 'UPLOADED' CHECK (status IN ('UPLOADED', 'PARSING', 'PARSED', 'FAILED')),
  is_active    boolean NOT NULL DEFAULT true,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, version)
);
CREATE INDEX resumes_owner_idx ON resumes (tenant_id, user_id);

CREATE TABLE candidate_profiles (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resume_id            uuid REFERENCES resumes(id) ON DELETE CASCADE,
  version              integer NOT NULL,
  profile              jsonb NOT NULL,
  normalized_skills    text[] NOT NULL DEFAULT '{}',
  years_of_experience  numeric(4,1) NOT NULL DEFAULT 0,
  seniority            text,
  edited_by_user       boolean NOT NULL DEFAULT false,
  is_active            boolean NOT NULL DEFAULT true,
  prompt_version       text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, version)
);
CREATE INDEX candidate_profiles_owner_idx ON candidate_profiles (tenant_id, user_id) WHERE is_active;

CREATE TABLE candidate_skills (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES candidate_profiles(id) ON DELETE CASCADE,
  skill_id    integer REFERENCES skills(id) ON DELETE SET NULL,
  skill_name  text NOT NULL,
  source      text NOT NULL DEFAULT 'EXTRACTED',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, skill_name)
);
CREATE INDEX candidate_skills_owner_idx ON candidate_skills (tenant_id, user_id);

CREATE TABLE candidate_embeddings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id  uuid NOT NULL UNIQUE REFERENCES candidate_profiles(id) ON DELETE CASCADE,
  embedding   vector(1536) NOT NULL,
  model       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX candidate_embeddings_owner_idx ON candidate_embeddings (tenant_id, user_id);

-- ─────────────────────────── Global job intelligence layer ───────────────────────────

CREATE TABLE companies (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  normalized_name  text NOT NULL UNIQUE,
  website          text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- One row per crawlable source, shared by every user who tracks it (crawl once, match many).
CREATE TABLE source_connectors (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  connector_type          text NOT NULL,
  source_url              text NOT NULL,
  canonical_key           text NOT NULL UNIQUE, -- e.g. "GREENHOUSE:stripe"
  source_identifier       text,
  status                  text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'DEGRADED', 'DISABLED')),
  crawl_interval_minutes  integer NOT NULL DEFAULT 360,
  rate_limit_per_minute   integer NOT NULL DEFAULT 30,
  max_concurrency         integer NOT NULL DEFAULT 1,
  crawl_delay_ms          integer NOT NULL DEFAULT 1000,
  last_crawled_at         timestamptz,
  last_success_at         timestamptz,
  last_failure_at         timestamptz,
  last_http_status        integer,
  last_error              text,
  failure_count           integer NOT NULL DEFAULT 0,
  consecutive_failures    integer NOT NULL DEFAULT 0,
  jobs_found              integer NOT NULL DEFAULT 0,
  avg_crawl_ms            integer,
  crawl_count             integer NOT NULL DEFAULT 0,
  etag                    text,
  last_modified           text,
  content_hash            text,
  next_crawl_at           timestamptz NOT NULL DEFAULT now(),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX source_connectors_due_idx ON source_connectors (next_crawl_at) WHERE status IN ('ACTIVE', 'DEGRADED');

-- A user's subscription to a global source (PRD "job_sources").
CREATE TABLE job_sources (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_connector_id  uuid NOT NULL REFERENCES source_connectors(id) ON DELETE CASCADE,
  display_name         text NOT NULL,
  status               text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_connector_id)
);
CREATE INDEX job_sources_owner_idx ON job_sources (tenant_id, user_id);
CREATE INDEX job_sources_connector_idx ON job_sources (source_connector_id) WHERE status = 'ACTIVE';

CREATE TABLE jobs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_connector_id  uuid NOT NULL REFERENCES source_connectors(id) ON DELETE CASCADE,
  company_id           uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source               text NOT NULL,
  source_job_id        text NOT NULL,
  canonical_url        text NOT NULL,
  title                text NOT NULL,
  normalized_title     text NOT NULL,
  description          text NOT NULL DEFAULT '',
  location_raw         text NOT NULL DEFAULT '',
  employment_type      text,
  work_mode            text,
  seniority            text,
  required_years       numeric(4,1),
  salary_min           numeric,
  salary_max           numeric,
  salary_currency      text,
  salary_text          text,
  department           text,
  url                  text NOT NULL,
  posted_at            timestamptz,
  first_seen_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at         timestamptz NOT NULL DEFAULT now(),
  content_updated_at   timestamptz,
  closed_at            timestamptz,
  status               text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  content_hash         text NOT NULL,   -- hash of source content, detects material updates
  dedupe_hash          text NOT NULL,   -- SHA256(company + title + location + description), PRD §18
  description_hash     text NOT NULL,   -- LLM extraction cache key, PRD §85
  version              integer NOT NULL DEFAULT 1,
  duplicate_of         uuid REFERENCES jobs(id) ON DELETE SET NULL,
  extraction           jsonb,
  extraction_version   text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_connector_id, source_job_id)
);
CREATE INDEX jobs_dedupe_idx ON jobs (dedupe_hash);
CREATE INDEX jobs_canonical_url_idx ON jobs (canonical_url);
CREATE INDEX jobs_open_first_seen_idx ON jobs (source_connector_id, first_seen_at DESC) WHERE status = 'OPEN' AND duplicate_of IS NULL;
CREATE INDEX jobs_company_idx ON jobs (company_id);

CREATE TABLE job_skills (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  skill_id     integer REFERENCES skills(id) ON DELETE SET NULL,
  skill_name   text NOT NULL,
  requirement  text NOT NULL CHECK (requirement IN ('REQUIRED', 'PREFERRED')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, skill_name)
);
CREATE INDEX job_skills_skill_idx ON job_skills (skill_name);

CREATE TABLE job_locations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  raw          text NOT NULL,
  city_id      integer REFERENCES locations(id) ON DELETE SET NULL,
  state_id     integer REFERENCES locations(id) ON DELETE SET NULL,
  country_id   integer REFERENCES locations(id) ON DELETE SET NULL,
  is_remote    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_locations_job_idx ON job_locations (job_id);

CREATE TABLE job_embeddings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        uuid NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  embedding     vector(1536) NOT NULL,
  model         text NOT NULL,
  content_hash  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_embeddings_hnsw_idx ON job_embeddings USING hnsw (embedding vector_cosine_ops);

-- ─────────────────────────── Matches & interactions ───────────────────────────

CREATE TABLE job_matches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id           uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  profile_version  integer NOT NULL,
  job_version      integer NOT NULL,
  prefs_hash       text NOT NULL,
  score            integer NOT NULL,
  rank_score       numeric(6,2) NOT NULL,
  match_level      text NOT NULL,
  confidence       numeric(3,2) NOT NULL,
  result           jsonb NOT NULL,
  explanation      text,
  evaluated_by     text NOT NULL,
  prompt_version   text,
  seen_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, job_id)
);
CREATE INDEX job_matches_owner_rank_idx ON job_matches (tenant_id, user_id, rank_score DESC);

CREATE TABLE saved_jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id      uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, job_id)
);
CREATE INDEX saved_jobs_owner_idx ON saved_jobs (tenant_id, user_id);

CREATE TABLE dismissed_jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id      uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, job_id)
);
CREATE INDEX dismissed_jobs_owner_idx ON dismissed_jobs (tenant_id, user_id);

CREATE TABLE user_interactions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id      uuid REFERENCES jobs(id) ON DELETE SET NULL,
  type        text NOT NULL,
  metadata    jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_interactions_owner_idx ON user_interactions (tenant_id, user_id, created_at DESC);

-- ─────────────────────────── Notifications & email ───────────────────────────

CREATE TABLE notifications (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_window  text NOT NULL, -- e.g. 2026-09-25:morning (user local date)
  type                 text NOT NULL DEFAULT 'DIGEST',
  status               text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED')),
  job_count            integer NOT NULL DEFAULT 0,
  subject              text,
  sent_at              timestamptz,
  error                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, notification_window)
);
CREATE INDEX notifications_owner_idx ON notifications (tenant_id, user_id, created_at DESC);

CREATE TABLE notification_jobs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_id      uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  job_id               uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  notification_window  text NOT NULL,
  job_version          integer NOT NULL,
  position             integer NOT NULL,
  score                integer NOT NULL,
  match_level          text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, job_id, notification_window)  -- PRD §69 idempotency
);
CREATE INDEX notification_jobs_user_job_idx ON notification_jobs (user_id, job_id);

CREATE TABLE email_deliveries (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_id      uuid NOT NULL UNIQUE REFERENCES notifications(id) ON DELETE CASCADE,
  provider             text NOT NULL,
  provider_message_id  text,
  status               text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'SENT', 'FAILED')),
  attempts             integer NOT NULL DEFAULT 0,
  error                text,
  opened_at            timestamptz,
  clicked_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────── Agent tracking & observability ───────────────────────────

CREATE TABLE agent_runs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid REFERENCES tenants(id) ON DELETE CASCADE,
  user_id              uuid REFERENCES users(id) ON DELETE CASCADE,
  source_connector_id  uuid REFERENCES source_connectors(id) ON DELETE CASCADE,
  type                 text NOT NULL CHECK (type IN ('CRAWL', 'MATCH', 'NOTIFY', 'RESUME')),
  trigger              text NOT NULL DEFAULT 'SCHEDULED',
  status               text NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED')),
  started_at           timestamptz NOT NULL DEFAULT now(),
  completed_at         timestamptz,
  jobs_discovered      integer NOT NULL DEFAULT 0,
  jobs_filtered        integer NOT NULL DEFAULT 0,
  jobs_matched         integer NOT NULL DEFAULT 0,
  jobs_selected        integer NOT NULL DEFAULT 0,
  emails_sent          integer NOT NULL DEFAULT 0,
  tokens_used          integer NOT NULL DEFAULT 0,
  estimated_cost       numeric(12,6) NOT NULL DEFAULT 0,
  error                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_runs_user_idx ON agent_runs (user_id, started_at DESC);
CREATE INDEX agent_runs_type_idx ON agent_runs (type, started_at DESC);

CREATE TABLE agent_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id  uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  event         text NOT NULL,
  data          jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_events_run_idx ON agent_events (agent_run_id);

-- PRD §126 — every LLM call is recorded (no raw resume/job content).
CREATE TABLE llm_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id    uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
  tenant_id       uuid REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         uuid REFERENCES users(id) ON DELETE CASCADE,
  provider        text NOT NULL,
  model           text NOT NULL,
  purpose         text NOT NULL,
  prompt_version  text NOT NULL,
  input_tokens    integer NOT NULL DEFAULT 0,
  output_tokens   integer NOT NULL DEFAULT 0,
  latency_ms      integer NOT NULL DEFAULT 0,
  estimated_cost  numeric(12,6) NOT NULL DEFAULT 0,
  success         boolean NOT NULL,
  cached          boolean NOT NULL DEFAULT false,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX llm_requests_created_idx ON llm_requests (created_at DESC);

-- PRD §85 — cache of structured LLM output keyed by content hash + prompt version.
CREATE TABLE llm_cache (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key   text NOT NULL UNIQUE,
  purpose     text NOT NULL,
  value       jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid REFERENCES tenants(id) ON DELETE SET NULL,
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  action       text NOT NULL,
  entity_type  text,
  entity_id    text,
  ip           text,
  metadata     jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);

-- ─────────────────────────── Platform configuration ───────────────────────────

CREATE TABLE platform_settings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  value       jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE feature_flags (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key          text NOT NULL UNIQUE,
  enabled      boolean NOT NULL DEFAULT false,
  description  text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- updated_at triggers on every table
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT table_name FROM information_schema.columns
           WHERE table_schema = 'public' AND column_name = 'updated_at'
  LOOP
    EXECUTE format('CREATE TRIGGER %I_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;
