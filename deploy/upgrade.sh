#!/bin/sh
# Deploy an image already published by CI, keeping the previous tag for rollback.
# This script NEVER enables disabled member/organizer/conference write gates.
set -eu

if [ "$#" -ne 1 ]; then
 echo "Usage: sh deploy/upgrade.sh ghcr.io/OWNER/dig-nexus:sha-FULL_COMMIT_SHA" >&2
 exit 2
fi
new_image="$1"
case "$new_image" in
 ghcr.io/*/dig-nexus:sha-*) ;;
 *) echo "Expected a commit-pinned dig-nexus GHCR image" >&2; exit 2 ;;
esac
# Require full 40-character SHA, rather than floating main/latest tags.
sha="${new_image##*:sha-}"
case "$sha" in *[!0-9a-f]*|'') echo "Invalid commit SHA" >&2;exit 2;; esac
if [ "${#sha}" -ne 40 ]; then echo "Use a complete 40-character SHA" >&2; exit 2;fi
cd "$(dirname "$0")/.."
if [ ! -f .env ]; then echo "Missing .env" >&2;exit 2;fi

# Preserve non-image settings. Atomic replacement keeps a rollbackable tag.
old_image="$(sed -n 's/^NEXUS_IMAGE=//p' .env | tail -n 1)"
if [ -z "$old_image" ]; then echo "Set NEXUS_IMAGE in .env first" >&2;exit 2;fi
if [ "$old_image" = "$new_image" ]; then echo "Already on requested image";exit 0;fi
echo "Pulling verified release tag from GitHub Container Registry..."
docker pull "$new_image"
# Fail closed unless the pulled OCI digest, source label and signed CI identity match.
node release/verify-image.mjs "$new_image"
tmp=".env.nexus-upgrade.$$"
umask 077
trap 'rm -f "$tmp"' EXIT HUP INT TERM
awk -v image="$new_image" '
  /^NEXUS_IMAGE=/ {$0="NEXUS_IMAGE=" image; seen=1}
  {print}
  END {if(!seen)print "NEXUS_IMAGE=" image}
' .env > "$tmp"
chmod 600 "$tmp"
mv "$tmp" .env

if docker compose up --no-build --no-deps --wait -d nexus; then
 echo "Nexus healthy on $new_image. Caddy remains running."
 exit 0
fi
echo "Health check failed. Restoring previous image." >&2
tmp=".env.nexus-rollback.$$"
awk -v image="$old_image" '/^NEXUS_IMAGE=/ {$0="NEXUS_IMAGE=" image} {print}' .env > "$tmp"
chmod 600 "$tmp"
mv "$tmp" .env
docker compose up --no-build --no-deps --wait -d nexus || {
 echo "Automatic rollback failed. Operator intervention is required." >&2
 exit 1
}
echo "Rolled back to $old_image" >&2
exit 1
