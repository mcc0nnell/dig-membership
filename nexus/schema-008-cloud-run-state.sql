-- Cloud Run runtime state. Apply to isolated Neon staging after schemas 001-007.
-- Hashed opaque OAuth flow and session IDs only; no Google access tokens, cookies, IPs or PII.
CREATE TABLE nexus_runtime_tokens (
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[0-9a-f]{64}$'),
 kind text NOT NULL CHECK(kind IN ('flow','session')),
 expires_at timestamptz NOT NULL
);
CREATE INDEX nexus_runtime_tokens_expiry_idx ON nexus_runtime_tokens(expires_at);

-- Shared, bounded-count rate limits across Cloud Run instances. Raw IPs are never stored.
CREATE TABLE nexus_runtime_rate_limits (
 bucket_hash text PRIMARY KEY CHECK(bucket_hash ~ '^[0-9a-f]{64}$'),
 request_count bigint NOT NULL CHECK(request_count >= 1),
 expires_at timestamptz NOT NULL
);
CREATE INDEX nexus_runtime_rate_limits_expiry_idx ON nexus_runtime_rate_limits(expires_at);
-- Operational cleanup (scheduled separately, never in each HTTP request):
-- DELETE FROM nexus_runtime_tokens WHERE expires_at < now();
-- DELETE FROM nexus_runtime_rate_limits WHERE expires_at < now();
