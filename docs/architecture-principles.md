# Architecture principles

These are permanent. A change that breaks one of them needs an explicit decision from the owner,
not a quiet exception.

**OpenReply belongs to its owner.** It must be manageable from any AI platform, now or later,
and nothing important may live only inside an AI vendor's system.

## 1. One standard MCP server, no client-specific behavior
MCP is implemented with the official SDK and the standard Streamable HTTP transport.
No code path checks which client is calling or changes behavior for ChatGPT, Claude or any other product.
Any standards-compliant client with valid authorization can discover and use the tools.

## 2. The REST API is the foundation, MCP is a thin layer
Business logic lives in `lib/services/*`. The versioned REST API (`/api/v1`) and the MCP tools both call
those same functions. OpenReply works fully with no LLM and no MCP. Removing MCP removes no capability.

## 3. Flexible authentication, never weakened
- Scoped API tokens for backend integrations and clients that can send a header.
- OAuth 2.1 (authorization code with PKCE, client metadata documents or dynamic registration,
  protected resource metadata) for remote clients that require it. Planned as milestone 1b.
- Both produce the same scoped, workspace-bound, expiring credentials checked by the same code.
- Authentication is never loosened for one provider's convenience. No anonymous mode.

## 4. Provider-neutral AI engine (applies from the AI intelligence milestone)
- One internal interface for model calls (`complete`, `classify`, structured output, tool use),
  with adapters for OpenAI, Anthropic, Google Gemini and OpenAI-compatible self-hosted models.
- Model and provider are configuration per task or agent (router, qualifier, assistant, summarizer),
  not code.
- Prompts, personas, knowledge and conversation memory are stored in OpenReply's database
  in plain, exportable formats. Nothing relies on a provider-side assistant, thread or memory object.
- Core logic depends on the interface, never on a vendor SDK type.

## 5. Open standards for tools and schemas
JSON Schema for tool inputs, strict objects, documented descriptions, consistent error codes,
versioned REST paths. No proprietary tool format where an open one exists.

## 6. Provider configuration (administrator feature, later)
Admin screen to add providers, pick models, store credentials encrypted with the existing
`ENCRYPTION_KEY` pattern (never shown again, never logged), set per-provider and per-agent usage
and spend limits, and define fallback order and failure behavior. Classification tasks fail open or
closed as configured per task.

## 7. Identical safety for every client and every model
All callers, human-driven or autonomous, pass the same gates: scopes, workspace isolation, audit log,
draft-only creation, approval for sensitive actions, rate limits. Switching model or provider cannot
bypass any of them, because the gates live in the service layer, below both MCP and the AI engine.
AI-generated content that reaches the public stays behind the approval and Fair Housing rules.

## 8. Interoperability is tested, not assumed
CI runs the MCP endpoint against several independent clients (TypeScript SDK, Python SDK, MCP Inspector,
raw JSON-RPC) and records the result. `docs/api-mcp.md` lists only what has actually been verified,
with the date and the authentication method used. Unverified clients are labeled as such.

## 9. Adding a model or agent is configuration
A new LLM means a new adapter or client connection and a token or OAuth grant. It never means editing
campaign, lead, conversation or analytics logic.

## 10. No lock-in
Campaigns, contacts, leads, consent, conversations, analytics, knowledge and automation settings stay in
OpenReply's Postgres on infrastructure the owner controls. Everything is exportable through the REST API.
Vendor-hosted memory or assistants are never the system of record.

## 11. Agents are first-class, separate and least-privilege
Each AI assistant or autonomous agent (ChatGPT, Claude, Gemini, Hermes, OpenClaw, Muse if a supported path exists, and future agents) gets its own credential with its own scopes, listed on an Agent Connections page with last activity, expiry and revocation. Sensitive scopes are never granted by default. Agent-to-agent work goes through a controlled workflow layer with its own credential, never by sharing credentials. See `agents.md`.
