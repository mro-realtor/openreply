# OpenReply development checkpoint

Last updated: 2026-10-13 (evening Pacific). Written so work can resume cold.

## Branch and PR stack (all draft, nothing merged, nothing deployed)

| Order | PR | Branch | Base | CI |
|---|---|---|---|---|
| 1 | #1 | feature/api-mcp | main | green |
| 2 | #2 | feature/oauth-mcp | feature/api-mcp | green (run 38517661570) |
| 3 | #3 | feature/contacts-dedup | feature/oauth-mcp | green (head 8fbdfe0) |
| 4 | #4 | feature/ig-connection-maintenance | feature/contacts-dedup | green (run 38521137956, head 464a9a3) |

Next branch: feature/outbound-webhooks, PR base feature/ig-connection-maintenance. Every new branch stacks on the previous one to avoid conflicts in prisma/schema.prisma, scripts/ci/upgrade-path.sh and the CI workflow.

## Delivery mechanics

- The local sandbox cannot run prisma generate and cannot git push (403). Local worktree /home/claude/openreply-audit is scratch only; the stop hook warning about it can be ignored.
- Push with Composio GITHUB_COMMIT_MULTIPLE_FILES from COMPOSIO_REMOTE_WORKBENCH (new branch needs base_branch). Verify with GITHUB_LIST_WORKFLOW_RUNS_FOR_A_REPOSITORY and job logs.
- CI workflow: .github/workflows/validate-api-mcp.yml (triggers on feature/**, disposable Postgres 17 and Redis 7).
- Commit trailers: Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com> and Claude-Session line. PR footer: Generated with Claude Code plus session link.

## Done

- Milestone 1b OAuth 2.1 (PR #2). Verified only with the official TS MCP SDK client in CI.
- Contacts and per-person DM dedup, flag CONTACTS_DEDUP_ENABLED default off (PR #3).
- Instagram connection maintenance (PR #4): token renewal 21 days early, webhook check and restore, health states, alerts as operational events, settings card, per-account reconnect. Worker timer added (every 6 hours, IG_MAINTENANCE_ENABLED, IG_MAINTENANCE_INTERVAL_MS) because the app is self-hosted and vercel.json crons do not run.

## Not verified

- Any live Meta call (refresh, subscribed_apps, force_reauth), the worker timer with real Redis, ChatGPT, Claude connector, Hermes, OpenClaw, Gemini, Muse clients, email delivery of alerts.

## Blockers and open findings

- No comment-router.ts, 1Prompt or Kairo components exist in any accessible repo. Decision taken: build a provider-neutral AI router from scratch (provider interface, per-task model config, encrypted provider keys, usage limits, fallback, prompts stored in OpenReply) unless Marvin supplies the originals.
- Stop hook "uncommitted changes" is a local scratch artifact. Installing the Claude GitHub App on the repo would remove it.

## Exact next steps, in order

1. feature/outbound-webhooks (n8n and CRM foundation). Models WebhookEndpoint, OutboxEvent (unique dedupeKey), WebhookDelivery (PENDING/DELIVERED/FAILED/DEAD, unique endpointId+eventId). Avoid clashing with existing inbound WebhookEvent and WebhookStatus. Flag OUTBOUND_WEBHOOKS_ENABLED default off. HMAC-SHA256 header X-OpenReply-Signature t=<ts>,v1=<hex>, event and delivery id headers, verify helper. URL guard (https only, block private, loopback, link-local, metadata; optional allowlist env for internal n8n hosts; manual redirects; DNS check). Retries 1m, 5m, 30m, 2h, 6h, 12h, 24h up to 8 attempts then DEAD with replay; 410 disables endpoint; auto-disable after consecutive failures with an alert. Events dm.sent, dm.skipped, dm.failed, contact.opted_out, contact.human_takeover, ping. Emit from dm-worker post-loop and the contact service. Owner and admin only settings API (secret shown once), delivery loop in the worker. Docs docs/integrations-n8n-crm.md and an example n8n workflow marked untested. mro-crm (private repo mro-realtor/mro-crm) is the likely receiver and is not modified.
2. AI router branch (from scratch, see blockers).
3. Campaign composer improvements (one branch, separate tested changes): Save Draft; configurable strict Follow Gate; text-only DMs; Nancy lead assignment; explicit contact consent tracking (ties into Contact opt-out and takeover; add contacts API and UI routes, since the service exists but has none).
4. Agent interoperability: Hermes first, then OpenClaw, Gemini; Agent Connections page (1c); interop testing (1d); Muse only through a supported path and treated as future until verified.
5. After each milestone: update this file, confirm CI green, send a concise report.

## Hard gates (need Marvin's explicit approval)

Merging into main, production deploy, production database migrations, activating campaigns, sending live messages, changing live Meta authorizations, enabling API, MCP or OAuth flags in production. Never show secret values in logs, responses, commits or reports. Never claim a test passed unless it ran. Never use em dashes.
