# DIG Nexus

**DIG Nexus** is the developing Deaf in Government membership, events, committees, governance, and communications platform. The Neon/PostgreSQL and Cloudflare foundation is documented in [`nexus/README.md`](nexus/README.md); the existing WordPress/Salesforce enrollment candidate is retained below for separate staging and policy review.

> **Repository rename:** The GitHub repository is now [`mcc0nnell/dig-nexus`](https://github.com/mcc0nnell/dig-nexus). Existing WordPress plugin paths, shortcodes, API settings, and Cloudflare Worker identifiers intentionally retain `dig-membership` names. Renaming those deployed integration identifiers requires its own migration plan.

## Legacy membership enrollment candidate

WordPress-first membership enrollment for **Deaf in Government** (DIG), backed by Salesforce and a credential-isolating Cloudflare Worker. Apache-2.0 licensed; independent of the existing Laravel portal.

> **Status: development candidate; not installed or deployed.** Local tests use mocks. A Salesforce sandbox review, WordPress staging pilot, policy approval, and production infrastructure configuration are required before launch.

## Components

| Directory | Responsibility |
|---|---|
| `wordpress/dig-membership/` | Installable WordPress plugin: `[dig_membership_join]` and `[dig_membership_verify]` shortcodes, theme-friendly styling and browser-side logic |
| `cf/membership-site/` | Worker gateway: Turnstile validation, restricted WordPress CORS, server-side Salesforce OAuth and REST forwarding |
| `dig-src/` | **Salesforce overlay**, not a standalone Salesforce project. Apex services and metadata to apply to DIG's existing Salesforce source tree |
| `manifest/` | Targeted Salesforce deployment manifest to be used **in the existing Salesforce project** |
| `docs/runbooks/` | Staging, cutover and rollback plan |

## Salesforce-native email

Salesforce sends the verification link and, after new-member activation, a WordPress-specific confirmation. A staff-scheduled Salesforce Batch Apex can send 30-day and 7-day WEBSITE_FREE renewal reminders after sandbox and policy review. Announcements remain a staff-driven Salesforce List Email/campaign action, never a public API. The read-only scripts/check-email-limits.mjs monitor queries actual Salesforce daily email capacity; it does not reserve capacity or send email. See [Salesforce email runbook](docs/runbooks/salesforce-email.md).

**No renewal job is scheduled or enabled by this repository.**

## Public GitHub Pages demo

**Demo URL:** https://mcc0nnell.github.io/dig-nexus/

The `Publish offline membership demo to GitHub Pages` GitHub Actions workflow serves **only** `demo/offline.html` as the site index, keeping Salesforce overlay files, secrets, and the WordPress plugin out of the deployment artifact. The demonstration is **synthetic and nonfunctional as a live membership service**: no external requests, authentication, cookies, persistence, WordPress credentials, or real member data.

On its first run, the workflow uses its Pages write permission to enable the Pages site and set the source to **GitHub Actions**. If repository or organization policy prevents automatic enablement, a repository administrator can select **Settings → Pages → Build and deployment → Source: GitHub Actions** manually. Run the `Publish offline membership demo to GitHub Pages` workflow using its manual `workflow_dispatch` button if needed. The workflow runs offline tests and publishes the latest HTML to GitHub Pages automatically when the demo changes. A green membership CI job does not by itself establish that Pages is live.

Do **not** use this GitHub Pages address as the live DIG enrollment endpoint. Production registration remains the WordPress plugin at deafingov.org after a Salesforce sandbox and policy review.

## WordPress member portal shell

Add `[dig_membership_portal]` to a WordPress page (for example, `/members`). This new shortcode renders responsive membership, profile/preferences and renewal sections **without showing real records or claiming a member is signed in**. It is a privacy-safe placeholder and does not use the demo's mock identity as authentication. The existing `[dig_membership_join]` and `[dig_membership_verify]` shortcodes remain unchanged.

**Next integration gate:** implement a secure server-side member session, authenticated Salesforce read endpoints with per-member access checks, consent history, and a staging test before showing personal information. The GitHub Pages demo remains synthetic and is not the live WordPress member portal.

## Salesforce-free membership experience preview

Open [demo/offline.html](demo/offline.html) locally for an interactive demo of the future member experience: join → simulated verification → profile → accessibility and email preferences → renewal → email templates → staff metrics. **All identities and figures are synthetic. The demo never sends an email, creates a WordPress account, authenticates anyone, or contacts Salesforce.** It is intentionally separate from the production WordPress plugin.

See [the offline demo guide and Salesforce integration mapping](docs/architecture/experience-demo.md). Run `node --test demo/offline.test.cjs` to check its scripted flows. The public staff view is a visual mock, **not an administrator login**.

## Registration flow

1. A visitor opens `https://deafingov.org/membership` (WordPress page with `[dig_membership_join]`).
2. The browser sends a verified Turnstile response, name and email to the Cloudflare Worker on a separate HTTPS origin.
3. The Worker requests a one-time email link from Salesforce, which uses the website-specific WordPress `/magic` URL with token in the URL **fragment**.
4. WordPress clears the fragment from browser history and sends the one-time token only to the Worker, which forwards it to Salesforce to validate and consume.
5. Salesforce activates an eligible term in `Membership__c`. Existing current/future terms are preserved. Ambiguous duplicate Contacts fail closed for staff review.

**No WordPress user or role is created.** No dues, authenticated member dashboard, voter eligibility, or self-service renewals are implemented by this candidate. Those require separate policy and security review. The `WEBSITE_FREE` membership level and 12-month term are **provisional and must be confirmed against current DIG policy**.

## Quick local checks

Requires PHP and Node.js 22+:

```bash
php -l wordpress/dig-membership/dig-membership.php
node --test wordpress/dig-membership/tests/*.test.cjs
node --test scripts/check-email-limits.test.mjs
(cd cf/membership-site && node --test)
```

CI runs the same commands. It does **not** deploy to DIG's website, Salesforce, or Cloudflare.

## Installation on staging

- [WordPress plugin installation](wordpress/dig-membership/README.md)
- [Cloudflare Worker configuration](cf/membership-site/README.md)
- [Website membership cutover and rollback](docs/runbooks/website-membership-cutover.md)
- [Salesforce email quotas, announcements, renewal batches, and rollback](docs/runbooks/salesforce-email.md)

Never put Salesforce credentials, Turnstile private keys, or member PII in WordPress settings, commits, CI variables visible to pull requests, or public issues. Review [SECURITY.md](SECURITY.md).

## Integrating with DIG's Salesforce repo

`dig-src/` contains the new classes/metadata **and updated versions of four existing classes**. They need to be reconciled with the latest DIG Salesforce baseline before deployment. Do not blindly overwrite live org source or run the manifest outside DIG's existing SFDX project. There is a known legacy `Membership_Term__c` vs. `Membership__c` split; this path intentionally uses `Membership__c` but does not backfill historical data.

## Roadmap

1. Sandbox contract tests for Salesforce and Contact field rollups; reconcile duplicate Contacts and legacy membership terms.
2. Staging end-to-end join, email delivery, invalid/expired/replayed link, screen-reader, keyboard, and anti-abuse tests.
3. Explicit membership policy, privacy/consent and retention review; pilot with admins and rollback.
4. Authenticated self-service profile, renewal workflow, communication preferences, and optional directory/governance modules after security review.

Contributions are welcome, but avoid submitting personal member data or production logs in issues or pull requests.
