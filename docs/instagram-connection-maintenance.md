# Instagram connection maintenance

Status: on branch `feature/ig-connection-maintenance`. Not deployed. No live Meta authorization has been changed.

## What the audit found

- Every account connects through **Instagram API with Instagram Login** (`api.instagram.com/oauth/authorize`, `graph.instagram.com`, scopes `instagram_business_*`). None use Facebook Login.
- Each connected account stores its **own** Instagram user access token (encrypted, AES-256-GCM). There is no shared Facebook user token. An account owned by Nancy has an independent authorization from one owned by Marvin, even though both use the same Meta app. One owner's login cannot renew or break the other's.
- Before this change a daily cron (`/api/cron/refresh-tokens`, defined only in `vercel.json`) refreshed tokens within 10 days of expiry. On a self-hosted deployment nothing in the repo called it. It kept no refresh history, no retry or backoff state, did not detect revoked logins, and never checked webhooks. A failed refresh only wrote an event nobody was prompted to read.
- Webhook subscription was done once at connect time and only recorded as true or false. Nothing re-checked it and nothing recorded whether events actually arrived.

## What this adds (reusing the same cron route)

| Area | Behavior |
| --- | --- |
| Renewal | Each account is renewed 21 days before expiry using its own token. Tokens younger than 25 hours are not refreshed (Meta rule). Expired tokens cannot be refreshed and are flagged. |
| Retries | Up to 3 tries per run for temporary errors (1 s, 3 s). Then exponential backoff across runs: 1 h, 2 h, 4 h, 8 h, 24 h. After 3 failed runs the account shows "Needs attention". |
| Revoked or changed login | A rejected token or removed permission marks only that account "Reconnect needed". It is not retried until the owner reconnects. |
| No duplicate work | Each account is claimed with a time-limited lock and re-read after the claim, so overlapping cron runs refresh once. |
| Webhooks | Each run reads the account's subscribed fields from Meta and re-subscribes if `comments` or `messages` is missing. |
| Delivery | Every verified webhook POST stamps `lastWebhookAt` on the account. States: healthy (event in 7 days), inactive (subscribed, quiet; not an error), degraded (subscription missing), disconnected (reconnect needed). |
| Alerts | An operational event (level ERROR) is written once per problem per 24 hours for: repeated renewal failure, reconnect needed, expired token, missing permissions, webhook not restorable. A recovery event is written when an account comes back. They appear on the Diagnostics page. Messages are stripped of anything that looks like a credential. |
| Settings | New "Instagram connection health" card per account: status, expiry, last renewal, next renewal, webhook state, last webhook event, who connected it, issues, Reconnect button. |
| Reconnect | `Reconnect` starts the login for that one account with `force_reauth`. The callback refuses any other Instagram login (nothing is changed) and refuses a link used by a different signed-in person. |

### Who runs it

The repo's `vercel.json` cron only exists on Vercel. A self-hosted deployment (Docker or EasyPanel with the long-running worker) has no Vercel cron. **The upkeep is opt-in because it contacts Meta** (it renews tokens and re-subscribes webhooks). Nothing runs unless `IG_MAINTENANCE_ENABLED` is exactly `true`; a missing, empty or misspelled value (`false`, `True`, `1`, `yes`, a value with spaces) keeps it off. When it is on, the worker runs it 1 minute after boot and then every 6 hours (`IG_MAINTENANCE_INTERVAL_MS`, minimum 15 minutes, an invalid value falls back to 6 hours). The same switch guards `/api/cron/refresh-tokens`: with it off, that route still resets the monthly usage counters but does not renew tokens or contact Meta, and says `maintenance: "disabled"` in its answer. Running the worker and the cron route together is safe: each account is locked while it is handled. The worker prints one line at start saying whether the upkeep is ON or OFF.

## Nancy's accounts

Nancy keeps her own Instagram login. If one of her accounts needs a reconnect:

1. Invite her to the OpenReply workspace as Admin (Settings, Team). She signs in with her own email.
2. She opens Settings, finds the account under "Instagram connection health", clicks Reconnect and logs in to that Instagram account.
3. Only that account is updated. Your accounts are not touched.

## Not verified

- No call has been made to Meta. All Meta behavior in tests is simulated with fakes; the real endpoints for refresh and `subscribed_apps` follow Meta's documentation and the code that was already in the project.
- `force_reauth` is documented for Instagram Business Login but has not been exercised against a live login here.
- The app-level webhook configuration (callback URL and verify token in the Meta dashboard) is not checked, because it needs Meta app credentials that are not part of this project's configuration. Only each account's subscription and actual delivery are monitored.
- Alerts are recorded and shown, not emailed. Email or push delivery is a possible follow-up.
- Migration `20261016000000_add_ig_connection_health` has not been run anywhere except disposable CI databases.
