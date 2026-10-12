# Membership experience demo (no Salesforce required)

This repository includes [demo/offline.html](../../demo/offline.html), a **self-contained, interactive HTML prototype** covering enrollment, simulated verification, member dashboard, profile editor, accessibility and communications preferences, sample renewal, email previews and an illustrative staff overview.

The demo deliberately has **no API calls, Salesforce credentials, network requests, WordPress identity, persistent storage, emails, real member records, or actual admin permissions**. It is not a replacement for DIG's production enrollment integration. It must **never** be mistaken for an authenticated portal. Member details and counts shown in the demo are invented. The initial sample total of 2,000 is only a round-number illustration; the active/pending/lapsed breakdown is fictional.

## Run and test offline

1. Download `demo/offline.html` from the repository and open it locally in a modern browser. You can also use a local static file server, but none is required: the HTML includes all CSS and JavaScript.
2. Use the prefilled `alex@example.test` sample identity (or another fictional identity). Click **Generate simulated email link**.
3. In the simulated inbox, select **Use demo verification link** to activate the example member, or **Simulate expired link** to test the failure state.
4. Explore all six sections, save sample profile/preferences, simulate a renewal, inspect read-only emails, and reset the demo. Reloading removes everything.

Run the offline tests with:

```bash
node --test demo/offline.test.cjs
```

GitHub Actions also runs this test on pushes and PRs. The tests exercise the form transition, mock expiry, profile/preferences updates, sample renewal, reset, and check the absence of network/storage APIs. They **do not** replace browser-based screen-reader/keyboard/accessibility testing.

## Planned integration mapping

| User experience | Salesforce integration to build or verify | Production requirements |
| --- | --- | --- |
| Join and email verification | Existing WordPress shortcodes, Cloudflare gateway, MagicLinkService, Membership__c activation | Email verification, one-time tokens, Turnstile, duplicates, Salesforce sandbox contract |
| Dashboard | Read-only status and active term via authenticated API | Real authentication and server-side per-member authorization; no public status lookup |
| Profile | Contact fields | Verified account identity, field-level security, consent, email change re-verification |
| Preferences | Dedicated consent records or confirmed existing communication-preference schema | Default opt-out, audit trail, unsubscribe, retention and privacy approval |
| Renewal | Membership__c eligibility and approved term rules | Resolve policy and Membership_Term__c history; idempotent update, no false dues |
| Emails | Existing Salesforce native transactional emails and staff-controlled list email | Live /limits check, sender validation, bounce suppression; no public blast endpoint |
| Staff preview | Authorized aggregate Salesforce reports | Explicit admin roles and audit logs; no real staff data or actions in the mock |

The prototype is independent of the WordPress plugin and exists for usability/design review. Bringing a dashboard or staff component into WordPress will require actual **server-side** permission checks, protected data endpoints, an audited identity/session design and fresh tests. The static prototype's sample staff tab is **not** a security boundary, and its demonstration verification is not authentication.

## Accessibility review checklist

Keyboard tab order and visible focus indicators, labels, status announcements, no audio-only feedback, reduced-motion-safe styling, responsive layout and clear errors are all intended. Before shipping to users, test keyboard-only enrollment/verification, TalkBack/VoiceOver/NVDA, 200%/400% zoom, WCAG contrast, focus on tab changes, ASL/video content, captions, and communication preference clarity with Deaf community reviewers.

## Remaining dependencies

Actual Salesforce schema review, identity and consent policy decisions, real member record integration, staff permissions, Salesforce mail limits, delivery, WordPress staging and security review all remain outstanding. The demo may be shared for feedback, **not deployed as DIG's real membership service**.
