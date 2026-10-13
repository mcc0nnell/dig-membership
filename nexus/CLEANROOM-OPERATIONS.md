# DIG Nexus clean-room operating modules

**Implementation: original DIG Nexus code, not copied from Tendenci, CiviCRM, pretix, Hi.Events, listmonk, pg-boss, WindAnvil, or Fire Producer.** Those projects were reviewed as operational and UX references. We did not import their source or transplant their licenses. Playwright and axe-core are third-party test tooling, not copied application components.

The selected stack remains **Docker Compose + Caddy + Neon**. The source-of-truth database is DIG Nexus's own PostgreSQL schema. The four proof tracks below are tested independently and are **not live services**.

## 1. Accessible member, attendee and organizer journeys

[The browser suite](../tests/browser/nexus-accessibility.spec.mjs) drives real Chromium using original fixture identities and the existing Nexus HTTP routes, then runs automated WCAG 2 A/AA and 2.1 A/AA checks via axe-core. It also checks keyboard skip navigation, accessible status announcements, and default-hidden enrollment.

```bash
npm ci
npx playwright install chromium
npx playwright test -c playwright.config.mjs
```

CI installs the required Linux browser dependencies. The tested organizer identity and data are deliberately synthetic. An automated scan **does not establish WCAG compliance**, ASL access quality, screen-reader usability, or Deaf community acceptance. Add human testing and real OAuth staging to the launch gate.

## 2. Background work without another database

[SQL 009](schema-009-jobs.sql) and [the job queue](jobs/queue.mjs) provide an original Postgres job lease with:
- single-query atomic `FOR UPDATE SKIP LOCKED` claim;
- expiring 90-second lease and random fencing token (stale workers cannot acknowledge a newer job);
- retry with bounded backoff, max attempts, and dead-letter terminal state;
- task allowlist limited to `runtime_expiry_cleanup`;
- separate optional Docker Compose `jobs` profile that remains **disabled even when selected**.

Only old, expired OAuth tokens and rate-limit buckets can be deleted by the current worker. It cannot send messages, generate consent, approve memberships, issue refunds, or touch accommodation requests.

Operational prerequisites: apply schema 009 **after 008** to an isolated Neon branch; use a restricted database role; define a unique hour/day deduplication key for each scheduled cleanup; monitor retries/dead jobs; set job worker flag only after review. The job service is not running by default. To confirm the fail-closed profile, `docker compose --profile jobs config` does not require database credentials but still requires configured local file paths.

## 3. Signed, immutable container releases

The Docker publishing job now attaches **BuildKit provenance + SBOM metadata**, stamps the exact source commit into the OCI image, and signs the **immutable image digest** with GitHub OIDC using Cosign. It independently verifies its GitHub Actions signing identity.

Before an operator-controlled upgrade, [`release/verify-image.mjs`](../release/verify-image.mjs) validates:
1. exact `ghcr.io/mcc0nnell/dig-nexus:sha-FULL_COMMIT_SHA` format;
2. the pulled image's OCI digest and revision label against that SHA;
3. a valid Cosign signature on that digest with the expected GitHub workflow certificate identity and issuer.

The [upgrade script](../deploy/upgrade.sh) refuses to replace a container when independent verification is not possible. It preserves the previous image on verification failure and rolls back if the replacement fails health checks. The operator's host must have Docker, Node.js 22+, and Cosign in its PATH.

This verifies artifact identity and a signed CI publication claim. **It does not prove independent reproducibility, source-to-binary equivalence, or software security.** A complete WindAnvil Assurance Record requires independent provenance/SBOM semantics and its own trusted policy; do not label ordinary CI a WindAnvil PASS.

## 4. NTC operations: original manual check-in

The existing DIG Nexus attendee functions already serialize event/workshop capacity, waitlists and cancellations in PostgreSQL. [Schema 010](schema-010-ntc-checkin.sql) adds **manager-only, idempotent manual check-in**, and the [HTTP route](api/checkin-api.mjs) is `POST /api/checkin/:slug` behind `NTC_CHECKIN_ENABLED=false`.

The route requires verified staff identity, exact same-origin request, intentional custom action header, a valid confirmation reference, and a rate limit. PostgreSQL re-verifies event manager status, locks the event row to serialize with cancellation, rejects waitlisted/cancelled registrations, and audits successful check-ins without duplicating the audit on repeated submissions.

Request format for *future staging only*:

```json
{"reference":"32-lowercase-hex-character-reference","method":"manual"}
```

The confirmation reference is **not a paid ticket, QR secret, or proof of payment**. A future scanning flow needs a separate expiring/signed bearer credential, revocation and replay model, scanner staff access rules, and real device tests. Payment provider reconciliation, refunds, tax/ticketing law, financial controls, export authorization, and event-specific accommodation fulfillment remain **not implemented**. Do not activate this route until DIG authorizes a staffed, privacy-reviewed rehearsal.

## Evidence and release gate

- Node tests: `node --test nexus/jobs/*.test.mjs nexus/api/checkin-api.test.mjs release/*.test.mjs`
- Chromium: `npx playwright test -c playwright.config.mjs`
- PostgreSQL 17: apply ordered schemas 001–010 to a disposable database; run `nexus/tests/jobs-and-checkin-integration.sql` (synthetic, transaction rolled back).
- Docker Compose: `docker compose config`; web writes stay disabled in every tested image.
- GitHub Actions: the Docker image publishes **only after** Docker, browser, and PostgreSQL checks all succeed.

Do not apply migrations to Neon `main`, deploy a public domain, enable feature flags, or send real email as part of this development work.
