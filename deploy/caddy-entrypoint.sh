#!/bin/sh
set -eu
token="$(tr -d '\r\n' < /run/secrets/proxy_token)"
case "$token" in
  *[!a-f0-9]*|'') echo 'Invalid proxy token' >&2; exit 1 ;;
esac
if [ "${#token}" -ne 64 ]; then echo 'Proxy token must be 64 hex characters' >&2; exit 1; fi
export NEXUS_PROXY_TOKEN="$token"
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
