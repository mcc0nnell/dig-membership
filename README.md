# DIG Nexus

**Neon-powered membership, events, and governance for Deaf in Government.**

DIG Nexus is an open-source platform for [Deaf in Government (DIG)](https://deafingov.org/): a single home for member profiles, conference programs, committees, governance, and communications. The selected deployment is **Docker Compose + Caddy + Neon PostgreSQL**, with WordPress as the website-facing layer. The same application image can also run on other container hosts. DIG Nexus owns its membership data and does not depend on an external CRM.

**Project status: active development — not a live membership service.** The repository contains working components, synthetic tests, database schemas, and an offline demo. It does **not** establish that Google sign-in, Neon-backed registration, newsletters, payments, or elections are available to real members. Production launch requires DIG policy approval, security and accessibility review, and a staged deployment.

**NTC conference foundation (development):** The [NTC conference specification](nexus/NTC-CONFERENCE.md) documents the independent published-only agenda API, multi-day accessible event view, and conference migration. The [organizer console deployment guide](nexus/ORGANIZER-DEPLOYMENT.md) covers staff permissions, editing, previews, and publication. The [attendee registration guide](nexus/ATTENDEE-REGISTRATION.md) documents the membership-free individual registration, atomic workshop waitlists, authenticated confirmation references and restricted accommodations workflow. Events default to draft; no real conference has been published or deployed.

**[Explore the offline demo](https://mcc0nnell.github.io/dig-nexus/)** · **[Implementation status](nexus/IMPLEMENTATION-STATUS.md)** · **[Security policy](SECURITY.md)**

## What we're building

| Area | Intended experience | Current state |
| --- | --- | --- |
| Membership | Sign in, request membership, see status, then eventually renew and manage a profile | Google OIDC/session code, explicit pending-request flow and Neon adapter; live onboarding disabled |
| Member directory | Discover opted-in colleagues across government | Schema and privacy rules; no public directory |
| Events | Register, manage capacity, and check in at DIG events, including DC27 | Published agenda, staff editor and isolated attendee registration/waitlists; live registration disabled |
| Committees | Organize rosters, roles, and restricted documents | Model and authorization rules; no deployed staff portal |
| Governance | Maintain terms, roles, election records, and eligible-voter snapshots | Schema and eligibility rules; **no ballot casting or counting** |
| Communications | Manage explicit subscriptions, campaigns, and delivery outcomes | Newsletter schema and MailerSend adapter; **sending disabled** |
| Dues | Record externally confirmed payments and membership terms | Data model only; **no payment processor integration** |

These are development milestones, not a claim that DIG has replaced its existing systems.

## The platform architecture

```text
  WordPress experience / DIG website
                 |
                 v
  Caddy HTTPS → DIG Nexus Docker container
      |                         |
      |                 Neon-backed state
      |               (OAuth state and
      |                session revocation)
      v
  Neon PostgreSQL
  (members, terms, events, governance, consent)
      |
      +-- Planned delivery integration --> MailerSend
      +-- Optional staff CRM experiment -> Twenty (not required)
```

- **WordPress** is the website-facing integration. The `[dig_nexus_portal]` shortcode is a development candidate. It directs members to the Nexus service; no database credentials or authorization logic belong in WordPress.
- **Docker Compose + Caddy** hosts the Node API and Google OpenID Connect authorization-code flow with PKCE. Caddy terminates HTTPS and authenticates private proxy headers. Neon stores hashed, expiring OAuth/session state. Real provider and browser deployment tests are still required.
- **Neon/PostgreSQL** is the source-of-truth architecture for the Nexus domain. The `dig-nexus-dev` development project exists; versioned SQL and isolated PostgreSQL CI do **not** imply every migration has been applied to Neon or production.
- **MailerSend** has an adapter, not an enabled mailing operation. Consent, one-click unsubscribe, suppression, signed webhooks, sender verification, and delivery controls remain release gates.
- **Twenty** is an optional CRM experiment, **not** the member system of record and not a deployed dependency.

**The architecture is Docker + Neon-first.** No parallel CRM, legacy membership gateway, or data migration is part of the DIG Nexus runtime. See [Historical artifacts](#historical-artifacts) for obsolete code still tracked in this repository.

## Repository map

| Path | What lives there |
| --- | --- |
| [`nexus/`](nexus/) | PostgreSQL schemas, domain policies, event lifecycle, authentication, member API, and WordPress Nexus shell |
| [`newsletter/`](newsletter/) | Subscriber/campaign schemas, delivery adapter, unsubscribe tokens, and rollout rules |
| [`demo/`](demo/) | Offline, synthetic member experience published to GitHub Pages |
| [`nexus/wordpress/`](nexus/wordpress/) | DIG Nexus WordPress portal integration |
| [`nexus/NTC-CONFERENCE.md`](nexus/NTC-CONFERENCE.md) | NTC conference design and publish-only agenda release gate |
| [`nexus/docker/`](nexus/docker/) | Docker startup, secret-file loading and authenticated proxy tests |
| [`compose.yaml`](compose.yaml) and [`nexus/DOCKER.md`](nexus/DOCKER.md) | Self-hosted Caddy + Nexus stack, release and rollback runbook |
| [`nexus/cloud-run/`](nexus/cloud-run/) | Portable Node HTTP adapter and Neon-backed state, inherited from the Cloud Run prototype |
| [`nexus/jobs/`](nexus/jobs/) | Original PostgreSQL job leases and fail-closed optional cleanup worker |
| [`release/`](release/) | Independent OCI digest, source-label and signed-publisher verification |
| [`nexus/CLEANROOM-OPERATIONS.md`](nexus/CLEANROOM-OPERATIONS.md) | Clean-room design, browser tests, queue and NTC operations gates |
| [`experiments/dig-nexus/`](experiments/dig-nexus/) | Read-only-by-default Twenty/Neon integration spike |
| [`nexus/RUNTIME-INTEGRATION.md`](nexus/RUNTIME-INTEGRATION.md) | Shared API and authentication implementation details (historical Worker prerequisites noted) |

### Authentication and registration are different gates

The implemented development Google sign-in flow is `/auth/google/start` → Google → `/auth/google/callback` → session cookie → `/portal` and read-only `/api/me`. Sign-in alone does **not** create, approve, renew, or activate a membership. A new, explicit `POST /api/enroll` can create a **pending** request from the verified Google browser session, but its `MEMBER_ENROLLMENT_ENABLED` flag is off by default. The browser route enforces same-origin checks, a custom action header and rate limiting.

`POST /api/register` is separately protected and **disabled by default**. It currently expects a verified bearer identity plus origin/rate-limit controls; it does **not** accept the Google browser session cookie as registration authorization. The browser request route is distinct and does not change the bearer endpoint or silently subscribe anyone to email. Neither endpoint is enabled in production.

Read [Docker deployment](nexus/DOCKER.md), [Google OIDC](nexus/GOOGLE-OIDC.md), and [registration deployment gates](nexus/REGISTRATION-DEPLOYMENT.md) before wiring up real credentials or member data.

## Try the project

### View the demo

Visit **[mcc0nnell.github.io/dig-nexus](https://mcc0nnell.github.io/dig-nexus/)** or open [`demo/offline.html`](demo/offline.html) locally. The public demo is a **self-contained simulation**: no login, persistence, emails, API requests, or actual member records. It must never be used as a production enrollment link.

### Run local checks

Use **Node.js 22+** and npm. These commands validate isolated code paths and mock integrations; they do not deploy infrastructure or send email.

```bash
git clone https://github.com/mcc0nnell/dig-nexus.git
cd dig-nexus
npm ci

# Nexus and newsletter unit tests
node --test nexus/*.test.mjs \
  nexus/api/worker.test.mjs \
  nexus/api/registration.test.mjs \
  nexus/api/registration-http.test.mjs \
  nexus/api/registration-db.test.mjs \
  nexus/api/oidc.test.mjs \
  nexus/api/database.test.mjs \
  nexus/api/member-http.test.mjs \
  nexus/api/google-auth.test.mjs \
  newsletter/*.test.mjs

# Offline demo
node --test demo/offline.test.cjs

# Portable Node runtime and Docker packaging (no public deployment)
node --test nexus/cloud-run/*.test.mjs nexus/docker/*.test.mjs
docker build -t dig-nexus:local .
```

Additional checks run in GitHub Actions: Deno API compatibility, PostgreSQL 17 schema/constraint validation, a real Chromium accessibility suite, and verified Docker release-signing checks. Older CI jobs still verify historical code but are not Nexus deployment gates.

**Do not run schema files against a production database to “try it out.”** Follow the ordered migrations and disposable-branch guidance in [registration deployment](nexus/REGISTRATION-DEPLOYMENT.md).

## Privacy, accessibility, and trust boundaries

DIG Nexus is for a Deaf-led organization. Accessibility and personal-data protection are requirements, not later enhancements:

- **Accessible by design:** keyboard and screen-reader operation, clear language, and ASL/captioned content need review with real users before launch.
- **Explicit consent:** being a member does not subscribe someone to a newsletter. Directory participation is opt-in and private by default.
- **Least privilege:** enforce identity, roles, and record access on the server. Never trust a browser-supplied member ID, role, or consent flag.
- **Sensitive information stays restricted:** accessibility/accommodation requests belong with authorized event staff, not public directories or marketing lists.
- **Financial and voting boundaries:** do not store card details; verify payment-provider receipts. Voter eligibility is **not** a secure secret-ballot system.
- **No production secrets or personal data in Git:** use scoped runtime secrets and synthetic test identities. See [SECURITY.md](SECURITY.md).

## Historical artifacts

Earlier experiments still appear under `wordpress/dig-membership/`, `cf/membership-site/`, `dig-src/`, and `manifest/`. Those components are **retired from the DIG Nexus design**. They are not a supported alternative backend, should not be wired into the new portal, and will be handled separately from active Nexus features. Their presence in the checkout is not an instruction to deploy them.

## Next milestones

1. **Finish live validation of the staged member journey:** deploy to a private Docker Compose + Caddy staging service and isolated Neon branch, complete real Google OAuth and Neon session-state tests, verify grants, and exercise `/api/me` end to end.
2. **Decide the registration contract:** document the verified-identity trust boundary, complete atomic/idempotent registration tests, and retain the default-off gate until reviewed.
3. **Ship a usable accessible member experience:** test the WordPress flow on real browsers with Deaf members and assistive-technology users; establish privacy, incident response, and retention procedures.
4. **Enable integrations one at a time:** MailerSend consent/suppression and verified delivery, payment-provider reconciliation, events, committees, and administrative reporting.
5. **Treat elections separately:** commission and review an appropriate ballot system before any binding vote.

For the detailed status and known limitations, use [`nexus/IMPLEMENTATION-STATUS.md`](nexus/IMPLEMENTATION-STATUS.md) alongside the more recent [runtime integration](nexus/RUNTIME-INTEGRATION.md) notes.

## Contributing

Issues and small, testable pull requests are welcome. Prefer changes with a documented user need, explicit security and privacy boundaries, and synthetic tests. Never include member records, credentials, or production logs in an issue or pull request.

Licensed under [Apache 2.0](LICENSE). DIG Nexus is a development project; this repository does not authorize changes to DIG production infrastructure or policy.
