#!/bin/sh
set -e

log() {
  echo "[entrypoint] $*"
}

if [ -d "/app/prisma/migrations" ]; then
  # Try the normal path first: applies any pending migrations against a fresh
  # or already-managed database.
  set +e
  npx prisma migrate deploy >/tmp/prisma-migrate-deploy.log 2>&1
  STATUS=$?
  set -e
  cat /tmp/prisma-migrate-deploy.log

  if [ "$STATUS" -ne 0 ]; then
    # Prisma error P3005: the database is not empty but has no migration
    # history. This happens on environments that were bootstrapped via
    # `prisma db push` before the migrations folder existed. Baseline all
    # shipped migrations as already applied, then retry `migrate deploy`.
    if grep -q "P3005" /tmp/prisma-migrate-deploy.log; then
      log "Existing database detected without Prisma migration history (P3005). Baselining shipped migrations..."
      for migration_dir in /app/prisma/migrations/*/; do
        migration_name=$(basename "$migration_dir")
        if [ -f "$migration_dir/migration.sql" ]; then
          log "Resolving $migration_name as applied..."
          npx prisma migrate resolve --applied "$migration_name"
        fi
      done
      log "Retrying prisma migrate deploy..."
      npx prisma migrate deploy

      # A database that pre-dates the migrations folder may also be missing
      # additive columns/tables that the baseline migration describes (because
      # the live DB was created with an older schema via `db push`). Run a
      # one-shot `db push --skip-generate` to apply any additive drift. This
      # never deletes data on its own; destructive changes would require
      # --accept-data-loss, which we deliberately do NOT pass.
      log "Applying any additive schema drift with prisma db push..."
      npx prisma db push --skip-generate
    else
      log "prisma migrate deploy failed. Aborting startup."
      exit 1
    fi
  fi
else
  log "WARN: prisma/migrations not present. Falling back to prisma db push."
  npx prisma db push --skip-generate
fi

log "Starting PCI Nexus backend..."
exec "$@"
