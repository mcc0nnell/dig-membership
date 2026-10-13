# DIG Nexus Newsletter — consent-first communications

**Development only; no marketing emails or automatic newsletter worker are enabled.** The selected DIG Nexus runtime is Docker Compose + Caddy + Neon PostgreSQL, with MailerSend as an optional outbound provider. This is original Nexus code informed by common mailing-list behavior, not a listmonk deployment or source import.

## Current model

- `schema.sql` defines subscriber state, campaigns and delivery records. Apply schemas 002–004 in order, **only** on a disposable PostgreSQL 17 database or isolated approved Neon staging branch.
- List membership, DIG membership, committee roles, NTC attendance and constituent affiliation never confer newsletter consent. `pending` is not `subscribed`; an explicitly consented subscriber is required before approval can queue a delivery.
- Restricted staff APIs expose **audience counts, not addresses**, with an explicit queue-approval step and immutable approved campaign content. The browser [association staff workspace](../nexus/ASSOCIATION-OPERATIONS.md) also requires verified staff authorization.
- The opt-out endpoint uses a hashed opaque token, GET confirmation screen and atomic POST redemption; unsubscribe/bounce/complaint states suppress queued mail.
- `dispatch.mjs` implements a single-recipient claim, a second consent preflight immediately before provider transport, and separate provider API receipt acknowledgement; ambiguous results are **not retried automatically**.
- `mailersend.mjs` adds visible unsubscribe URLs to HTML/text and the provider's `list_unsubscribe` parameter, but requires verified one-click plan support and explicit launch gates.
- Provider API acceptance is **not** evidence of recipient inbox delivery.

## Still blocked

Real sending depends on a verified sender domain, DIG consent policy, actual MailerSend account plan/webhook authenticity, unsubscribe proof, per-recipient idempotency, approved staff permissions, retention/support procedures, and a restricted runtime worker. No automatic marketing job, production recipient import, complaint webhook consumer, or live dispatch is present.

**All sending flags remain off.** The separate selected-runtime deployment and exact gates are documented in [newsletter implementation](IMPLEMENTATION.md), [association operations](../nexus/ASSOCIATION-OPERATIONS.md), and [Docker deployment](../nexus/DOCKER.md).

## Tests

```bash
node --test newsletter/*.test.mjs nexus/api/newsletter-unsubscribe.test.mjs
node --test demo/offline.test.cjs
```

GitHub also validates synthetic PostgreSQL consent/one-click/claim/preflight behavior. Never test mailing against real member addresses or the production database without separate explicit authorization.
