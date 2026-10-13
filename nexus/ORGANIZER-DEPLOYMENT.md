# NTC organizer console — development-only release gates

The console is implemented in `nexus/api/organizer*.mjs` and SQL migration
`nexus/schema-006-organizer.sql`. **No organizer is automatically provisioned.**
It uses the existing Google OAuth session and revocation path, not a separate
username/password system, and requires a membership identity mapping plus a
role that is authorized for the selected event.

## Staged deployment prerequisites

1. Apply ordered schema 001–006 to an isolated reviewed Neon staging branch, after
   backup and verification. Do not apply migration 006 to a live database without
   confirming existing 005 speaker ownership and role policy.
2. Complete and test the existing Google session integration, origin settings,
   rate-limit bindings and credential management; never put database credentials
   in WordPress or JavaScript.
3. Staff provisioning is a privileged **server-side administrative operation**.
   For a known event ID and already-verified member ID, an authorized database
   administrator may insert `nexus_event_staff_assignments(event_id,member_id,staff_role)`.
   Use `manager` for publication approval, `editor` for drafts. A global
   `nexus_roles.role='admin'` grants conference manager rights. No HTTP endpoint
   allows anyone to grant themselves these roles.
4. Configure `organizerRateLimiter` independently of membership registration,
   then set `ORGANIZER_ENABLED=true` only in approved staging after verifying
   authorization and access revocation end to end. Defaults to `false`.
5. Staff access `/organizer/ntc-2027` (replace with approved event slug) after
   signing in via `/auth/google/start`. Public event viewing is separate at
   `/events/:slug` and requires both event and session publication.
6. Verify keyboard navigation, focus and screen-reader labels, DeafBlind access,
   venue time-zone formatting, audit trails, and roles with DIG staff.

## Security contract

- Every request verifies a server-side, revocable Google session. Client `x-role`,
  `memberId`, email or body fields cannot grant staff privileges.
- Restricted reads use `nexus_organizer_snapshot`, scoped by verified issuer and
  subject through `nexus_external_identities`. All writes use one PostgreSQL
  transaction function `nexus_organizer_apply`, rechecking current staff role,
  locking the event row, and appending an immutable metadata-only audit record.
- Event staff assignments are **per event**; existing draft events never become
  public through permission changes. The `manager` role approves event, session,
  and speaker publication; editors cannot rewrite previously published content.
- All state-changing HTTP requests demand exact same-origin `Origin`, JSON
  content type, bounded size, rate limiting, and an allow-listed command schema.
- Snapshot and audit intentionally exclude attendee and accessibility-request
  data. Speaker biographies remain draft/private until a manager approves.
- The audit is metadata-only: it records actor, event, target, command and time,
  not full before/after text or private notes. Define retention and archival
  procedures before operational launch.
- There is no public admin API, no payment handling, no email send, no ticket
  issuance, and no permission self-service in this milestone.

## Verification

- Node: `node --test nexus/api/organizer*.test.mjs`
- Full unit suite and Wrangler bundle: see `.github/workflows/dig-nexus.yml`.
- PostgreSQL: `.github/workflows/dig-nexus-postgres.yml` applies migration 006
  and runs `nexus/tests/organizer-integration.sql` on a disposable PostgreSQL 17.
  That integration verifies unauthorized role boundaries, event isolation,
  manager-only publication, draft constraints and immutable audit.

No server deployment or Neon migration is implied by a successful CI run.
