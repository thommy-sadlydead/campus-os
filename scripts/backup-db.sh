#!/bin/sh
# Dumps the production database and encrypts the dump so that only the holder
# of the private key can read it. Run by .github/workflows/db-backup.yml every
# night; safe to run by hand against any database. Needs pg_dump, pg_restore,
# psql (at least the server's major version) and age.
#
#   BACKUP_DATABASE_URL  required: the DIRECT database URL (db.prisma.io), not
#                        the pooled one; a dump needs a session of its own.
#   RECIPIENT_FILE       the age public key(s), default scripts/backup-recipient.txt
#   OUT_DIR              where the encrypted file goes, default backup-out
#   STAMP                part of the file name, default the UTC time
#
# This runs in a PUBLIC repository's Actions, whose logs anyone can read, so it
# never prints a host, a count, a name or anything else from the database:
# only whether each step worked.
set -eu

: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL is not set}"
RECIPIENT_FILE=${RECIPIENT_FILE:-scripts/backup-recipient.txt}
OUT_DIR=${OUT_DIR:-backup-out}
STAMP=${STAMP:-$(date -u +%Y-%m-%dT%H-%M-%S)}

[ -s "$RECIPIENT_FILE" ] || { echo "No public key in $RECIPIENT_FILE: nothing to encrypt to." >&2; exit 1; }

mkdir -p "$OUT_DIR"
dump="$OUT_DIR/campus-os-$STAMP.dump"
encrypted="$dump.age"
# The plain dump never outlives this script, even when a step fails.
trap 'rm -f "$dump"' EXIT

echo "Dumping the database..."
pg_dump --format=custom --no-owner --no-acl --schema=public --file="$dump" "$BACKUP_DATABASE_URL"

# A backup of the wrong or an empty database is worse than none, because
# nobody finds out until the restore. So before encrypting: the dump has to
# list data for the tables every Campus OS database has, and the account
# table has to have at least one row.
contents=$(pg_restore --list "$dump")
for table in User Class Assignment Exam Session; do
  echo "$contents" | grep -q "TABLE DATA public $table " || { echo "The dump has no data for the $table table: wrong database, or a broken dump." >&2; exit 1; }
done
users=$(psql "$BACKUP_DATABASE_URL" -Atc 'select count(*) from "User"')
[ "${users:-0}" -gt 0 ] || { echo "The User table is empty: refusing to keep a backup of an empty database." >&2; exit 1; }

echo "Encrypting..."
age -R "$RECIPIENT_FILE" -o "$encrypted" "$dump"
[ -s "$encrypted" ] || { echo "The encrypted file is empty." >&2; exit 1; }

echo "Backup written: $(basename "$encrypted"), $(wc -c < "$encrypted" | tr -d ' ') bytes."
