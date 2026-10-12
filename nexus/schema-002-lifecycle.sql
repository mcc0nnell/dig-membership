-- DIG Nexus lifecycle extension. Apply after nexus/schema.sql in isolated staging.
-- Identity, membership entitlements, money, and email consent are independent.
CREATE TABLE nexus_membership_terms (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 member_id uuid NOT NULL REFERENCES nexus_members(id),
 starts_on date NOT NULL,
 ends_on date NOT NULL,
 kind text NOT NULL CHECK (kind IN ('annual','lifetime','complimentary')),
 source text NOT NULL DEFAULT 'manual',
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (ends_on >= starts_on),
 UNIQUE(member_id,starts_on,ends_on,kind)
);
CREATE INDEX nexus_membership_terms_member_dates_idx ON nexus_membership_terms(member_id,starts_on,ends_on);
CREATE TABLE nexus_communication_preferences (
 member_id uuid PRIMARY KEY REFERENCES nexus_members(id),
 newsletter_status text NOT NULL DEFAULT 'pending' CHECK (newsletter_status IN ('pending','subscribed','unsubscribed','bounced','complained')),
 consent_at timestamptz,
 consent_source text,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (newsletter_status <> 'subscribed' OR (consent_at IS NOT NULL AND consent_source IS NOT NULL))
);
CREATE TABLE nexus_event_checkins (
 registration_id uuid PRIMARY KEY REFERENCES nexus_registrations(id),
 checked_in_at timestamptz NOT NULL DEFAULT now(),
 checked_in_by uuid NOT NULL REFERENCES nexus_members(id),
 method text NOT NULL CHECK (method IN ('qr','manual'))
);
-- Existing nexus_members.member_status is retained temporarily for compatibility.
-- Do not infer email consent or voting eligibility from that legacy field.
-- Do not auto-populate terms or preferences from existing members without an approved migration.
