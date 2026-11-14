# Automation CMS Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/automations` redirect with an authenticated ManyChat-like CMS that organizes supported OpenReply campaigns and sequences and makes creation capabilities clear.

**Architecture:** Reuse the existing campaign/sequence domain and APIs. Add a channel-aware capability catalog, a reusable automation shell (tabs, chooser, basic capability cards), and keep unsupported actions read-only/disabled. Do not add DB schema or alter provider execution in this phase.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS, Vitest.

**Spec:** [2026-11-13-manychat-automation-cms-design.md](../specs/2026-11-13-manychat-automation-cms-design.md)

## Global Constraints

- Keep existing campaign and sequence APIs, records, routes, and stable-ID routing behavior intact.
- Existing campaign `isActive` values map only to Active/Paused; do not invent Draft/Live or published revisions.
- Only expose clickable setup for capabilities that the current execution path supports.
- Preserve access to Overview, Inbox, Campaigns, Sequences, DM Logs, Settings, and Diagnostics.
- ManyChat remains reference-only; no edit/publish actions there and no production provider sends here.

## Review Focus

- Campaign loading/error/empty state: show accurate counts, search results, and no fabricated status.
- Multiple connected Instagram accounts: account filtering remains available and correctly scopes results.
- Unsupported channel/template: it must be disabled with a reason and cannot create records.
- Direct `/automations/new`: it must show the chooser; cancel returns to the CMS.
- Narrow viewport and keyboard use: navigation, tabs, and modal remain reachable and labeled.

---

### Task 1: Capability catalog and automated coverage

**Files:**
- Create: `lib/automation-catalog.ts`
- Test: `__tests__/automation-catalog.test.ts`

**Interfaces:**
- Produces exported `automationTemplates` metadata with channel, category, mode, supported state, disabled reason, and supported destination.
- Consumes no DB data; no runtime side effects.

- [x] **Step 1: Write failing catalog tests** named `allows Instagram comment setup through the existing campaign builder` and `keeps unsupported Facebook and AI templates disabled without destinations`. Assert the supported destination is `/campaigns/new` and unsupported items are not navigable. Added RED→GREEN coverage that scratch creation is disabled on Facebook.
- [x] **Step 2: Run the focused Vitest test and confirm the missing catalog causes the expected failure.**
- [x] **Step 3: Implement the smallest typed catalog** for supported Instagram comment-to-DM setup, supported sequence creation entry, and disabled Facebook/story/AI placeholders.
- [x] **Step 4: Run the focused test and confirm it passes.** Added a third RED→GREEN filtering test covering channel + goal + trigger + search together.

### Task 2: Global navigation and titles

**Files:**
- Modify: `components/sidebar.tsx`
- Modify: `components/top-bar.tsx`
- Test: manual/browser check in Phase 1 verification

**Interfaces:**
- Existing `SidebarProps` and `TopBarProps` remain unchanged.

- [x] **Step 1: Implement ManyChat-like global navigation** with Home, Automation, Inbox, Settings and visibly disabled Contacts, AI Automation, Broadcasts; retain a secondary OpenReply utility group for Overview, Campaigns, Sequences, DM Logs, Diagnostics.
- [x] **Step 2: Update active state** so `/automations/*`, `/campaigns/*`, and `/sequences/*` mark Automation; keep compact desktop labels independent of mobile drawer state and preserve `aria-current`.
- [x] **Step 3: Update page titles** for Automation CMS, Basic, Sequences, and existing routes.
- [ ] **Step 4: Run typecheck/lint and inspect desktop/mobile navigation.** Typecheck/lint pass; visual browser inspection is pending authenticated preview access.

### Task 3: Automation tabs, library frame, and chooser

**Files:**
- Create: `components/automation-tabs.tsx`
- Create: `components/automation-template-chooser.tsx`
- Create: `components/automation-workspace.tsx`
- Modify: `app/(dashboard)/automations/page.tsx`
- Modify: `app/(dashboard)/automations/new/page.tsx`
- Modify: `app/(dashboard)/campaigns/page.tsx`
- Test: browser flows `/automations`, `/automations/new`, chooser close/destination

**Interfaces:**
- `AutomationWorkspace({ initialChooserOpen?: boolean })` controls the CMS heading/tabs/create dialog and embeds the existing campaign list in `workspaceMode`.
- `CampaignsPage({ workspaceMode?: boolean })` preserves current default behavior at `/campaigns`; workspace mode removes duplicate create actions and labels the data as automations.
- `AutomationTemplateChooser({ open, onClose })` reads only the capability catalog; it never creates data until a supported destination is chosen.

- [x] **Step 1: Add catalog-backed chooser tests** verifying supported Instagram destination, disabled capabilities, combined search/filter logic, and scratch-builder channel capability.
- [x] **Step 2: Run focused tests and confirm they fail for the missing catalog behavior.** The catalog import failed before implementation; filter and channel-capability tests also failed before their helpers were added. Modal close/focus and route interactions remain browser-verification items.
- [x] **Step 3: Implement accessible native modal dialog** with focus containment/background inertness, Instagram/Facebook tabs, goal/trigger filters, Recommended cards, Quick Setup/Flow Builder labels, disabled reasons, Search field, and Start From Scratch route only for the supported Instagram campaign builder.
- [x] **Step 4: Replace `/automations` redirect with CMS page** and route `/automations/new` to the chooser-open variant; preserve `/campaigns` direct behavior.
- [x] **Step 5: Add My Automations/Basic/Sequences tabs** and integrate the current campaigns list while retaining its account/status/search behavior and existing actions.
- [x] **Step 6: Run focused test, typecheck, and lint.**

### Task 4: Basic Automations capability view and sequence tab

**Files:**
- Create: `app/(dashboard)/automations/basic/page.tsx`
- Modify: `app/(dashboard)/sequences/page.tsx`
- Test: browser navigation and account-state display

**Interfaces:**
- Basic page uses authenticated dashboard data for connected Instagram accounts; if accounts are loaded client-side, use the existing `/api/dashboard/stats` response.
- No new provider setup writes are introduced.

- [x] **Step 1: Add Basic view** grouped by connected account with observed categories (Conversation Starters, Story Mention Reply, Default Reply, Main Menu) and honest unsupported/unavailable labels. Loading errors are distinct from a successful empty account response and expose retry.
- [x] **Step 2: Add the common automation tabs** to the existing Sequences library without changing its create/edit/schedule flows.
- [ ] **Step 3: Manually verify no account state shows a useful connect prompt and each tab stays in the authenticated dashboard.** Pending authenticated preview/local session.

### Task 5: Full verification and durable checkpoint

**Files:**
- Modify: `../openreply-parity-checklist.md`
- Verify: OpenReply application in preview/local browser

- [x] **Step 1: Run `npm run typecheck`, `npm run lint`, and `npm test`.** Typecheck passes; lint has two pre-existing unused-import warnings; full suite passes 167 tests.
- [x] **Step 2: Run `npm run build` after the locked dependencies and required Next.js documentation are available.** `npm run build -- --webpack` passes after review fixes.
- [ ] **Step 3: Verify shell and chooser visually** at desktop and mobile widths; exercise tabs, search, filters, account selector, template buttons, close/back, and existing campaign/sequence entry. Pending authenticated preview/local session.
- [x] **Step 4: Update the parity checklist** with exact files/commits/tests and remaining phases; do not merge or deploy as part of this UI milestone.

## Self-review

- Phase 1 surface requirements all map to Tasks 1–5. Trigger domain, advanced node palette, Facebook delivery, revisions, Inbox parity, contacts, broadcasts, and account-level writes remain separate follow-on phases in the spec.
- Campaign statuses and account behavior are grounded in existing API/schema; no migration or new provider behavior is planned.
- Main uncovered risks are Next.js 16 conventions, CSS regressions from global navigation, provider access requirements, and incomplete UI test support. Browser verification covers the visual/interaction cases that Vitest’s current Node-only setup cannot render.
