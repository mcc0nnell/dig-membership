# DIG Nexus runtime integration (not a production launch)

## What is implemented
- `@neondatabase/serverless` HTTP query adapter: single-statement atomic registration function and member lookup.
- Cloudflare Wrangler config with disabled registration, Workers runtime, and rate-limit binding.
- `/api/me`: verified OIDC bearer token -> read-only membership lookup by issuer and subject. Returns no email or roles; no account auto-linking.
- WordPress accessible portal shell: explicitly indicates login is unavailable until a provider and session integration are configured.

## Required before real sign-in
1. Select and configure an OIDC provider, client ID, callback URL, and authorization-code + PKCE login flow with HttpOnly Secure SameSite cookies and CSRF protections. **Bearer token verification is not a browser login flow.**
2. Provision Neon credentials as a Cloudflare secret (`DATABASE_URL`), not in Wrangler vars or WordPress. Use least-privilege database role and verify connection and function grants in a non-production database.
3. Configure trusted `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URL` and `REGISTRATION_ALLOWED_ORIGIN`; confirm JWKS URL is same-origin with issuer.
4. Configure frontend-to-Worker authenticated session and CORS/CSRF policy. The WordPress shortcode intentionally does not solicit bearer tokens or store them in JavaScript.
5. Run end-to-end tests against synthetic accounts and a disposable Neon branch. No production registration, email, or payments are enabled.

## Commands
From repository root: `npm ci`, `node --test nexus/api/*.test.mjs` (excluding `*.deno.test.mjs` under Node), `npx wrangler deploy --dry-run --config nexus/wrangler.jsonc`. Deployment requires explicit operator approval and secrets.
