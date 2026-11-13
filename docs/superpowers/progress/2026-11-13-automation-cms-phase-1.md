# OpenReply / ManyChat parity progress — Phase 1

Updated: 2026-11-13 (America/Los_Angeles)

## Repository state

- Repository: `mro-realtor/openreply`
- Branch: `codex/sequence-quick-reply-routing`
- Base PR branch head restored from GitHub: `e54df45a2ce3783b792f365a758b4d323d748727` (PR #21 remains open/draft).
- Phase 1 code is committed locally at `a9169bd` (`feat: add ManyChat-style automation CMS shell`). This checkpoint has not yet been pushed. No migration, merge, live provider send, or deployment was performed.
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
- Visual browser verification is still pending. There is no local authenticated session or preview deployment for this checkout; the production browser tab is the older deployed build. Do not claim the new UI was visually verified until preview access is available.

## Remaining in Phase 1

- Re-run the full test suite and webpack production build after the final code edits.
- Complete authenticated desktop/mobile visual verification of the library, chooser, Basic tab, filters, and existing sequence route.
- The Node-only Vitest configuration does not cover dialog focus, routing clicks, or responsive drawer behavior.
- Push the reviewed checkpoint to the existing draft PR branch to obtain CI/preview, then visually verify the authenticated UI before deciding whether any deployment is appropriate.
- Continue full ManyChat parity after the CMS milestone: reusable trigger model, account-level working defaults, message/action variants, graph conditions/random splits/timeouts/fallbacks, published revisions, broader Inbox/contact/broadcast/settings/channel support.

## Next action

Finish Phase 1 verification and checkpoint its commit. Then proceed with a separate reusable-trigger/data-model milestone while preserving stable-ID routes and legacy sequence JSON. A close visual shell does not mean full ManyChat functional parity.
