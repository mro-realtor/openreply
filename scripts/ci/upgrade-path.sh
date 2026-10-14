#!/usr/bin/env bash
# Upgrade-path test on a disposable Postgres: old schema + legacy data -> new migration
# -> data intact -> rollback -> data intact -> re-apply. Never run against a real database.
set -euo pipefail
: "${PGHOST:=localhost}" "${PGUSER:=postgres}" "${PGPASSWORD:=postgres}"
export PGHOST PGUSER PGPASSWORD
DB=openreply_upgrade
NEW=prisma/migrations/20261014000000_add_api_access
psql -v ON_ERROR_STOP=1 -q -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
run() { psql -v ON_ERROR_STOP=1 -q -d "$DB" "$@"; }

for dir in $(ls -d prisma/migrations/*/ | sort); do
  [ "${dir%/}" = "$NEW" ] && continue
  run -f "${dir}migration.sql"
done
echo "old schema applied"

run -c "INSERT INTO \"User\"(id,\"updatedAt\") VALUES('u1',now());
INSERT INTO \"Workspace\"(id,name,\"ownerId\",\"updatedAt\") VALUES('w1','w','u1',now());
INSERT INTO \"InstagramAccount\"(id,\"workspaceId\",\"instagramId\",username,\"accessToken\",\"updatedAt\") VALUES('a1','w1','1','x','enc',now());
INSERT INTO \"Automation\"(id,\"workspaceId\",\"instagramAccountId\",name,\"dmMessage\",\"updatedAt\") VALUES('au1','w1','a1','legacy','hi',now());"

run -f "$NEW/migration.sql"
test "$(run -t -A -c "SELECT concat_ws(',', \"isActive\"::text, \"isDraft\"::text) FROM \"Automation\" WHERE id='au1'")" = "true,false"
echo "upgrade ok: legacy campaign unchanged (active, not a draft)"

run -f "$NEW/rollback.sql"
test "$(run -t -A -c "SELECT name FROM \"Automation\" WHERE id='au1'")" = "legacy"
test "$(run -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_name IN ('ApiToken','AuditLog','IdempotencyKey')")" = "0"
echo "rollback ok: legacy data intact, new tables gone"

run -f "$NEW/migration.sql"
echo "re-apply ok"
