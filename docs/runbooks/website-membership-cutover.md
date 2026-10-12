# Website membership cutover checklist

**Status: developer candidate; not deployed.** Never deactivate the existing portal based solely on these files.

1. Confirm DIG membership rules and canonical WordPress origin (user confirmed WordPress on 2026-10-12). Cross-check 2025 NTC public statement that DIG membership is free against current Board policy.
2. Inventory Salesforce `Membership__c`, `Membership_Term__c`, Contacts, duplicate email counts, and active memberships. Compare status rollups before any changes.
3. Confirm staff permissions and OAuth integration user. Validate targeted Apex deployment, all MagicLink test classes, and the new website tests against a Salesforce sandbox.
4. Configure `WebsiteMembershipBaseUrl__c` to the canonical **WordPress origin** without touching the existing portal URL. Install the WordPress plugin on staging with `/membership` and `/magic` shortcodes. Publish the API Worker on a staging host, set `PUBLIC_SITE_ORIGIN`, and configure Turnstile, secrets and rate limiting. Ensure the token fragment `#t=` is never received by WordPress in its HTTP requests.
5. Verify one new member, an already-active member, a future membership, a lapsed member, a duplicate email, expired token, one-time-use replay, and inaccessible/bounced email. Confirm no Contact is created **until email verification**.
6. Validate Contact's `Is_Current_Member__c`, `Membership_Status_Summary__c`, `Membership_End_Date__c`, `Member_Since__c` and audit event expectations. Confirm `PaidDate__c` stays empty for WEBSITE_FREE.
7. Update the WordPress navigation 'Join' link to `/membership` only after a staging pilot; publish in stages and monitor duplicate Contacts, email sends and errors.
8. After migration and verification, retire the legacy route writing only `Membership_Term__c` and any Laravel-linked public entrypoints; do not modify old data without reconciliation.

Rollback: remove the root website 'Join' route/link to the new site and restore prior path. Keep Salesforce records created during the pilot for audit, and discontinue `web-join` issuance. Do not delete memberships to conceal a failed rollout.
