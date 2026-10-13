# DIG Nexus Newsletter

**Prototype only. No sending is enabled.** WordPress is the campaign editor, Neon is the system of record, Cloudflare Workers/Queues handle scheduling and retries, and a configurable transactional/bulk email provider delivers messages.

## Model
- `schema.sql` defines subscribers, drafts and per-recipient delivery state. Run it only against a **dedicated DIG database**, never a shared Neon project.
- Consent is explicit: `pending` is not subscribed; imports must not imply permission.
- Every outgoing message needs List-Unsubscribe and List-Unsubscribe-Post headers, a functional one-click unsubscribe endpoint, organization identification, and a text/plain alternative.
- Unsubscribes, hard bounces and complaints are durable suppressions; re-subscription requires fresh verification.
- Segment targeting and authorization must be enforced server-side; no browser-held database or provider credentials.
- Campaign sends require a preview, test email, explicit staff approval, idempotent queue jobs, throttling, webhook signature verification, and a kill switch.
- Never count open tracking pixels as engagement by default. Report deliveries, failures and opt-outs.
- Keep emails accessible: descriptive links, semantic HTML, captioned video links and readable text.

## Next integration steps
1. Choose an email delivery provider and confirm its nonprofit quota, bulk-mail policy, sender-domain verification, and bounce/complaint webhook capabilities.
2. Build WordPress admin screens behind `manage_options` or a narrower DIG capability.
3. Implement signed Cloudflare gateway endpoints and verified subscriber opt-in/unsubscribe.
4. Test against a disposable Neon database using only `example.test` addresses and a mocked provider.
5. Verify SPF/DKIM/DMARC, unsubscribe and suppression behavior before any real campaign.

The existing WordPress membership plugin is Salesforce-oriented and should not be treated as a deployed Neon integration.

## Clean-room list and campaign operations

DIG Nexus includes original listmonk-inspired functions, without importing listmonk source or deploying it. See [association operations](../nexus/ASSOCIATION-OPERATIONS.md) for the consented list model, staff-only campaign audience previews, approvals, queued deliveries, suppression triggers, and rollout limits.

These are staging-only functions; a queued campaign **never** bypasses the existing disabled MailerSend marketing gate.


### Safeguarded one-click and delivery claims

A new, separately disabled one-click endpoint and claim-only dispatch
primitive are documented in [DIG Nexus association operations](../nexus/ASSOCIATION-OPERATIONS.md).
The legacy `sendNewsletter` adapter now requires a verified provider plan
and an enabled HTTPS one-click URL, and inserts MailerSend's documented
`list_unsubscribe` parameter. No automatic newsletter worker is enabled.
