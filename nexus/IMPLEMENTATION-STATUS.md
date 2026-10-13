# DIG Nexus — implementation status

**Last reviewed: October 13, 2026. Development and synthetic validation, not a production launch.**

**Selected stack:** Docker Compose + non-root Node 22 API + Caddy HTTPS + Neon PostgreSQL. WordPress can link to the Nexus portal. Google OIDC, independent NTC magic sign-in, Zeffy reconciliation and MailerSend are optional provider integrations with separate credentials and launch gates. Neither an external CRM nor Cloudflare is a runtime requirement. The static [GitHub Pages demo](../demo/offline.html) is offline and cannot sign in, receive money, issue tickets or send email.

## What is implemented in source and synthetic tests

| Domain | Development implementation | Default deployment |
| --- | --- | --- |
| Member identity | Google OIDC authorization-code/PKCE, Neon-backed session/state, `/api/me`, pending enrollment with separate bearer registration gate | Auth credentials needed; enrollment and registration disabled |
| Membership & governance | Members, roles, terms, opt-in directory schema, committees and eligibility policy | No public directory, binding ballots or election operations |
| NTC conference | Published-only agenda, private organizer editor, attendee registration/waitlists, separate attendee magic sign-in | Event writes/ticketing default off |
| DC27 paid admission | Zeffy-hosted checkout, independently verified transactions, non-holding pending intents, atomic seat confirmation, paid-review/refund handling, QR check-in | Sales, webhooks and check-in default off; no live-provider validation |
| Constituents | Original organizations, affiliations, follow-up activities/cases; role-gated association workspace | `CONSTITUENTS_ENABLED=false` |
| Newsletter | Explicit subscriber consent, lists, previews, staff campaign queue; hashed one-click unsubscribe, suppression, single-delivery claim with second consent preflight; MailerSend adapter | No automatic dispatch worker; sending and unsubscribe disabled |
| Jobs & releases | Postgres fenced job leases, opt-in cleanup/intent expiry worker, Docker image SBOM/provenance, signed image release and rollback checks | Optional jobs worker disabled; no automatic server deployment |

A signed image or a passing synthetic test is **not** proof of working Google sign-in, a real paid Zeffy registration, or mail deliverability. No real-member database migration, public domain deployment, email send, production ticket sale, or live check-in was authorized by these repository changes.

## Database migration order

Apply **only** on disposable PostgreSQL 17 or an explicitly approved isolated Neon staging branch, and check dependent grants before considering production:

```text
nexus/schema.sql
nexus/schema-002-lifecycle.sql
nexus/schema-003-identities.sql
nexus/schema-004-registration.sql
nexus/schema-005-conference.sql
nexus/schema-006-organizer.sql
nexus/schema-007-attendee.sql
nexus/schema-008-cloud-run-state.sql   # portable Neon-backed runtime state
nexus/schema-009-ticketing.sql
nexus/schema-010-jobs.sql
nexus/schema-011-magic-links.sql
nexus/schema-012-constituents.sql
nexus/schema-013-paid-inventory.sql
newsletter/schema.sql
newsletter/schema-002-unsubscribe.sql
newsletter/schema-003-operations.sql
newsletter/schema-004-unsubscribe-redemption.sql
```

The filename `schema-008-cloud-run-state.sql` is historical; the durable state tables are also used by the Docker runtime. The presence of these migrations on GitHub **does not** mean they were applied to the default Neon branch.

## Validated evidence

- GitHub CI runs Node/Deno unit tests, disposable PostgreSQL schema and concurrency proofs, Docker Compose localhost smoke tests and Chromium/axe automated accessibility checks.
- The optional main-branch container workflow builds SBOM/provenance, signs immutable GHCR image digests through GitHub OIDC and verifies the publisher identity.
- Newsletter unit and PostgreSQL tests demonstrate consent-only queueing, atomic hashed-token unsubscribe POST, suppression, and no automatic retry after ambiguous provider acceptance.
- The demo has independent local JavaScript checks and a Chromium interaction/accessibility suite. It has **no** API, cookies, browser storage or network integrations.

For release evidence, inspect the **current** GitHub Actions run of the relevant commit rather than treating a previous green run as current validation.

## Required before any real service

1. DIG approval of membership/accessibility/privacy policies, actual restricted database grants, backup/restore and secrets management.
2. Private HTTPS Docker staging + isolated Neon branch; real Google OAuth and attendee magic-link tests with valid provider configuration.
3. Named DIG operator reconciliation of actual Zeffy inventory, verified buyer/receipt/webhook samples, refunds/disputes and safe final-seat admission.
4. MailerSend domain and account-plan verification, authenticated bounces/complaints, one-click unsubscribe acceptance test, and an approved marketing delivery policy; sending stays off.
5. Review and test accessibility with Deaf/ASL users, keyboard, screen readers, mobile zoom and captions; automated axe checks alone cannot establish WCAG compliance.
6. Defined operational ownership for retention, reporting, alerting and security incidents. Secret-ballot elections require separate independent assurance.

See [Docker setup](DOCKER.md), [paid inventory](PAID-INVENTORY.md), [association/communications](ASSOCIATION-OPERATIONS.md), [clean-room quality gates](CLEANROOM-OPERATIONS.md) and [demo walkthrough](../docs/architecture/experience-demo.md).
