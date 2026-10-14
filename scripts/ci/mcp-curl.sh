#!/usr/bin/env bash
# Independent client #3: raw JSON-RPC over HTTP, no MCP library at all. Also checks the negative cases.
set -euo pipefail
H=(-H "Content-Type: application/json" -H "Accept: application/json, text/event-stream")
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

test "$(code -X POST "$MCP_URL" "${H[@]}" -d '{}')" = "401" && echo "no token -> 401"
test "$(code -X POST "$MCP_URL" "${H[@]}" -H "Authorization: Bearer orp_nottherealtokennottherealtokennottherealtok" -d '{}')" = "401" && echo "bad token -> 401"
test "$(code -X GET "$MCP_URL" -H "Authorization: Bearer $READ_TOKEN")" = "405" && echo "GET -> 405"

AUTH=(-H "Authorization: Bearer $READ_TOKEN")
INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
curl -sf -X POST "$MCP_URL" "${H[@]}" "${AUTH[@]}" -d "$INIT" | grep -q '"result"' && echo "initialize ok"
LIST=$(curl -sf -X POST "$MCP_URL" "${H[@]}" "${AUTH[@]}" -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
echo "$LIST" | grep -q '"list_campaigns"' && echo "tools/list ok"
if echo "$LIST" | grep -q 'create_draft_campaign'; then echo "read token can see a write tool"; exit 1; fi
echo "read-only token sees no write tool"
