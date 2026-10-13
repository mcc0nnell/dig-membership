# DIG Nexus implementation status

Updated 2026-10-12. Development only. Draft PR #6.

## Verified
- Dedicated Neon project `dig-nexus-dev` and `dig_nexus` database were provisioned.
- Schemas 001 and 002 plus newsletter schemas were applied on the development branch and a separate validation branch.
- Synthetic member, membership term and pending communication preference were inserted and cleaned up on the validation branch; post-cleanup counts were zero.
- PostgreSQL 17 CI applied the original four schemas successfully.
- Node and Deno tests passed before the latest registration changes; latest runs must be checked separately.

## New registration milestone (not yet end-to-end)
- `nexus/api/registration.mjs`: pure registration orchestration. Requires verified identity from a trusted server-side verifier; never trusts member ID, roles, consent, or email in the request body.
- `nexus/api/registration.test.mjs`: denied unauthenticated requests, validation, duplicate/idempotent response contract, and email conflict.
- `nexus/schema-003-identities.sql`: issuer/subject to member mapping. Newly added to PostgreSQL CI, **not yet applied to Neon**.
- `nexus/api/worker.mjs`: public health endpoint; `/api/me` intentionally returns 501. No registration HTTP route yet.
- `nexus/wordpress/dig-nexus.php`: accessible shortcode placeholder; not deployed.

## Remaining gates before a real registration
1. Configure and validate OIDC issuer, JWKS signature, audience, expiry, and verified email.
2. Implement a transactional Neon adapter that atomically inserts member and identity mapping, serializes races, and refuses email-based automatic account linking.
3. Expose a rate-limited authenticated registration HTTP endpoint with origin/CSRF controls appropriate to the chosen session mechanism.
4. Apply schema 003 to isolated Neon staging after CI validation and inspect indexes/constraints.
5. Test concurrent duplicate requests, account collisions, provider errors, and no-consent defaults against a disposable database.
6. Connect WordPress only after authentication and server-side authorization work. No payment, election ballots, or marketing email in this milestone.

## Test commands
- Node: `node --test nexus/*.test.mjs nexus/api/worker.test.mjs nexus/api/registration.test.mjs newsletter/*.test.mjs`
- Deno: `deno test --no-check --allow-net=127.0.0.1 nexus/api/*.deno.test.mjs`
- PostgreSQL: GitHub Actions `DIG Nexus PostgreSQL schema validation`.

## Security boundaries
Newsletter opt-in is independent of membership and must never be inferred from signup. Membership eligibility is independent of identity. Directory opt-in defaults to false. No client-supplied role or member ID may authorize access. Accessibility requests must remain restricted to event staff. Ballots must not be linked to identities.
