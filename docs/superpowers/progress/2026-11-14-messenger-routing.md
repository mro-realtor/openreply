# Messenger workflow routing — progress checkpoint

Updated: 2026-11-14 (America/Los_Angeles)

## Completed in this checkpoint

- Added a Messenger-specific sequence enrollment model and additive migration. It uses the existing Sequence JSON, Messenger Page, trigger, and sequence status model; existing Instagram enrollments and data are unchanged.
- Extracted webhook event processing into `lib/messenger/router.ts`.
- Deduplicated inbound events before automation effects, matched keywords case-insensitively, enrolled eligible contacts into the configured Messenger sequence, retained the immediate keyword reply, and recorded successful outbound messages.
- Recorded Meta send failures on the original webhook event so they appear in Messenger history and diagnostics.
- Updated the automation catalog test to reflect that Facebook Messenger keyword automation is supported, while Facebook comment triggers remain unavailable.
- Added router tests for duplicate event suppression, sequence enrollment and outbound history, and Meta delivery failure recording.

## Verification

- `npm run db:generate`: passed.
- `npx prisma validate`: passed.
- `npm test -- --reporter=dot`: 23 files, 172 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed with the existing two unused-import warnings in `app/api/workspace/members/route.ts`.
- `npm run build -- --webpack`: passed. Initial sandbox build could not write `.next`; rerun with workspace write permission completed successfully.
- `git diff --check`: passed (Git reports the expected LF-to-CRLF working-copy warning for the edited test).

## Remaining

- Messenger sequence enrollments are persisted but the existing sequence worker still processes Instagram-only enrollment records. Messenger follow-up step delivery, quick-reply routing, cancellation on reply, and time-window expiry need a separate provider-aware worker implementation before multi-step Messenger sequences execute.
- The immediate keyword reply and workflow enrollment currently happen in the synchronous webhook request. Move work to a durable queue with retry/observability before production scale.
- Messenger events still do not share the Instagram Contact/Inbox event model; unified channel inbox and contact profile work remains open.
- OAuth callback currently connects every discovered Page immediately; preview/select-before-connect, individual webhook diagnostics, and Page-level refresh metadata remain open.
- No database migration was applied to a live database, no real authorized Page/contact was available for end-to-end verification, and no EasyPanel deployment or production URL verification was done.
- No commit or push was made.

This checkpoint is a backend routing milestone, not completion of the broader multichannel automation plan.
