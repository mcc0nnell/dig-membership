#!/usr/bin/env bash
set -euo pipefail
# Two real concurrent database connections, refusing any non-disposable host/database.
if [[ "${CONFERENCE_TEST_DATABASE:-}" != "1" || "${PGDATABASE:-}" != "dig_nexus" || "${PGUSER:-}" != "postgres" || ! "${PGHOST:-}" =~ ^(localhost|127\.0\.0\.1)$ ]]; then
 echo 'Refusing paid inventory concurrency test outside explicitly selected disposable localhost PostgreSQL' >&2
 exit 2
fi
psql -v ON_ERROR_STOP=1 -f nexus/tests/paid-inventory-concurrency-setup.sql >/dev/null
out_a=$(mktemp);out_b=$(mktemp)
trap 'rm -f "$out_a" "$out_b"' EXIT
psql -v ON_ERROR_STOP=1 -Atc "SELECT nexus_conference_zeffy_reconcile('race-paid-event-a-001','e4000000-0000-4000-8000-000000000004','e2000000-0000-4000-8000-000000000002','e3000000-0000-4000-8000-000000000003','race-paid-a@fixture.invalid',2500,'usd','succeeded','online','none',false);" > "$out_a" &
a=$!
psql -v ON_ERROR_STOP=1 -Atc "SELECT nexus_conference_zeffy_reconcile('race-paid-event-b-002','e5000000-0000-4000-8000-000000000005','e2000000-0000-4000-8000-000000000002','e3000000-0000-4000-8000-000000000003','race-paid-b@fixture.invalid',2500,'usd','succeeded','online','none',false);" > "$out_b" &
b=$!
wait "$a";wait "$b"
registered=$(psql -Atc "SELECT count(*) FROM nexus_conference_enrollments WHERE event_id='e1000000-0000-4000-8000-000000000001' AND status='registered';")
review=$(psql -Atc "SELECT count(*) FROM nexus_conference_enrollments WHERE event_id='e1000000-0000-4000-8000-000000000001' AND status='paid_review';")
paid=$(psql -Atc "SELECT count(*) FROM nexus_conference_payment_orders o JOIN nexus_conference_enrollments en ON en.id=o.enrollment_id WHERE en.event_id='e1000000-0000-4000-8000-000000000001' AND o.status='paid';")
conflict=$(psql -Atc "SELECT count(*) FROM nexus_conference_zeffy_reviews WHERE event_id='e1000000-0000-4000-8000-000000000001' AND reason='capacity_conflict';")
[[ "$registered" == "1" && "$review" == "1" && "$paid" == "2" && "$conflict" == "1" ]] || {
 echo "Paid seat race failed: confirmed=$registered review=$review verifiedPaid=$paid conflict=$conflict" >&2
 cat "$out_a" "$out_b" >&2
 exit 1
}
echo 'PASS: two concurrent verified Zeffy payments -> exactly one confirmed seat, one refund/manual-review case, two paid ledger entries'
