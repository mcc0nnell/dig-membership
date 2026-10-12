# DIG Membership — WordPress plugin (v0.2 developer candidate)

This is a **native WordPress frontend** for enrollment and one-time email verification. **No Laravel or WordPress membership database** is required. Salesforce remains the system of record; Cloudflare protects Salesforce OAuth credentials and validates Turnstile responses.

## WordPress setup

1. Upload `dig-membership.zip` in **Plugins → Add New → Upload Plugin**, then activate.
2. Open **Settings → DIG Membership**. Enter the **HTTPS origin** of your deployed Cloudflare membership Worker (such as `https://membership-api.example.org`; the value must have no path) and your **public** Turnstile site key. Never enter Turnstile secret or Salesforce credentials into WordPress. You can instead set `DIG_MEMBERSHIP_GATEWAY_URL` and `DIG_MEMBERSHIP_TURNSTILE_SITE_KEY` as PHP constants in `wp-config.php`.
3. Create a public WordPress page with slug `membership` and body **`[dig_membership_join]`**.
4. Create a public WordPress page with slug `magic` and body **`[dig_membership_verify]`**. Exclude `/magic` from page caches, SEO indexing, analytics, social previews, redirects other than canonical slash handling, and any security plugin that strips fragments. Avoid placing third-party scripts on this page; the verification token exists only in the fragment and is removed immediately when JS executes.
5. Set Salesforce Custom Metadata `DIG_PortalAuthConfig__mdt.DEFAULT.WebsiteMembershipBaseUrl__c` to the **WordPress site origin** (for example, `https://deafingov.org`, no slash), *not* the Cloudflare Worker URL. The `web-join` email link will be built as `https://deafingov.org/magic#t=<token>&p=web-join` after the matching Apex change is deployed.
6. Set Worker `PUBLIC_SITE_ORIGIN` to the **exact WordPress origin** (including `www` if used). Register the WordPress hostname in Cloudflare Turnstile. Set Worker `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET`, and the Salesforce credentials as described in `../../cf/membership-site/README.md`. Apply Cloudflare rate limiting/WAF to API request and verification endpoints.
7. Test a brand-new Contact, existing member, duplicate Contact email, expired token, token replay, keyboard navigation, Turnstile failure, and emails in **Salesforce sandbox and WordPress staging** before production.

## Architecture and restrictions

```text
WordPress shortcode + JavaScript
  -> Cloudflare Worker (PUBLIC_SITE_ORIGIN allowlist, Turnstile, rate limits)
    -> Salesforce OAuth / Apex REST
      -> Magic_Link__c (30 minute, one-time)
      -> verified Contact + Membership__c
```

The WordPress plugin stores **no** Salesforce access tokens, member PII, or membership status. There are no WordPress user accounts or roles assigned by joining. This is an **enrollment and verification foundation**, not a full member dashboard, authenticated renewals, or dues collection system. Staff governance entitlements remain controlled inside Salesforce.

Do not disable WordPress' normal security controls. A public membership endpoint necessarily allows unauthenticated email-link requests: use Turnstile, Cloudflare WAF/rate limits, and operational monitoring. CORS restricts browser access, but is **not** a substitute for authentication or bot protection.

`PUBLIC_SITE_ORIGIN` should use the canonical WordPress hostname only. Do not set it to `*` or an `http://` origin in production.

## Smoke checks

```sh
php -l wordpress/dig-membership/dig-membership.php
node --check wordpress/dig-membership/assets/dig-membership.js
node --test wordpress/dig-membership/tests/*.test.cjs
cd cf/membership-site && node --test
```

No production deployment was performed in creating this package. Salesforce Apex changes still require org validation and tests.
