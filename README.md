# DIG Nexus

**One platform for membership, communication, events, and governance at Deaf in Government.**

DIG Nexus is an open-source project to bring the day-to-day work of [Deaf in Government (DIG)](https://deafingov.org/) into one accessible, privacy-conscious experience. The goal is straightforward: make it easier for members to participate, for volunteers to serve, and for DIG to operate without stitching together disconnected systems.

**Project status: active development — not a live membership service.** The repository contains working components, synthetic tests, database schemas, and an offline demo. It does **not** establish that Google sign-in, Neon-backed registration, newsletters, payments, or elections are available to real members. Production launch requires DIG policy approval, security and accessibility review, and a staged deployment.

**[Explore the offline demo](https://mcc0nnell.github.io/dig-nexus/)** · **[Implementation status](nexus/IMPLEMENTATION-STATUS.md)** · **[Security policy](SECURITY.md)**

## What we're building

| Area | Intended experience | Current state |
| --- | --- | --- |
| Membership | Join, sign in, see status, renew, and manage a profile | Domain model and Google OIDC/session code; live onboarding not enabled |
| Member directory | Discover opted-in colleagues across government | Schema and privacy rules; no public directory |
| Events | Register, manage capacity, and check in at DIG events, including DC27 | Schema and lifecycle tests; no live registration |
| Committees | Organize rosters, roles, and restricted documents | Model and authorization rules; no deployed staff portal |
| Governance | Maintain terms, roles, election records, and eligible-voter snapshots | Schema and eligibility rules; **no ballot casting or counting** |
| Communications | Manage explicit subscriptions, campaigns, and delivery outcomes | Newsletter schema and MailerSend adapter; **sending disabled** |
| Dues | Record externally confirmed payments and membership terms | Data model only; **no payment processor integration** |

These are development milestones, not a claim that DIG has replaced its existing systems.

## How it fits together

```text
  WordPress experience / DIG website
                 |
                 v
  Cloudflare Workers (HTTP API, OAuth, authorization)
      |                         |
      |                 Durable Object
      |               (OAuth state and
      |                session revocation)
      v
  Neon PostgreSQL
  (members, terms, events, governance, consent)
      |
      +-- Planned delivery integration --> MailerSend
      +-- Optional CRM exploration -----> Twenty
```

- **WordPress** is the website-facing integration. The new `[dig_nexus_portal]` shortcode is a development candidate, separate from the older membership shortcodes.
- **Cloudflare Workers** implements the API and Google OpenID Connect authorization-code flow with PKCE. The session design includes encrypted cookies, one-time OAuth state, and revocation through a Durable Object. Real provider and browser deployment tests are still required.
- **Neon/PostgreSQL** is the proposed source of truth for the new Nexus domain. The `dig-nexus-dev` development project exists; versioned SQL and isolated PostgreSQL CI do **not** imply every migration has been applied to Neon or production.
- **MailerSend** has an adapter, not an enabled mailing operation. Consent, one-click unsubscribe, suppression, signed webhooks, sender verification, and delivery controls remain release gates.
- **Twenty** is an optional CRM experiment, **not** the member system of record and not a deployed dependency.

The older WordPress/Salesforce membership candidate remains in this repository for compatibility and evaluation. **There is no approved Salesforce-to-Neon migration or production cutover.** See [Legacy enrollment path](#legacy-enrollment-path).

## Repository map

| Path | What lives there |
| --- | --- |
| [`nexus/`](nexus/) | PostgreSQL schemas, domain policies, event lifecycle, authentication, member API, and WordPress Nexus shell |
| [`newsletter/`](newsletter/) | Subscriber/campaign schemas, delivery adapter, unsubscribe tokens, and rollout rules |
| [`demo/`](demo/) | Offline, synthetic member experience published to GitHub Pages |
| [`wordpress/dig-membership/`](wordpress/dig-membership/) | Existing WordPress membership plugin candidate |
| [`cf/membership-site/`](cf/membership-site/) | Existing Cloudflare gateway for the Salesforce-oriented enrollment path |
| [`dig-src/`](dig-src/) and [`manifest/`](manifest/) | Salesforce overlay and scoped deployment manifest; **not** a standalone Salesforce project |
| [`experiments/dig-nexus/`](experiments/dig-nexus/) | Read-only-by-default Twenty/Neon integration spike |
| [`docs/`](docs/) | Architecture notes and operator runbooks |

### Authentication and registration are different gates

The proposed Google sign-in flow is `/auth/google/start` → Google → `/auth/google/callback` → session cookie → `/portal` and read-only `/api/me`. Sign-in alone does **not** create, approve, renew, or activate a membership.

`POST /api/register` is separately protected and **disabled by default**. It currently expects a verified bearer identity plus origin/rate-limit controls; it does **not** accept the Google browser session cookie as registration authorization. Do not combine these paths without a reviewed identity, CSRF, and consent design.

Read [Google OIDC](nexus/GOOGLE-OIDC.md), [runtime integration](nexus/RUNTIME-INTEGRATION.md), and [registration deployment gates](nexus/REGISTRATION-DEPLOYMENT.md) before wiring up real credentials or member data.

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

# Validate the Cloudflare Worker bundle without deploying
npx wrangler deploy --dry-run --config nexus/wrangler.jsonc
```

Additional checks run in GitHub Actions: Deno API compatibility, PostgreSQL 17 schema/constraint validation, and legacy WordPress/Cloudflare tests. For the WordPress PHP syntax check, use PHP 8.3 (see [membership CI](.github/workflows/ci.yml)).

**Do not run schema files against a production database to “try it out.”** Follow the ordered migrations and disposable-branch guidance in [registration deployment](nexus/REGISTRATION-DEPLOYMENT.md).

## Privacy, accessibility, and trust boundaries

DIG Nexus is for a Deaf-led organization. Accessibility and personal-data protection are requirements, not later enhancements:

- **Accessible by design:** keyboard and screen-reader operation, clear language, and ASL/captioned content need review with real users before launch.
- **Explicit consent:** being a member does not subscribe someone to a newsletter. Directory participation is opt-in and private by default.
- **Least privilege:** enforce identity, roles, and record access on the server. Never trust a browser-supplied member ID, role, or consent flag.
- **Sensitive information stays restricted:** accessibility/accommodation requests belong with authorized event staff, not public directories or marketing lists.
- **Financial and voting boundaries:** do not store card details; verify payment-provider receipts. Voter eligibility is **not** a secure secret-ballot system.
- **No production secrets or personal data in Git:** use scoped runtime secrets and synthetic test identities. See [SECURITY.md](SECURITY.md).

## Legacy enrollment path

The [WordPress membership plugin](wordpress/dig-membership/README.md), [Salesforce gateway](cf/membership-site/README.md), and [Salesforce overlay](dig-src/) were built as a **separate development candidate** for enrollment through DIG's existing website and Salesforce environment. They require sandbox reconciliation, DIG policy approval, and WordPress staging tests before deployment.

Identifiers such as `wordpress/dig-membership/`, `[dig_membership_join]`, `[dig_membership_verify]`, and the `dig-membership-site` Worker name are intentionally retained for compatibility. A repository rename is **not** a migration of these integration contracts.

Operator references: [website cutover and rollback](docs/runbooks/website-membership-cutover.md), [Salesforce email](docs/runbooks/salesforce-email.md), and [legacy experience mapping](docs/architecture/experience-demo.md).

## Next milestones

1. **Prove the identity-to-member read path:** deploy to a non-production Worker and isolated Neon branch, complete real Google OAuth and Durable Object tests, verify grants, and exercise `/api/me` end to end.
2. **Decide the registration contract:** document the verified-identity trust boundary, complete atomic/idempotent registration tests, and retain the default-off gate until reviewed.
3. **Ship a usable accessible member experience:** test the WordPress flow on real browsers with Deaf members and assistive-technology users; establish privacy, incident response, and retention procedures.
4. **Enable integrations one at a time:** MailerSend consent/suppression and verified delivery, payment-provider reconciliation, events, committees, and administrative reporting.
5. **Treat elections separately:** commission and review an appropriate ballot system before any binding vote.

For the detailed status and known limitations, use [`nexus/IMPLEMENTATION-STATUS.md`](nexus/IMPLEMENTATION-STATUS.md) alongside the more recent [runtime integration](nexus/RUNTIME-INTEGRATION.md) notes.

## Contributing

Issues and small, testable pull requests are welcome. Prefer changes with a documented user need, explicit security and privacy boundaries, and synthetic tests. Never include member records, credentials, or production logs in an issue or pull request.

Licensed under [Apache 2.0](LICENSE). DIG Nexus is a development project; this repository does not authorize changes to DIG production infrastructure or policy.
