-- Prompt-cache accounting: portion of input tokens served from the provider's cache (cheaper).
ALTER TABLE llm_requests ADD COLUMN IF NOT EXISTS cached_input_tokens integer NOT NULL DEFAULT 0;

-- Long-term agent memory per user (PRD §30): a distilled, versioned summary of what the user has
-- shown they like/dislike (saved, applied, dismissed with reasons, thumbs feedback). Rebuilt from
-- user_interactions — never the source of truth, safe to delete.
CREATE TABLE IF NOT EXISTS agent_memory (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  summary       jsonb NOT NULL,
  signal_count  integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_memory_owner_idx ON agent_memory (tenant_id, user_id);
CREATE TRIGGER agent_memory_set_updated_at BEFORE UPDATE ON agent_memory FOR EACH ROW EXECUTE FUNCTION set_updated_at();
