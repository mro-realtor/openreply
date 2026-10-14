# OpenReply development checkpoint

Last updated: 2026-10-14 (after PR #7). Written so work can resume cold.

## Branch and PR stack (all draft, nothing merged, nothing deployed)

| Order | PR | Branch | Base | CI |
|---|---|---|---|---|
| 1 | #1 | feature/api-mcp | main | green |
| 2 | #2 | feature/oauth-mcp | feature/api-mcp | green (run 38517661570) |
| 3 | #3 | feature/contacts-dedup | feature/oauth-mcp | green (head 8fbdfe0) |
| 4 | #4 | feature/ig-connection-maintenance | feature/contacts-dedup | green (run 38521886070, head 82f9358) |
| 5 | #5 | feature/outbound-webhooks | feature/ig-connection-maintenance | green (run 38540828642, head 2bcafc1) |
| 6 | #6 | feature/contact-consent-assignment | feature/outbound-webhooks | green (run 38541799077, head 388d415) |
| 7 | #7 | feature/campaign-settings | feature/contact-consent-assignment | green (run 38543508899, head b25ac5a) |

Next branch: stack on feature/campaign-settings. Every new branch stacks on the previous one to avoid conflicts in prisma/schema.prisma, scripts/ci/upgrade-path.sh and the CI workflow.

## Delivery mechanics

- The local sandbox cannot run prisma generate and cannot git push (403). Local worktree /home/claude/openreply-audit is scratch only; the stop hook warning about it can be ignored.
- Push with Composio GITHUB_COMMIT_MULTIPLE_FILES from COMPOSIO_REMOTE_WORKBENCH (new branch needs base_branch). Verify with GITHUB_LIST_WORKFLOW_RUNS_FOR_A_REPOSITORY and job logs.
- CI workflow: .github/workflows/validate-api-mcp.yml (triggers on feature/**, disposable Postgres 17 and Redis 7).
- Commit trailers: Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com> and Claude-Session line. PR footer: Generated with Claude Code plus session link.

## Done

- Milestone 1b OAuth 2.1 (PR #2). Verified only with the official TS MCP SDK client in CI.
- Contacts and per-person DM dedup, flag CONTACTS_DEDUP_ENABLED default off (PR #3).
- Instagram connection maintenance (PR #4): token renewal 21 days early, webhook check and restore, health states, alerts as operational events, settings card, per-account reconnect. Worker timer added (every 6 hours, IG_MAINTENANCE_ENABLED, IG_MAINTENANCE_INTERVAL_MS) because the app is self-hosted and vercel.json crons do not run.

- Outbound webhooks (PR #5): tables, signing, retries, URL safety, endpoint API, DM and contact events, worker delivery loop. Flag OUTBOUND_WEBHOOKS_ENABLED off. CI ran 35 unit and 12 database tests plus upgrade, rollback and re-apply with 13 new tables. Not tried against a real n8n or CRM.

- Contact consent and lead assignment (PR #6): consent history with source, assignment between teammates, listing and filtering, events. CI ran 7 database tests plus upgrade, rollback and re-apply with 14 new tables.
- Campaign composer settings (PR #7): strict follow gate, text-only DMs, default teammate (for Nancy), draft-safe creation and activation check (name, message, keyword). All off by default. Worker logic covered by 47 local unit tests and CI. A first CI run failed because the activation check also required a trigger post, which broke an existing test; fixed by dropping that requirement. Backend only: no dashboard controls yet.

## Not verified

- Any live Meta call (refresh, subscribed_apps, force_reauth), the worker timer with real Redis, ChatGPT, Claude connector, Hermes, OpenClaw, Gemini, Muse clients, email delivery of alerts.

## Blockers and open findings

- No comment-router.ts, 1Prompt or Kairo components exist in any accessible repo. Decision taken: build a provider-neutral AI router from scratch (provider interface, per-task model config, encrypted provider keys, usage limits, fallback, prompts stored in OpenReply) unless Marvin supplies the originals.
- Stop hook "uncommitted changes" is a local scratch artifact. Installing the Claude GitHub App on the repo would remove it.

## Exact next steps, in order

1. DONE: feature/outbound-webhooks (PR #5). Possible later additions: a settings page card for endpoints, a cron route fallback, an example CRM receiver contract once mro-crm is chosen.
2. AI router branch (from scratch, see blockers).
3. Campaign composer UI branch: Save Draft button, strict follow and text-only toggles, default teammate picker, minimal Contacts page, workspace members endpoint. Backend for all of it is done (PRs #6 and #7). Also expose contacts and new campaign settings through v1 API and MCP (review leads:read scope, update api-core snapshot tests).
4. Agent interoperability: Hermes first, then OpenClaw, Gemini; Agent Connections page (1c); interop testing (1d); Muse only through a supported path and treated as future until verified.
5. After each milestone: update this file, confirm CI green, send a concise report.

## Decisions for Marvin

- Approve merge order for the stack (#1 to #7) and when to run production migrations.
- Whether consent status should block first replies (currently it only records).
- Supply original AI router components, or approve building from scratch.
- Installing the Claude GitHub App on the repo to clear the stop hook warning.

## Hard gates (need Marvin's explicit approval)

Merging into main, production deploy, production database migrations, activating campaigns, sending live messages, changing live Meta authorizations, enabling API, MCP or OAuth flags in production. Never show secret values in logs, responses, commits or reports. Never claim a test passed unless it ran. Never use em dashes.
