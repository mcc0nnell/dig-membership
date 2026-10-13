-- NTC attendee registration v1. Apply ONLY after schema 006 in isolated staging.
-- Attendees are NOT DIG members and receive NO membership, voting or mailing privileges.
CREATE TABLE nexus_conference_attendees (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 issuer text NOT NULL CHECK(length(issuer) BETWEEN 8 AND 512),
 subject text NOT NULL CHECK(length(subject) BETWEEN 1 AND 512),
 email text NOT NULL,
 email_key text GENERATED ALWAYS AS (lower(btrim(email))) STORED UNIQUE,
 display_name text NOT NULL CHECK(length(btrim(display_name)) BETWEEN 1 AND 120),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(issuer,subject)
);
CREATE TABLE nexus_conference_enrollments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id uuid NOT NULL REFERENCES nexus_events(id),
 attendee_id uuid NOT NULL REFERENCES nexus_conference_attendees(id),
 status text NOT NULL CHECK(status IN ('registered','waitlisted','cancelled')),
 confirmation_reference text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16),'hex'),
 requested_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(event_id,attendee_id),
 UNIQUE(id,event_id)
);
CREATE INDEX nexus_enrollments_event_queue_idx ON nexus_conference_enrollments(event_id,status,requested_at,id);
CREATE TABLE nexus_conference_workshop_reservations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 enrollment_id uuid NOT NULL REFERENCES nexus_conference_enrollments(id),
 session_id uuid NOT NULL REFERENCES nexus_conference_sessions(id),
 status text NOT NULL CHECK(status IN ('confirmed','waitlisted','cancelled')),
 requested_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(enrollment_id,session_id)
);
CREATE INDEX nexus_workshop_queue_idx ON nexus_conference_workshop_reservations(session_id,status,requested_at,id);

-- Accommodation intake requires explicit attendee consent and is NEVER part of agenda or staff snapshot.
CREATE TABLE nexus_conference_accessibility_requests (
 enrollment_id uuid PRIMARY KEY REFERENCES nexus_conference_enrollments(id),
 request_text text NOT NULL CHECK(length(btrim(request_text)) BETWEEN 1 AND 2000),
 consent_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE nexus_conference_access_coordinators (
 event_id uuid NOT NULL REFERENCES nexus_events(id) ON DELETE CASCADE,
 member_id uuid NOT NULL REFERENCES nexus_members(id) ON DELETE CASCADE,
 PRIMARY KEY(event_id,member_id)
);

-- All enrollment/seat writes serialize on the event row. Organizer writes lock the same row.
-- Trigger prevents organizers from silently invalidating existing workshop bookings.
CREATE FUNCTION nexus_conference_guard_booked_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM nexus_conference_workshop_reservations w
  JOIN nexus_conference_enrollments en ON en.id=w.enrollment_id
  WHERE w.session_id=OLD.id AND w.status IN ('confirmed','waitlisted') AND en.status='registered') THEN
  IF NEW.kind<>'workshop' OR NEW.published=false OR NEW.event_id<>OLD.event_id OR
     NEW.starts_at<>OLD.starts_at OR NEW.ends_at<>OLD.ends_at OR
     (NEW.capacity IS NOT NULL AND NEW.capacity < (
      SELECT count(*) FROM nexus_conference_workshop_reservations w
      JOIN nexus_conference_enrollments en ON en.id=w.enrollment_id
      WHERE w.session_id=OLD.id AND w.status='confirmed' AND en.status='registered'))
  THEN RAISE EXCEPTION 'active workshop bookings require coordinated rescheduling' USING ERRCODE='22023'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER nexus_conference_booked_session_guard BEFORE UPDATE ON nexus_conference_sessions
 FOR EACH ROW EXECUTE FUNCTION nexus_conference_guard_booked_session();

-- Only public, open events can enroll. One atomic transaction handles race/idempotency.
CREATE FUNCTION nexus_conference_register(p_slug text,p_issuer text,p_subject text,p_email text,p_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_event nexus_events%ROWTYPE; v_attendee uuid; v_record nexus_conference_enrollments%ROWTYPE;
 v_status text;
BEGIN
 IF p_issuer IS NULL OR p_subject IS NULL OR length(p_issuer) NOT BETWEEN 8 AND 512 OR
    length(p_subject) NOT BETWEEN 1 AND 512 OR length(btrim(p_name)) NOT BETWEEN 1 AND 120 OR
    length(p_email) NOT BETWEEN 3 AND 254 OR p_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
 THEN RAISE EXCEPTION 'invalid verified identity or name' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_event FROM nexus_events WHERE slug=p_slug FOR UPDATE;
 IF NOT FOUND OR v_event.publication_status<>'published' OR NOT v_event.registration_open OR now()>=v_event.starts_at
 THEN RAISE EXCEPTION 'event registration closed' USING ERRCODE='P0002'; END IF;
 SELECT id INTO v_attendee FROM nexus_conference_attendees WHERE issuer=p_issuer AND subject=p_subject;
 IF v_attendee IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM nexus_conference_attendees WHERE id=v_attendee AND email_key=lower(btrim(p_email)))
  THEN RAISE EXCEPTION 'identity email changed; manual review required' USING ERRCODE='23505'; END IF;
 ELSE
  -- Same verified email on another identity must NOT silently link or duplicate registrations.
  INSERT INTO nexus_conference_attendees(issuer,subject,email,display_name)
   VALUES(p_issuer,p_subject,lower(btrim(p_email)),btrim(p_name)) RETURNING id INTO v_attendee;
 END IF;
 SELECT * INTO v_record FROM nexus_conference_enrollments WHERE event_id=v_event.id AND attendee_id=v_attendee;
 IF FOUND AND v_record.status<>'cancelled' THEN
  RETURN jsonb_build_object('status',v_record.status,'confirmationReference',v_record.confirmation_reference,'alreadyRegistered',true);
 END IF;
 IF v_event.capacity IS NULL OR (SELECT count(*) FROM nexus_conference_enrollments
   WHERE event_id=v_event.id AND status='registered')<v_event.capacity
 THEN v_status='registered'; ELSE v_status='waitlisted'; END IF;
 INSERT INTO nexus_conference_enrollments(event_id,attendee_id,status)
 VALUES(v_event.id,v_attendee,v_status)
 ON CONFLICT(event_id,attendee_id) DO UPDATE SET status=excluded.status,
   confirmation_reference=encode(gen_random_bytes(16),'hex'),requested_at=now(),updated_at=now()
 RETURNING * INTO v_record;
 RETURN jsonb_build_object('status',v_record.status,'confirmationReference',v_record.confirmation_reference,'alreadyRegistered',false);
END $$;

-- Reserving, cancelling and promoting workshops are serialized with event registration.
CREATE FUNCTION nexus_conference_workshop(p_slug text,p_issuer text,p_subject text,p_session_slug text,p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_event nexus_events%ROWTYPE; v_enrollment uuid; v_session nexus_conference_sessions%ROWTYPE;
 v_reservation nexus_conference_workshop_reservations%ROWTYPE; v_status text;
BEGIN
 SELECT * INTO v_event FROM nexus_events WHERE slug=p_slug FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'event not found' USING ERRCODE='P0002'; END IF;
 SELECT en.id INTO v_enrollment FROM nexus_conference_enrollments en
 JOIN nexus_conference_attendees a ON a.id=en.attendee_id
 WHERE en.event_id=v_event.id AND a.issuer=p_issuer AND a.subject=p_subject AND en.status='registered';
 IF v_enrollment IS NULL THEN RAISE EXCEPTION 'active event registration required' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_session FROM nexus_conference_sessions
 WHERE event_id=v_event.id AND slug=p_session_slug FOR UPDATE;
 IF NOT FOUND OR v_session.kind<>'workshop' THEN RAISE EXCEPTION 'workshop unavailable' USING ERRCODE='P0002'; END IF;
 IF p_action='reserve' THEN
  IF v_event.publication_status<>'published' OR NOT v_event.registration_open OR
     now()>=v_session.starts_at OR NOT v_session.published
  THEN RAISE EXCEPTION 'workshop booking closed' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_reservation FROM nexus_conference_workshop_reservations
    WHERE enrollment_id=v_enrollment AND session_id=v_session.id;
  IF FOUND AND v_reservation.status<>'cancelled' THEN
   RETURN jsonb_build_object('status',v_reservation.status,'alreadySelected',true);
  END IF;
  -- Do not confirm the same attendee into concurrent workshops.
  IF EXISTS(SELECT 1 FROM nexus_conference_workshop_reservations w
    JOIN nexus_conference_sessions other ON other.id=w.session_id
    WHERE w.enrollment_id=v_enrollment AND w.status='confirmed'
      AND w.session_id<>v_session.id AND other.starts_at<v_session.ends_at
      AND other.ends_at>v_session.starts_at)
  THEN RAISE EXCEPTION 'overlapping confirmed workshop' USING ERRCODE='22023'; END IF;
  IF v_session.capacity IS NULL OR (SELECT count(*) FROM nexus_conference_workshop_reservations w
     JOIN nexus_conference_enrollments en ON en.id=w.enrollment_id
     WHERE w.session_id=v_session.id AND w.status='confirmed' AND en.status='registered')<v_session.capacity
  THEN v_status='confirmed'; ELSE v_status='waitlisted'; END IF;
  INSERT INTO nexus_conference_workshop_reservations(enrollment_id,session_id,status)
  VALUES(v_enrollment,v_session.id,v_status)
  ON CONFLICT(enrollment_id,session_id) DO UPDATE SET status=excluded.status,requested_at=now(),updated_at=now()
  RETURNING * INTO v_reservation;
  RETURN jsonb_build_object('status',v_reservation.status,'alreadySelected',false);
 ELSIF p_action='cancel' THEN
  SELECT * INTO v_reservation FROM nexus_conference_workshop_reservations
  WHERE enrollment_id=v_enrollment AND session_id=v_session.id;
  IF NOT FOUND OR v_reservation.status='cancelled' THEN RETURN jsonb_build_object('status','cancelled','alreadyCancelled',true); END IF;
  UPDATE nexus_conference_workshop_reservations SET status='cancelled',updated_at=now()
  WHERE id=v_reservation.id;
  IF v_reservation.status='confirmed' THEN
   UPDATE nexus_conference_workshop_reservations SET status='confirmed',updated_at=now()
   WHERE id=(SELECT w.id FROM nexus_conference_workshop_reservations w
    JOIN nexus_conference_enrollments en ON en.id=w.enrollment_id
    WHERE w.session_id=v_session.id AND w.status='waitlisted' AND en.status='registered'
      AND NOT EXISTS(SELECT 1 FROM nexus_conference_workshop_reservations overlapping
       JOIN nexus_conference_sessions occupied ON occupied.id=overlapping.session_id
       WHERE overlapping.enrollment_id=w.enrollment_id AND overlapping.status='confirmed'
         AND occupied.starts_at<v_session.ends_at AND occupied.ends_at>v_session.starts_at)
    ORDER BY w.requested_at,w.id LIMIT 1);
  END IF;
  RETURN jsonb_build_object('status','cancelled','alreadyCancelled',false);
 ELSE RAISE EXCEPTION 'invalid action' USING ERRCODE='22023'; END IF;
END $$;

-- Cancel conference enrollment and promote the oldest eligible event waitlistee.
CREATE FUNCTION nexus_conference_cancel(p_slug text,p_issuer text,p_subject text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_event uuid; v_record nexus_conference_enrollments%ROWTYPE; w record;
BEGIN
 SELECT id INTO v_event FROM nexus_events WHERE slug=p_slug FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'event not found' USING ERRCODE='P0002'; END IF;
 SELECT en.* INTO v_record FROM nexus_conference_enrollments en
 JOIN nexus_conference_attendees a ON a.id=en.attendee_id
 WHERE en.event_id=v_event AND a.issuer=p_issuer AND a.subject=p_subject;
 IF NOT FOUND OR v_record.status='cancelled' THEN RETURN jsonb_build_object('status','cancelled','alreadyCancelled',true); END IF;
 UPDATE nexus_conference_enrollments SET status='cancelled',updated_at=now() WHERE id=v_record.id;
 FOR w IN (SELECT session_id,status FROM nexus_conference_workshop_reservations
    WHERE enrollment_id=v_record.id AND status IN ('confirmed','waitlisted')) LOOP
  UPDATE nexus_conference_workshop_reservations SET status='cancelled',updated_at=now()
  WHERE enrollment_id=v_record.id AND session_id=w.session_id;
  IF w.status='confirmed' THEN
   UPDATE nexus_conference_workshop_reservations SET status='confirmed',updated_at=now()
   WHERE id=(SELECT r.id FROM nexus_conference_workshop_reservations r
    JOIN nexus_conference_enrollments en ON en.id=r.enrollment_id
    WHERE r.session_id=w.session_id AND r.status='waitlisted' AND en.status='registered'
       AND NOT EXISTS(SELECT 1 FROM nexus_conference_workshop_reservations overlapping
        JOIN nexus_conference_sessions occupied ON occupied.id=overlapping.session_id
        JOIN nexus_conference_sessions freeing ON freeing.id=w.session_id
        WHERE overlapping.enrollment_id=r.enrollment_id AND overlapping.status='confirmed'
          AND occupied.starts_at<freeing.ends_at AND occupied.ends_at>freeing.starts_at)
    ORDER BY r.requested_at,r.id LIMIT 1);
  END IF;
 END LOOP;
 DELETE FROM nexus_conference_accessibility_requests WHERE enrollment_id=v_record.id;
 IF v_record.status='registered' THEN
  UPDATE nexus_conference_enrollments SET status='registered',updated_at=now()
  WHERE id=(SELECT id FROM nexus_conference_enrollments WHERE event_id=v_event AND status='waitlisted'
   ORDER BY requested_at,id LIMIT 1);
 END IF;
 RETURN jsonb_build_object('status','cancelled','alreadyCancelled',false);
END $$;

CREATE FUNCTION nexus_conference_self(p_slug text,p_issuer text,p_subject text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE v_record record;
BEGIN
 SELECT en.id,en.status,en.confirmation_reference,a.display_name,a.email,ev.title,ev.timezone
 INTO v_record FROM nexus_conference_enrollments en
 JOIN nexus_conference_attendees a ON a.id=en.attendee_id
 JOIN nexus_events ev ON ev.id=en.event_id
 WHERE ev.slug=p_slug AND a.issuer=p_issuer AND a.subject=p_subject;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('eventTitle',v_record.title,'status',v_record.status,
  'confirmationReference',v_record.confirmation_reference,'displayName',v_record.display_name,
  'email',v_record.email,'timezone',v_record.timezone,
  'workshops',COALESCE((SELECT jsonb_agg(jsonb_build_object('slug',s.slug,'title',s.title,'status',w.status)
  ORDER BY s.starts_at,s.slug) FROM nexus_conference_workshop_reservations w
  JOIN nexus_conference_sessions s ON s.id=w.session_id
  WHERE w.enrollment_id=v_record.id AND w.status<>'cancelled'),'[]'::jsonb),
  'accessibilityRequest',(SELECT r.request_text FROM nexus_conference_accessibility_requests r
    WHERE r.enrollment_id=v_record.id));
END $$;

-- Never store accessibility needs without an explicit request-specific acknowledgement.
CREATE FUNCTION nexus_conference_accommodation(p_slug text,p_issuer text,p_subject text,p_note text,p_consent boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_event uuid; v_enrollment uuid;
BEGIN
 SELECT id INTO v_event FROM nexus_events WHERE slug=p_slug FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'event not found' USING ERRCODE='P0002'; END IF;
 SELECT en.id INTO v_enrollment FROM nexus_conference_enrollments en
 JOIN nexus_conference_attendees a ON a.id=en.attendee_id
 WHERE en.event_id=v_event AND a.issuer=p_issuer AND a.subject=p_subject AND en.status IN ('registered','waitlisted');
 IF v_enrollment IS NULL THEN RAISE EXCEPTION 'active registration required' USING ERRCODE='42501'; END IF;
 IF p_note IS NULL THEN
  DELETE FROM nexus_conference_accessibility_requests WHERE enrollment_id=v_enrollment;
  RETURN jsonb_build_object('saved',true,'hasRequest',false);
 END IF;
 IF p_consent IS DISTINCT FROM true OR length(btrim(p_note)) NOT BETWEEN 1 AND 2000
 THEN RAISE EXCEPTION 'explicit accommodation consent required' USING ERRCODE='22023'; END IF;
 INSERT INTO nexus_conference_accessibility_requests(enrollment_id,request_text,consent_at)
 VALUES(v_enrollment,btrim(p_note),now())
 ON CONFLICT(enrollment_id) DO UPDATE SET request_text=excluded.request_text,
   consent_at=excluded.consent_at,updated_at=now();
 RETURN jsonb_build_object('saved',true,'hasRequest',true);
END $$;

-- A coordinator must be explicitly assigned for that event, independently of organizer role.
-- Access reads are audited without logging accommodation contents.
CREATE FUNCTION nexus_conference_coordination(p_slug text,p_issuer text,p_subject text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_event uuid;v_actor uuid;v_data jsonb;
BEGIN
 SELECT ev.id,m.id INTO v_event,v_actor FROM nexus_events ev
 JOIN nexus_conference_access_coordinators c ON c.event_id=ev.id
 JOIN nexus_external_identities i ON i.member_id=c.member_id AND i.issuer=p_issuer AND i.subject=p_subject
 JOIN nexus_members m ON m.id=i.member_id AND m.member_status<>'suspended'
 WHERE ev.slug=p_slug;
 IF v_event IS NULL THEN RAISE EXCEPTION 'coordinator access required' USING ERRCODE='42501'; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('attendeeName',a.display_name,'email',a.email,
  'request',r.request_text,'updatedAt',r.updated_at,'registrationStatus',en.status)
  ORDER BY r.updated_at), '[]'::jsonb)
 INTO v_data FROM nexus_conference_accessibility_requests r
 JOIN nexus_conference_enrollments en ON en.id=r.enrollment_id
 JOIN nexus_conference_attendees a ON a.id=en.attendee_id
 WHERE en.event_id=v_event AND en.status IN ('registered','waitlisted');
 INSERT INTO nexus_event_audit(event_id,actor_member_id,action,detail)
 VALUES(v_event,v_actor,'read_accessibility_requests',jsonb_build_object('records',jsonb_array_length(v_data)));
 RETURN jsonb_build_object('requests',v_data);
END $$;

-- Prevent operators from shrinking event capacity below previously confirmed enrollments.
CREATE FUNCTION nexus_conference_guard_event_capacity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.capacity IS NOT NULL AND NEW.capacity < (
  SELECT count(*) FROM nexus_conference_enrollments WHERE event_id=OLD.id AND status='registered')
 THEN RAISE EXCEPTION 'event capacity below registered attendees' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER nexus_conference_capacity_guard BEFORE UPDATE OF capacity ON nexus_events
 FOR EACH ROW EXECUTE FUNCTION nexus_conference_guard_event_capacity();
