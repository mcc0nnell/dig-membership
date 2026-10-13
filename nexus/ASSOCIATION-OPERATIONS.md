# DIG Nexus clean-room association and newsletter operations

This adds **original DIG Nexus behavior**, informed by the general functional capabilities of **CiviCRM** (constituent and association management) and **listmonk** (lists and newsletters). No CiviCRM or listmonk source code was imported. Neither AGPL application is deployed as a dependency, and there is no Salesforce dependency.

The target remains **Docker Compose + Caddy + Neon**. The initial operations are developer/staging features. All production operations remain disabled and require an independently approved staff access policy, consent policy, privacy notice, and database role design.

## Constituents — association-management foundation

Migration `nexus/schema-012-constituents.sql` extends the **existing** `nexus_members`, `nexus_roles`, `nexus_committees`, `nexus_membership_terms`, and `nexus_dues` models. It adds:

- Organizations (government, nonprofit, education and other), with separate time-bound member affiliations
- Internal case metadata with assignment, status and category; no accommodation details are imported
- Staff follow-up activities with an append-only trigger and identified actor
- A staff-restricted summary of member status, membership terms, committees, affiliations and counts

Neither constituent affiliation nor case status changes membership entitlement, voting eligibility, directory opt-in, ticketing status or newsletter consent. The official membership-term and role rules remain independent. Sensitive accommodations and medical information must not be copied into activity summaries.

## Communications — list/campaign operations

Migration `newsletter/schema-003-operations.sql` extends the existing subscriber, campaign, delivery and hashed unsubscribe-token tables. It adds:

- Named lists and explicit list-subscription records
- Private, staff-authorized campaign audience previews showing counts only
- A separate approval/queuing transaction which materializes deliveries **only** for actively subscribed addresses with recorded consent
- Immutable approved campaign content, append-only approval auditing and automatic suppression of queued deliveries on unsubscribe, bounce or complaint

List assignment alone is **not consent**. A member, committee participant, registrant, or CiviCRM-style constituent does not automatically become a newsletter subscriber. This feature introduces **no bulk-import bypass**, automated mass-send, email opens/clicks tracking, or default-on marketing worker. The existing MailerSend adapter stays behind `DIG_NEWSLETTER_SEND_ENABLED` and `DIG_NEWSLETTER_MARKETING_READY`, which are disabled in the default deployment.

The queue is a **delivery plan**, not delivery confirmation. A future real sender must obtain a narrow DB role, atomically claim jobs and recheck suppression/consent immediately before calling MailerSend. Sender retries, unsubscribe headers, provider event handling, deliverability, retention and lawful-basis policies still need verification.

## Private HTTP boundary

Existing session and verified immutable subject are required. PostgreSQL functions independently check a **non-suspended, active DIG officer or administrator** via `nexus_external_identities` and `nexus_roles`. Browser-provided role, member id or email headers confer no authority.

| Route | Method | Use | Flag (default off) |
| --- | --- | --- | --- |
| `/api/association/members/:uuid` | GET | Staff-only constituent summary | `CONSTITUENTS_ENABLED` |
| `/api/association/members/:uuid/activities` | POST | Record follow-up activity | `CONSTITUENTS_ENABLED` |
| `/api/association/campaigns/:uuid` | GET | Preview eligible audience count | `CAMPAIGNS_ENABLED` |
| `/api/association/campaigns/:uuid/queue` | POST | Queue approved, consented recipients | `CAMPAIGNS_ENABLED` |

Every route requires staff verification, a configured rate limiter, server-side SQL authorization and parameterized queries. Writes additionally require exact HTTPS same-origin checks and `X-Dig-Nexus-Action` set to `record-activity` or `queue-campaign`, respectively. Activity payload permits only `action` and `summary`; campaign queue accepts no body. Unknown errors do not leak SQL or private records. These routes have **no public administration UI** yet.

## Migration and test order

Only on a fresh, isolated PostgreSQL 17 or Neon staging branch:

```text
nexus/schema.sql and migrations 002–011
nexus/schema-012-constituents.sql
newsletter/schema.sql
newsletter/schema-002-unsubscribe.sql
newsletter/schema-003-operations.sql
nexus/tests/constituent-operations-integration.sql
```

The integration script uses synthetic staff, members, organizations, two contrasting consent states and a campaign. It proves staff denial, activity immutability, member/email separation, one-time queue approval, content locking, subscriber suppression and transaction rollback.

Before any production launch, apply restricted grants, audit real-data visibility, validate subject revocation, enforce privacy retention and response workflows, review audience/legal compliance and add full staff UI accessibility testing. Do not run these migrations against Neon `main` by default.
