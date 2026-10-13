-- DIG Nexus conference extension (NTC and future events), applied after schema-004.
-- Independent specification and implementation; no Salesforce code or schemas imported.
-- Fail closed: old events and all new sessions are unpublished by default.
ALTER TABLE nexus_events
 ADD COLUMN publication_status text NOT NULL DEFAULT 'draft'
   CHECK (publication_status IN ('draft','published','archived')),
 ADD COLUMN timezone text NOT NULL DEFAULT 'America/New_York',
 ADD COLUMN venue_name text,
 ADD COLUMN venue_address text;

CREATE TABLE nexus_conference_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id uuid NOT NULL REFERENCES nexus_events(id) ON DELETE CASCADE,
 slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 180),
 summary text NOT NULL DEFAULT '',
 kind text NOT NULL CHECK (kind IN ('keynote','workshop','breakout','panel','networking','plenary')),
 track text,
 room text,
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL,
 capacity integer CHECK (capacity IS NULL OR capacity > 0),
 published boolean NOT NULL DEFAULT false,
 CHECK (ends_at > starts_at),
 UNIQUE(event_id,slug),
 UNIQUE(id,event_id)
);
CREATE INDEX nexus_sessions_public_agenda_idx
 ON nexus_conference_sessions(event_id,starts_at,id) WHERE published;

CREATE TABLE nexus_conference_speakers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
 bio text NOT NULL DEFAULT '',
 public_profile boolean NOT NULL DEFAULT false
);
CREATE TABLE nexus_conference_session_speakers (
 session_id uuid NOT NULL REFERENCES nexus_conference_sessions(id) ON DELETE CASCADE,
 speaker_id uuid NOT NULL REFERENCES nexus_conference_speakers(id) ON DELETE CASCADE,
 role text NOT NULL DEFAULT 'presenter' CHECK (role IN ('presenter','moderator','facilitator')),
 display_order integer NOT NULL DEFAULT 0 CHECK (display_order >= 0),
 PRIMARY KEY(session_id,speaker_id)
);
CREATE INDEX nexus_session_speakers_order_idx
 ON nexus_conference_session_speakers(session_id,display_order,speaker_id);

-- Registrant accommodations remain in nexus_registrations.accessibility_request,
-- never in the public session/speaker tables. No bookings or ticket issuance yet.
