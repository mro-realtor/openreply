# Roadmap

Governed by [architecture-principles.md](architecture-principles.md): provider-neutral, no lock-in, same safety gates for every AI client.

Order of work. Each milestone ships on its own branch, behind flags, with tests,
a rollback note and an approval gate before production.

1. **API and MCP foundation** (done on `feature/api-mcp`, awaiting review and deploy approval)
   1c. **Agent Connections page**: per-agent credentials, scopes, last activity, expiry, revoke (see `agents.md`).
   1d. **Agent interoperability testing**: Hermes Agent first, then OpenClaw, Gemini clients, others; Muse only via a supported path.
   1b. **OAuth 2.1 for remote clients** (standards-based, usable by any compliant MCP client; ChatGPT requires it).
       Issues the same scoped, workspace-bound tokens. Interoperability matrix kept current in `docs/api-mcp.md`.
2. **Contact identity and leads** (next priority after secure MCP access): Contact, SocialIdentity, Lead, Consent, Conversation.
   Per-person and cross-campaign cooldown, opt-out and human-takeover suppression.
   Additive migrations and a controlled backfill from `DmLog`. Existing history preserved.
3. **AI intelligence** on a provider-neutral engine (OpenAI, Anthropic, Gemini, self-hosted adapters, per-task model config,
   admin provider settings with encrypted keys, usage limits and fallback; all prompts and memory stored in OpenReply): locate the current `comment-router.ts` and the 1Prompt/Cairo
   pieces, per-campaign conversation modes (direct capture, qualification, assistance, human only),
   editable personas (Marvin, Nancy), explainable lead classification, Fair Housing guardrails.
4. **n8n and CRM**: signed webhooks, durable outbox with retries and dead letters,
   qualified-lead event to the existing MRO CRM. Decide the system of record per data type first.
5. **Channels**: channel adapter interface, then Facebook Pages and Messenger, then evaluate
   TikTok and YouTube against their real API permissions.
6. **Voice and appointments** (Retell), consent-gated.
7. **Analytics**: funnel from engagement to closed transaction, observed vs estimated clearly marked.
8. **Advanced MCP tools**: personas, lead search, assignment, integration health, each behind its own scope.

Acceptance test after milestone 3: the "NOR | Historia Primera Casa | CASA" campaign
created end to end through MCP as an inactive draft with no Reel, nothing sent.
Milestone 1 can already create the draft and store the lead-capture and assignee intent in `draftConfig`;
the lead-capture behavior itself arrives with milestone 2.
