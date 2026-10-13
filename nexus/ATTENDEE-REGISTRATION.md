# NTC attendee registration — development milestone

This is an original, Salesforce-free DIG Nexus conference registration implementation.
It is designed for DC27/NTC (April 28–30, 2027), and future events. It is **not
live**, does **not** send email, does **not** charge money, and does **not** issue
check-in credentials. Any conference title, fee, program or venue must be
confirmed and published by authorized DIG staff.

## What works in isolated staging

- Attendees do **not** need a DIG membership. They are kept in separate
  `nexus_conference_attendees` and `nexus_conference_enrollments` tables; no
  `nexus_members`, voting, directory, dues or newsletter record is created.
- The first sign-in path is the existing **verified Google OIDC session**, with
  server-side revocation. It is not an email-only/no-Google registration yet;
  support for additional verified sign-in methods is a separate accessibility
  and identity milestone. No browser-supplied `memberId`, email, or role is trusted.
- `GET /conference/:slug` shows an accessible self-service enrollment shell.
  Only session-verified users can call attendee APIs. Published agendas remain
  available at `/events/:slug` independently.
- `POST /api/conference/:slug/register` accepts only a display name and uses
  the verified sign-in email. Enrollment is rejected unless the event is both
  published and explicitly `registration_open`. Idempotent retries return the
  same random confirmation reference; changing verified identities with a
  duplicate email fails closed. This is a **reference**, never an auth token,
  ticket or payment receipt.
- `GET /api/conference/:slug/me` returns only the current person's enrollment,
  private request and workshop selections. It cannot list other attendees.
- `POST /api/conference/:slug/workshops` reserves or cancels a *published*
  workshop. Atomic event-row locking ensures no overbooking; full workshops
  offer a time-ordered waitlist. Cancelling a confirmed seat promotes an
  eligible waitlistee. Confirmed overlapping workshops are prohibited.
- `POST /api/conference/:slug/cancel` cancels the conference place, cancels
  workshops, removes the accommodation request and promotes the oldest event
  waitlistee. It does not issue a refund; payment is not implemented.
- `PUT /api/conference/:slug/accommodations` accepts a private note **only**
  with explicit request-specific consent, or deletes it with `request: null`.
  Never send this field to newsletter, analytics, attendee exports, public
  speaker profiles or the QR/check-in system.
- `GET /coordination/:slug` is a separate, server-authenticated coordinator
  shell. `GET /api/conference/:slug/coordination` returns requests only to
  explicitly assigned event coordinators via
  `nexus_conference_access_coordinators`. Reading this sensitive information
  appends a metadata-only audit entry. Ordinary event managers and editors do
  not automatically gain access.

## Transaction and privacy boundaries

- All attendee writes use one PostgreSQL function per request. Enrollment,
  workshop selection, cancellation and accommodation updates acquire an event
  row lock; organizer changes use the same lock. New events stay unpublished
  and registration-closed by default.
- Read access always uses the *verified issuer and immutable subject*, not a
  client-provided email. An existing email with another verified identity is a
  conflict for staff resolution, never automatic account linking.
- Confirmation references are random opaque identifiers returned only in the
  signed-in user's view. **No MailerSend email is sent**; a separate approved
  transactional notification outbox and delivery/retry pipeline are required.
  Marketing consent is independent and is never inferred from registration.
- Accommodation requests are sensitive personal information. Minimize notes,
  do not log request bodies, define retention and staff access review, and
  test with Deaf, DeafBlind, captioning and keyboard/screen-reader participants
  before production. Database encryption/access controls and backups need an
  independent privacy review.
- Registration is not payment authorization. Capacity allocation does not
  guarantee a paid ticket. Add verified payment webhooks, refunds, receipts,
  and coordinated seat-release policy before selling admissions.
- The attendee page clearly discloses that requests do not guarantee specific
  services until organizers confirm them.

## Deployment gates and operator controls

1. Provision **isolated** Neon staging; apply SQL migrations 001–007 in order.
   Never apply to production simply to test functionality.
2. Create the NTC event, review agenda and published workshop capacities, and
   obtain organizer approval for publication. A privileged administrator may
   enable `nexus_events.registration_open=true` only for that reviewed event;
   there is deliberately no public API to open registrations.
3. Verify real Google sign-in, session revocation, same-origin policy, rate
   limiting and Cloudflare binding on the chosen staging origin. Keep
   `CONFERENCE_REGISTRATION_ENABLED=false` until the release gate is approved.
4. Explicitly assign coordinator members using audited administrative database
   procedure to `nexus_conference_access_coordinators`. There is no HTTP
   endpoint for coordinator self-assignment.
5. Test guest/workshop concurrency, refunds and the cancellation policy,
   translated/ASL/captioned instructions, accessible validation, coordinated
   follow-ups and confidential-data retention. The system currently supports
   **individual attendees only**, not dependent/guest registration.
6. Add approved transactional email confirmations, payment integration and
   onsite credential issuance before any public NTC launch.

## Local verification

- `node --test nexus/api/conference-*.test.mjs`
- The DIG Nexus unit workflow tests all existing modules and validates a Worker
  `wrangler deploy --dry-run` bundle (not a deployment).
- PostgreSQL 17 workflow applies schema 007, runs
  `nexus/tests/conference-integration.sql` (always ROLLBACK), and runs
  `nexus/tests/conference-concurrency.sh` against a **disposable local** service,
  where two independent DB connections race for one event place and one
  workshop seat. The shell script refuses remote or non-explicit databases.

No real member or attendee data was created by this milestone.
