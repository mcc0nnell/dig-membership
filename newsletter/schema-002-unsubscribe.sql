-- Apply after schema.sql, only to a dedicated DIG development database.
-- Store token hashes, never plaintext tokens.
CREATE TABLE IF NOT EXISTS newsletter_unsubscribe_tokens (
 token_hash char(64) PRIMARY KEY,
 subscriber_id uuid NOT NULL REFERENCES newsletter_subscribers(id),
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS newsletter_unsubscribe_tokens_subscriber_idx ON newsletter_unsubscribe_tokens(subscriber_id);
-- A token redemption must execute in a single transaction:
-- 1. Lock token row FOR UPDATE, require expires_at > now() and consumed_at IS NULL.
-- 2. Update subscriber status to 'unsubscribed'.
-- 3. Suppress any queued deliveries for that subscriber.
-- 4. Set consumed_at = now().
-- Repeat redemptions should return a generic success response.
