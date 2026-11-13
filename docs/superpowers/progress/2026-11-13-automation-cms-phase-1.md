# OpenReply / ManyChat parity progress — Phase 1

Updated: 2026-11-13 (America/Los_Angeles)

## Repository state

- Repository: `mro-realtor/openreply`
- Branch: `codex/sequence-quick-reply-routing`
- Base for the restored branch: `e54df45a2ce3783b792f365a758b4d323d748727` (PR #21 remains open/draft).
- Phase 1 code is committed and pushed to draft PR #21. Latest branch head is `0bc4e26692b900833e1261daeef75368dd86cbd4` (`docs: checkpoint automation CMS phase 1`), following feature commit `a9169bd`. No migration, merge, live provider send, or production deployment was performed.
- This checkout was cloned into the writable project root as `openreply/`; the sibling `mro-crm/` repository and `sources/` mirror were left untouched.

## Completed this continuation

- Recovered the ManyChat reference state from the attached Chrome session without reloading its stale builder tab or changing any reference data.
- Expanded the reference inventory for My Automations, New Automation templates, Basic Automations, Sequences, navigation, and plan-gated behaviors; see the project-root `openreply-parity-checklist.md`.
- Added the phase design and plan: `docs/superpowers/specs/2026-11-13-manychat-automation-cms-design.md` and `docs/superpowers/plans/2026-11-13-automation-cms-phase-1.md`.
- Replaced `/automations` and `/automations/new` redirects with an Automation workspace and chooser-open route.
- Added ManyChat-like Automation/Basic/Sequences tabs, a typed Instagram/Facebook template catalog and chooser, supported/disabled capability states, and per-account Basic Automation status cards.
- Added compact global navigation, retained OpenReply tools/URLs, and marked unsupported Contacts/AI Automation/Broadcasts as coming later.
- Reused campaign data and APIs, added account/status/search/trigger filters and list/grid options, and preserved existing campaign actions and sequence editing.
- Final review fixes: chooser now uses native `<dialog>.showModal()` focus containment and background inertness; Facebook cannot route through the Instagram Start From Scratch link; Post comment filters exclude DM-only trigger records; Basic distinguishes failed loads from successful empty results and offers retry; desktop rail remains compact after resizing from mobile; Sequences highlights Automation.
- Extracted the campaigns page logic into reusable `components/campaign-list.tsx` after the Next.js route type checker caught that route page components cannot accept the `workspaceMode` prop.
- No database schema changes in this slice.

## Verification

- Focused automation catalog/trigger/basic-account tests currently pass (7 tests); RED observed before adding the catalog, route filter, account result parser, and channel helper.
- `npm run typecheck`: passed after `npm run db:generate` (Prisma client 7.8.0).
- `npm run lint`: passed with two existing warnings in `app/api/workspace/members/route.ts` (`generateInvitationToken`, `getInvitationExpiry` unused).
- `npm test`: 22 test files, 167 tests passed after review fixes.
- `npm run typecheck`: passed after review fixes.
- `npm run lint`: passed with the same two pre-existing unused-import warnings in `app/api/workspace/members/route.ts`.
- `npm run build -- --webpack`: passed after review fixes; build includes `/automations`, `/automations/basic`, and `/automations/new`.
- `git diff --check`: passed; only CRLF-normalization warnings on changed route files.
- Standard Turbopack build stalled on this environment. Webpack build is the supported Next.js 16 alternative and completed.
- Visual browser verification is still pending. A temporary local preview route was added and removed; attached Chrome could not reach the local dev server (`ERR_CONNECTION_TIMED_OUT`). Vercel lookup found no project/deployment for this repository, and production remains the older deployed build. Do not claim the new UI was visually verified until an authenticated preview is available.

## ManyChat recon and CMS visual correction — 2026-11-13

- Re-opened the user’s exact `/cms?path=/&field=modified&order=desc` reference in attached Chrome. The automation library is a dense centered table with Name, Runs, CTR, and Modified columns; compact global icon rail; clear draft/live status; top-right New Automation; search and trigger/state filters; New Folder and Trash controls; and a list/grid toggle.
- Read-only inspection of New Automation confirmed a centered Templates modal, channel tabs, left goal and trigger filters, search, Recommended and Discover more sections, Quick Automation vs Flow Builder badges, Popular / Upgrade / AI labels, plus Start From Scratch. No template was installed and no reference data was changed.
- CMS correction now uses a ManyChat-blue accent, a responsive table library with accurate Active/Paused status, run/CTR/modified values, account and trigger context, and preserves edit, activate/pause, duplicate, and delete actions. The cards remain available in grid mode. Folder and Trash remain explicitly disabled because campaign persistence has no folder or recoverable archive model; no fake controls were wired.
- Verification after this correction: `npm run typecheck` passed; `npm run lint` passed with the same two pre-existing unused imports; `npm test -- --reporter=dot` passed all 167 tests; `npm run build -- --webpack` passed after retrying with authorized workspace build-output access; `git diff --check` passed. Attached Chrome still cannot reach the local server, and no hosted Vercel preview exists, so local visual behavior is not yet browser-verified.

## Remaining in Phase 1

- Browser-verify the new table and chooser at desktop/mobile widths using an authenticated PR preview; the local browser cannot reach the local server and repository discovery found no Vercel project.
- Complete authenticated desktop/mobile visual verification of the library, chooser, Basic tab, filters, and existing sequence route.
- The Node-only Vitest configuration does not cover dialog focus, routing clicks, or responsive drawer behavior.
- Add durable folder and recoverable-trash support to the data model/API; current controls are disabled, consistent with their lack of persistence semantics.
- Continue full ManyChat parity after the CMS milestone: reusable trigger model, account-level working defaults, message/action variants, graph conditions/random splits/timeouts/fallbacks, published revisions, broader Inbox/contact/broadcast/settings/channel support.

## Next action

Finish Phase 1 visual verification when a safe authenticated preview is available, and checkpoint the current visual correction. Then implement durable folders/trash, reusable triggers, account-level supported defaults, full flow builder configuration/actions/logic/revisions, and remaining workspace surfaces while preserving stable-ID routes and legacy sequence JSON. This remains a partial CMS milestone, not full ManyChat parity.
