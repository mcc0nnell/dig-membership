# NTC conference platform — clean-room product specification

This DIG Nexus implementation was written from original DIG/NTC needs and public
behavioral descriptions of event software. No Summit Events App or Salesforce
source code, data model, Apex classes, markup, or templates were copied.
The runtime is Cloudflare Workers + Neon PostgreSQL, with a possible WordPress
presentation layer. It is not a Salesforce port or a production conference site.

## NTC 2027 use case

The planned **DIG National Training Conference, DC27**, is scheduled for **April
28–30, 2027, in Washington, DC**, with the theme *The Now and the Possible*.
The address, fees, session lineup, and accommodations must come from approved DIG
organizer data, not test fixtures. Do not publish placeholder schedules as facts.

The conference's primary workflows are:

1. Organizers create an event edition with an agenda, tracks, rooms, sessions,
   speaker profiles and workshop capacities; only explicitly published content
   is public. Preserve the same schema for NTC28 and regional events.
2. A visitor explores an accessible public agenda by day, track and format, and
   later registers for the event. Registration must not require a DIG membership.
3. A registrant selects ticket type, chooses capacity-constrained workshops,
   manages guests, and receives a confirmation; payments are integrated through
   a hosted processor, never card numbers in DIG Nexus.
4. A registrant may privately request ASL interpreters, CART captions,
   DeafBlind/SSP support, mobility access, dietary support or other accommodations.
   These are needs to be arranged, not services promised by default. Only a
   minimum authorized accessibility-coordination team may view them.
5. Event staff scan individually scoped tickets/QR tokens, reconcile attendance,
   handle manual lookup, and manage onsite capacities. Never put a person’s
   accessibility request or membership status in the QR payload.
6. After the event, staff export restricted financial and attendance reports,
   publish presentations with speaker consent, and apply a retention policy.

## Current implemented vertical slice (development only)

- `schema-005-conference.sql` extends existing `nexus_events` and adds session,
  presenter and linking tables. New and existing events default to draft; new
  sessions and speaker bios default to private. No public registrations are added.
- `GET /api/events/:slug/agenda` returns ONLY published event/session and
  explicitly public speaker information from parameterized DB queries.
- `GET /events/:slug` renders a semantic, keyboard-friendly server-side agenda;
  no scripts, embedded trackers, member emails, or registration data.
- Both routes return 404 for draft/unknown events, 503 if no database exists,
  and never reveal SQL errors. There is no server-side event management UI yet.
- `nexus_registrations` and `nexus_event_checkins` remain canonical attendance
  foundations. Payment, workshop reservation, attendee operations and private
  accessibility workflow are explicitly NOT available yet.

## Next implementation order

1. Authorized organizer CRUD and preview/publish transitions with audit logging
   and per-event staff permissions; validate session date ranges.
2. Independent attendee registration (without requiring paid DIG membership),
   secure expiring confirmation tokens and transactional event/workshop capacity.
3. Accommodation intake and a restricted staff coordinator view with explicit
   purpose, consent, retention, access logs and no public directory joining.
4. Accessible staff check-in (keyboard/manual and camera QR option), duplicate
   protection, offline-safe queue and reconciliation.
5. Payment provider webhooks and receipts, then speaker submission, exhibitors,
   session proposal review, and administrative export/reporting.

## Verification and rollout

Run `node --test nexus/api/agenda-*.test.mjs` and all repository tests. CI
validates all ordered SQL schemas against PostgreSQL 17. Apply migration 005 only
in isolated staging after review; neither Neon production nor Cloudflare is
modified by a PR. The current public API responds 503 until a safe DB binding
exists, and draft data remains invisible until an organizer publishes it.

## Organizer console milestone

See [ORGANIZER-DEPLOYMENT.md](ORGANIZER-DEPLOYMENT.md). The restricted
`/organizer/:slug` shell and `/api/organizer/:slug` snapshot/actions support
editing sessions, room labels, speaker profiles and session assignments, with
manager-approved publication and metadata-only audit. This requires a working
Google session and explicit event staff provisioning. It is off by default.
