#!/bin/sh
set -e

# Run pending Prisma migrations. We prefer "migrate deploy" because it only
# applies pending migrations and never alters the database schema beyond what
# the migration files describe. Fallback to "db push" for existing
# environments that were bootstrapped before the migrations folder existed.
if [ -d "/app/prisma/migrations" ]; then
  echo "Running prisma migrate deploy..."
  npx prisma migrate deploy
else
  echo "WARN: prisma/migrations not present. Falling back to prisma db push."
  npx prisma db push --skip-generate
fi

echo "Starting PCI Nexus backend..."
exec "$@"
