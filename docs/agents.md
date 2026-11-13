# AI agents and clients

OpenReply is managed through two standard interfaces: the versioned REST API (`/api/v1`) and one
standard MCP server (`/api/mcp`). Any agent or model that speaks either can manage it.
No client-specific code exists. See [architecture-principles.md](architecture-principles.md).

## Status legend
- **Verified**: a test actually ran against a running OpenReply and passed (date and run noted).
- **Documented**: the vendor's documentation says it should work. We have not run it.
- **Planned**: not built yet.
- **Not supported**: the vendor does not offer the needed capability today.

## Compatibility (sources checked 2026-10-14)

| Agent or client | How it would connect | Status |
|---|---|---|
| TypeScript MCP SDK | Streamable HTTP + scoped token | Verified 2026-10-14 in CI (see `api-mcp.md`) |
| Python MCP SDK | Streamable HTTP + scoped token | Verified 2026-10-14 in CI |
| MCP Inspector CLI | Streamable HTTP + scoped token | Verified 2026-10-14 in CI (tools/list) |
| Raw JSON-RPC (curl) | Streamable HTTP + scoped token | Verified 2026-10-14 in CI |
| Claude custom connector | request header with scoped token | Documented |
| Hermes Agent (Nous Research) | `mcp_servers` url + `headers: Authorization: Bearer`, or `auth: oauth` | Documented. Early real-agent test target |
| OpenClaw | `mcp.servers` with `transport: streamable-http`, OAuth via `openclaw mcp login`; static header syntax unconfirmed | Documented (partly) |
| ChatGPT | OAuth 2.1 only (no static keys) | Planned: milestone 1b |
| Google Gemini and other MCP clients | same two interfaces | Planned, untested |
| Meta Muse | see below | Not supported directly today |

Note: the Python SDK test exercises the same client library Hermes uses for OAuth, but it is not Hermes.
Hermes and OpenClaw are marked Documented until a real instance is pointed at a deployed OpenReply and the run is recorded here.

### Hermes Agent
Per Hermes documentation: remote servers go in `~/.hermes/config.yaml` under `mcp_servers`; Streamable HTTP is the default;
static headers and OAuth 2.1 (authorization code with PKCE, client metadata document or dynamic registration) are supported;
`tools.include` / `tools.exclude` can limit which tools the agent sees; tools appear as `mcp_<server>_<tool>`.

```yaml
mcp_servers:
  openreply:
    url: "https://<your-domain>/api/mcp"
    headers:
      Authorization: "Bearer <token from Settings>"
    tools:
      include: [list_accounts, get_account, list_campaigns, get_campaign, list_campaign_logs]
```
Tool filtering on the client is a convenience, not security. The token's scopes on the server are the real limit.

### OpenClaw
Per OpenClaw documentation: `mcp.servers.<name>` with `url` and `transport: "streamable-http"`, optional `toolFilter`,
and `openclaw mcp login <name>` for OAuth. Verify with `openclaw mcp doctor <name> --probe`.

### Meta Muse
Meta's official Connectors page describes a developer preview: selected developers apply and are admitted in waves,
connectors use OAuth account linking, and MCP is named as an early-access onboarding tool. It does not document a way for a
Muse user to add their own remote MCP server, and connectors from the preview are not yet public. We rely on no other method.
Plan: (1) keep the REST API and OAuth server (milestone 1b) as the integration surface, (2) apply to the preview if wanted,
(3) build a thin Muse adapter only if Meta publishes a supported path. Third-party articles claiming otherwise are not treated as evidence.

## Per-agent permissions
Every agent gets its own credential with its own scopes. Examples:
- Research agent: `read` only.
- Campaign agent: `read` + `drafts:write`.
- Neither receives `activate` or `send`. Those scopes are reserved, cannot be issued today, and when they exist they will
  require explicit per-action approval by a person.
Credentials are per agent so one agent can be revoked without touching the others.

## Agent Connections page (planned, milestone 1c)
Replaces the simple token card with a page listing each connected agent: name, kind, scopes, last activity, expiration, and
a revoke button, plus its recent audit entries. Built on the existing `ApiToken` and `AuditLog` tables.

## Agent-to-agent orchestration
Through n8n or another workflow layer, using that layer's own scoped credential. One agent never holds another agent's
credential and no agent can call another directly with elevated rights. A workflow can only do what its own token allows,
and every action lands in the same audit log.
