# Sending OpenReply events to n8n or a CRM (outbound webhooks)

OpenReply can push a small message to a web address you choose every time something happens, for example a DM was sent or a person opted out. n8n, a CRM, or any tool that can receive a webhook can then act on it. Nothing is sent unless you switch the feature on, and OpenReply never sends anything to a person from this feature. It only tells your other tool what happened.

Status: built and covered by automated tests with a fake receiver. It has not yet been run against a real n8n or CRM, and it is off in production.

## Turning it on

Off by default. To enable it, set these in the web service and the worker:

| Setting | Meaning |
|---|---|
| `OUTBOUND_WEBHOOKS_ENABLED=true` | Master switch. While it is not `true`, nothing is queued, sent or exposed (the API answers 404). |
| `OUTBOUND_WEBHOOK_ALLOWED_HOSTS` | Optional. Comma separated hostnames that may use plain `http` or a private address, for example an n8n container on your own network (`n8n`). Exact names only. |
| `OUTBOUND_DELIVERY_INTERVAL_MS` | Optional. How often the worker sends queued events. Default 15000. |

The database tables arrive with migration `20261017000000_add_outbound_webhooks`. Run it the same way as your other migrations, after taking a backup. A manual `rollback.sql` is included.

## Events

| Event | When |
|---|---|
| `dm.sent` | A DM was sent for a comment. |
| `dm.skipped` | A DM was not sent: already sent for this campaign, cooldown, opted out, human takeover, rate limit or plan limit. The `reason` field says which. |
| `dm.failed` | A DM could not be sent. Recorded on the first failure of that message. |
| `contact.opted_out` | A person was marked as opted out. |
| `contact.human_takeover` | A person was marked as handled by a human. |
| `ping` | A test you trigger yourself. |

Each message is a JSON body:

```json
{
  "id": "evt_id",
  "type": "dm.sent",
  "createdAt": "2026-10-14T10:00:00.000Z",
  "workspaceId": "...",
  "data": { "dmLogId": "...", "commenterId": "...", "commenterName": "...", "commentText": "...", "automationId": "...", "contactId": "...", "status": "SENT", "reason": null }
}
```

The same event is never queued twice. Delivery is "at least once": if your receiver is slow to answer, the same event can arrive again, so use `id` (also sent as the `X-OpenReply-Event-Id` header) to ignore repeats.

The `data` includes the commenter's name and comment text so your CRM can create or update a lead. Only endpoints you add yourself receive it.

## Checking that a message really came from OpenReply

Every request carries `X-OpenReply-Signature: t=<unix seconds>,v1=<hex>`. The value is an HMAC-SHA256, keyed with the endpoint secret, of the text `<t>.<raw request body>`. Check it against the raw body (not a re-serialised copy) and reject requests whose `t` is more than 5 minutes old. Other headers: `X-OpenReply-Event`, `X-OpenReply-Event-Id`, `X-OpenReply-Delivery-Id`.

Node example:

```js
const crypto = require("crypto");
function verify(secret, header, rawBody) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(parts.t + "." + rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
}
```

## Managing endpoints

Owners and admins only. All paths are under `/api/outbound`:

| Request | What it does |
|---|---|
| `GET /endpoints` | List endpoints. The address is shown as `https://host/...` only, because many webhook addresses contain a secret. |
| `POST /endpoints` | Add one: `{ "name": "n8n", "url": "https://...", "eventTypes": ["dm.sent"] }`. Leave `eventTypes` empty for every event. The signing secret is returned once in this response and never again. |
| `PATCH /endpoints/{id}` | Change name, url, events, `isActive`, or `rotateSecret: true` for a new secret (shown once). |
| `DELETE /endpoints/{id}` | Remove it and its history. |
| `POST /endpoints/{id}/test` | Queue a test event. |
| `GET /endpoints/{id}/deliveries` | The last 50 deliveries with status, tries and the last error. |
| `POST /deliveries/{id}/replay` | Try a failed or dead delivery again from scratch. |

## What happens when your receiver is down

A delivery succeeds on any 2xx answer. Anything else (an error status, a timeout, a redirect, no answer) is retried after 1 minute, 5 minutes, 30 minutes, 2 hours, 6 hours, 12 hours and 24 hours. After 8 tries it is marked dead and kept for you to replay. An answer of 410 Gone switches the endpoint off. An endpoint that fails 20 deliveries in a row is switched off and a warning is recorded on the Diagnostics page. Switch it back on with `PATCH` and it picks up where it left off.

## Safety rules built in

- Only `https` addresses, unless the host is on your allowlist.
- Addresses that point at the server itself or your private network (localhost, 10.x, 192.168.x, 169.254.x cloud metadata, and similar) are refused, both when you save the address and again right before each send, including names that secretly resolve to such an address.
- Redirects are never followed.
- Secrets are stored encrypted and never written to logs or shown after creation.
- Each request has a 10 second timeout.

Known limit: the address check happens just before the send, so a hostname that changes its answer between that check and the connection is a theoretical gap. If that matters to you, keep the allowlist empty and use public https receivers only.

## Connecting n8n

1. In n8n, add a Webhook node, method POST, and turn on the Raw Body option. Copy its Production URL.
2. Add it in OpenReply with `POST /api/outbound/endpoints`. Save the secret it returns.
3. Send a test with `POST /api/outbound/endpoints/{id}/test` and check the execution in n8n.
4. An example workflow is in `docs/examples/n8n-openreply-webhook.json`. It has not been imported into a real n8n yet, so treat it as a starting point. Checking the signature inside n8n needs the `crypto` module allowed (`NODE_FUNCTION_ALLOW_BUILTIN=crypto`).

## Connecting a CRM

Point an endpoint at whatever receiver your CRM exposes, or at an n8n workflow that calls the CRM. The private `mro-crm` project is the intended first receiver; nothing in this repository changes it, and its own rule that AI output needs human review still applies.
