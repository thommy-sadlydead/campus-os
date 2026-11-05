#!/bin/sh
# Schema changes for `npm run build`: prisma/pre-push.sql, then `prisma db push`.
#
# They go over Prisma Postgres's direct host (db.prisma.io), because the
# pooled host the app uses at runtime (pooled.db.prisma.io, see
# src/lib/db-url.ts) pools by transaction, which schema changes can't run
# through. That's DIRECT_URL when it's set; otherwise DATABASE_URL, moved to
# the direct host if it names the pooled one (same user and password).
set -e
if [ -n "$DIRECT_URL" ]; then
  DATABASE_URL="$DIRECT_URL"
else
  DATABASE_URL=$(printf '%s' "$DATABASE_URL" | sed 's#@pooled\.db\.prisma\.io#@db.prisma.io#')
fi
export DATABASE_URL
prisma db execute --file prisma/pre-push.sql --schema prisma/schema.prisma
prisma db push --skip-generate
