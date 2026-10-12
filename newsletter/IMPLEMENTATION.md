# MailerSend rollout checklist

Current status: adapter and token primitives committed; **not deployed**.

## Sending safety
- The current adapter does **not** set List-Unsubscribe or List-Unsubscribe-Post headers. It must not be enabled for newsletters until MailerSend's actual custom-header behavior has been validated and those headers are emitted.
- Add a Cloudflare Worker endpoint to redeem opaque tokens atomically in Neon. Do not use GET requests to unsubscribe: automated link scanners can visit them. Use POST for one-click unsubscribe, and a confirmation form for human GET visits.
- Keep marketing gates disabled in every environment until delivery, consent, suppression, and unsubscribe tests pass.
- MailerSend events must be authenticated using its documented webhook signature scheme; never trust unsigned bounce/complaint payloads.
- Idempotent delivery records must be claimed transactionally before calling the provider. Retry 429/5xx with backoff; never blindly retry uncertain accepted sends.
- Treat a provider 202 response as accepted, not delivered.
- Set verified SPF, DKIM, DMARC and sending domain before sending.

## Local tests
`node --test newsletter/*.test.mjs` (Node 20+). Tests mock MailerSend and do not send email.

## Required infrastructure
Dedicated DIG Neon database, Cloudflare Worker + Queues, WordPress editor and permission checks, verified MailerSend domain, secure Worker secrets. None are provisioned by this commit.
