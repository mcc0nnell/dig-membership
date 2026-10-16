# Security policy

DIG Nexus is a development and staging candidate, **not** a production-ready membership identity provider. Do not expose authenticated writes, attendee payment reconciliation, check-in, or member records publicly without documented staging and permission testing.

## Private vulnerability reporting

Report suspected issues privately to DIG website administrators through an established organizational channel. Do **not** post vulnerabilities, live access tokens, Neon database URLs, Google OAuth secrets, Zeffy credentials or webhook secrets, MailerSend API tokens, member information, accessibility/accommodation requests, or working magic links in public issues and pull requests. Enable GitHub private vulnerability reporting before broad public adoption.

## Deployment expectations

- Use the supported Docker Compose/Caddy architecture with a non-root application container and Neon PostgreSQL credentials scoped to required database operations. See `nexus/DOCKER.md`.
- Retain the private Caddy-to-application proxy boundary. Never publicly publish the application port or trust client-provided identity, IP, or proxy headers.
- Keep all state-changing features disabled until staging has exercised login, authorization, cross-user isolation, request limits, and CSRF/origin controls. CORS alone is **not** authorization.
- Verify Google OAuth callback configuration, issuer/audience, encrypted sessions, revocation, and logout; keep session and magic-link credentials outside Git. Do not leak authentication tokens through query strings, debug logs, analytics, or support tickets.
- Verify Zeffy webhook signatures and independently retrieve payment status before admission, credential issuance, or reconciliation. Never infer payment success from a browser request alone.
- Require staff authorization and auditability for check-in, organizer writes, accommodation coordination, and member administration.
- Verify transactional MailerSend configuration, rate-limiting, no-store responses for sensitive pages, and safe HTML rendering.
- Maintain patched dependencies and perform staging tests before updating deployed tooling or images.

The legacy `cf/membership-site` material and any WordPress `/magic` integration require independent configuration and security review if deployed; they are not substitutes for the current Nexus identity and authorization controls.
