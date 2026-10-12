-- DIG Nexus newsletter schema. Apply only to a dedicated DIG database.
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 email text NOT NULL,
 email_normalized text GENERATED ALWAYS AS (lower(btrim(email))) STORED UNIQUE,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','subscribed','unsubscribed','bounced','complained')),
 source text NOT NULL DEFAULT 'manual',
 consent_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS newsletter_campaigns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 subject text NOT NULL,
 html_body text NOT NULL,
 text_body text NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','queued','sending','sent','paused')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS newsletter_deliveries (
 campaign_id uuid NOT NULL REFERENCES newsletter_campaigns(id),
 subscriber_id uuid NOT NULL REFERENCES newsletter_subscribers(id),
 status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed','suppressed')),
 provider_message_id text,
 attempts integer NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (campaign_id,subscriber_id)
);
CREATE INDEX IF NOT EXISTS newsletter_delivery_queue_idx ON newsletter_deliveries(status,updated_at);
