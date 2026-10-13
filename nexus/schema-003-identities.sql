-- Bind verified IdP identities to member records. Apply after schema-002.
-- Issuer+subject is the authoritative unique identity; email is NOT proof of account ownership.
CREATE TABLE nexus_external_identities (
 issuer text NOT NULL,
 subject text NOT NULL,
 member_id uuid NOT NULL REFERENCES nexus_members(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (issuer,subject),
 UNIQUE (member_id,issuer)
);
-- Transactional adapter algorithm:
-- 1. Verify OIDC JWT signature, issuer, audience, expiry, and email_verified BEFORE DB.
-- 2. BEGIN; serialize concurrent registration for the same issuer+subject.
-- 3. SELECT nexus_external_identities by (issuer,subject); return existing member if present.
-- 4. INSERT nexus_members with verified email, pending status and private directory.
-- 5. On email unique conflict, return identity_conflict; do not auto-link accounts.
-- 6. INSERT nexus_external_identities; COMMIT.
-- 7. Retry serialization/unique race safely; no member activation or newsletter consent.
