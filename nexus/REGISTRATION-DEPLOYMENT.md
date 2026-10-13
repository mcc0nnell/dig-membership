# DIG Nexus registration deployment gate

The Worker has an intentionally disabled `POST /api/register` endpoint.

## Required configuration

- `REGISTRATION_ENABLED=true` — only after all gates below pass; absent or false means 503.
- `OIDC_ISSUER` — exact HTTPS identity provider issuer.
- `OIDC_AUDIENCE` — expected token audience.
- `OIDC_JWKS_URL` — HTTPS JWKS endpoint on the issuer's origin.
- `pgClient` — trusted server-side PostgreSQL query client (e.g. Hyperdrive-backed); never expose database credentials to WordPress or browsers.

The Worker can also accept injected `verifyIdentity` and `registrationDb` adapters for isolated tests. These are trusted server-side dependencies, **not** request headers.

Apply `nexus/schema.sql`, `nexus/schema-002-lifecycle.sql`, `nexus/schema-003-identities.sql`, and `nexus/schema-004-registration.sql` in order to a non-production database first. The registration SQL function executes in a single PostgreSQL statement and defaults to pending membership with no newsletter consent.

## Do not enable until

1. PostgreSQL integration and Node/Deno tests are green.
2. OIDC issuer/audience/JWKS are confirmed against the chosen provider; reject tokens minted for another client.
3. The PostgreSQL client is configured with least privilege and encrypted transport.
4. Per-identity/IP rate limiting and session CSRF/origin policy are enforced at the edge.
5. An authorized end-to-end test passes with a synthetic account and cleanup.

No production account creation, email delivery, payments, elections, or member import is authorized by this document.
