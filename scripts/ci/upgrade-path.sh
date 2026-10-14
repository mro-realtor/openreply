#!/usr/bin/env bash
# Upgrade-path test on a disposable Postgres: old schema + legacy data -> new migrations
# -> data intact -> rollback (reverse order) -> data intact -> re-apply. Never run against a real database.
set -euo pipefail
: "${PGHOST:=localhost}" "${PGUSER:=postgres}" "${PGPASSWORD:=postgres}"
export PGHOST PGUSER PGPASSWORD
DB=openreply_upgrade
CUTOFF=20261014   # migrations from this prefix on are the ones under test
psql -v ON_ERROR_STOP=1 -q -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
run() { psql -v ON_ERROR_STOP=1 -q -d "$DB" "$@"; }

OLD=(); NEW=()
for dir in $(ls -d prisma/migrations/*/ | sort); do
  dir="${dir%/}"; name="${dir##*/}"
  if [[ "$name" < "$CUTOFF" ]]; then OLD+=("$dir"); else NEW+=("$dir"); fi
done
for dir in "${OLD[@]}"; do run -f "$dir/migration.sql"; done
echo "old schema applied (${#OLD[@]} migrations); testing ${#NEW[@]} new"

run -c "INSERT INTO \"User\"(id,\"updatedAt\") VALUES('u1',now());
INSERT INTO \"Workspace\"(id,name,\"ownerId\",\"updatedAt\") VALUES('w1','w','u1',now());
INSERT INTO \"InstagramAccount\"(id,\"workspaceId\",\"instagramId\",username,\"accessToken\",\"updatedAt\") VALUES('a1','w1','1','x','enc',now());
INSERT INTO \"Automation\"(id,\"workspaceId\",\"instagramAccountId\",name,\"dmMessage\",\"updatedAt\") VALUES('au1','w1','a1','legacy','hi',now());"

apply_all() { for dir in "${NEW[@]}"; do run -f "$dir/migration.sql"; done; }
count_tables() { run -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ($1)"; }
NEW_TABLES="'ApiToken','AuditLog','IdempotencyKey','OAuthClient','OAuthAuthorizationRequest','OAuthGrant','OAuthAuthorizationCode','OAuthRefreshToken','Contact','SocialIdentity','WebhookEndpoint','OutboxEvent','WebhookDelivery','ContactConsentEvent'"

apply_all
test "$(run -t -A -c "SELECT concat_ws(',', \"isActive\"::text, \"isDraft\"::text) FROM \"Automation\" WHERE id='au1'")" = "true,false"
test "$(count_tables "$NEW_TABLES")" = "14"
test "$(run -t -A -c "SELECT \"connectionStatus\"::text FROM \"InstagramAccount\" WHERE id='a1'")" = "ACTIVE"
echo "upgrade ok: legacy campaign unchanged (active, not a draft), 14 new tables"

for (( i=${#NEW[@]}-1; i>=0; i-- )); do run -f "${NEW[$i]}/rollback.sql"; done
test "$(run -t -A -c "SELECT name FROM \"Automation\" WHERE id='au1'")" = "legacy"
test "$(count_tables "$NEW_TABLES")" = "0"
test "$(run -t -A -c "SELECT count(*) FROM information_schema.columns WHERE table_name='InstagramAccount' AND column_name='connectionStatus'")" = "0"
test "$(run -t -A -c "SELECT username FROM \"InstagramAccount\" WHERE id='a1'")" = "x"
echo "rollback ok: legacy data intact, new tables gone"

apply_all
echo "re-apply ok"
