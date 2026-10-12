# Salesforce-native email for DIG

**Deployment state: not deployed.** DIG uses WordPress, Salesforce Nonprofit Cloud, and a Cloudflare Worker gateway. This overlay must be reconciled with the current private Salesforce codebase before sandbox deployment. No renewal job is enabled by default.

## Supported email paths

| Type | Mechanism | Safety |
| --- | --- | --- |
| Verification | Existing Salesforce Apex magic link delivery after Cloudflare Turnstile | Failed sends roll back new and invalidated magic-link rows; one-time 30-minute token and throttle |
| New member confirmation | Salesforce Queueable Apex after email verification and new website membership | WordPress-specific confirmation, not the legacy Laravel portal; checks Contact email and HasOptedOutOfEmail; a mail error cannot revoke the membership; failed jobs require manual staff investigation and retry |
| 30-day and 7-day renewal notices | Optional Salesforce Batch Apex | WEBSITE_FREE and Source=Web only; no cancelled/opted-out contacts; skips already-renewed contacts; sent-at markers avoid normal duplicates |
| Announcements and newsletters | Staff-operated Salesforce List Email/campaign interface (if entitled) | Staff reviews consent, recipients, suppression, unsubscribe/opt-out and daily MassEmail capacity. No public bulk-send API |

The renewal batch checks its recipient scope and requires batches of at most 25. On a failed send, no timestamp is set; a later scheduled run may retry while still in the 30-to-8-day or 7-to-0-day eligible window. A hard Salesforce quota failure can fail a batch chunk. This is **not exactly-once delivery**: if email acceptance succeeds but recording the timestamp fails, staff must reconcile Salesforce Email Logs before retrying. Check Apex Jobs after execution.

**No renewal schedule is installed automatically.** DIG must approve membership term policy and opt-out/privacy treatment before staff enable it. The WEBSITE_FREE and 12-month policy remain provisional.

## Daily limits and monitoring

Salesforce licensed production orgs typically allow **up to 5,000 external SingleEmail recipients a day** for Apex/API. Salesforce mass/list email is governed by a separate applicable allocation. These numbers are **org-wide**, shared with existing Salesforce automations, and not guaranteed merely by having Nonprofit Cloud. Developer, trial and sandbox orgs can have lower allowances. Recipients rather than API calls are counted; duplicate recipients can consume capacity.

The read-only script at scripts/check-email-limits.mjs queries the production Salesforce REST Limits endpoint, using a short-lived OAuth token supplied through your approved operations terminal:

    export SF_INSTANCE_URL='https://YOUR_INSTANCE.my.salesforce.com'
    export SF_ACCESS_TOKEN='[short-lived token from approved org sign-in]'
    DIG_EMAIL_RESERVE=500 node scripts/check-email-limits.mjs
    unset SF_ACCESS_TOKEN

It displays actual SingleEmail and MassEmail maximums and remaining recipients. The default 500 is an **alert threshold**, not a Salesforce reservation, a send queue, or protection against other simultaneous jobs. Exit code 2 means unknown quota, insufficient remaining, or API failure. Never expose this script in WordPress, publish its credentials or paste the token into GitHub. Before larger batches, leave headroom for user verification links.

Authoritative references:
- https://developer.salesforce.com/docs/platform/api-rest/guide/resources-limits.html
- https://help.salesforce.com/s/articleView?id=000384947&type=1
- https://help.salesforce.com/s/articleView?id=sf.limitations_email_mass&type=5

## Sandbox validation and production gate

1. Reconcile the public dig-src overlay with DIG's existing Salesforce source. Deploy manifest/website-membership-v1.xml **to sandbox only first**; run DigMembershipEmailServiceTest, DigWebsiteMembershipServiceTest and ALL affected legacy Apex tests. Local Node/PHP CI does not validate Apex or real Salesforce delivery.
2. Check org deliverability, Salesforce integration-user CRUD/FLS and Apex access, approved Org-Wide Email Address, a staffed reply mailbox, SPF/DKIM/DMARC and bounce handling. Configure WebsiteMembershipBaseUrl__c as the HTTPS WordPress origin. Validate no portal URL is in the website confirmation/reminder.
3. Confirm actual SingleEmail and MassEmail limits from the production org before sending. Pilot internal test inboxes, malformed/expired/replayed links, unsuccessful email sends, duplicate Contacts, opt-outs, 30-day and 7-day notices and previously renewed terms. Examine Email Logs; do not record member email addresses in public issues.
4. Obtain board/staff approval for term rules, reminder timing and consent. Verify WEBSITE_FREE exclusions and legacy Membership_Term__c vs Membership__c history before scheduling.
5. After sandbox validation, have an authorized admin run a **small sandbox-only** pilot via Execute Anonymous:

        Database.executeBatch(new DigMembershipRenewalEmailBatch(), 25);

6. Only after explicit approval, an administrator may add ONE scheduled job in Execute Anonymous. Salesforce schedules in that user's timezone; verify the selected hour before use:

        System.schedule(
          'DIG Website-Free Renewal Reminders',
          '0 0 12 * * ?',
          new DigMembershipRenewalEmailScheduler()
        );

7. Review Setup > Scheduled Jobs, Apex Jobs, Email Logs and daily /limits data. No public route should be able to trigger this Batch Apex or send marketing announcements.

## Retry and rollback

The 30-day band is 8–30 days before expiry, and 7-day band is 0–7 days. Only successful Salesforce sendEmail API acceptances set the corresponding datetime marker on Membership__c. Failed sends remain eligible for the next approved run while within a band, but delivery-to-inbox is not guaranteed. When a sent-at marker update fails after Salesforce accepts mail, an automated retry could duplicate mail: inspect Email Logs and manually reconcile first. The current implementation does not use a durable exactly-once outbox.

To disable: abort the renewal job under Setup > Scheduled Jobs, then stop enrollment API traffic if necessary. Keep historical membership and email audit records. Do not silently delete data to conceal a failed send.

For a 2,000-member announcement, Salesforce List Email can be considered by staff after inspecting MassEmail.Remaining and Salesforce's recipient-per-action limits. The membership plugin **does not** provide mass send permissions or treat successful email verification as marketing consent.
