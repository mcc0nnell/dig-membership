# DIG Nexus foundation (experimental)

This branch proposes the common domain model for DIG membership, directory, DC27 and other events, committees, governance, dues, and newsletter authorization. **No deployment, real payment processing, voting system, or member import has occurred.**

## Modules
- Member identity and opt-in directory (default private)
- Explicit role permissions; authentication still required at the Cloudflare gateway
- Events and capacity-aware registration; server must lock the event before allocating places
- Committee rosters and restricted documents
- Dues receipts from a payment provider; no card data stored
- Election eligibility only; secret-ballot casting/counting deliberately excluded pending independent security design
- Newsletter campaign approval; MailerSend delivery remains disabled

## Architecture
WordPress presentation → Cloudflare Workers (verified sessions, rate limits, authorization, queues) → dedicated Neon PostgreSQL. MailerSend is outbound transport. Sensitive accessibility requests must be visible only to authorized event staff, never the directory or newsletters.

## Verification
Run `node --test nexus/*.test.mjs newsletter/*.test.mjs` with Node 20+.
These are pure unit tests, not database or end-to-end tests.

## Production gates
1. Provision isolated DIG Neon project; apply schema in staging, verify migrations/constraints.
2. Implement real session verification, CSRF protection, and per-resource authorization on every API endpoint.
3. Implement privacy controls, data retention/export/deletion, and access logs without sensitive request bodies.
4. Build WordPress screens with keyboard and screen-reader testing plus ASL/captioned content.
5. Integrate MailerSend with compliant unsubscribe and signed webhooks; never send without verified consent.
6. Integrate a payment provider with verified webhooks, reconciliation and refunds.
7. Validate concurrency on registration/waitlists and duplicate payment notifications.
8. Commission a separate, independently reviewed election system before handling secret ballots.
9. Do not expose membership or accommodation data in public APIs.

## NTC conference milestone

See [NTC-CONFERENCE.md](NTC-CONFERENCE.md) for the original product specification, migration 005, public agenda endpoints and the unpublished-by-default release gate.

## Conference attendee registration (development)

See [ATTENDEE-REGISTRATION.md](ATTENDEE-REGISTRATION.md). Registration is separate from DIG membership; authenticated attendee API, database migrations, and restricted coordinator read are disabled until the staging release gate.
