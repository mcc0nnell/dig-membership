# DIG Nexus runtime integration

**Status: implementation merged, no production launch.** Registration remains disabled. This is the operational overview; see [GOOGLE-OIDC.md](GOOGLE-OIDC.md) for login details and [REGISTRATION-DEPLOYMENT.md](REGISTRATION-DEPLOYMENT.md) for the separate registration authorization gate.

## Components

| Component | Implemented behavior | Not yet verified live |
| --- | --- | --- |
| WordPress shortcode | Accessible link to Worker-hosted Google login; no token handling in WordPress | WordPress plugin deployment and real-domain navigation |
| Cloudflare Worker | Google Authorization Code + PKCE, state/nonce, ID token verification, encrypted cookie session, `/portal`, `/api/me`, logout | Real Google OAuth client and browser integration |
| Durable Object `AUTH_STATE` | One-time OAuth state consumption and revocable session IDs; Wrangler SQLite migration `auth-state-v1` | Deployed migration, persistence and concurrency behavior |
| Neon PostgreSQL | `@neondatabase/serverless` query adapter and member lookup by immutable issuer/subject | Live `DATABASE_URL`, schema 003/004 and least-privilege role validation |
| Registration API | Bearer-token-only guarded registration endpoint, disabled by default | Production enablement; browser cookie sessions are not accepted |
| Newsletter | Guarded MailerSend adapter | Real email sends remain disabled and require separate authorization |

## Deployment prerequisites

1. Create a Google OAuth **Web application** client, authorize the exact HTTPS callback (`/auth/google/callback`), and provision `GOOGLE_CLIENT_ID`, `GOOGLE_REDIRECT_URI`, `GOOGLE_CLIENT_SECRET`, and a high-entropy `GOOGLE_SESSION_SECRET` in Cloudflare. The client secret and session secret must be Worker secrets.
2. Deploy the Worker to an approved HTTPS origin with the `AUTH_STATE` Durable Object binding and SQLite migration. Verify one-time callback state and logout revocation across requests. **Wrangler dry-run is not a deployed migration.**
3. Set WordPress option `dig_nexus_api_url` to the Worker HTTPS origin; verify the shortcode and login/logout on real browsers, including keyboard and screen-reader testing.
4. Provision least-privilege Neon `DATABASE_URL` as a Worker secret, apply and validate schemas 001–004 in order on a disposable branch, and test member lookup with synthetic identities.
5. Review CSP, session expiry/key rotation, incident handling, logs, accessibility, and privacy. Keep `REGISTRATION_ENABLED=false` while any gate remains open.
6. Configure `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URL`, and `REGISTRATION_ALLOWED_ORIGIN` **only for the separate registration bearer-token path** after selecting and validating that token policy. Do not assume Google browser cookies work with `/api/register`.

## Local validation

Run `npm ci`, `node --test nexus/*.test.mjs nexus/api/worker.test.mjs nexus/api/registration.test.mjs nexus/api/registration-http.test.mjs nexus/api/registration-db.test.mjs nexus/api/oidc.test.mjs nexus/api/database.test.mjs nexus/api/member-http.test.mjs nexus/api/google-auth.test.mjs newsletter/*.test.mjs`, and `npx wrangler deploy --dry-run --config nexus/wrangler.jsonc`. GitHub Actions also runs Deno and PostgreSQL checks.

**No production account creation, mail delivery, payments, elections, or member import is authorized by this document.**
