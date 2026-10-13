#!/usr/bin/env bash
set -euo pipefail
# Refuse to run against anything other than explicit disposable local PostgreSQL.
if [[ "${CONFERENCE_TEST_DATABASE:-}" != "1" || "${PGDATABASE:-}" != "dig_nexus" || "${PGUSER:-}" != "postgres" || ! "${PGHOST:-}" =~ ^(localhost|127\.0\.0\.1)$ ]]; then
 echo 'Refusing concurrency test: requires explicitly selected localhost disposable dig_nexus database' >&2
 exit 2
fi
psql -v ON_ERROR_STOP=1 -f nexus/tests/conference-concurrency-setup.sql >/dev/null
psql -v ON_ERROR_STOP=1 -Atc "SELECT nexus_conference_register('race-event','https://accounts.google.com','race-a','race-a@fixture.invalid','Race A');" >/tmp/dig-ntc-race-a.txt &
a=$!
psql -v ON_ERROR_STOP=1 -Atc "SELECT nexus_conference_register('race-event','https://accounts.google.com','race-b','race-b@fixture.invalid','Race B');" >/tmp/dig-ntc-race-b.txt &
b=$!
wait "$a";wait "$b"
registered=$(psql -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM nexus_conference_enrollments en JOIN nexus_events e ON en.event_id=e.id WHERE e.slug='race-event' AND en.status='registered';")
waitlisted=$(psql -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM nexus_conference_enrollments en JOIN nexus_events e ON en.event_id=e.id WHERE e.slug='race-event' AND en.status='waitlisted';")
[[ "$registered" == "1" && "$waitlisted" == "1" ]] || { echo "Event race failed: registered=$registered waitlisted=$waitlisted" >&2; exit 1; }
psql -v ON_ERROR_STOP=1 -Atc "SELECT nexus_conference_workshop('race-workshop-event','https://accounts.google.com','workshop-a','workshop-race','reserve');" >/tmp/dig-ntc-workshop-a.txt &
a=$!
psql -v ON_ERROR_STOP=1 -Atc "SELECT nexus_conference_workshop('race-workshop-event','https://accounts.google.com','workshop-b','workshop-race','reserve');" >/tmp/dig-ntc-workshop-b.txt &
b=$!
wait "$a";wait "$b"
confirmed=$(psql -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM nexus_conference_workshop_reservations w JOIN nexus_conference_sessions s ON s.id=w.session_id WHERE s.slug='workshop-race' AND w.status='confirmed';")
waitlisted=$(psql -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM nexus_conference_workshop_reservations w JOIN nexus_conference_sessions s ON s.id=w.session_id WHERE s.slug='workshop-race' AND w.status='waitlisted';")
[[ "$confirmed" == "1" && "$waitlisted" == "1" ]] || { echo "Workshop race failed: confirmed=$confirmed waitlisted=$waitlisted" >&2; exit 1; }
echo 'PASS: two concurrent event requests -> 1 registered + 1 waitlisted; two concurrent workshop requests -> 1 confirmed + 1 waitlisted'
