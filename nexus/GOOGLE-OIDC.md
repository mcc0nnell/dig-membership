# DIG Nexus: Google OpenID Connect sign-in

> **Current target:** Docker Compose + Caddy; see [DOCKER.md](DOCKER.md) for the deployed-runtime plan and Docker secret files. Cloudflare/Worker secret and Durable Object setup below documents the earlier implementation and is not the new hosting requirement. The Google OIDC/PKCE verification logic is reused by Cloud Run.

**Status:** Implementation and synthetic tests only. Not deployed. No real Google OAuth client or production secrets have been configured. Registration remains disabled.

## Architecture

- WordPress `[dig_nexus_portal]` links to the Cloudflare Worker `/auth/google/start`; WordPress never receives Google tokens or database credentials.
- Worker creates cryptographically random state, nonce and PKCE S256 verifier/challenge. The five-minute OAuth transaction is stored in an encrypted, Secure, HttpOnly, SameSite=Lax, host-only cookie, with one-time state tracked in a Cloudflare Durable Object.
- Google Authorization Code flow redirects to `/auth/google/callback`; Worker exchanges the code directly with Google's token endpoint, validates Google's ID token signature against Google JWKS using `jose`, checks Google issuer, client audience, nonce, and verified email.
- Worker issues a one-hour encrypted, Secure, HttpOnly, SameSite=Lax host-only session cookie; redirects to `/portal`. No Google access or refresh token is persisted.
- `/portal` reads `/api/me` on the same Worker origin, rendering the member status using `textContent`, never trusting HTML from the database. The Worker queries Neon by `(issuer, sub)`; email is not used for account linking. Sign-in does not activate or enroll members.
- POST `/auth/logout` requires a same-origin `Origin` header, revokes the session ID in a Durable Object, and expires the browser session cookie. Session encryption uses A256GCM and a secret derived from `GOOGLE_SESSION_SECRET`.
- Portal JavaScript is served as a same-origin module with CSP `script-src 'self'`; no inline script exception.

## Google Cloud setup (operator action required)

1. Create/select a Google Cloud project. Configure Google Auth Platform consent screen, application name, support email, authorized domains, and publishing/test users as appropriate.
2. Create an **OAuth Client ID** of type **Web application**. Add the exact HTTPS Worker callback URL, e.g. `https://nexus.example.org/auth/google/callback`, under authorized redirect URIs.
3. Set Worker `GOOGLE_CLIENT_ID` (non-secret config), `GOOGLE_REDIRECT_URI` (exact callback URI), `GOOGLE_CLIENT_SECRET` and `GOOGLE_SESSION_SECRET` as Worker secrets. Generate the latter using at least 32 random bytes, encoded as a long secret. Never commit credentials.
4. Set the WordPress `dig_nexus_api_url` option to the HTTPS Worker origin only. Use a domain you control, TLS, and verify it matches the Google redirect URI origin.
5. Provision Neon `DATABASE_URL` as a Worker secret with least-privilege permissions; apply schemas 001–004 to a non-production branch and validate database grants.
6. Verify OAuth code exchange, state/nonce replay prevention, cookie handling, login/logout, member lookup and accessibility with synthetic Google test accounts. Set `REGISTRATION_ENABLED` only after separate registration security and operations review.

## Local validation

Run `npm ci`, `node --test nexus/api/google-auth.test.mjs nexus/api/member-http.test.mjs`, and `npx wrangler deploy --dry-run --config nexus/wrangler.jsonc`. CI additionally runs Deno and isolated Node suites. Tests mock Google's token exchange and must not use real user credentials.

## Operational limitations

- No production deployment, client registration, Neon secret, or actual Google login is complete.
- No email-based automatic account linking, roles, membership approval, newsletter consent, or payment processing.
- The new `POST /api/enroll` is a **separately gated** browser membership **request** route with explicit intent, exact-Origin enforcement and rate limiting. It is disabled by default and creates a pending record only. The pre-existing `/api/register` still requires a verified bearer token and does **not** accept the browser cookie.
- The portal is deliberately simple; complete keyboard/screen-reader, ASL and captions UX review before public release.

## Security work still required before public launch

- Validate Durable Object SQLite migration and atomic state consumption in a deployed non-production environment. Current unit tests use a synthetic store; production Durable Object behavior is not yet proven.
- Review session lifecycle policies, cross-device revocation, and key rotation; current revocation is per session ID and key rotation requires an explicit migration plan.
- Test with a real Google OAuth client and browser, including cookie behavior, account switching, Google error responses, logout CSRF, session expiration, and assistive technology.
- Keep both `MEMBER_ENROLLMENT_ENABLED` and `REGISTRATION_ENABLED` disabled until separate staging/operational approval. The browser request uses an exact-Origin check, mandatory non-simple action header and user-confirmed request; test these in real browsers before enabling.

**Deployment requirement:** Wrangler now declares an `AUTH_STATE` SQLite-backed Durable Object binding and `auth-state-v1` migration. The auth flow fails closed without this binding. Do not remove the binding or deploy a Worker without migrating the class.
