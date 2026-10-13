-- Only disposable PostgreSQL CI / isolated staging. Data is synthetic and rolled back.
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE actor uuid; eventid uuid; ref text; outcome jsonb; invalid_denied boolean:=false;
BEGIN
 PERFORM nexus_register_verified_identity('https://id.example.invalid','ntc-manager','ntc-manager@example.invalid','Synthetic Manager');
 SELECT id INTO actor FROM nexus_members WHERE email_key='ntc-manager@example.invalid';
 IF actor IS NULL THEN RAISE EXCEPTION 'no synthetic manager'; END IF;
 INSERT INTO nexus_events(slug,title,starts_at,ends_at,publication_status,registration_open)
 VALUES('ntc-checkin-synthetic','Synthetic Check-in Conference','2027-04-28 09:00:00-04','2027-04-30 18:00:00-04','published',true)
 RETURNING id INTO eventid;
 INSERT INTO nexus_event_staff_assignments(event_id,member_id,staff_role)
 VALUES(eventid,actor,'manager');
 PERFORM nexus_conference_register('ntc-checkin-synthetic',
  'https://id.example.invalid','ntc-attendee','ntc-attendee@example.invalid','Synthetic Attendee');
 SELECT en.confirmation_reference INTO ref FROM nexus_conference_enrollments en
 WHERE en.event_id=eventid;
 IF ref IS NULL THEN RAISE EXCEPTION 'no synthetic attendee'; END IF;
 -- Attendee may not impersonate staff, even when holding their own reference.
 BEGIN
  PERFORM nexus_conference_staff_checkin('ntc-checkin-synthetic',
   'https://id.example.invalid','ntc-attendee',ref,'manual');
 EXCEPTION WHEN insufficient_privilege THEN invalid_denied:=true;
 END;
 IF NOT invalid_denied THEN RAISE EXCEPTION 'attendee bypassed staff check'; END IF;
 -- Only manual check-in is implemented. No QR or payment recognition.
 invalid_denied:=false;
 BEGIN
  PERFORM nexus_conference_staff_checkin('ntc-checkin-synthetic',
   'https://id.example.invalid','ntc-manager',ref,'qr');
 EXCEPTION WHEN invalid_parameter_value THEN invalid_denied:=true;
 END;
 IF NOT invalid_denied THEN RAISE EXCEPTION 'unsupported QR was accepted'; END IF;
 outcome=nexus_conference_staff_checkin('ntc-checkin-synthetic',
  'https://id.example.invalid','ntc-manager',ref,'manual');
 IF outcome->>'status'<>'checked_in' OR outcome->>'alreadyCheckedIn'<>'false'
 THEN RAISE EXCEPTION 'expected first check-in: %',outcome; END IF;
 outcome=nexus_conference_staff_checkin('ntc-checkin-synthetic',
  'https://id.example.invalid','ntc-manager',ref,'manual');
 IF outcome->>'alreadyCheckedIn'<>'true' THEN RAISE EXCEPTION 'duplicate created second visit'; END IF;
 IF (SELECT count(*) FROM nexus_conference_checkins WHERE event_id=eventid)<>1
 THEN RAISE EXCEPTION 'check-in count mismatch'; END IF;
 IF (SELECT count(*) FROM nexus_event_audit WHERE event_id=eventid AND action='attendee_manual_checkin')<>1
 THEN RAISE EXCEPTION 'audit entry count mismatch'; END IF;
 PERFORM nexus_conference_cancel('ntc-checkin-synthetic','https://id.example.invalid','ntc-attendee');
 invalid_denied:=false;
 BEGIN
  PERFORM nexus_conference_staff_checkin('ntc-checkin-synthetic',
   'https://id.example.invalid','ntc-manager',ref,'manual');
 EXCEPTION WHEN invalid_parameter_value THEN invalid_denied:=true;
 END;
 IF NOT invalid_denied THEN RAISE EXCEPTION 'cancelled registration was checked in'; END IF;
END $$;

DO $$
DECLARE id1 uuid; token uuid; result record; job_id uuid;
BEGIN
 INSERT INTO nexus_background_jobs(task,dedupe_key) VALUES('runtime_expiry_cleanup','fixture-one') RETURNING id INTO id1;
 IF (SELECT count(*) FROM nexus_background_jobs WHERE task='runtime_expiry_cleanup')<>1
 THEN RAISE EXCEPTION 'queue enqueue mismatch'; END IF;
 WITH claim AS (
  SELECT id FROM nexus_background_jobs
  WHERE state='queued' AND run_at<=now() AND attempts<max_attempts
  ORDER BY run_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1
 )
 UPDATE nexus_background_jobs j SET state='running',attempts=j.attempts+1,
  lease_until=now()+interval '90 seconds',lease_token=gen_random_uuid()
 FROM claim WHERE j.id=claim.id RETURNING j.id,j.lease_token INTO job_id,token;
 IF job_id<>id1 OR token IS NULL THEN RAISE EXCEPTION 'claim failed'; END IF;
 -- Stale lease never completes.
 UPDATE nexus_background_jobs SET state='done' WHERE id=id1
  AND lease_token=gen_random_uuid() AND lease_until>now();
 IF FOUND THEN RAISE EXCEPTION 'stale lease acknowledged'; END IF;
 UPDATE nexus_background_jobs SET state='done',lease_until=NULL,lease_token=NULL,finished_at=now()
 WHERE id=id1 AND lease_token=token AND state='running' AND lease_until>now();
 IF NOT FOUND THEN RAISE EXCEPTION 'owner could not acknowledge'; END IF;
 INSERT INTO nexus_runtime_tokens(token_hash,kind,expires_at)
 VALUES(repeat('d',64),'session',now()-interval '1 day');
 WITH gone AS (DELETE FROM nexus_runtime_tokens WHERE expires_at<now()-interval '5 minutes' RETURNING 1)
 SELECT count(*) INTO result FROM gone;
 IF result.count<>1 THEN RAISE EXCEPTION 'expired token cleanup did not run'; END IF;
END $$;
ROLLBACK;
