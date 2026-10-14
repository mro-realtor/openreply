# Deployment guide

Read this before any production deploy. Nothing here has been run against production. Commands are templates: replace the placeholders, never paste real secrets into chat, tickets or commits.

Related: `docs/dependency-map.md` (what each PR needs), `docs/instagram-connection-maintenance.md`.

## 1. Anything that can contact Meta or another outside service

| Behavior | Contacts | When it runs | Control |
|---|---|---|---|
| Sending DMs and public replies for an **active** campaign | Meta | When a matching comment arrives | Campaigns are created inactive. Only a person activates one. API and MCP can only make drafts. |
| Comment polling safety net (worker) | Meta (reads comments) | Every 5 minutes after the worker starts. **Already on in the existing app.** | `COMMENT_POLL_INTERVAL_MS` changes the pace. There is no off switch today. |
| Instagram upkeep: token renewal, webhook check and restore | Meta | Only when `IG_MAINTENANCE_ENABLED` is exactly `true`, in the worker (first run 1 minute after boot, then every 6 hours) and in `/api/cron/refresh-tokens` | **Off by default.** Opt-in. |
| Cron routes `attach-next-reel` and `snapshot-followers` | Meta | Only if something calls them. `vercel.json` schedules them on Vercel; a self-hosted setup runs them only if an outside scheduler calls them with the cron secret. | `CRON_SECRET`, and do not schedule them externally unless wanted |
| Connecting or reconnecting Instagram | Meta | When a signed-in person clicks Connect | User action |
| Dashboard pages that read Instagram data (profile, posts, conversations, overview) | Meta (reads) | When a signed-in person opens them | User action |
| Outbound webhooks to n8n or a CRM | The URLs you register | Only when `OUTBOUND_WEBHOOKS_ENABLED` is `true` and an endpoint exists | Off by default; `OUTBOUND_WEBHOOK_ALLOWED_HOSTS` limits where |
| Sign-in and invitation emails | Resend | When someone signs in or is invited | `RESEND_API_KEY` |
| REST API, MCP, OAuth endpoints | Nothing outbound. They only answer requests. | Only when their flags are `true` | `API_V1_ENABLED`, `MCP_ENABLED`, `OAUTH_ENABLED` |
| Viewing or searching contacts | Nothing | Never sends | Read only by design |

The only thing in this stack that talks to Meta on its own, with no person involved, is comment polling (existing behavior) and the opt-in upkeep. Nothing here contacts GoHighLevel, Retell, n8n (until a webhook endpoint is added and the flag is on) or any AI provider.

## 2. Environment variables and safe defaults

Set these on the **web** service unless noted. The worker needs the database, Redis, encryption and Meta variables and the worker-only ones below. Flags are read as the exact text `true`; anything else means off.

| Variable | Safe default | Notes |
|---|---|---|
| `DATABASE_URL`, `REDIS_URL` | required | Web and worker |
| `NEXTAUTH_URL`, `NEXTAUTH_SECRET` | required | Secret: random, never shared |
| `ENCRYPTION_KEY` | required | 32 bytes in hex. Losing or changing it makes stored Instagram tokens unreadable. Back it up separately from the database. |
| `CRON_SECRET` | required if any cron route is used | Secret |
| `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `FACEBOOK_APP_SECRET`, `WEBHOOK_VERIFY_TOKEN` | required | Meta app settings. Never change live authorizations without approval. |
| `META_GRAPH_API_VERSION` | repo default | |
| `RESEND_API_KEY`, `EMAIL_FROM` | required for email sign-in | |
| `API_V1_ENABLED` | unset (off) | Turns on `/api/v1/*` |
| `MCP_ENABLED` | unset (off) | Turns on `/api/mcp` |
| `OAUTH_ENABLED` | unset (off) | Also needs `MCP_ENABLED` |
| `API_RATE_LIMIT_PER_MINUTE` | 120 | Per token |
| `CONTACTS_DEDUP_ENABLED` | unset (off) | **Held.** Do not set until approved. |
| `CONTACT_DM_COOLDOWN_HOURS` | repo default | Only matters when contacts are on |
| `IG_MAINTENANCE_ENABLED` (worker and web) | `false` or unset | **Opt-in. Contacts Meta.** |
| `IG_MAINTENANCE_INTERVAL_MS` (worker) | 21600000 | Minimum 900000. An invalid value falls back to 6 hours. |
| `OUTBOUND_WEBHOOKS_ENABLED` | unset (off) | |
| `OUTBOUND_WEBHOOK_ALLOWED_HOSTS`, `OUTBOUND_DELIVERY_INTERVAL_MS` | repo defaults | |
| `COMMENT_POLL_INTERVAL_MS` (worker) | 300000 | |

Check flags without printing secrets. Run this on each service and read only the flag lines:

```
printenv | grep -E '^(API_V1_ENABLED|MCP_ENABLED|OAUTH_ENABLED|CONTACTS_DEDUP_ENABLED|IG_MAINTENANCE_ENABLED|OUTBOUND_WEBHOOKS_ENABLED)='
```

Expect no lines, or lines ending in `=false`.

## 3. Database backup and restore verification

A backup you have not restored is not a backup. Do all of this before every deploy that includes a migration.

1. Take the backup (custom format, dated). Keep it off the server too:
   ```
   pg_dump --format=custom --no-owner --file=openreply-YYYY-MM-DD.dump "$DATABASE_URL"
   ```
2. Record row counts now, for later comparison: `Workspace`, `User`, `InstagramAccount`, `Automation`, `DmLog`, and the number of rows in `_prisma_migrations`.
3. Restore into a **separate, empty scratch database**, never the live one:
   ```
   createdb openreply_restore_check
   pg_restore --no-owner --dbname=openreply_restore_check openreply-YYYY-MM-DD.dump
   ```
4. Verify: the same row counts, `_prisma_migrations` has the same names, and one Instagram account row has a non-empty encrypted token column (do not print it).
5. Drop the scratch database. Write down the date, who checked and the counts. If any count differs, the backup is not trusted; take another before going on.

Also keep `ENCRYPTION_KEY` backed up somewhere separate. A restored database without it cannot read Instagram tokens.

## 4. Prisma migration recovery

The web container runs `npx prisma migrate deploy` when it starts. The worker does not run migrations, so start the web service first.

| Situation | What to do |
|---|---|
| Check state | `npx prisma migrate status` shows applied, pending and failed migrations. |
| A migration failed part way | Each migration runs in one transaction, so a failure normally leaves nothing half applied. Read the error, then `npx prisma migrate resolve --rolled-back <migration_name>`. Fix the cause and redeploy. If unsure, stop and restore the backup (section 3). |
| A migration applied, but you need to undo it | Only if no flag was ever on. Run that migration's `rollback.sql` through `psql`, newest migration first, then `npx prisma migrate resolve --rolled-back <migration_name>` for each. Each migration has `prisma/migrations/<name>/rollback.sql`. Rehearse on the scratch copy first (section 7). |
| Data already written by a feature that was on | Do not use `rollback.sql`. It drops those tables and columns. Redeploy the previous code (older code ignores added tables and columns) and keep the data. |
| Database and migration files disagree (drift) | Do not edit by hand. Compare a schema-only dump to a fresh database built from the migrations. CI does this check on every push. |
| Anything unclear | Restore the verified backup into a new database and point the app at it. |

Rollback scripts were exercised by CI against disposable databases only. They have never been run against production.

## 5. Worker startup checks

After starting the worker, confirm all of these in its log and the dashboard:

1. `[DM Worker] Started` appears.
2. `[DM Worker] Instagram maintenance is OFF.` appears. If you see `is ON`, stop the worker and fix `IG_MAINTENANCE_ENABLED` unless you approved it.
3. No error lines about the database, Redis or `ENCRYPTION_KEY`.
4. The Diagnostics page shows a recent worker heartbeat (it updates about every 30 seconds).
5. Settings shows each Instagram account as before. Do not click Reconnect to test.
6. Do not test with a live comment on a real post. A matching comment on an active campaign sends a real DM.

## 6. Deployment order

1. Confirm the backup is verified (section 3) and the flags are as in section 2.
2. Deploy **web** first. It applies the migrations. Run `prisma migrate status` and confirm nothing is pending or failed.
3. Check the dashboard loads and existing campaigns look right.
4. Deploy **worker** second, then run the startup checks (section 5).
5. Roll out in three steps: after #2, after #5, after #9 (see `docs/dependency-map.md`). Verify after each.
6. Turning on any flag is a separate decision, one flag at a time, never in the same step as a deploy.

## 7. Rollback rehearsal

Do this once on a scratch copy before the first production deploy, and again if the migrations change:

1. Restore the verified backup into a scratch database (section 3).
2. Run `npx prisma migrate deploy` against it. Save a schema-only dump: `pg_dump --schema-only ... > after.sql`.
3. Run each `rollback.sql`, newest first, then `migrate resolve --rolled-back` for each.
4. Save another schema-only dump and compare it with a dump of the scratch copy taken before step 2. They should match apart from the migration history table.
5. Run `migrate deploy` again to prove the migrations apply cleanly a second time.
6. Write down the date, the result and any difference. Do not proceed to production if they differ.

Code rollback needs no rehearsal on data: redeploy the previous image. Added tables and columns are ignored by older code.
