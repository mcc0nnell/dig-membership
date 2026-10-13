-- DIG Nexus clean-room Postgres job lease primitive.
-- Apply only AFTER schema 008, first on an isolated Neon staging branch.
-- No newsletter, external messages, or payments are authorized by this queue.
CREATE TABLE nexus_background_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task text NOT NULL CHECK (task IN ('runtime_expiry_cleanup')),
  dedupe_key text CHECK (dedupe_key IS NULL OR length(dedupe_key) BETWEEN 1 AND 180),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload)='object' AND payload='{}'::jsonb),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','done','dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 12),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 12),
  run_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_token uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  last_error_code text CHECK(last_error_code IS NULL OR length(last_error_code)<=60),
  CHECK ((state='running')=(lease_token IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE UNIQUE INDEX nexus_background_jobs_dedupe_idx
 ON nexus_background_jobs(task,dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX nexus_background_jobs_claim_idx
 ON nexus_background_jobs(state,run_at,lease_until,created_at);
