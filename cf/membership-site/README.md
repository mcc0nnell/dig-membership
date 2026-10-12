# DIG Membership Site (no Laravel)

This is a **framework-independent Cloudflare Worker**, not a Laravel app. It serves the public enrollment page and acts as a credential-safe gateway for Salesforce's already implemented magic-link APIs. The DIG root website uses WordPress. **Prefer the native `wordpress/dig-membership` plugin** for `/membership` and `/magic`. Keep this Worker as the credential-safe JSON API gateway; its built-in standalone HTML is only an optional fallback.

**Safety:** This is source code, not a live deployment. No domain, Salesforce org, or production records were modified. The root `deafingov.org` site's actual hosting could not be verified by the web checker on 2026-10-12; do not presume WordPress or Cloudflare routes for that root domain.

## Request flow

1. `GET /membership` displays a standalone fallback form. The production WordPress membership page uses the plugin shortcode instead.
2. `POST /api/membership/request` validates the Turnstile token and calls Salesforce `/services/apexrest/v1/magic/request` with purpose `web-join`.
3. Salesforce creates a one-time, 30-minute email link to `WebsiteMembershipBaseUrl__c/magic#t=...&p=web-join`. It records the supplied names **on the token record** (not in an unverified Contact).
4. `GET /magic` is the standalone fallback. The production WordPress `/magic` page reads the `#t=` URL fragment, removes it from history, and calls `POST /api/membership/verify`. Salesforce must use `WebsiteMembershipBaseUrl__c` set to the **WordPress origin**; `web-join` link generation now uses `#t=` rather than `?t=`.
5. Salesforce `/services/apexrest/v1/magic/verify` locks and consumes the token, then `DigWebsiteMembershipService.activate` finds or creates the Contact and, when eligible, adds a **free** term to `Membership__c` (`Level__c=WEBSITE_FREE`, no `PaidDate__c`). The existing membership trigger populates Contact's summary. Existing current or future terms are **not replaced**.
6. Worker returns only `{ok,status,end}`. It strips Contact IDs, email and all Salesforce admin claims, and holds Salesforce credentials server-side.

This leverages the existing Salesforce member spine, magic link, metadata, and daily renewal task job. It intentionally does **not** issue browser login sessions or a member dashboard, use a payment provider, or expose personal profile records through a public endpoint.

## Setup (must be completed before activation)

1. Review DIG's **current** free-membership policy and website hosting. Historical 2025 content states membership was free; this cannot be assumed permanent. `WEBSITE_FREE` can be disabled by removing its metadata record, which causes enrollment to fail closed rather than inventing payments.
2. Salesforce: configure `DIG_PortalAuthConfig__mdt.DEFAULT.WebsiteMembershipBaseUrl__c` to the canonical WordPress origin, e.g. `https://deafingov.org`, **without a trailing slash**. Do **not** overwrite `PortalBaseUrl__c` (which is used by Laravel).
3. Salesforce: deploy and validate a **targeted** manifest from the repo root:

   ```sh
   sf project deploy validate --target-org deafingov \
     --manifest manifest/website-membership-v1.xml \
     --test-level RunSpecifiedTests \
     --tests DigWebsiteMembershipServiceTest
   ```

   Run all affected MagicLink and DigOps tests separately before deploying; the API classes are reused.
4. Salesforce: ensure the integration user has only the required Apex REST class access and CRUD/FLS permissions on `Magic_Link__c`, `Contact`, `Membership__c` (and the Contact membership summary fields) plus permission to send email. Connected App uses OAuth client-credentials with a dedicated least-privileged integration user. Confirm email deliverability and verified sender.
5. Cloudflare: create Turnstile widget for the **actual** chosen hostname; configure `TURNSTILE_SITE_KEY` as a non-secret variable. Use `wrangler secret put` for `TURNSTILE_SECRET`, `SF_CLIENT_ID`, `SF_CLIENT_SECRET`. Set `SF_AUTH_BASE_URL` (Salesforce login URL for this org), and `SF_INSTANCE_URL` (`https://<my-domain>.my.salesforce.com`). The gateway validates the latter's hostname. No credentials in source files.
6. Apply Cloudflare rate limiting/WAF to `/api/membership/request`, and review the domain's DNS/route ownership. Choose a dedicated Worker hostname for `/api/membership/*` (not currently verified as active), leaving WordPress `/membership` and `/magic` on the existing root website. Do not reroute the WordPress pages or the entire root site to Cloudflare. Configure website links after staging verification.
7. Run keyboard/screen-reader, duplicate contact, active paid term, future term, first join, expired token, token replay, and email deliverability smoke tests on a sandbox before live launch.
8. Schedule the existing `DigOps_MembershipDailyJob` if renewal Tasks are wanted. It creates staff Tasks; it **does not** send renewal emails automatically.

### Local checks

```sh
cd cf/membership-site
node --test
# npm install && npm run dev  # requires Cloudflare dev tooling and configured variables
```

The Node tests mock external calls: **passing tests do not prove** Salesforce configuration, domain routing or email delivery.

## Existing repository's membership split

- `Membership_Term__c` is written by the older `DigMembershipService.join` API, but `DigOps_MembershipService` computes the current Contact status from **`Membership__c`**. This is a real architectural divergence. This v1 implementation writes only `Membership__c`. The old entrypoint must be audited and retired or migrated in a separate board-approved data cleanup, **not** silently backfilled.
- Staff need to review **duplicate Salesforce Contacts per email** before a launch. This service fails closed instead of choosing the newest record arbitrarily.
- `MagicLinkVerifyApi` still has legacy `join` and `renew` behavior for other clients, untouched except for the new web-join branch and token row lock.
- `WEBSITE_FREE` is a deliberate 12-month policy default; if DIG has changed its bylaws or renewal rules, edit CMDT before deployment.

## Remaining work before a complete member experience

Current build is the **join/verify/activation core**, not a production-ready full membership product. Implement authenticated member profile and renewal self-service using proper server-side sessions; consent management and member-facing email preferences; imports/migration from the legacy term object; governance eligibility based on bylaws; and monitoring/alerts. Do not derive voting eligibility solely from the website's status response.

## WordPress-first deployment

See [`../../wordpress/dig-membership/README.md`](../../wordpress/dig-membership/README.md). Set the Worker `PUBLIC_SITE_ORIGIN` variable to the exact HTTPS origin of the WordPress site, e.g. `https://deafingov.org`. The Worker allows browser requests from this origin and sends an explicit CORS header (not wildcard). The Turnstile widget must be registered for the **WordPress** hostname; siteverify validates against that hostname, not the API hostname. Worker and WordPress must use the same Turnstile site key, with the secret kept only in Cloudflare.

The Cloudflare Worker does **not** replace the WordPress theme or member pages. Run `node --test` to test the same-origin and WordPress-origin flows.
