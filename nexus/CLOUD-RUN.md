# DIG Nexus on Google Cloud Run

**Target runtime: Cloud Run (Node.js 22 container) + Neon PostgreSQL.**

This is a supported *development and staging path*, not a claim that Cloud Run or a public member portal has been deployed. The application code stays in `nexus/api/`; `nexus/cloud-run/` provides the HTTP adapter, durable database-backed sessions, and shared rate limiting.

## Architecture

```
DIG WordPress / member browser
           |
   Google Cloud Run (HTTPS)
     - Nexus API + portals
     - Google OAuth / PKCE
     - server-side authorization
           |
       Neon PostgreSQL
        - DIG member and conference data
        - one-time hashed OAuth flow state
        - hashed revocable session IDs
        - hashed rate-limit counters

Other services, once explicitly enabled:
  Cloud Tasks / Scheduler -> approved background jobs
  MailerSend              -> consent-checked email delivery
  Secret Manager          -> Cloud Run runtime credentials
```

No Cloudflare Durable Objects, Workers, or Wrangler are required by the **Cloud Run container**. The prior Worker config remains tracked for transition/testing but is not the target deployment.

## What we changed

- Node HTTP adapter calls the existing Fetch-based Nexus API without rewriting or copying authorization logic.
- A **fixed** `PUBLIC_ORIGIN` defines canonical HTTPS URLs and prevents client-supplied Host/Forwarded headers from changing Google callback or same-origin validation.
- `nexus_runtime_tokens` persists **hashed** one-time OAuth flow state and revocable session IDs. Atomic deletion prevents callback replay; sessions expire.
- `nexus_runtime_rate_limits` atomically maintains bounded counters shared across Cloud Run instances. Raw IPs and member IDs are not written to these tables.
- `POST /api/enroll`, `POST /api/register`, the organizer console, and conference registrations are **all disabled** by default, regardless of the presence of Neon or OAuth credentials.
- Only the `nexus/api/` and `nexus/cloud-run/` directories plus production npm dependencies enter the container.

## Local verification

Install Node.js 22+, Docker, and npm.

```bash
npm ci
node --test nexus/cloud-run/*.test.mjs
docker build -t dig-nexus-cloudrun:local .
docker run --rm -p 127.0.0.1:8080:8080 \
  -e PORT=8080 -e PUBLIC_ORIGIN=https://localhost:8080 \
  dig-nexus-cloudrun:local
# In a separate terminal:
curl http://127.0.0.1:8080/api/health
```

Local HTTP is for a *disabled-authentication smoke test only*. Google OAuth uses Secure cookies and a real HTTPS callback; an HTTP localhost smoke test is **not** a real login test.

## Neon schema gate

Apply `nexus/schema-008-cloud-run-state.sql` **after** ordered migrations 001–007 on an **isolated Neon branch**. Confirm the two new tables exist and that the database role used by Cloud Run has only the necessary privileges. Existing Nexus base migrations remain a separate gate: our default Neon development branch may not yet have migrations 003–007.

Before enabling browser enrollment or organizer writes, verify all required schema versions with synthetic identities, compare intended privileges, and test rollback. Do not point `DATABASE_URL` at Neon `main` until approvals and migration verification are complete.

**Retention:** these two tables need periodic expiration cleanup. A narrowly authorized **Cloud Run Job + Cloud Scheduler** can delete expired rows. Do not enable live authentication until cleanup operations, incident response and session-secret rotation are planned.

## Google Cloud deployment prerequisites

Cloud Run needs a Google Cloud project with billing enabled and these APIs available: Cloud Run, Cloud Build, Artifact Registry, and Secret Manager. Use a *dedicated runtime service account*, not personal access keys. Give it Secret Manager access only to the three secrets it needs, and use an isolated Neon role/database branch.

Create a **Google OAuth Web client** with the exact approved HTTPS `GOOGLE_REDIRECT_URI` ending in `/auth/google/callback`. Make sure its origin is the same as `PUBLIC_ORIGIN`. Use test users until DIG authorizes a wider launch.

Secret Manager should provide:
- `DATABASE_URL` — a restricted Neon connection string (never committed or exposed in WordPress).
- `GOOGLE_CLIENT_SECRET` — the actual client secret.
- `GOOGLE_SESSION_SECRET` — a long, securely generated random secret.

Set `GOOGLE_CLIENT_ID` and `GOOGLE_REDIRECT_URI` as ordinary server environment variables. Google recommends **pinning specific secret versions** when injecting environment variables rather than relying on `latest`.

Once the project, service account, secrets, OAuth redirect, schema, and DNS/origin are prepared, a **staging** example is:

```bash
# Review PROJECT_ID, SERVICE_ACCOUNT, VERSION, and HTTPS_ORIGIN first.
gcloud config set project PROJECT_ID
gcloud run deploy dig-nexus-staging \
  --source . --region us-east1 \
  --service-account SERVICE_ACCOUNT \
  --no-allow-unauthenticated \
  --min-instances 0 --max-instances 2 \
  --memory 512Mi --concurrency 20 \
  --set-env-vars PUBLIC_ORIGIN=HTTPS_ORIGIN,GOOGLE_CLIENT_ID=GOOGLE_CLIENT_ID,GOOGLE_REDIRECT_URI=HTTPS_ORIGIN/auth/google/callback,REGISTRATION_ENABLED=false,MEMBER_ENROLLMENT_ENABLED=false,ORGANIZER_ENABLED=false,CONFERENCE_REGISTRATION_ENABLED=false \
  --set-secrets DATABASE_URL=dig-nexus-neon-url:VERSION,GOOGLE_CLIENT_SECRET=dig-nexus-google-client-secret:VERSION,GOOGLE_SESSION_SECRET=dig-nexus-session-secret:VERSION
```

This command is a **runbook template**, not something CI executes. `--no-allow-unauthenticated` protects the initial service for operator smoke tests. Real Google browser login will require an intentionally public HTTPS entry point and an approved plan for authentication, network abuse protection, and costs. To use a custom domain, Google currently recommends a load balancer or Firebase Hosting rather than relying on Cloud Run's preview direct-domain mapping.

**Client-IP consideration:** the adapter deliberately discards user-supplied forwarding headers and uses the socket address for conservative rate limiting; behind Google's shared front end, that may throttle a proxy population rather than each individual. A **Google Cloud Armor / load-balancer edge policy** (or another vetted trusted-client-IP mechanism) and real-browser rate-limit tests are required before enabling enrollment. Organizer/conference limits additionally use verified subject identifiers. Never trust arbitrary `X-Forwarded-For` values from the public internet.

**Staging checklist:** validate OAuth callback/PKCE, session revocation across Cloud Run instances, member lookups against Neon, 404 for unpublished events, authorization for restricted roles, keyboard/screen-reader testing, privacy/consent, Cloud Logging retention, secret rotation, budget alerts, error monitoring, and a rollback route. Only then consider enabling individual flags.

## Not yet done

- No `gcloud` configuration or Google Cloud project was available on Butcher at implementation time, so **nothing was deployed**.
- No production Google OAuth client, cloud domain, Secret Manager secrets, or database role has been configured.
- No email, payments, real users, or DIG production traffic was migrated.
- Background processing, trusted per-client rate limiting and table-expiry cleanup need dedicated operational work.

Existing Cloudflare-specific docs and Workers remain in source until a staged cutover is verified, but the **Cloud Run container does not depend on Cloudflare**.
