# Contacts: consent and lead assignment

OpenReply keeps one record per person (a contact) across all your Instagram accounts and campaigns. This page covers the two things you can now record on a contact. Nothing on this page sends a message to anyone.

## Consent

Each contact has a consent status: **unknown** (the default), **granted** or **withdrawn**. Every change is saved as a history entry with its source (for example `manual`, `dm_reply`, `web_form`), an optional note, who recorded it, and when.

- **Granted** records that the person gave permission. It does not switch messaging back on by itself if they had opted out.
- **Withdrawn** counts as a stop request: the person is marked opted out and no campaign will message them again.
- Consent is a record you keep. It does not currently block a first reply to someone who commented on your post. Whether to require granted consent before certain messages (follow ups, promotions) is a decision for you and, where it applies, your compliance rules. Ask before this is turned into a hard rule.

## Lead assignment

A contact can be assigned to a teammate in the workspace (for example Nancy). Only people in the workspace can be assigned.

## Who can do what

| | Owner / Admin | Member |
|---|---|---|
| See contacts | yes | yes |
| Assign or reassign | yes | no |
| Record consent, opt out, mark human takeover | yes | only for contacts assigned to them |
| Opt someone back in | yes | no |

## API (signed-in dashboard session)

- `GET /api/contacts` with `assignedTo=me|unassigned|<userId>`, `status=ACTIVE|OPTED_OUT`, `consent=UNKNOWN|GRANTED|WITHDRAWN`, `q`, `limit`, `cursor`
- `GET /api/contacts/{id}` includes the last 20 consent entries
- `PATCH /api/contacts/{id}` with any of `assignedToUserId`, `consent: { status, source, note }`, `optedOut`, `humanTakeover`

This is not yet available to API tokens or MCP. That needs a reviewed permission scope and is listed as a next step.

## Events for n8n and CRMs

With outbound webhooks on (see `docs/integrations-n8n-crm.md`), these events are sent: `contact.assigned`, `contact.consent_changed`, `contact.opted_out`, `contact.human_takeover`.
