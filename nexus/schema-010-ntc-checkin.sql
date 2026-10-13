-- Original DIG Nexus manual check-in, NOT paid ticketing or QR credential issuance.
-- Run after 009, only on isolated staging with synthetic attendees.
CREATE TABLE nexus_conference_checkins (
 enrollment_id uuid PRIMARY KEY,
 event_id uuid NOT NULL REFERENCES nexus_events(id),
 FOREIGN KEY(enrollment_id,event_id) REFERENCES nexus_conference_enrollments(id,event_id),
 actor_id uuid NOT NULL REFERENCES nexus_members(id),
 checked_in_at timestamptz NOT NULL DEFAULT now(),
 method text NOT NULL CHECK(method='manual')
);
CREATE INDEX nexus_conference_checkins_event_idx ON nexus_conference_checkins(event_id,checked_in_at);

CREATE FUNCTION nexus_conference_staff_checkin(
 p_slug text,p_issuer text,p_subject text,p_reference text,p_method text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_event uuid;v_actor uuid;v_role text;v_record record;v_inserted uuid;
BEGIN
 SELECT a.event_id,a.actor_id,a.staff_role INTO v_event,v_actor,v_role
 FROM nexus_organizer_access(p_slug,p_issuer,p_subject) a;
 IF v_event IS NULL OR v_role<>'manager' THEN
  RAISE EXCEPTION 'check-in restricted to event manager' USING ERRCODE='42501';
 END IF;
 IF p_method<>'manual' OR p_reference !~ '^[a-f0-9]{32}$' THEN
  RAISE EXCEPTION 'unsupported check-in request' USING ERRCODE='22023';
 END IF;
 -- Serialize check-in with attendee cancellation and waitlist promotion.
 PERFORM 1 FROM nexus_events WHERE id=v_event AND publication_status='published' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'event is not published' USING ERRCODE='P0002'; END IF;
 SELECT en.id,en.status INTO v_record
 FROM nexus_conference_enrollments en
 WHERE en.event_id=v_event AND en.confirmation_reference=p_reference;
 IF NOT FOUND THEN RAISE EXCEPTION 'registration not found' USING ERRCODE='P0002'; END IF;
 IF v_record.status<>'registered' THEN
  RAISE EXCEPTION 'registration not active' USING ERRCODE='22023';
 END IF;
 INSERT INTO nexus_conference_checkins(enrollment_id,event_id,actor_id,method)
 VALUES(v_record.id,v_event,v_actor,'manual')
 ON CONFLICT(enrollment_id) DO NOTHING
 RETURNING enrollment_id INTO v_inserted;
 IF v_inserted IS NOT NULL THEN
  INSERT INTO nexus_event_audit(event_id,actor_member_id,action,detail)
  VALUES(v_event,v_actor,'attendee_manual_checkin',
    jsonb_build_object('enrollmentId',v_record.id));
 END IF;
 RETURN jsonb_build_object('status','checked_in','alreadyCheckedIn',v_inserted IS NULL);
END $$;
