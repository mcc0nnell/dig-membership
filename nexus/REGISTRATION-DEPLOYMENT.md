# DIG Nexus registration deployment gate

**Status: disabled, not deployed.** `POST /api/register` defaults to HTTP 503 unless `REGISTRATION_ENABLED=true`. Separately, the new **explicit-request** `POST /api/enroll` defaults to 503 unless `MEMBER_ENROLLMENT_ENABLED=true`. Signing in is not a membership request or approval.

## Authentication paths are intentionally separate

- **Google browser login:** `/auth/google/start` -> Google -> `/auth/google/callback` -> encrypted, HttpOnly, Secure session cookie -> `/portal` and read-only `/api/me`. The Google session is tracked in the `AUTH_STATE` Durable Object. See [GOOGLE-OIDC.md](GOOGLE-OIDC.md).
- **Browser membership request:** `POST /api/enroll` uses only the verified Google **session cookie**, exact same-origin `Origin`, same-origin Fetch Metadata if present, `x-dig-nexus-action: request-membership`, an enabled `registrationRateLimiter`, and a body with `{displayName, requestMembership:true}`. It is disabled by default and creates pending membership only.
- **Bearer registration API:** `POST /api/register` requires an independently verified **Bearer** identity, a matching `REGISTRATION_ALLOWED_ORIGIN`, the `registrationRateLimiter` binding, and `REGISTRATION_ENABLED=true`. A Google session cookie is **not** accepted by this endpoint.

## Registration-specific configuration

- `REGISTRATION_ENABLED` — keep `false` until the bearer-token gates below pass.
- `MEMBER_ENROLLMENT_ENABLED` — keep `false` until the separate Google browser enrollment flow passes staging and policy review.
- `OIDC_ISSUER` — exact HTTPS issuer for registration bearer tokens.
- `OIDC_AUDIENCE` — exact expected bearer-token audience.
- `OIDC_JWKS_URL` — HTTPS JWKS endpoint on the issuer's origin.
- `REGISTRATION_ALLOWED_ORIGIN` — exact trusted HTTPS Origin for registration requests.
- `registrationRateLimiter` — Cloudflare rate-limit binding declared in `nexus/wrangler.jsonc`.
- `DATABASE_URL` — Cloudflare **secret** for Neon PostgreSQL, never WordPress/browser source or checked-in Wrangler vars. `pgClient`/`registrationDb` can be injected by trusted server-side tests.

Google's `GOOGLE_CLIENT_ID` is **not automatically interchangeable** with `OIDC_AUDIENCE`. Select and test the registration token policy explicitly before enabling it.

## Database gate

Apply `nexus/schema.sql`, `nexus/schema-002-lifecycle.sql`, `nexus/schema-003-identities.sql`, and `nexus/schema-004-registration.sql` in order on a disposable Neon branch. Validate the SQL function, constraints, least-privilege grants, encrypted transport, concurrent/idempotent registration, and rollback/cleanup. The atomic SQL function creates **pending** membership without newsletter consent. Do not infer that passing synthetic PostgreSQL CI means migrations were applied to a live Neon project.

## Do not enable until

1. Google sign-in and Durable Object migration have been verified in a non-production Cloudflare environment using the real OAuth provider; cookie session revocation and one-time state consumption must work across requests.
2. Registration's **separate bearer-token** issuer/audience/JWKS policy is configured and tested against the chosen identity provider; cross-client tokens must fail.
3. Neon schemas, atomic function, permissions, and synthetic end-to-end member lookup/registration are validated on a disposable branch.
4. Registration Origin checks, rate limiting, replay/idempotency and request/consent semantics are reviewed. Any future cookie-based registration must include a distinct CSRF design.
5. WordPress/Worker HTTPS origins, accessibility, monitoring, incident response, and data-retention procedures are approved by DIG operators.
6. Production secrets and deployment are explicitly authorized. No email delivery, payments, elections, or member import are authorized by this checklist.

## Validation without deployment

From the repository root run `npm ci`, the Node/Deno CI test suites, and `npx wrangler deploy --dry-run --config nexus/wrangler.jsonc`. Dry-run validates the bundle and bindings **but does not create the Durable Object, apply a Neon migration, or verify a Google callback**.
