#!/usr/bin/env bash
# Apply Drizzle migrations to the remote Neon database.
#
# Reads the Neon connection string from DATABASE_SERVICE in .env, derives the
# DIRECT (unpooled) endpoint — DDL must not go through the Neon pooler
# (DEPLOY.md step 6 / drizzle.config.ts) — by stripping the "-pooler" segment,
# then runs the existing `db:migrate:remote` script against it.
#
# Usage:
#   npm run db:migrate:neon          # interactive (asks for confirmation)
#   bash scripts/migrate-remote.sh -y  # skip the confirmation prompt
set -euo pipefail

ENV_FILE=".env"

ASSUME_YES=0
case "${1:-}" in
  -y|--yes) ASSUME_YES=1 ;;
  "") ;;
  *) echo "Unknown argument: $1 (use -y/--yes)" >&2; exit 1 ;;
esac

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found — run this from the project root." >&2
  exit 1
fi

# Pull DATABASE_SERVICE out of .env. The value contains '=' (e.g. channel_binding=require),
# so keep everything after the first '='. Strip optional surrounding quotes.
raw="$(grep -E '^DATABASE_SERVICE=' "$ENV_FILE" | head -n1 | cut -d= -f2-)"
raw="${raw%\"}"; raw="${raw#\"}"
raw="${raw%\'}"; raw="${raw#\'}"

if [ -z "$raw" ]; then
  echo "Error: DATABASE_SERVICE is not set in $ENV_FILE." >&2
  exit 1
fi

# Derive the direct (unpooled) endpoint by removing the "-pooler" segment.
# If it's already unpooled, this is a no-op.
direct="${raw/-pooler/}"

# Show the target (host + db only — never print the credentials).
hostport="${direct#*@}"; host="${hostport%%/*}"
dbpart="${direct##*/}"; db="${dbpart%%\?*}"
echo "Target Neon (direct/unpooled): host=$host db=$db"

if [ "$raw" = "$direct" ]; then
  echo "Note: no '-pooler' found in DATABASE_SERVICE — using the string as-is."
fi

if [ "$ASSUME_YES" -ne 1 ]; then
  printf "Apply pending migrations to this database? [y/N] "
  read -r reply
  case "$reply" in
    y|Y|yes|YES) ;;
    *) echo "Aborted."; exit 0 ;;
  esac
fi

DATABASE_URL="$direct" npm run db:migrate:remote
