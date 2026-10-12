# Security policy

This is a development candidate, **not** a production-ready membership identity provider.

Do not post live access tokens, Salesforce org credentials, private Turnstile keys, member names/emails, or valid magic links in public issues or pull requests. Report suspected issues privately to DIG's website administrators through an established organizational channel. Maintainers should configure a private vulnerability reporting mechanism for this public GitHub repository before broad adoption.

Deployment requires least-privilege Salesforce integration credentials, rate limits/WAF for both membership endpoints, email sender verification, Cloudflare secret storage, appropriate WordPress privacy/cache settings, and staging tests for replay and duplicate Contacts. CORS is a browser boundary, **not** API authorization or an abuse-control substitute.

The WordPress `/magic` page must exclude third-party analytics/scripts, previews and caching. Never include authentication tokens in query strings, debug logs, analytics events, or support tickets.
