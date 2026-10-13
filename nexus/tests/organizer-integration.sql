-- Disposable PostgreSQL-only integration proof. Any unexpected behavior fails CI.
BEGIN;
INSERT INTO nexus_members(id,email,display_name) VALUES
 ('11111111-1111-4111-8111-111111111111','editor@fixture.invalid','Synthetic Editor'),
 ('22222222-2222-4222-8222-222222222222','manager@fixture.invalid','Synthetic Manager'),
 ('33333333-3333-4333-8333-333333333333','outsider@fixture.invalid','Synthetic Outsider');
INSERT INTO nexus_external_identities(issuer,subject,member_id) VALUES
 ('https://accounts.google.com','editor','11111111-1111-4111-8111-111111111111'),
 ('https://accounts.google.com','manager','22222222-2222-4222-8222-222222222222'),
 ('https://accounts.google.com','outsider','33333333-3333-4333-8333-333333333333');
INSERT INTO nexus_roles(member_id,role) VALUES ('22222222-2222-4222-8222-222222222222','admin');
INSERT INTO nexus_events(id,slug,title,starts_at,ends_at) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ntc-test','Synthetic NTC','2027-04-28T08:00:00-04:00','2027-04-30T20:00:00-04:00'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','other-test','Other Synthetic','2027-04-28T08:00:00-04:00','2027-04-30T20:00:00-04:00');
INSERT INTO nexus_event_staff_assignments(event_id,member_id,staff_role)
 VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','editor');
DO $$
DECLARE v jsonb; n integer;
BEGIN
 IF nexus_organizer_snapshot('ntc-test','https://accounts.google.com','outsider') IS NOT NULL
 OR nexus_organizer_snapshot('other-test','https://accounts.google.com','editor') IS NOT NULL
 OR nexus_organizer_snapshot('ntc-test','https://accounts.google.com','editor') IS NULL
 THEN RAISE EXCEPTION 'draft scope boundary failed'; END IF;
 BEGIN
  PERFORM nexus_organizer_apply('ntc-test','https://accounts.google.com','outsider','set_event_publication','{"publicationStatus":"published"}');
  RAISE EXCEPTION 'outsider mutation unexpectedly succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM nexus_organizer_apply('ntc-test','https://accounts.google.com','editor','save_session',
  '{"slug":"one","title":"Synthetic Workshop","kind":"workshop","startsAt":"2027-04-28T09:00:00-04:00","endsAt":"2027-04-28T10:00:00-04:00","room":"Room A","capacity":40}');
 SELECT count(*) INTO n FROM nexus_conference_sessions WHERE slug='one' AND published=false;
 IF n<>1 THEN RAISE EXCEPTION 'draft session not created'; END IF;
 BEGIN
  PERFORM nexus_organizer_apply('ntc-test','https://accounts.google.com','editor','set_session_publication','{"slug":"one","published":true}');
  RAISE EXCEPTION 'editor published unexpectedly';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM nexus_organizer_apply('other-test','https://accounts.google.com','editor','save_session',
   '{"slug":"one","title":"Cross event","kind":"workshop","startsAt":"2027-04-28T09:00:00-04:00","endsAt":"2027-04-28T10:00:00-04:00"}');
  RAISE EXCEPTION 'cross-event mutation succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM nexus_organizer_apply('ntc-test','https://accounts.google.com','editor','save_session',
   '{"slug":"bad","title":"Outside","kind":"workshop","startsAt":"2027-05-01T09:00:00-04:00","endsAt":"2027-05-01T10:00:00-04:00"}');
  RAISE EXCEPTION 'out-of-range session succeeded';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 PERFORM nexus_organizer_apply('ntc-test','https://accounts.google.com','manager','set_session_publication','{"slug":"one","published":true}');
 BEGIN
  PERFORM nexus_organizer_apply('ntc-test','https://accounts.google.com','editor','save_session',
  '{"slug":"one","title":"Unapproved rewrite","kind":"workshop","startsAt":"2027-04-28T09:00:00-04:00","endsAt":"2027-04-28T10:00:00-04:00"}');
  RAISE EXCEPTION 'editor rewrote published session';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM nexus_organizer_apply('ntc-test','https://accounts.google.com','editor','save_speaker',
  '{"id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","displayName":"Synthetic Speaker","bio":"Demo only","publicProfile":false}');
 BEGIN
  PERFORM nexus_organizer_apply('ntc-test','https://accounts.google.com','editor','save_speaker',
   '{"id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","displayName":"Synthetic Speaker","publicProfile":true}');
  RAISE EXCEPTION 'editor speaker publication succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM nexus_organizer_apply('ntc-test','https://accounts.google.com','manager','save_speaker',
  '{"id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","displayName":"Synthetic Speaker","publicProfile":true}');
 BEGIN
  PERFORM nexus_organizer_apply('ntc-test','https://accounts.google.com','editor','save_speaker',
   '{"id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","displayName":"Unapproved Rewrite","publicProfile":false}');
  RAISE EXCEPTION 'editor rewrote public speaker';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM nexus_organizer_apply('ntc-test','https://accounts.google.com','editor','set_session_speaker',
   '{"sessionSlug":"one","speakerId":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"presenter","linked":true}');
  RAISE EXCEPTION 'editor modified approved session speakers';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM nexus_organizer_apply('ntc-test','https://accounts.google.com','manager','set_session_speaker',
  '{"sessionSlug":"one","speakerId":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"presenter","linked":true}');
 PERFORM nexus_organizer_apply('ntc-test','https://accounts.google.com','manager','set_event_publication','{"publicationStatus":"published"}');
 IF (SELECT publication_status FROM nexus_events WHERE slug='ntc-test')<>'published' THEN RAISE EXCEPTION 'event not published'; END IF;
 IF (SELECT count(*) FROM nexus_conference_sessions cs
     JOIN nexus_conference_session_speakers link ON link.session_id=cs.id
     JOIN nexus_conference_speakers sp ON sp.id=link.speaker_id
     JOIN nexus_events e ON e.id=cs.event_id
     WHERE e.slug='ntc-test' AND e.publication_status='published'
       AND cs.published AND sp.public_profile AND sp.event_id=e.id)<>1
 THEN RAISE EXCEPTION 'published agenda or speaker relationship incorrect'; END IF;
 IF (SELECT count(*) FROM nexus_event_audit WHERE event_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')<>6
 THEN RAISE EXCEPTION 'audit count invalid'; END IF;
 BEGIN
  DELETE FROM nexus_event_audit WHERE event_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  RAISE EXCEPTION 'audit delete succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF (SELECT count(*) FROM nexus_event_audit WHERE actor_member_id='11111111-1111-4111-8111-111111111111')<>2
 THEN RAISE EXCEPTION 'actor attribution failed'; END IF;
END $$;
ROLLBACK;
