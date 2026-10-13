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

Every route requires staff verification, a configured rate limiter, server-side SQL authorization and parameterized queries. Writes additionally require exact HTTPS same-origin checks and `X-Dig-Nexus-Action` set to `record-activity` or `queue-campaign`, respectively. Activity payload permits only `action` and `summary`; campaign queue accepts no body. Unknown errors do not leak SQL or private records. These routes have a **default-disabled, private staff workspace** at `/association`; there is no public administrative interface and no live deployment.

## Migration and test order

Only on a fresh, isolated PostgreSQL 17 or Neon staging branch:

```text
nexus/schema.sql and migrations 002–013
newsletter/schema.sql
newsletter/schema-002-unsubscribe.sql
newsletter/schema-003-operations.sql
newsletter/schema-004-unsubscribe-redemption.sql
nexus/tests/constituent-operations-integration.sql
```

The integration script uses synthetic staff, members, organizations, two contrasting consent states and a campaign. It proves staff denial, activity immutability, member/email separation, one-time queue approval, content locking, subscriber suppression and transaction rollback.

Before any production launch, apply restricted grants, audit real-data visibility, validate subject revocation, enforce privacy retention and response workflows, review audience/legal compliance, and complete human staff UI accessibility testing. The Chromium/axe checks are automated proof only. Do not run these migrations against Neon `main` by default.


## Staff workspace — browser-tested

The original accessible [association workspace](api/association-page.mjs) is served at
`/association` only if at least one of `CONSTITUENTS_ENABLED` or
`CAMPAIGNS_ENABLED` has been intentionally enabled. Private records are fetched
only after an explicit lookup, and all values are inserted with `textContent`.
Staff can see the existing constituent summary and record a follow-up; a
separate campaign panel shows recipient *counts* and requires a confirmation
checkbox before queueing. **Queuing does not send.** Every API operation still
authorizes immutable identity, a DIG staff role and the applicable feature
flag at the database and HTTP boundaries.

The Chromium/axe suite checks automated WCAG A/AA rules, keyboard basics,
the member text-escape boundary, and the campaign-queue confirmation.
Those automated scans are not proof of accessibility for Deaf users or
screen-reader acceptance; human testing remains required.

## Newsletter one-click and dispatch proof (not launched)

Migration `newsletter/schema-004-unsubscribe-redemption.sql` adds atomic,
replay-safe hashed token redemption at `/newsletter/unsubscribe/:token`.
GET displays a confirmation page without changing consent; a MailerSend
RFC 8058-style `application/x-www-form-urlencoded` one-click POST and a
human confirmation POST both call the same transaction. The response does
not reveal whether an address exists. Unsubscribe immediately changes the
subscriber state and suppresses queued deliveries.

The same migration includes a **single-recipient** PostgreSQL dispatch claim:
- selects only approved, queued campaigns and recipients whose current
  subscriber status and recorded consent are valid;
- locks the subscriber and delivery with `SKIP LOCKED`, moves it to
  `sending`, and issues a new opaque one-click token;
- calls a second database consent/approval preflight immediately before
  the provider API request, suppressing in-flight work if consent changed
  since claim (there remains a narrow interval before network acceptance);
- never automatically reclaims an ambiguous `sending` state after a
  network error, to avoid accidental duplicate marketing email;
- separately acknowledges a provider API message ID, which means API
  acceptance, *not* delivery to an inbox.

[`newsletter/dispatch.mjs`](../newsletter/dispatch.mjs) has one
explicitly gated `dispatchOne` operation but **no automatic worker or
timer**. All five flags must be enabled:
`DIG_NEWSLETTER_SEND_ENABLED`, `DIG_NEWSLETTER_MARKETING_READY`,
`DIG_NEWSLETTER_ONE_CLICK_VERIFIED`, `NEWSLETTER_UNSUBSCRIBE_ENABLED`
and `DIG_NEWSLETTER_DISPATCH_ENABLED`. The default Docker configuration
provides neither permission nor execution, so **no messages are sent**.

MailerSend documents a `list_unsubscribe` API parameter, which sets its
one-click POST header; use of custom unsubscribe headers requires a
supported plan (see [MailerSend unsubscribe documentation](https://www.mailersend.com/help/how-to-add-a-custom-unsubscribe-header)).
The adapter is intentionally blocked until the account plan and
real-provider behavior are verified. It appends a visible HTTPS
unsubscribe link to HTML and plain text as well.

Before launching: validate the real MailerSend plan/domain, webhook
signatures and provider acceptance receipts, queue grants and retention,
privacy/security rules, customer support process, deliverability,
compliance, and unsubscribed-recipient handling. Raw token URLs should not
be captured in proxy request logs. Run synthetic, sandboxed tests and
confirm an end-to-end unsubscribe before enabling a single live send.

To test against disposable PostgreSQL 17 apply ordered Nexus 001–013,
newsletter 001–004, then
`nexus/tests/newsletter-dispatch-integration.sql`. It rolls back all
synthetic subscriber and campaign records.
