-- Disposable PostgreSQL fixture for concurrent writes across separate connections.
INSERT INTO nexus_events(slug,title,starts_at,ends_at,capacity,registration_open,publication_status)
VALUES ('race-event','Synthetic race event','2027-04-28T08:00:00-04:00','2027-04-30T20:00:00-04:00',1,true,'published'),
 ('race-workshop-event','Synthetic workshop race','2027-04-28T08:00:00-04:00','2027-04-30T20:00:00-04:00',2,true,'published');
INSERT INTO nexus_conference_sessions(event_id,slug,title,kind,starts_at,ends_at,capacity,published)
SELECT id,'workshop-race','Workshop race','workshop','2027-04-28T10:00:00-04:00','2027-04-28T11:00:00-04:00',1,true
FROM nexus_events WHERE slug='race-workshop-event';
SELECT nexus_conference_register('race-workshop-event','https://accounts.google.com','workshop-a','workshop-a@fixture.invalid','Workshop A');
SELECT nexus_conference_register('race-workshop-event','https://accounts.google.com','workshop-b','workshop-b@fixture.invalid','Workshop B');
