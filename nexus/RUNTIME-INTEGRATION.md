# DIG Nexus runtime integration

> **Runtime transition:** Google Cloud Run + Neon is now the target. See [CLOUD-RUN.md](CLOUD-RUN.md) for deployment and hashed Neon session state. The Cloudflare Worker/Durable Object instructions below describe the earlier adapter and are **not prerequisites** for the Cloud Run container.

**Status: implementation merged, no production launch.** Registration remains disabled. This is the operational overview; see [GOOGLE-OIDC.md](GOOGLE-OIDC.md) for login details and [REGISTRATION-DEPLOYMENT.md](REGISTRATION-DEPLOYMENT.md) for the separate registration authorization gate.

## Components

| Component | Implemented behavior | Not yet verified live |
| --- | --- | --- |
| WordPress shortcode | Accessible link to Worker-hosted Google login; no token handling in WordPress | WordPress plugin deployment and real-domain navigation |
| Cloudflare Worker | Google Authorization Code + PKCE, state/nonce, ID token verification, encrypted cookie session, `/portal`, `/api/me`, logout | Real Google OAuth client and browser integration |
| Durable Object `AUTH_STATE` | One-time OAuth state consumption and revocable session IDs; Wrangler SQLite migration `auth-state-v1` | Deployed migration, persistence and concurrency behavior |
| Neon PostgreSQL | `@neondatabase/serverless` query adapter and member lookup by immutable issuer/subject | Live `DATABASE_URL`, schema 003/004 and least-privilege role validation |
| Membership request | Separate cookie-backed `POST /api/enroll` with exact-Origin checks, custom action header, rate limiting, explicit request, and atomic pending registration | Feature flag defaults off; live OAuth, Neon role and CSRF/browser checks |
| Registration API | Existing `POST /api/register` remains bearer-token-only and disabled by default | Its authorization policy and production enablement |
| Newsletter | Guarded MailerSend adapter | Real email sends remain disabled and require separate authorization |

## Deployment prerequisites

1. Create a Google OAuth **Web application** client, authorize the exact HTTPS callback (`/auth/google/callback`), and provision `GOOGLE_CLIENT_ID`, `GOOGLE_REDIRECT_URI`, `GOOGLE_CLIENT_SECRET`, and a high-entropy `GOOGLE_SESSION_SECRET` in Cloudflare. The client secret and session secret must be Worker secrets.
2. Deploy the Worker to an approved HTTPS origin with the `AUTH_STATE` Durable Object binding and SQLite migration. Verify one-time callback state and logout revocation across requests. **Wrangler dry-run is not a deployed migration.**
3. Set WordPress option `dig_nexus_api_url` to the Worker HTTPS origin; verify the shortcode and login/logout on real browsers, including keyboard and screen-reader testing.
4. Provision least-privilege Neon `DATABASE_URL` as a Worker secret, apply and validate schemas 001–004 in order on a disposable branch, and test member lookup with synthetic identities.
5. Review CSP, session expiry/key rotation, incident handling, logs, accessibility, and privacy. Keep `REGISTRATION_ENABLED=false` while any gate remains open.
6. Keep `MEMBER_ENROLLMENT_ENABLED=false` until the same-origin browser enrollment route is tested with Google, the Durable Object, Neon, and approved policies. It accepts a session cookie **only** for an explicit request and creates a pending, private record with no newsletter consent.
7. Configure `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URL`, and `REGISTRATION_ALLOWED_ORIGIN` **only for the separate bearer-token `/api/register` path** after selecting and validating that token policy. Google cookies never authorize `/api/register`.

## Local validation

Run `npm ci`, `node --test nexus/*.test.mjs nexus/api/worker.test.mjs nexus/api/registration.test.mjs nexus/api/registration-http.test.mjs nexus/api/registration-db.test.mjs nexus/api/oidc.test.mjs nexus/api/database.test.mjs nexus/api/member-http.test.mjs nexus/api/google-auth.test.mjs nexus/api/member-journey.test.mjs newsletter/*.test.mjs`, and `npx wrangler deploy --dry-run --config nexus/wrangler.jsonc`. GitHub Actions also runs Deno and PostgreSQL checks.

**No production account creation, mail delivery, payments, elections, or member import is authorized by this document.**

## First member journey: staging validation

1. Visit the Worker-hosted `/portal` and choose **Continue with Google**.
2. After a verified Google sign-in, `GET /api/me` looks up the member by immutable issuer/subject. Unknown accounts show an invitation **only if** `MEMBER_ENROLLMENT_ENABLED=true`.
3. The person explicitly checks their intention to request membership, enters a display name, and submits to the same Worker origin using `POST /api/enroll`. The route requires the secure session cookie, an exact same-origin `Origin`, a non-simple custom request header, and a working rate-limiter binding. This is separate from the existing bearer-token endpoint.
4. Neon atomically creates a **pending** membership record bound to the verified identity. Directory is private, newsletter consent is not granted, and duplicate submissions are idempotent. Existing email + different identity fails closed.
5. `GET /api/me` shows the actual pending status; sign-out revokes the session.

**Validated:** synthetic full-flow tests and the atomic SQL registration function on isolated Neon branch `member-journey-validation` (not the default/main branch). **Not validated:** live Google client configuration, Cloudflare deployment, production Neon credentials/least-privilege grants, real browsers, accessibility acceptance and organization membership policies. No flag was enabled on a deployed Worker.

The feature flags are intentionally distinct:
- `MEMBER_ENROLLMENT_ENABLED=false`: browser session `POST /api/enroll`.
- `REGISTRATION_ENABLED=false`: separate bearer-token `POST /api/register`.

Changing either flag is a separate operator decision. Do not infer enrollment consent from login or use the bearer-token endpoint as a fallback for the portal.
