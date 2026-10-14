# Campaign composer settings

These settings are stored on each campaign. All of them default to off, so
existing campaigns behave exactly as before.

## Save as draft
Send `isDraft: true` when creating a campaign. A draft is never live, whatever
`isActive` says, and may be incomplete (no trigger post, no keyword yet).
Turning a campaign on (`isActive: true`) checks that it is complete. If not, the
request is refused with a plain list of what is still missing: a name, the
message, and a keyword or match any word. A trigger post is not required, which
keeps the existing behaviour for drafts created through the API.

## Strict follow gate (`followGateStrict`)
Needs `requireFollow`. Normal mode: after someone taps "I'm following", only a
confirmed non-follower is turned away, and if Instagram cannot say either way the
link is sent so a real follower is never stuck. Strict mode: only a confirmed
follower gets the link; if the check cannot be verified the person is asked again.

## Text-only messages (`textOnly`)
The message is sent as plain text with the link written inline (extra links on
their own lines), with no buttons. Because the follow gate and the opening DM
both need a button to tap, text-only cannot be combined with them.

## Default teammate (`defaultAssigneeUserId`)
New people from this campaign are assigned to this teammate, who must be a member
of the workspace. It never overrides an existing assignee. When a person is
assigned this way a `contact.assigned` event is emitted with `via: campaign_default`.
If the teammate is later deleted the default is cleared and the campaign keeps running.

## Not yet included
Dashboard controls (toggles, Save Draft button, teammate picker) and exposure
through the v1 API and MCP are separate follow-up changes.
