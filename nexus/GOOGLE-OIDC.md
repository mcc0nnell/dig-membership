# DIG Nexus: Google sign-in decision and implementation plan

**Decision:** Google OAuth 2.0 / OpenID Connect for member authentication. DIG Nexus remains the authority for membership approval, roles, dues, and directory visibility. A Google account does **not** grant DIG membership.

**Status:** Architecture approved for implementation; **Google browser sign-in is not yet implemented or deployed**. The current Worker validates bearer JWTs using `jose` and supports verified `/api/me` lookup. WordPress still shows a sign-in-unavailable message. Registration and newsletter sending remain disabled.

## Google Cloud setup (operator action)

1. Configure the Google Auth Platform consent screen, branding, and audience. Choose External unless there is a deliberate Google Workspace-only restriction. Test users may be needed while in testing mode.
2. Create an OAuth 2.0 **Web application** client in Google Cloud Console. Set authorized JavaScript origins only if needed; the preferred server-side flow does not expose credentials or tokens to browser JavaScript.
3. Register the exact HTTPS callback URL, e.g. `https://<worker-host>/auth/google/callback`. Replace the placeholder with the real deployed Worker hostname; it is not yet an active endpoint. Google requires an exact match.
4. Store `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` as Cloudflare Worker secrets (client ID can be public but manage it centrally). Never put the client secret, Neon URL, tokens, or session keys in WordPress or the repository.
5. Choose the final Worker and WordPress hostnames before setting cookie domain, callback URL, and origin allowlist. Prefer same-site hosting for session cookies.

## Planned Worker login flow (not yet coded)

- `GET /auth/google/start`: generate high-entropy state, PKCE verifier/challenge (S256), and nonce; bind to a short-lived, HttpOnly, Secure, SameSite cookie. Redirect to Google's authorization endpoint with `openid email profile` scopes, exact redirect URI, client ID, and code challenge. No implicit flow.
- `GET /auth/google/callback`: verify state and nonce, exchange authorization code server-side using the PKCE verifier and confidential client authentication, and validate the ID token with `jose` against Google's trusted discovery/JWKS, audience, issuer, expiry, and nonce. Require `email_verified === true`; use `sub` (not email) as the stable identity key.
- Create a server-managed, short-lived, rotating session with HttpOnly, Secure, appropriate SameSite cookies and CSRF defenses for mutations. Do not store ID/access tokens in localStorage, URLs, WordPress options, or browser-readable cookies.
- `GET /api/me`: derive identity from the validated session, then query Neon by `(issuer, sub)` and return only permitted member information. Do not auto-link accounts by matching email.
- `POST /auth/logout`: invalidate server session and clear cookies. Logout must not rely on merely deleting a browser token.
- `POST /api/register`: only after the deployment gate is explicitly opened; pending member status and newsletter opt-out remain defaults. Require CSRF protection, origin validation, rate limits, and verified identity.

## Important verifier compatibility

Google's OIDC issuer may be `https://accounts.google.com` (or `accounts.google.com` in some token contexts). Google's JWKS location is not necessarily on the issuer's origin. The **current** `createOidcVerifier` intentionally rejects cross-origin JWKS URLs and expects a bearer token. Do not simply set Google environment variables and enable registration. Implement a separately configured Google verifier with a pinned Google discovery/JWKS URL, explicit issuer allowlist, and Google-specific tests; do not loosen the generic verifier to accept arbitrary token-provided key URLs.

## Acceptance tests before enabling sign-in

- PKCE/state/nonce success and rejection; expired/replayed state; wrong audience/issuer, invalid signature, expired token, unverified email; malformed callback and token-exchange failures.
- Cookie security, session rotation/expiry/logout, CSRF, cross-origin denial, rate limiting, no sensitive logging, and no token leakage in redirect URLs.
- Synthetic new member -> pending; returning member -> same identity; same email/different Google subject -> conflict; unapproved member -> no privileged access.
- WordPress keyboard-only, screen-reader, reduced-motion, mobile, and clear error/status UX; captions and ASL resources where relevant.
- Node, Deno, Wrangler dry-run, and isolated integration tests against a disposable Neon branch. No live member import or emails during validation.

## Safe launch gate

Do not turn on `REGISTRATION_ENABLED` or deploy live Google login until the client is provisioned, Worker callback and session handling exist, DNS/HTTPS and secret bindings are configured, synthetic end-to-end tests pass, and DIG authorizes rollout.
