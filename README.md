# DIG Membership

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

## Registration flow

1. A visitor opens `https://deafingov.org/membership` (WordPress page with `[dig_membership_join]`).
2. The browser sends a verified Turnstile response, name and email to the Cloudflare Worker on a separate HTTPS origin.
3. The Worker requests a one-time email link from Salesforce, which uses the website-specific WordPress `/magic` URL with token in the URL **fragment**.
4. WordPress clears the fragment from browser history and sends the one-time token only to the Worker, which forwards it to Salesforce to validate and consume.
5. Salesforce activates an eligible term in `Membership__c`. Existing current/future terms are preserved. Ambiguous duplicate Contacts fail closed for staff review.

**No WordPress user or role is created.** No dues, authenticated member dashboard, voter eligibility, or renewals are implemented by this candidate. Those require separate policy and security review. The `WEBSITE_FREE` membership level and 12-month term are **provisional and must be confirmed against current DIG policy**.

## Quick local checks

Requires PHP and Node.js 22+:

```bash
php -l wordpress/dig-membership/dig-membership.php
node --test wordpress/dig-membership/tests/*.test.cjs
(cd cf/membership-site && node --test)
```

CI runs the same commands. It does **not** deploy to DIG's website, Salesforce, or Cloudflare.

## Installation on staging

- [WordPress plugin installation](wordpress/dig-membership/README.md)
- [Cloudflare Worker configuration](cf/membership-site/README.md)
- [Website membership cutover and rollback](docs/runbooks/website-membership-cutover.md)

Never put Salesforce credentials, Turnstile private keys, or member PII in WordPress settings, commits, CI variables visible to pull requests, or public issues. Review [SECURITY.md](SECURITY.md).

## Integrating with DIG's Salesforce repo

`dig-src/` contains the new classes/metadata **and updated versions of four existing classes**. They need to be reconciled with the latest DIG Salesforce baseline before deployment. Do not blindly overwrite live org source or run the manifest outside DIG's existing SFDX project. There is a known legacy `Membership_Term__c` vs. `Membership__c` split; this path intentionally uses `Membership__c` but does not backfill historical data.

## Roadmap

1. Sandbox contract tests for Salesforce and Contact field rollups; reconcile duplicate Contacts and legacy membership terms.
2. Staging end-to-end join, email delivery, invalid/expired/replayed link, screen-reader, keyboard, and anti-abuse tests.
3. Explicit membership policy, privacy/consent and retention review; pilot with admins and rollback.
4. Authenticated self-service profile, renewal workflow, communication preferences, and optional directory/governance modules after security review.

Contributions are welcome, but avoid submitting personal member data or production logs in issues or pull requests.
