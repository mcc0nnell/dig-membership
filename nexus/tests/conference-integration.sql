-- Isolated disposable DB integration. All synthetic records rolled back.
BEGIN;
INSERT INTO nexus_events(id,slug,title,starts_at,ends_at,capacity,publication_status,registration_open)
VALUES('77777777-7777-4777-8777-777777777777','conf-test','Synthetic conference','2027-04-28T08:00:00-04:00','2027-04-30T20:00:00-04:00',2,'published',true);
INSERT INTO nexus_conference_sessions(id,event_id,slug,title,kind,starts_at,ends_at,capacity,published)
VALUES('88888888-8888-4888-8888-888888888888','77777777-7777-4777-8777-777777777777','workshop-one','Synthetic Workshop','workshop','2027-04-28T10:00:00-04:00','2027-04-28T11:00:00-04:00',1,true);
INSERT INTO nexus_members(id,email,display_name) VALUES
('99999999-9999-4999-8999-999999999999','coordinator@fixture.invalid','Synthetic Coordinator'),
('aaaa0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa','not-coordinator@fixture.invalid','Synthetic Non Coordinator');
INSERT INTO nexus_external_identities(issuer,subject,member_id) VALUES
('https://accounts.google.com','coord','99999999-9999-4999-8999-999999999999'),
('https://accounts.google.com','noncoord','aaaa0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
INSERT INTO nexus_conference_access_coordinators(event_id,member_id)
VALUES ('77777777-7777-4777-8777-777777777777','99999999-9999-4999-8999-999999999999');
DO $$
DECLARE a jsonb;b jsonb;c jsonb;v_ref text; n int;
BEGIN
 a=nexus_conference_register('conf-test','https://accounts.google.com','alice','alice@fixture.invalid','Synthetic Alice');
 b=nexus_conference_register('conf-test','https://accounts.google.com','bob','bob@fixture.invalid','Synthetic Bob');
 c=nexus_conference_register('conf-test','https://accounts.google.com','carla','carla@fixture.invalid','Synthetic Carla');
 IF a->>'status'<>'registered' OR b->>'status'<>'registered' OR c->>'status'<>'waitlisted'
 THEN RAISE EXCEPTION 'conference capacity exceeded or queue missing'; END IF;
 v_ref=a->>'confirmationReference';
 a=nexus_conference_register('conf-test','https://accounts.google.com','alice','alice@fixture.invalid','Synthetic Alice');
 IF a->>'alreadyRegistered'<>'true' OR a->>'confirmationReference'<>v_ref
 THEN RAISE EXCEPTION 'retry not idempotent'; END IF;
 IF (SELECT count(*) FROM nexus_members WHERE email LIKE '%@fixture.invalid')<>2
 THEN RAISE EXCEPTION 'attendee unexpectedly created DIG membership'; END IF;
 BEGIN
  PERFORM nexus_conference_register('conf-test','https://accounts.google.com','other','alice@fixture.invalid','Other');
  RAISE EXCEPTION 'identity-email conflict improperly linked';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 IF (nexus_conference_workshop('conf-test','https://accounts.google.com','alice','workshop-one','reserve')->>'status')<>'confirmed'
 THEN RAISE EXCEPTION 'first workshop place not confirmed'; END IF;
 IF (nexus_conference_workshop('conf-test','https://accounts.google.com','bob','workshop-one','reserve')->>'status')<>'waitlisted'
 THEN RAISE EXCEPTION 'second workshop place not waitlisted'; END IF;
 BEGIN
  PERFORM nexus_conference_workshop('conf-test','https://accounts.google.com','carla','workshop-one','reserve');
  RAISE EXCEPTION 'event waitlistee booked workshop';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE nexus_conference_sessions SET published=false WHERE slug='workshop-one';
  RAISE EXCEPTION 'booked session silently unpublished';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 -- A confirmed cancellation must promote the first valid workshop waitlistee.
 PERFORM nexus_conference_workshop('conf-test','https://accounts.google.com','alice','workshop-one','cancel');
 IF (SELECT w.status FROM nexus_conference_workshop_reservations w
 JOIN nexus_conference_enrollments en ON en.id=w.enrollment_id
 JOIN nexus_conference_attendees at ON at.id=en.attendee_id WHERE at.subject='bob')<>'confirmed'
 THEN RAISE EXCEPTION 'workshop waitlist not promoted'; END IF;
 IF (nexus_conference_workshop('conf-test','https://accounts.google.com','alice','workshop-one','reserve')->>'status')<>'waitlisted'
 THEN RAISE EXCEPTION 'requeued workshop attendee not waitlisted'; END IF;
 -- A registrant cannot confirm overlapping workshops, even with capacity.
 INSERT INTO nexus_conference_sessions(event_id,slug,title,kind,starts_at,ends_at,capacity,published)
 SELECT id,'overlap','Overlapping Workshop','workshop','2027-04-28T10:30:00-04:00','2027-04-28T11:30:00-04:00',5,true
 FROM nexus_events WHERE slug='conf-test';
 BEGIN
  PERFORM nexus_conference_workshop('conf-test','https://accounts.google.com','bob','overlap','reserve');
  RAISE EXCEPTION 'overlapping workshops both confirmed';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 -- Consent and coordinator permissions are independent of newsletter / organizer.
 BEGIN
  PERFORM nexus_conference_accommodation('conf-test','https://accounts.google.com','alice','CART requested',false);
  RAISE EXCEPTION 'accommodation saved without consent';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 PERFORM nexus_conference_accommodation('conf-test','https://accounts.google.com','alice','CART requested',true);
 IF nexus_conference_self('conf-test','https://accounts.google.com','alice')->>'accessibilityRequest'<>'CART requested'
 THEN RAISE EXCEPTION 'private self view missing'; END IF;
 BEGIN
  PERFORM nexus_conference_coordination('conf-test','https://accounts.google.com','noncoord');
  RAISE EXCEPTION 'unauthorized accommodation access';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 c=nexus_conference_coordination('conf-test','https://accounts.google.com','coord');
 IF jsonb_array_length(c->'requests')<>1 OR c->'requests'->0->>'request'<>'CART requested'
 THEN RAISE EXCEPTION 'authorized coordinator could not access request'; END IF;
 IF (SELECT detail ? 'request' FROM nexus_event_audit WHERE action='read_accessibility_requests' LIMIT 1) IS DISTINCT FROM false
 THEN RAISE EXCEPTION 'audit recorded sensitive note'; END IF;
 -- Cancel Bob's event place: Carla is promoted and Alice's workshop waitlist gets the released seat.
 PERFORM nexus_conference_cancel('conf-test','https://accounts.google.com','bob');
 IF nexus_conference_self('conf-test','https://accounts.google.com','carla')->>'status'<>'registered'
 THEN RAISE EXCEPTION 'event waitlist not promoted'; END IF;
 IF (SELECT w.status FROM nexus_conference_workshop_reservations w
 JOIN nexus_conference_enrollments en ON en.id=w.enrollment_id
 JOIN nexus_conference_attendees at ON at.id=en.attendee_id WHERE at.subject='alice')<>'confirmed'
 THEN RAISE EXCEPTION 'cancel failed to promote workshop waitlist'; END IF;
 PERFORM nexus_conference_accommodation('conf-test','https://accounts.google.com','alice',NULL,false);
 IF (SELECT count(*) FROM nexus_conference_accessibility_requests)<>0 THEN RAISE EXCEPTION 'attendee delete failed'; END IF;
 PERFORM nexus_conference_cancel('conf-test','https://accounts.google.com','alice');
 IF (SELECT count(*) FROM nexus_conference_enrollments WHERE status='registered')<>1
 THEN RAISE EXCEPTION 'conference attendance after cancellations wrong'; END IF;
END $$;
ROLLBACK;
