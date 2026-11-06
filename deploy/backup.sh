#!/usr/bin/env bash
# Nightly backup of the event log: SQLite's online backup into data/backups/, keeping the newest 14.
# It runs inside the app's container, which has the SQLite driver; the host needs only Docker.
# Cron line, as the user that owns ~/stacks/chaperone (see the README):
#   17 3 * * * ~/stacks/chaperone/backup.sh >> ~/stacks/chaperone/data/backups/backup.log 2>&1
set -euo pipefail

# compose.yml and .env are beside this script, wherever cron starts it from.
cd "$(dirname "$0")"

echo "$(date -u +%FT%TZ) backing up"
docker compose exec -T app node dist/cli.js backup --keep 14
