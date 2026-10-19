#!/bin/sh
# Dump the database to deploy/backups/ (gzipped SQL), keeping 30 days.
#   deploy/backup.sh               a dump now
#   crontab:  15 3 * * * /opt/coned-battery-wizard/deploy/backup.sh >> /var/log/wizard-backup.log 2>&1
# Restore into an empty database:
#   gunzip -c deploy/backups/<file>.sql.gz | docker compose exec -T db psql -U wizard -d wizard
set -eu
cd "$(dirname "$0")"
mkdir -p backups
f="backups/wizard-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
docker compose exec -T db pg_dump -U wizard -d wizard | gzip > "$f"
find backups -name 'wizard-*.sql.gz' -mtime +30 -delete
echo "$(date -u +%FT%TZ) $f $(wc -c < "$f") bytes"
