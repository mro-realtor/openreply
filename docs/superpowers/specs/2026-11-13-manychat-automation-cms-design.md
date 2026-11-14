# ManyChat Automation CMS parity design

## Intent

OpenReply should reproduce the useful setup experience, navigation, and automation capabilities observed in the user’s ManyChat account, while preserving OpenReply’s existing data and provider integrations. Success means the dashboard opens into a recognizable automation workspace, users can discover and create supported automations through the same clear entry points, and the workflow editor grows into a complete connected-node builder with accurate channel behavior.

## Evidence and current state

- The reference inspection on 2026-11-13 covered the Automation CMS, automation template chooser, Basic Automations, Sequences, and one saved draft flow. The account was on the Free plan, so paid AI/condition/randomizer/smart-delay details could not be observed. ManyChat state was not edited or published.
- The CMS exposes a global app sidebar (Home, Contacts, Automation, Manychat AI, Inbox, Broadcasts, Settings), Automation subtabs (My Automations, Basic, Sequences), a trigger/state-filtered automation list, list/grid modes, folders, trash, New Automation, and performance columns.
- New Automation opens a channel-aware template chooser. Instagram and Facebook have different goal/trigger categories; templates are grouped as quick automations or Flow Builder templates, with recommendations and upgrade labels.
- Basic Automations are configured per connected social account and include account-level defaults and entry points such as Conversation Starters, Story Mention Reply, Default Reply, Main Menu, and welcome behavior.
- The flow editor has a trigger entry card, message/action cards, configurable left panel, labeled route connectors, test/preview, live/publish controls, undo/redo, version history, auto-arrange, zoom/minimap/help, and a basic-builder option.
- OpenReply currently has a `/automations` redirect to `/campaigns`, a text-only dashboard sidebar, a campaign list and builder, and a separate sequence list/builder. The database currently models campaigns and sequences, not a general automation library or reusable trigger records. Quick-reply routing is implemented on draft PR #21 and must be retained.

## Goals

1. Match the information architecture and visual hierarchy of ManyChat’s automation workspace.
2. Make automation creation discoverable through channel selection, supported templates, and start-from-scratch entry points.
3. Preserve existing campaign, sequence, Inbox, and route persistence semantics as the UI grows.
4. Evolve toward reusable triggers, multiple channel-aware entry points, richer message/action/condition nodes, and true graph-based execution.
5. Make unsupported or plan/provider-limited controls clear, with accessible disabled states and accurate explanations.
6. Maintain durable checkpoints and verify each independent product slice with tests and visual review.

## Non-goals and anti-goals

- Do not edit or publish the user’s ManyChat automations.
- Do not send unsolicited live messages or change production workflows during UI work.
- Do not copy ManyChat trademarks, illustrations, or proprietary source assets; match layout, interaction patterns, and familiar terminology using OpenReply branding.
- Do not claim parity for channels, triggers, or actions that OpenReply cannot execute safely.
- Do not replace persisted campaigns/sequences wholesale or invalidate legacy sequence JSON.

## Approaches considered

1. **Incremental CMS over existing models (chosen).** Build the ManyChat-like shell, library, and creation entry points over existing campaign and sequence APIs, then add general trigger/node models in separately testable milestones. This delivers an immediate visual improvement and protects live data, though some library behavior remains campaign/sequence-backed initially.
2. **Replace the automation domain model first.** Introduce a general automation, trigger, and graph schema before changing the UI. This is structurally clean but delays the visible improvement and creates a large migration/release risk while existing execution only supports a subset of nodes.
3. **Rebrand the existing campaign screen only.** Change labels and colors without building the CMS surfaces. This is cheap but would not meet the user’s requested experience or setup flow.

## Architecture and implementation phases

### Phase 1: CMS shell and creation entry points

- Restore `/automations` as a real authenticated page.
- Present app-level navigation and automation subtabs consistent with ManyChat: Home, Contacts (unavailable), Automation, AI Automation (unavailable), Inbox, Broadcasts (unavailable), and Settings. Keep OpenReply’s Overview, Sequences, DM Logs, Diagnostics, and campaign routes accessible as nested/secondary destinations; visibly mark absent features as unavailable instead of linking to fake pages.
- Use the ManyChat CMS composition: persistent narrow global navigation rail, active Automation state, Automation header, My Automations/Basic/Sequences tabs, and a main library toolbar/list; collapse the rail accessibly on narrow screens.
- Build a searchable/filterable list over existing campaign data, with explicit Active/Paused labels (campaigns expose only `isActive`; do not call Active “published” or synthesize Draft), supported channel/trigger labels, and clear create actions. Do not invent a persisted draft where the campaign API does not support one.
- Make both `/automations` and `/automations/new` valid CMS surfaces; the latter opens the same chooser without creating a record.
- Add an Instagram/Facebook template chooser that lists only supported OpenReply templates/actions, distinguishes Quick Setup from Flow Builder, and routes supported Instagram comment templates into the existing campaign builder and Sequence creation into the existing sequence flow. Keep Facebook, story, AI, and unsupported message types informational and disabled unless their execution path exists.
- Render Basic sections per connected account and identify the observed Conversation Starters, Story Mention Reply, Default Reply, and Main Menu capabilities; label the welcome action unavailable until supported. Do not fabricate setup flows for controls that cannot execute.
- Keep Sequences as a first-class tab and preserve its existing editing/scheduling route.

### Phase 2: Reusable trigger and Basic Automations model

- Add standalone trigger records and association to automations, preserving stable IDs and backward compatibility with campaign-backed triggers.
- Add account-level setup for supported defaults (for example, Instagram DM default reply) only where Meta access and execution are implemented.
- Add Facebook/Messenger support through the existing provider APIs and settings, with per-channel validation.

### Phase 3: Workflow builder parity

- Extend the existing graph canvas with grouped add-node menus, node-specific left configuration panels, dynamic stable-ID connections, drag/drop, pan/zoom, auto-arrange, keyboard-accessible controls, undo/redo, and persisted positions/routes.
- Support message variants (text, image, file, cards/gallery, buttons/quick replies), actions, delays, user-data collection, conditions, random splits, and fallbacks with a shared typed graph schema.
- Make Preview and Test execute the same resolver as the worker; add draft/published revisions and safe activation controls.

### Phase 4: Workspace parity

- Bring Inbox operations, contact profiles/segments, broadcasts, account/settings, analytics, folders/trash, and additional channel providers to equivalent discoverability and behavior.
- Prioritize provider compliance, permissions, opt-in, and send-window constraints before enabling delivery.

## Constraints and rollout

- Build on the existing Next.js 16, React 19, Prisma/Postgres, and Tailwind stack; follow the installed Next.js 16 repository docs.
- Keep stable step/route IDs and old sequence JSON readable.
- Add additive migrations only when the later domain phases require them. Review migration and target before production rollout.
- Validate locally and in preview first. Production deployment and any live-provider behavior require isolated test data/recipient and the existing deployment safeguards.

## Phase 1 acceptance

- `/automations` renders the authenticated Automation workspace and `/automations/new` opens its chooser rather than redirecting to the campaign form.
- The persistent global navigation visibly marks the active Automation section on automation, campaign, and sequence routes; Inbox, Settings, Overview, Sequences, Campaigns, DM Logs, and Diagnostics still open their existing routes. Contacts, AI Automation, and Broadcasts are clearly unavailable, not dead links.
- Automation tabs navigate among My Automations, Basic, and Sequences; Basic shows each connected account and clearly distinguishes current supported controls from unavailable capabilities.
- Search plus Active/Paused and supported trigger/channel filters produce accurate results from existing API data; campaigns are not mislabeled as Draft or Live.
- New Automation opens an Instagram/Facebook chooser with supported Instagram-comment setup and a visible start-from-scratch route that does not silently create or publish data. Unsupported channel/trigger templates are visibly disabled with a clear reason.
- Existing campaign editing/toggle/delete and sequence editing still work.
- Keyboard access, responsive layout, typecheck, lint, test suite, and production build pass; visually verify the library and chooser in a browser.

## Calls left to implementation

- Exact icon set and responsive menu behavior, using existing dependencies and components.
- Which existing campaign/sequence form a supported template card should open; use accurate channel/trigger capability and do not create placeholder automations.
- Keep the broader phase roadmap active and checkpoint each phase separately.
