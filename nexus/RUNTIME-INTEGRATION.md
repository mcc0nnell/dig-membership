# DIG Nexus runtime integration (not a production launch)

## What is implemented
- `@neondatabase/serverless` HTTP query adapter: single-statement atomic registration function and member lookup.
- Cloudflare Wrangler config with disabled registration, Workers runtime, and rate-limit binding.
- `/api/me`: verified OIDC bearer token -> read-only membership lookup by issuer and subject. Returns no email or roles; no account auto-linking.
- WordPress portal links to the Worker Google sign-in flow. Authorization Code + PKCE, state, nonce, Google ID token verification, encrypted HttpOnly session and `/portal` membership-status view are implemented; see `GOOGLE-OIDC.md`.

## Required before real sign-in
1. Configure the Google OAuth web client, callback, secret and actual HTTPS Worker deployment described in `GOOGLE-OIDC.md`. Browser sign-in code exists but has not been tested with a real Google account.
2. Provision Neon credentials as a Cloudflare secret (`DATABASE_URL`), not in Wrangler vars or WordPress. Use least-privilege database role and verify connection and function grants in a non-production database.
3. Configure trusted `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URL` and `REGISTRATION_ALLOWED_ORIGIN`; confirm JWKS URL is same-origin with issuer.
4. The WordPress shortcode links to the Worker-hosted portal, so browser cookies remain same-origin. Do not expose tokens to WordPress or add cross-origin credentialed API calls.
5. Run end-to-end tests against synthetic accounts and a disposable Neon branch. No production registration, email, or payments are enabled.

## Commands
From repository root: `npm ci`, `node --test nexus/api/*.test.mjs` (excluding `*.deno.test.mjs` under Node), `npx wrangler deploy --dry-run --config nexus/wrangler.jsonc`. Deployment requires explicit operator approval and secrets.
