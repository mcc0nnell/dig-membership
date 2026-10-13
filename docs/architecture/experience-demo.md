# DIG Nexus — interactive offline platform demo

**Updated October 13, 2026.** [Open the public GitHub Pages preview](https://mcc0nnell.github.io/dig-nexus/) or view [the single-file source](../../demo/offline.html).

This is an original, standalone **static HTML/CSS/JavaScript simulation** for exploring UX—not a live membership, conference, CRM, mail, finance, or voting service. All names, counts, accounts, staff records, memberships, paid-admission statuses and notifications are invented. There is **no login, backend fetch, browser storage, cookies, real payment, email provider, QR token, or persistence**. State resets on reload. The preview has a restrictive CSP that denies outbound connections.

## Walkthroughs

| Experience | What the local buttons demonstrate | Production boundary |
| --- | --- | --- |
| Membership | Fictional email-link verification, a sample member card/profile, preferences, renewal, and API identity-decision scenarios | A real verified identity is not a DIG membership approval; separate explicit pending enrollment and staff policy are required |
| DC27 / NTC | `not_requested` → `pending_payment` → sample independently verified paid admission → staff QR check-in; a refund/dispute suspends admission | Zeffy owns ticket stock; pending payment holds **zero** Nexus seats. Actual verified payment, capacity locking and staff permissions are server-side responsibilities |
| Association operations | Fictional constituent summary, affiliation/committee, local staff follow-up | Real `/association` requires verified officer/admin and server-authorized per-record access |
| Newsletters | One explicitly consented recipient, one pending non-subscriber, audience preview, explicit campaign queue approval and unsubscribe suppression | Queueing is not delivery. Real one-click unsubscribe is a POST, with provider acceptance, consent preflight and suppression controls |

The “active” demo membership card is illustrative and **does not** mean a new real applicant automatically becomes active after email verification. The actual development member enrollment route creates a **pending** request and remains disabled until approved.

## Try it

Visit the URL above, or download/open `demo/offline.html` as a local file. The four feature cards work immediately—no simulated login required. The separate member dashboard appears only after following its fictional verification flow.

- **NTC:** try registering an unpaid intent, confirm the no-reservation notice, simulate verification, check-in, and a disputed payment. Reset to start over.
- **Constituents:** open the fictional staff record and add a sample follow-up. Nothing is written to Neon.
- **Newsletters:** preview a synthetic one-consented/one-pending audience, confirm and queue, then opt out. The queued item is suppressed and messages sent remain zero.
- **Membership:** experiment with the mock email-link, profile, preferences and account-conflict response. Preferences are never inferred from joining.

## Test and publishing contract

```bash
npm ci
node --test demo/offline.test.cjs
npx playwright install chromium
npx playwright test -c demo/playwright.config.mjs
```

Node tests assert no storage, network APIs or external scripts, valid JavaScript, and the presence of all features. The Chromium tests drive the real controls, verify paid-admission state ordering and duplicate check-in protection, show HTML as inert text in a fictional activity log, confirm consent/opt-out behavior, and run axe-core WCAG A/AA automated checks. Automated scanning is **not** a claim of WCAG compliance, ASL usability, or comprehensive assistive-technology acceptance.

The [Pages workflow](../../.github/workflows/pages.yml) must pass both suites before it copies **only** `demo/offline.html` to `_site/index.html`. No application secrets, live endpoints, or user data may be included in Pages artifacts. The public route is a usability showcase, never a sign-in or enrollment link.

## Mapping to the real development code

| Demo | DIG Nexus source | Unmet launch condition |
| --- | --- | --- |
| Identity/member | `nexus/api/google-auth.mjs`, `member-enrollment.mjs`, `member-db.mjs`, identity schema | Real Google OIDC, session behavior, policy and isolated Neon tests |
| NTC | `nexus/api/conference-api.mjs`, `ticketing.mjs`, `nexus/schema-013-paid-inventory.sql` | Verified Zeffy inventory/webhooks, admission/review process and QR device tests |
| Constituent staff | `nexus/api/association-page.mjs`, `association-ops.mjs`, `nexus/schema-012-constituents.sql` | Approved identity, role grants, privacy and staging accessibility |
| Campaigns | `newsletter/dispatch.mjs`, `nexus/api/newsletter-unsubscribe.mjs`, `newsletter/schema-004-unsubscribe-redemption.sql` | Validated provider plan, signed events, approved mail sender and delivery governance |
| Container | `compose.yaml`, `nexus/DOCKER.md` | Controlled HTTPS staging, Neon grants, backups and security review |

For verified status and limits, use [implementation status](../../nexus/IMPLEMENTATION-STATUS.md), [Docker runbook](../../nexus/DOCKER.md), and [association operations](../../nexus/ASSOCIATION-OPERATIONS.md). These are original clean-room Nexus interfaces, not imported CRM or mailing platform code.

## Accessibility review before real launch

Review with Deaf/ASL users plus keyboard, VoiceOver, NVDA, TalkBack, zoom to 400%, visible focus, form errors, state changes, captioning, ASL presentation, and no audio-only messaging. Financial and attendance decisions must provide accessible alternatives to QR/device-only entry. The demo's fictional staff view is **not** a privacy or authentication barrier.
