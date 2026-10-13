# Newsletter implementation and release gates

**Updated October 13, 2026. No marketing email has been enabled or sent as part of DIG Nexus development.** The selected runtime is Docker + Caddy + Neon, not Cloudflare Workers or Queues.

## Already implemented (development only)

- Original subscribers, lists, campaigns, per-recipient delivery states, campaign staff preview and approval.
- Membership, organizational affiliation, event attendance and list assignment **never imply consent**. Only actively subscribed records with recorded consent may enter a campaign queue.
- A private `/newsletter/unsubscribe/:token` endpoint: GET displays a confirmation form **without** unsubscribing; POST consumes a SHA-256-hashed opaque token atomically. An RFC 8058-style form POST is supported. Queued deliveries are suppressed on opt-out.
- A one-recipient PostgreSQL claim with `SKIP LOCKED`, a second preflight check of current subscriber consent and campaign approval, and a separate provider API acknowledgement step.
- The adapter includes plain-text and HTML unsubscribe links and MailerSend's `list_unsubscribe` API parameter, but refuses to send without verified one-click support and all required flags.
- Unknown/timeout provider outcomes remain in a manual-reconciliation state: **no automatic retry** can duplicate an email of uncertain acceptance.

## Still required before a single real send

1. Verify the DIG MailerSend account's supported plan, sender/domain configuration, actual one-click behavior and SPF/DKIM/DMARC.
2. Validate the provider's current authenticated webhook events for bounces and complaints and reconcile them to durable subscriber suppression.
3. Demonstrate an end-to-end test with an explicitly approved test address and real provider receipts. An API `sent` state means accepted by the provider, **not** delivered to the inbox.
4. Provision the least-privileged Neon role, bounded worker orchestration, monitoring and manual resolution of uncertain results; no automatic bulk marketing worker exists.
5. DIG policy approval for consent records, retention, accessible text/HTML templates, subscriber export/deletion, unsubscribe UX and marketing compliance.

The default Compose configuration keeps `NEWSLETTER_UNSUBSCRIBE_ENABLED=false`. Dispatch additionally requires `DIG_NEWSLETTER_SEND_ENABLED`, `DIG_NEWSLETTER_MARKETING_READY`, `DIG_NEWSLETTER_ONE_CLICK_VERIFIED`, `NEWSLETTER_UNSUBSCRIBE_ENABLED`, and `DIG_NEWSLETTER_DISPATCH_ENABLED` to all be explicitly `true`. Tests use synthetic identities and mocked provider responses.

## Validation and references

```bash
node --test newsletter/*.test.mjs nexus/api/newsletter-unsubscribe.test.mjs
node --test demo/offline.test.cjs
```

Run ordered Nexus 001–013 and newsletter 001–004 on **disposable** PostgreSQL 17, then `nexus/tests/constituent-operations-integration.sql` and `nexus/tests/newsletter-dispatch-integration.sql`. Read [association and communications operations](../nexus/ASSOCIATION-OPERATIONS.md) and [Docker runbook](../nexus/DOCKER.md). No production data or server credentials should be used for these proofs.
