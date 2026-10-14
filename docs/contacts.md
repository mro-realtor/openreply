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

## Dashboard

**Contacts** in the sidebar lists people with search, status, Instagram DM permission and assignee filters. A contact page shows linked identities, follow up, permission to message, and campaign activity. The pages only show information. Viewing or searching a contact never sends a message or changes anything.

## API tokens and MCP (read only)

A token with the `contacts:read` scope can read contacts. It is not included in `read`, so existing tokens see no change, and it is not enabled in production by this change.

- `GET /api/v1/contacts` with `q`, `status`, `consent`, `assignedTo`, `identity=INSTAGRAM:<id>`, `limit`, `cursor`
- `GET /api/v1/contacts/{id}`
- `GET /api/v1/contacts/{id}/history`
- MCP tools `list_contacts`, `get_contact`, `list_contact_history`

Rules that hold on every route:

- Everything is limited to the token's own workspace. A contact from another workspace answers 404.
- Comment text and message content are never returned to tokens or MCP. They stay behind the reserved `leads:read` scope, which nobody can be issued yet.
- Consent is per channel. `consent.instagramDm` is the only channel stored today. `consent.sms` and `consent.voice` always read `NOT_TRACKED`, so a CRM or voice agent must not treat Instagram permission as permission to text or call.
- `followUpState` (`UNASSIGNED`, `ASSIGNED`, `HUMAN_TAKEOVER`, `OPTED_OUT`) is worked out from existing fields. It is not a sales stage; stages belong in the CRM.

## How people are identified

A contact has its own internal id that never changes. Platform ids (today the Instagram user id) are stored as linked identities under that contact. Names, handles, phone numbers and emails are never used to decide that two records are the same person, and contacts are never merged automatically. A changed Instagram username updates the handle on the same contact.

Adding another source later (GoHighLevel, a phone number) means adding one new identity type through a reviewed migration, plus a verified matching rule agreed in advance. SMS and voice consent would be stored as their own records, separate from the Instagram ones. Neither is built yet.

## Events for n8n and CRMs

With outbound webhooks on (see `docs/integrations-n8n-crm.md`), these events are sent: `contact.assigned`, `contact.consent_changed`, `contact.opted_out`, `contact.human_takeover`.
