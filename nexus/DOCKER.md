# Self-hosted DIG Nexus: Docker Compose + Caddy + Neon

**Selected hosting model:** one Docker Compose project with a Caddy HTTPS reverse proxy and a non-root Node 22 DIG Nexus container. Neon PostgreSQL remains external and authoritative; no local PostgreSQL or Google Cloud runtime is required.

This is **staging-ready software**, not an authorized public membership launch. Enrollment, bearer registration, organizer writes and attendee conference registrations are hard-disabled in `compose.yaml`. Never enable them based solely on successful container health checks.

## How the stack works

```text
Browser
   |
  HTTPS 443, Caddy (automatic certificates and canonical Host)
   |          (forwards source socket IP and proxy authentication token)
   v
DIG Nexus API (private Docker network, port 8080 is never published)
   |         Google OAuth / member portal / conferences / newsletter foundation
   v
Neon PostgreSQL (remote, restricted database role)
   |         member/event records + hashed sessions + bounded rate limits
```

No Cloudflare Worker, Durable Object, Cloud Run, Google Cloud project, or external Redis instance is needed. Compose overrides the portable image entry point with the authenticated-Caddy server, so a future container hosting change does not require reimplementing the application. This does **not** remove Google *sign-in* from the member identity flow.

## First local smoke test (Butcher or another Docker host)

Requirements: Docker Engine and the Docker Compose plugin. Clone DIG Nexus or pull the latest changes into an existing checkout.

```bash
cp .env.example .env
mkdir -p deploy/secrets deploy/state/caddy-data deploy/state/caddy-config
chmod 700 deploy/secrets deploy/state deploy/state/caddy-data deploy/state/caddy-config
umask 077

# Enter LOCAL-ONLY settings in .env. They must match the bound host/port.
# NEXUS_SITE_ADDRESS=http://localhost:18080
# NEXUS_PUBLIC_ORIGIN=https://localhost:18080
# NEXUS_HTTP_BIND=127.0.0.1:18080:18080
# NEXUS_HTTPS_BIND=127.0.0.1:18443:443
# NEXUS_HTTPS_UDP_BIND=127.0.0.1:18443:443/udp
# NEXUS_UID=<non-root result of id -u>
# NEXUS_GID=<result of id -g>
# NEXUS_IMAGE=dig-nexus:local

# Empty placeholder credentials are accepted only for disabled-auth smoke checks.
: > deploy/secrets/database_url
: > deploy/secrets/google_client_secret
: > deploy/secrets/google_session_secret
openssl rand -hex 32 > deploy/secrets/proxy_token
chmod 600 deploy/secrets/*

docker compose config --quiet
docker compose up --build --wait -d
curl http://localhost:18080/api/health
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:18080/portal

# Cleanup of the local test stack, with persisted Caddy state retained:
docker compose down
```

The local smoke test uses **HTTP** and a simulated HTTPS canonical URL. Secure Google cookies are not expected to work in that mode; it does not test real Google OAuth. The API and portal should return HTTP 200, while all write endpoints continue to fail closed.

### Private files and non-root permissions

- Keep `deploy/secrets/` and `deploy/state/` **out of Git**. These paths are ignored. `deploy/state/` contains Caddy certificates/configuration and must be backed up on the host.
- Docker Compose file secrets preserve underlying host filesystem ownership/permissions. Each container is run with the explicitly selected non-root numeric UID/GID in `.env`; those IDs **must own** the local files and state directories. If provisioning under a different account, set ownership before starting the stack. Do **not** use root UID 0.
- Keep the secret directory mode 0700 and individual files mode 0600. No secret contents should appear in the Docker image, Compose YAML, GitHub workflow, logs, or WordPress.
- A 64-character random token is shared privately by **Caddy and Nexus**. Caddy overwrites any user-provided proxy headers with a verified source-socket IP and the secret token; the Nexus HTTP adapter rejects requests without a matching token. The application port is private to the Compose network.
- Only Caddy publishes ports; for a public deployment, permit TCP 80/443 (and optionally UDP 443) in the firewall. Docker-published ports can bypass some host firewall expectations, so validate exposure from a different machine.

## Prepare private HTTPS staging

Set in `.env`:

```dotenv
NEXUS_SITE_ADDRESS=nexus-staging.example.org
NEXUS_PUBLIC_ORIGIN=https://nexus-staging.example.org
GOOGLE_CLIENT_ID=YOUR_GOOGLE_OAUTH_WEB_CLIENT_ID
GOOGLE_REDIRECT_URI=https://nexus-staging.example.org/auth/google/callback
NEXUS_HTTP_BIND=80:80
NEXUS_HTTPS_BIND=443:443
NEXUS_HTTPS_UDP_BIND=443:443/udp
NEXUS_UID=1000
NEXUS_GID=1000
NEXUS_IMAGE=dig-nexus:local
```

The UID/GID above are **examples**; use the actual non-root owner of the secret files and Caddy state directories. Point DNS to your VPS and ensure certificate challenges can reach it. Avoid making a test service publicly discoverable until access controls and server patching are understood.

Replace the empty secret files with:

- `deploy/secrets/database_url`: a dedicated, least-privileged **isolated Neon branch** PostgreSQL URL. Apply schemas 001–008 in the documented order; `nexus/schema-008-cloud-run-state.sql` is also used by Docker. Real member records must not be copied into staging.
- `deploy/secrets/google_client_secret`: the client secret for the approved Google OAuth web client.
- `deploy/secrets/google_session_secret`: a cryptographically random session-encryption secret, e.g. `openssl rand -base64 48`. Changing it invalidates browser sessions.
- `deploy/secrets/proxy_token`: `openssl rand -hex 32`. Changing it requires **both containers** to be recreated together.

Run `docker compose up --build --wait -d` and validate the HTTPS portal. The static `PUBLIC_ORIGIN` must exactly match the browser origin and registered Google callback. The user-facing WordPress site should link to the Caddy HTTPS hostname, not a direct container port.

## Routine updates: no Dockerfile edits required

CI tests Docker Compose on localhost with synthetic secrets. After merging into GitHub `main`, it automatically builds and publishes an image at:

```text
ghcr.io/mcc0nnell/dig-nexus:sha-FULL_COMMIT_SHA
```

The server does **not** automatically deploy that image. Deployment requires an operator-controlled host and explicit release selection.

For a server that already has `compose.yaml` and private `.env`, and is authenticated to GHCR if the image is private:

```bash
sh deploy/upgrade.sh ghcr.io/mcc0nnell/dig-nexus:sha-FULL_COMMIT_SHA
```

This script pulls the new image, changes only `NEXUS_IMAGE` in `.env`, recreates the Nexus container, waits for its health check, and **restores the previous image** if startup fails. It does not change Caddy, DNS, secrets, database migrations, or feature flags. Expect a short reconnection window: this is a single-VPS deployment, not a zero-downtime rolling cluster.

When `compose.yaml`, Caddy configuration, or the Dockerfile itself changes, review those infrastructure changes and run `docker compose up --build --wait -d` only when approved. A local source-build workflow also works without GHCR:

```bash
git pull --ff-only
docker compose up --build --wait -d
```

This source-build path does not use the image-pinning/rollback script. Build a previous Git revision to roll back application code, and never assume code rollback reverses database migrations.

## Release gates still outstanding

- Approved DIG policies, actual Google browser tests, and accessibility review with Deaf/ASL users.
- Restricted Neon database grants and a verified schema/rollback plan.
- Trusted public-client rate limiting, abuse protection, and load testing at your actual proxy/CDN topology (Caddy currently trusts the immediate socket IP only).
- Expiry cleanup for Neon runtime tokens/counters through a scheduled, least-privileged job.
- HTTPS certificates and renewal, host OS patching, secrets rotation, monitoring, backup/restore, incident response and a monthly cost budget.

**No real member onboarding, ticket payments, elections, or newsletter sending should be activated until those gates pass.**
