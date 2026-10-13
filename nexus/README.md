# DIG Nexus — application foundation

This directory contains the original DIG Nexus domain and API code. **Development only; not an authorized public member, ticket, mail, or elections service.**

**Selected deployment:** WordPress website link → Caddy HTTPS → non-root Docker Node API → Neon PostgreSQL. There is no required Salesforce, CiviCRM, listmonk, Cloudflare Worker, or Google Cloud runtime. Google OAuth and NTC magic-link sign-in are provider options, not automatic membership approval.

| Domain | Current implementation | Release gate |
| --- | --- | --- |
| Membership | Verified subject/identity, pending enrollment, lifecycle and terms | Real OAuth, policy and isolated Neon verification |
| Directory & committees | Private-by-default member schema and role controls | DIG privacy and staff authorization |
| Governance | Eligibility and role logic | **No secret-ballot casting or counting** |
| NTC | Agenda, organizer, attendees, waitlists, Zeffy verified-paid admission and QR path | Provider fixtures, stock reconciliation, privacy, default-off flags |
| Association | Organizations, affiliations, follow-up cases/activity and private browser staff workspace | `CONSTITUENTS_ENABLED`, `CAMPAIGNS_ENABLED` off |
| Newsletter | Explicit list consent, previews, queue, one-click opt-out, dispatch preflight | No live sends, no automatic worker, verified MailerSend plan pending |
| Runtime | Caddy authenticated proxy, Neon-backed state and opt-in jobs | Nonprod HTTPS staging, database grants, secrets and monitoring |

Find the **current documented implementation** in [status](IMPLEMENTATION-STATUS.md), [Docker runbook](DOCKER.md), [NTC paid inventory](PAID-INVENTORY.md), [association operations](ASSOCIATION-OPERATIONS.md), and [clean-room test policy](CLEANROOM-OPERATIONS.md). The [offline interactive demo](../demo/offline.html) uses synthetic local state only.

All SQL changes must be validated against a disposable PostgreSQL database or isolated Neon staging branch before applying production migrations. Accessibility reviews with Deaf people, ASL access, captions, screen readers, keyboard operation, and privacy requirements remain launch gates.

Legacy Worker/Cloud Run modules or documentation are retained as historical/alternate adapters. They are not prerequisites for the chosen Docker deployment.
