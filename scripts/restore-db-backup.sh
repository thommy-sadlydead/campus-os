#!/bin/sh
# Restores an encrypted backup (made by scripts/backup-db.sh) into an EMPTY
# database. It never overwrites: it stops if the target already has tables,
# so the worst a wrong target URL can do is nothing. To recover production,
# restore into a NEW empty Prisma Postgres database, check it, then point
# DATABASE_URL at it (CLAUDE.md, "Backups").
#
#   sh scripts/restore-db-backup.sh BACKUP.dump.age PRIVATE_KEY_FILE TARGET_DATABASE_URL
#
# Needs pg_restore, psql and age. The private key file is the one saved when
# the backup was set up (see CLAUDE.md); without it a backup can't be read.
set -eu

[ "$#" -eq 3 ] || { echo "Usage: sh scripts/restore-db-backup.sh BACKUP.dump.age PRIVATE_KEY_FILE TARGET_DATABASE_URL" >&2; exit 2; }
backup=$1
key=$2
target=$3

[ -f "$backup" ] || { echo "No such backup file: $backup" >&2; exit 1; }
[ -f "$key" ] || { echo "No such key file: $key" >&2; exit 1; }

tables=$(psql "$target" -Atc "select count(*) from information_schema.tables where table_schema = 'public'")
if [ "$tables" != 0 ]; then
  echo "The target database already has $tables tables in its public schema. Restore into an empty database." >&2
  exit 1
fi

# The dump lists the public schema itself, which every new database already
# has, so that one entry is skipped; any other error stops the restore.
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

echo "Restoring into an empty database..."
age -d -i "$key" -o "$work/db.dump" "$backup"
pg_restore --list "$work/db.dump" | grep -v -E ' SCHEMA - public |COMMENT - SCHEMA public ' > "$work/toc"
pg_restore --use-list="$work/toc" --no-owner --no-acl --exit-on-error --dbname="$target" "$work/db.dump"
echo "Done. Tables restored: $(psql "$target" -Atc "select count(*) from information_schema.tables where table_schema = 'public'")."
