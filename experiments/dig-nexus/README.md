# DIG Nexus — Twenty + Neon integration spike

**Status:** experimental; synthetic data only. This does not deploy Twenty, create Neon resources, or migrate Salesforce.

## Architecture
WordPress portal → Cloudflare authentication gateway → Twenty CRM REST API → Neon PostgreSQL. Twenty also needs its own application and worker processes, Redis, and durable file storage.

## Run
1. Provision an isolated Twenty test instance, with its `PG_DATABASE_URL` pointed to a dedicated Neon development database. Adapt Twenty's Compose configuration: the stock deployment assumes a local `db` service.
2. Configure Redis and persistent storage, and confirm migrations complete.
3. Generate a restricted Twenty API token and set `TWENTY_URL` (HTTPS) and `TWENTY_API_KEY` locally.
4. Run `node smoke.mjs` (Node 20+). Default is **read-only**.
5. Only in a disposable workspace, set `DIG_ALLOW_SYNTHETIC_WRITE=YES` to create one fictional person using an `example.test` email.

This test does not establish compatibility of Twenty migrations with Neon, secure member login, or production readiness. Never expose the Twenty API key to WordPress browser JavaScript.
