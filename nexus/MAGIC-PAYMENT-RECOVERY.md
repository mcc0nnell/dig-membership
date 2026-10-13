# NTC sign-in links and Zeffy recovery — isolated development gate

This is the **Nexus-native** magic-link implementation. It does not use legacy
Salesforce/Apex login and does not give a conference attendee DIG membership,
organizer privileges, or scanning privileges. Existing Google OIDC remains
available for staff and Google-registered participants.

## Email sign-in

- The conference page offers **Sign in by email link** (`/auth/magic?event=:slug`).
- `POST /api/auth/magic/request` accepts a syntactically valid email and event slug,
  verifies same-origin and bounded JSON, and requires independent hour-window rate
  limits by source IP and hashed email. It never returns a raw token.
- The server creates a random 256-bit bearer token. PostgreSQL stores **only a
  SHA-256 hash**, its normalized email, the event slug and a 15-minute expiry.
  Requesting another link revokes the previous outstanding token for that email.
- MailerSend sends the link via HTTPS. The token lives in the URL **fragment**,
  not the request path or query. A minimal page strips the fragment from browser
  history and waits for an explicit click before posting the token to the server.
  This also prevents typical mail scanners from consuming it by merely opening
  the URL.
- `POST /api/auth/magic/redeem` atomically consumes the hashed token once and
  establishes a one-hour encrypted HttpOnly Secure SameSite=Lax attendee cookie.
  Its server-side session is revocable in Neon. `/api/auth/magic/logout` revokes
  this session. Raw login tokens are never persisted or exposed through HTTP.
- Both the Google sign-in and this email sign-in work for conference attendee
  registration, private accommodation intake and **attendee** ticket issuance.
  **Coordinator, organizer, check-in staff and DIG member privileges require
  their original Google session and database-scoped roles.**
- A pre-existing **Google attendee registration** is not silently linked to an
  email-magic identity sharing its email. The independent identity conflict is
  deliberate; manual identity merging requires separately verifying both
  login methods. No automatic transfer of private accessibility requests.

## Zeffy recovery

- Zeffy remains the payment authority. Any confirmation **must** come from a
  fresh signed webhook + Zeffy API lookup or a logged-in purchaser recovery
  request + Zeffy API lookup, never a return URL, form field, or email receipt.
- `POST /api/ticketing/:event/recover` accepts a Zeffy payment UUID (if known).
  The server retrieves the actual payment, verifies online/successful status,
  campaign, rate, line item, USD price and absence of refunds/disputes. The
  purchaser's **Zeffy buyer email must exactly match** the signed-in attendee
  email, and PostgreSQL independently enforces registered attendee identity.
- Matched payments create a single idempotent payment entitlement. A repeat
  recovery never issues an extra ticket or sends duplicate payment mail.
- Signed webhooks that confirm a correctly priced Zeffy payment but lack a
  registered buyer are stored in `nexus_conference_zeffy_reviews`. This is a
  **manual-review queue**, not admission. It retains sensitive purchaser email
  in the restricted database; define retention, staff access and audit policy.
  After a purchaser securely recovers their payment, its review record is
  marked resolved. No automatic email-based claim of another person's ticket.
- Different purchase and registration emails intentionally require **human
  reconciliation**. We cannot assume that two unrelated emails belong to the
  same person. Staff must verify both addresses and the Zeffy payment before
  migrating an entitlement; such an admin workflow is not yet published.

## Configuration and verification

Migration order: `nexus/schema.sql` through `nexus/schema-011-magic-links.sql`
(including schema 009). Apply to an isolated Neon staging branch **only**.

For Docker/Caddy, create mode-0600 file
`deploy/secrets/magic_link_session_secret` with a cryptographically strong
value (e.g. `openssl rand -base64 48`). The existing
`deploy/secrets/mailersend_api_token` and a verified
`MAILERSEND_FROM_EMAIL` are required to send login links. Compose and the
Node adapter default both `MAGIC_LINK_ENABLED` and
`MAGIC_LINK_EMAIL_ENABLED` to **false**. The existing conference/ticketing
flags must also be explicitly enabled on staging. No real emails or Zeffy
transactions were sent by these unit and disposable PostgreSQL tests.

Tests:

```bash
node --test nexus/api/magic-auth.test.mjs nexus/api/ticketing.test.mjs
# On disposable PostgreSQL after migrations 001–010:
psql -v ON_ERROR_STOP=1 -f nexus/tests/magic-recovery-integration.sql
```

Before public release, complete full browser/email-provider testing,
MailScanner/preview testing, abuse-control review, privacy retention policy,
refund/oversell/abandoned-reservation coordination with Zeffy, and accessible
user testing. Email login eliminates the Google-account requirement for **new**
individual conference attendees; it does not yet support guest group orders.
