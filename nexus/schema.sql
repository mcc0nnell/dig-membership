-- DIG Nexus v0.1. Dedicated empty Neon database only; not Twenty's private schema.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE nexus_members (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 email text NOT NULL,
 email_key text GENERATED ALWAYS AS (lower(btrim(email))) STORED UNIQUE,
 display_name text NOT NULL,
 agency text,
 member_status text NOT NULL DEFAULT 'pending' CHECK (member_status IN ('pending','active','lapsed','suspended')),
 directory_opt_in boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE nexus_roles (
 member_id uuid NOT NULL REFERENCES nexus_members(id) ON DELETE CASCADE,
 role text NOT NULL CHECK (role IN ('member','officer','editor','event_staff','admin')),
 PRIMARY KEY (member_id,role)
);
CREATE TABLE nexus_committees (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL UNIQUE
);
CREATE TABLE nexus_committee_members (
 committee_id uuid NOT NULL REFERENCES nexus_committees(id),
 member_id uuid NOT NULL REFERENCES nexus_members(id),
 position text,
 PRIMARY KEY (committee_id,member_id)
);
CREATE TABLE nexus_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 slug text NOT NULL UNIQUE,
 title text NOT NULL,
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL,
 capacity integer CHECK (capacity IS NULL OR capacity > 0),
 registration_open boolean NOT NULL DEFAULT false,
 CHECK (ends_at > starts_at)
);
CREATE TABLE nexus_registrations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id uuid NOT NULL REFERENCES nexus_events(id),
 member_id uuid NOT NULL REFERENCES nexus_members(id),
 status text NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','cancelled','attended','waitlisted')),
 accessibility_request text,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (event_id,member_id)
);
CREATE TABLE nexus_dues (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 member_id uuid NOT NULL REFERENCES nexus_members(id),
 provider text NOT NULL,
 provider_reference text NOT NULL,
 amount_cents integer NOT NULL CHECK (amount_cents >= 0),
 currency char(3) NOT NULL DEFAULT 'USD',
 status text NOT NULL CHECK (status IN ('pending','paid','refunded','failed')),
 UNIQUE (provider,provider_reference)
);
CREATE TABLE nexus_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 title text NOT NULL,
 object_key text NOT NULL UNIQUE,
 visibility text NOT NULL CHECK (visibility IN ('members','officers','committee')),
 committee_id uuid REFERENCES nexus_committees(id),
 CHECK ((visibility = 'committee') = (committee_id IS NOT NULL))
);
CREATE TABLE nexus_elections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 title text NOT NULL,
 opens_at timestamptz NOT NULL,
 closes_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed')),
 CHECK (closes_at > opens_at)
);
-- Only voter eligibility is modeled here. Never store ballots with member IDs.
CREATE TABLE nexus_voter_eligibility (
 election_id uuid NOT NULL REFERENCES nexus_elections(id),
 member_id uuid NOT NULL REFERENCES nexus_members(id),
 eligible boolean NOT NULL,
 PRIMARY KEY (election_id,member_id)
);
CREATE INDEX nexus_registrations_event_idx ON nexus_registrations(event_id,status);
CREATE INDEX nexus_dues_member_idx ON nexus_dues(member_id,status);
