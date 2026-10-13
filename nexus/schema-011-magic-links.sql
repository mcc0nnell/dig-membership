-- Conference magic links are independent of membership. One-use tokens are hashed.
CREATE TABLE nexus_conference_magic_links (
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[0-9a-f]{64}$'),
 email text NOT NULL CHECK(length(email) BETWEEN 3 AND 254),
 event_slug text NOT NULL CHECK(event_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 expires_at timestamptz NOT NULL DEFAULT (now()+interval '15 minutes'),
 requested_at timestamptz NOT NULL DEFAULT now(),
 CHECK(expires_at>requested_at AND expires_at<=requested_at+interval '15 minutes')
);
CREATE INDEX nexus_conference_magic_expiry ON nexus_conference_magic_links(expires_at);
CREATE FUNCTION nexus_magic_issue(p_hash text,p_email text,p_event text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE normalized text:=lower(btrim(p_email));
BEGIN
 IF p_hash !~ '^[a-f0-9]{64}$' OR length(normalized) NOT BETWEEN 3 AND 254 OR
 normalized !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' OR
 p_event !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR length(p_event)>80
 THEN RAISE EXCEPTION 'invalid request' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM nexus_events WHERE slug=p_event AND publication_status='published')
 THEN RAISE EXCEPTION 'event unavailable' USING ERRCODE='P0002'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(normalized,19));
 DELETE FROM nexus_conference_magic_links WHERE email=normalized;
 INSERT INTO nexus_conference_magic_links(token_hash,email,event_slug) VALUES(p_hash,normalized,p_event);
 RETURN true;
END $$;
CREATE FUNCTION nexus_magic_consume(p_hash text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result nexus_conference_magic_links%ROWTYPE;
BEGIN
 DELETE FROM nexus_conference_magic_links WHERE token_hash=p_hash AND expires_at>now() RETURNING * INTO result;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('email',result.email,'eventSlug',result.event_slug);
END $$;
CREATE FUNCTION nexus_magic_revoke(p_hash text) RETURNS boolean LANGUAGE sql AS $$
 DELETE FROM nexus_conference_magic_links WHERE token_hash=p_hash RETURNING true
$$;
-- A verified attendee may recover a Zeffy purchase by its provider payment ID.
-- This cannot transfer someone else's purchase or auto-match a different email.
-- The caller must authenticate via Google OR one-time email magic link.
CREATE FUNCTION nexus_conference_zeffy_claim(p_slug text,p_issuer text,p_subject text,
 p_payment uuid,p_campaign uuid,p_rate uuid,p_email text,p_amount integer,p_currency text,
 p_status text,p_type text,p_refund text,p_disputed boolean)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_event nexus_events%ROWTYPE; v_attendee uuid;
BEGIN
 SELECT * INTO v_event FROM nexus_events WHERE slug=p_slug FOR UPDATE;
 IF NOT FOUND OR v_event.zeffy_campaign_id IS DISTINCT FROM p_campaign OR
    v_event.zeffy_ticket_rate_id IS DISTINCT FROM p_rate
 THEN RAISE EXCEPTION 'event mismatch' USING ERRCODE='22023'; END IF;
 SELECT en.id INTO v_attendee FROM nexus_conference_enrollments en
 JOIN nexus_conference_attendees a ON a.id=en.attendee_id
 WHERE en.event_id=v_event.id AND en.status='registered' AND a.issuer=p_issuer
   AND a.subject=p_subject AND a.email_key=lower(btrim(p_email));
 IF NOT FOUND THEN RAISE EXCEPTION 'verified purchaser enrollment required' USING ERRCODE='42501'; END IF;
 IF p_status<>'succeeded' OR p_refund<>'none' OR p_disputed IS DISTINCT FROM false
 THEN RAISE EXCEPTION 'payment requires manual review' USING ERRCODE='22023'; END IF;
 RETURN nexus_conference_zeffy_reconcile('selfclaim:'||p_payment::text,p_payment,p_campaign,p_rate,
   p_email,p_amount,p_currency,p_status,p_type,p_refund,p_disputed);
END $$;
-- Verified but unattributed Zeffy payments are retained for human reconciliation.
-- No ticket or entitlement is granted by this intake record.
CREATE TABLE nexus_conference_zeffy_reviews (
 zeffy_payment_id uuid PRIMARY KEY,
 event_id uuid NOT NULL REFERENCES nexus_events(id),
 buyer_email text NOT NULL,
 reason text NOT NULL DEFAULT 'unmatched_enrollment' CHECK(reason IN ('unmatched_enrollment')),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','resolved')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX nexus_zeffy_reviews_event_state ON nexus_conference_zeffy_reviews(event_id,state,created_at);
CREATE FUNCTION nexus_conference_zeffy_review(p_payment uuid,p_campaign uuid,p_rate uuid,
 p_email text,p_amount integer,p_currency text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE e nexus_events%ROWTYPE;
BEGIN
 SELECT * INTO e FROM nexus_events WHERE zeffy_campaign_id=p_campaign FOR UPDATE;
 IF NOT FOUND OR e.zeffy_ticket_rate_id IS DISTINCT FROM p_rate OR
    e.ticket_price_cents<>p_amount OR e.ticket_currency<>upper(p_currency) OR
    length(p_email) NOT BETWEEN 3 AND 254 OR
    p_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
 THEN RAISE EXCEPTION 'unmatched payment cannot be attributed' USING ERRCODE='22023'; END IF;
 INSERT INTO nexus_conference_zeffy_reviews(zeffy_payment_id,event_id,buyer_email)
 VALUES(p_payment,e.id,lower(btrim(p_email)))
 ON CONFLICT(zeffy_payment_id) DO UPDATE SET updated_at=now()
 WHERE nexus_conference_zeffy_reviews.event_id=excluded.event_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'payment belongs to another event' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('status','manual_review');
END $$;
CREATE FUNCTION nexus_conference_zeffy_review_resolve(p_payment uuid) RETURNS boolean LANGUAGE sql AS $$
 UPDATE nexus_conference_zeffy_reviews SET state='resolved',updated_at=now()
 WHERE zeffy_payment_id=p_payment AND state='pending' RETURNING true
$$;
