#!/usr/bin/env bash
#
# KI-1 — fail loudly if the live database schema has drifted from the recorded Prisma migration
# history (e.g. a hand-written ALTER was applied without a migration, or a migration is pending).
# `prisma migrate status` is the source of truth: exit 0 = "Database schema is up to date!",
# non-zero = pending migrations or drift.
#
#   tools/check-migration-drift.sh            # check the DB in $DATABASE_URL (or ./.env)
#
# Run it on each instance (gov / main / funding). Intended to be wired into deploy-guard.sh as a
# pre-deploy gate so a drifted schema stops the deploy instead of surfacing as a runtime error.
set -uo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
cd "$here"

# Load DATABASE_URL from .env when not already in the environment (same pattern as the cjs tools).
if [[ -z "${DATABASE_URL:-}" && -f .env ]]; then
  export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')"
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "✗ DATABASE_URL is not set (and no ./.env found) — cannot check migration drift." >&2
  exit 2
fi

echo "— prisma migrate status —"
if pnpm --filter @drep-dao/db exec prisma migrate status; then
  echo "✓ Schema matches the recorded migration history."
  exit 0
else
  echo "✗ Migration drift or pending migrations detected (see above)." >&2
  echo "  Reconcile with 'prisma migrate resolve --applied <name>' (schema already has it) or apply" >&2
  echo "  pending migrations with 'prisma migrate deploy'. Never hand-write ALTERs." >&2
  exit 1
fi
