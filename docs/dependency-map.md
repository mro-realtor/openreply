# Dependency map for PRs #1 to #9

Status: all nine PRs are draft. Nothing is merged, deployed or migrated in production. No feature flag is on. This page only describes what would happen; it changes nothing.

## Read this first: one thing is on by default

The Instagram connection upkeep added in PR #4 is **on unless you turn it off**. The worker checks `IG_MAINTENANCE_ENABLED !== "false"`, so a worker running PR #4 or later renews Instagram tokens with Meta about 1 minute after it starts, then every 6 hours. That is a live change to Meta authorizations. Before the first deploy of #4 or later, set `IG_MAINTENANCE_ENABLED=false` on the **worker**. Every other new feature is off by default. Whether to turn upkeep on is your call and is not decided here.

## The stack

Each PR is built on the one before it, so each contains all earlier changes. They share `prisma/schema.prisma`, the CI workflow and the upgrade-path script, which is why they are stacked and not independent.

| # | Branch | Needs | Database migration (all additive) | Flag that switches it on | What is visible with flags off |
|---|---|---|---|---|---|
| 1 | feature/api-mcp | main | `20261014000000_add_api_access`: tables ApiToken, AuditLog, IdempotencyKey; Automation.isDraft (default false), draftConfig | `API_V1_ENABLED`, `MCP_ENABLED` | nothing, endpoints answer 404 |
| 2 | feature/oauth-mcp | #1 | `20261014120000_add_oauth`: 5 OAuth tables, ApiToken.grantId | `OAUTH_ENABLED` (also needs `MCP_ENABLED`) | nothing |
| 3 | feature/contacts-dedup | #2 | `20261015000000_add_contacts`: Contact, SocialIdentity, DmLog.contactId, 2 enums | `CONTACTS_DEDUP_ENABLED` (held) | nothing, no contacts are written |
| 4 | feature/ig-connection-maintenance | #3 | `20261016000000_add_ig_connection_health`: about 14 new InstagramAccount columns, 1 enum | `IG_MAINTENANCE_ENABLED` (**default ON**, see above) | connection health on Settings; reconnect now saves who connected and granted scopes |
| 5 | feature/outbound-webhooks | #4 | `20261017000000_add_outbound_webhooks`: 3 tables, 1 enum | `OUTBOUND_WEBHOOKS_ENABLED` | nothing |
| 6 | feature/contact-consent-assignment | #5 | `20261018000000_add_contact_consent_assignment`: Contact consent and assignee columns, ContactConsentEvent | uses `CONTACTS_DEDUP_ENABLED` for data | session-only contact routes exist, empty until contacts are on |
| 7 | feature/campaign-settings | #6 | `20261019000000_add_campaign_composer_settings`: 3 Automation columns, all default off | none (settings default off per campaign) | nothing until a campaign sets them |
| 8 | feature/campaign-dashboard-api | #7 | none | none new (API and MCP drafts need #1 flags) | **new builder controls**: strict follow, text only, teammate picker, Save draft |
| 9 | feature/contacts-dashboard-api | #8 | none | none new (`contacts:read` needs `API_V1_ENABLED` and `MCP_ENABLED`) | **new Contacts item in the sidebar**; page says tracking is off |

Real code dependencies beyond the stacking: #6 needs #3 (contacts), #7 needs #6 (default teammate), #8 needs #7, #9 needs #1, #3 and #6.

## Safe merge order

Strictly 1, 2, 3, 4, 5, 6, 7, 8, 9. Merge each into main with a **merge commit** (not squash), then let GitHub move the next PR's base to main (or set it by hand) before merging that one. Squashing a stacked PR makes the next one conflict. A simpler alternative is to merge only #9, which brings in all nine at once, at the cost of reviewing them one by one.

## Safe deployment order

Merging does not change production. Deploying does, because the web container runs `prisma migrate deploy` when it starts.

1. Before any deploy: take a database backup, and set `IG_MAINTENANCE_ENABLED=false` on the worker. Confirm no other flag is set.
2. Deploy the **web** service first (it applies the migrations), check it is healthy, then deploy the **worker**.
3. Deploy in three steps so each step is small. Each step is the main branch as it stands after that merge:
   - **Checkpoint A, after #2**: migrations 1 and 2 (new empty tables).
   - **Checkpoint B, after #5**: migrations 3, 4 and 5.
   - **Checkpoint C, after #9**: migrations 6 and 7. This is also the first release with visible UI changes (#8 builder, #9 Contacts item).
4. After each step, check the dashboard loads, existing campaigns still show, and the worker log is clean. Do not test with live comments.
5. Turning flags on is a separate decision for later, one at a time, in this order: `API_V1_ENABLED`, `MCP_ENABLED`, `OAUTH_ENABLED`, then `OUTBOUND_WEBHOOKS_ENABLED`, then `CONTACTS_DEDUP_ENABLED` last. `IG_MAINTENANCE_ENABLED` stays false until you approve it. The held flags stay held until the Codex audit and your architecture direction arrive.

## Rollback points

| Point | Code rollback | Database rollback |
|---|---|---|
| After Checkpoint A, B or C | Redeploy the previous release. Safe: every migration only adds tables or columns with defaults, so older code ignores them. | Each migration has a `rollback.sql`. Run them newest first (#7 down to #1), and only if no flag was ever on. Also mark each migration as rolled back in Prisma's history, which needs a written procedure before production. CI ran these only against disposable databases, never production. |
| Any flag turned on | Turn the flag off. Takes effect on restart. | Avoid. Rollback SQL would delete data written since. |

## What can and cannot be undone

Reversible:
- Merging (revert commits), as long as the migration has not been applied.
- Redeploying older code after any checkpoint.
- Every flag flip.
- Migrations while the new tables are still empty (flags off).
- Campaign drafts (the API can only create inactive drafts).

Not reversible, or only with data loss:
- A Meta token renewal done by the upkeep job. You cannot un-renew it, so keep it off until approved.
- Webhooks already delivered to n8n or a CRM, and DMs already sent by active campaigns.
- Contacts, identities and consent history once recorded. Consent history is append-only on purpose, and rolling back the migration deletes it.
- InstagramAccount columns from #4 are filled on any reconnect even with flags off (who connected, granted scopes), so rolling that migration back loses that history.
- OAuth grants and API tokens issued after those flags are on.
