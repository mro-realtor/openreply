# Admin API and MCP server

Status: milestone 1, on branch `feature/api-mcp`. Both surfaces ship **off**.
Nothing here can send a message or activate a campaign.

## Turning it on

Set these on the **web** service only (not the worker), then redeploy:

| Variable | Value | Effect |
|---|---|---|
| `API_V1_ENABLED` | `true` | enables `/api/v1/*` |
| `MCP_ENABLED` | `true` | enables `/api/mcp` |
| `API_RATE_LIMIT_PER_MINUTE` | optional, default `120` | per token |

With both unset, every new endpoint returns 404 and the app behaves exactly as before.

## Database change

One additive migration, `20261014000000_add_api_access`:

- new tables `ApiToken`, `AuditLog`, `IdempotencyKey`
- new columns on `Automation`: `isDraft BOOLEAN DEFAULT false`, `draftConfig JSONB NULL`

Existing rows are untouched (every existing campaign gets `isDraft = false`).
The web container already runs `prisma migrate deploy` on start.
Rollback SQL: `prisma/migrations/20261014000000_add_api_access/rollback.sql`.

## Authentication and authorization

- Create tokens in **Settings > API and MCP access** (workspace owner only).
  The secret is shown once. Only its SHA-256 hash is stored.
- Format `orp_` + 43 URL-safe characters (256 bits). Sent as `Authorization: Bearer <token>`.
- Tokens expire (default 30 days, max 90) and can be revoked at any time.
- A token is bound to one workspace. Every query filters on that workspace.
- Failures before lookup return one generic 401, so a caller cannot tell a
  malformed token from an unknown one.
- Rate limit: fixed 60 second window per token, in Redis. If Redis is down the
  API **fails closed** (503).
- `lastUsedAt` is updated at most once a minute. This is the only write a read request makes.

### Scopes

| Scope | Issuable now | Grants |
|---|---|---|
| `read` | yes | accounts, campaigns, delivery logs |
| `drafts:write` | yes | create and edit inactive drafts |
| `campaigns:modify` | reserved | edit active campaigns |
| `leads:read` | reserved | contact and lead data |
| `send` | reserved | no tool exists |
| `activate` | reserved | no tool exists |

Reserved scopes cannot be put on a token until a tool that needs them exists and is reviewed.
Tokens default to `read` only.

### Draft safety

- API and MCP campaigns are always created with `isActive = false` and `isDraft = true`.
- Input schemas are strict. `isActive`, `isDraft`, `workspaceId` and `id` are rejected, not ignored.
- Every message-sending path (webhook, worker, reconciler) already requires
  `isActive = true`, so a draft cannot fire.
- Editing is allowed only while the campaign is an inactive draft. The condition is repeated
  inside the database write, so a person activating it in the dashboard wins any race.
- Turning a campaign on from the dashboard clears `isDraft`.
- A draft does not need a post or Reel. `activationChecklist` on each campaign lists what is still missing.

### What is deliberately not exposed

No delete, activate, pause, send, SQL, shell, environment, or token tools or endpoints.
Responses never include access tokens, share slugs, commenter IDs, commenter names or comment text.

### Audit log

Table `AuditLog` records token creation and revocation, every draft create or edit,
every MCP tool call (success, denied, error) and permission denials on REST.
Details are passed through secret redaction and capped at 4 KB.

## REST API

Base `https://<your-domain>/api/v1`. Responses are `{ "data": ..., "requestId": "..." }`.
Errors are `{ "error": { "code", "message", "details?" }, "requestId" }`.
Lists return `{ "items": [...], "nextCursor": "..." | null }`; pass `?cursor=` and `?limit=` (max 100).

| Method and path | Scope | Notes |
|---|---|---|
| `GET /health` | read | database and Redis check |
| `GET /accounts` | read | token health and webhook state, no credentials |
| `GET /accounts/{id}` | read | |
| `GET /campaigns` | read | filters `status=draft|active|paused`, `accountId` |
| `GET /campaigns/{id}` | read | adds delivery counts and activation checklist |
| `POST /campaigns` | drafts:write | `Idempotency-Key` header supported |
| `PATCH /campaigns/{id}` | drafts:write | drafts only, otherwise 409 `CAMPAIGN_NOT_DRAFT` |
| `GET /logs` | read | filters `campaignId`, `status`; no personal data |

Error codes: `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `VALIDATION_FAILED` 400,
`CAMPAIGN_NOT_DRAFT` 409, `IDEMPOTENCY_IN_PROGRESS` 409, `IDEMPOTENCY_KEY_REUSED` 422,
`RATE_LIMITED` 429 (with `Retry-After`), `SERVICE_UNAVAILABLE` 503.

Idempotency: repeat a POST with the same `Idempotency-Key` and body and you get the stored
response with `Idempotent-Replayed: true`. A different body with the same key is rejected.
Keys last 24 hours and are per token.

Known limits of this milestone: draft edits cover the primary tracked link only (no second
button link); `draftConfig` is replaced as a whole on update.

## MCP server

Endpoint `POST /api/mcp`, Streamable HTTP, stateless, JSON responses. Every request needs a
bearer token, including `tools/list`. GET and DELETE return 405.

Tools are listed only if the token holds the scope:

| Tool | Scope |
|---|---|
| `list_accounts`, `get_account` | read |
| `list_campaigns`, `get_campaign` | read |
| `list_campaign_logs` | read |
| `create_draft_campaign` | drafts:write |
| `update_draft_campaign` | drafts:write |

`draftConfig` holds settings no runtime feature reads yet, so they are stored but inert:
`conversationMode` (`direct_capture`, `ai_qualification`, `ai_assistance`, `human_only`),
`leadCapture` (`requiredFields`, `markReadyOnlyWhenComplete`), `assignee`, `notes`.

## Client compatibility

The server is standard MCP (official SDK, Streamable HTTP) with no client-specific code.
Verified status is only what CI has actually run. Last verified: 2026-10-14, GitHub Actions run 38513999576 on `feature/api-mcp`, against a disposable server and database started inside the job (never production).

| Client | Auth method | Verified |
|---|---|---|
| TypeScript MCP SDK (HTTP) | scoped token | Verified in CI (list tools, read, create draft, scope hiding, rejects missing token) |
| Python MCP SDK 1.13.1 (HTTP) | scoped token | Verified in CI (same checks) |
| MCP Inspector CLI 0.17.2 | scoped token | Verified in CI (tools/list only) |
| Raw JSON-RPC (curl) | scoped token | Verified in CI (401 without or with a bad token, 405 on GET, initialize, tools/list, read-only token sees no write tool) |
| Hermes Agent, OpenClaw, Gemini clients | scoped token or OAuth | documented by vendor, not yet run (see `agents.md`) |
| Meta Muse | none available | not supported directly (see `agents.md`) |
| Claude custom connector | scoped token header | not tested by us |
| ChatGPT | needs OAuth (milestone 1b) | not supported yet |

## Connecting clients

Instructions below follow the vendors' documentation as of 2026-10-14. They are not a verification.

### Claude (supported now with a bearer token)

Claude's custom connector dialog has a **Request headers** section for fixed credentials.

1. In OpenReply: Settings > API and MCP access > create a token named "Claude", scope `read`
   (add `drafts:write` only when you want it to create drafts). Copy it.
2. In Claude: Customize > Connectors > Add > Add custom connector.
3. URL `https://<your-domain>/api/mcp`. Authentication: no sign in.
4. Request headers: name `Authorization`, value `Bearer <your token>`.

Caveat: the connector must be reachable from Anthropic's servers over public HTTPS, and your
custom domain currently has no working certificate (see project notes). The
`easypanel.host` address works.
If your account's dialog has no Request headers field, use Claude Desktop with `mcp-remote`
(the same way the EasyPanel MCP is connected) and pass the header with `--header`.

### ChatGPT (not supported by this milestone)

OpenAI documents only OAuth 2.1 for authenticated MCP servers. It states ChatGPT cannot send
a custom API key, and static bearer tokens are not documented. An unauthenticated mode exists
but is for read-only anonymous data, which this server must never be.

To support ChatGPT, OpenReply needs an OAuth 2.1 authorization server:

- authorization code flow with PKCE `S256`
- client registration by Client ID Metadata Documents (preferred) or dynamic registration
- `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`
- `resource` parameter honored, tokens bound to the MCP URL as audience
- RFC 9207 `iss` on authorization responses
- allowlist ChatGPT's redirect URI `https://chatgpt.com/connector_platform_oauth_redirect`
- a consent screen tied to the existing owner login, issuing the same scoped tokens

This is a separate step (milestone 1b). It would also let Claude's connector use sign-in
instead of a pasted header.

## Testing done

CI (`.github/workflows/validate-api-mcp.yml`, run 38513999576, all steps passed) ran on disposable
Postgres 17 and Redis 7 service containers: Prisma generate and validate, full TypeScript check, lint,
187 unit tests (12 database tests skipped in that step), migrations applied to an empty database,
no schema drift against `schema.prisma`, 12 database integration tests, an upgrade-path test
(legacy data kept through the new migration, the rollback script, and re-apply), a production build,
and the four client checks above against a server started with the flags on.

Not covered: a real production database, Hermes Agent or OpenClaw instances, the Claude connector UI, ChatGPT
(needs OAuth), and the dashboard in a browser.
