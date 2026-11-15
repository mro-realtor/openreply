# Multichannel Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make OpenReply automations support Instagram and connected Facebook Pages in one ManyChat-style flow builder, with channel-aware triggers, actions, routing, and delivery.

**Architecture:** Keep the existing Instagram campaign model working, add a channel-neutral workflow layer for new automations, and adapt Messenger Pages as selectable delivery accounts. The builder will expose a single canvas/sidebar experience while validating channel-specific capabilities before publishing.

**Tech Stack:** Next.js App Router, React, Prisma/Postgres, Zod, existing Meta Graph clients, BullMQ worker.

## Global Constraints

- Preserve existing Instagram campaigns and sequence JSON compatibility.
- Facebook delivery must enforce Meta Messenger permissions and the 24-hour response window.
- Every workflow node and route uses stable IDs.
- OAuth discovery remains the only user-facing Facebook connection path; manual token entry stays hidden.

## Review Focus

- A workflow targeting multiple channels must never send an Instagram payload through Messenger or vice versa.
- Removing a connected Page must disable its workflow targets without deleting unrelated Instagram data.
- A Facebook webhook event must enter the same contact/inbox and automation routing pipeline as Instagram.
- Unsupported blocks must be rejected at publish time with an actionable message.
- Existing campaigns must load and run unchanged after the schema migration.

### Task 1: Channel-neutral workflow data model

**Files:** `prisma/schema.prisma`, new migration, `lib/workflows/*`.

- Add workflow, workflow-node, workflow-edge, and workflow-target entities with channel/target IDs and stable node IDs.
- Add Zod schemas for triggers, actions, conditions, delays, media, buttons, and handoff actions.
- Add an adapter that converts existing Instagram sequences into workflow nodes without changing stored legacy JSON.
- Test migration/read compatibility and invalid cross-channel targets.

### Task 2: Unified trigger ingestion

**Files:** `lib/meta/webhook.ts`, Messenger webhook route, `lib/workflows/router.ts`, queue jobs.

- Normalize Instagram DM/comment and Facebook Messenger message events into one inbound event shape.
- Route by target account, trigger type, keyword/condition, and active workflow priority.
- Persist contacts and conversation events with channel metadata.
- Add tests for keyword, default reply, button/postback, and duplicate-event handling.

### Task 3: Channel-aware delivery adapters

**Files:** `lib/meta/client.ts`, new `lib/meta/messenger-client.ts`, worker delivery code.

- Implement text, quick reply, URL button, attachment, delay, tag/field update, and human handoff actions.
- Enforce capability validation: Messenger Page tokens for Facebook nodes, Instagram tokens for Instagram nodes.
- Record outbound events and delivery errors consistently.
- Add unit tests for payload shape and 24-hour policy failures.

### Task 4: ManyChat-style builder parity

**Files:** `components/sequence-flow-builder.tsx`, new node sidebar/config components, workflow API routes.

- Add channel selector and target selector to the left configuration panel.
- Add trigger cards, message cards, buttons, quick replies, media upload, delay, condition, randomizer, action, AI handoff, and existing-step routing.
- Support drag/drop node placement, edge rewiring, zoom/auto-arrange, undo/redo, preview, and publish validation.
- Hide unavailable blocks instead of rendering “coming later”.

### Task 5: Contacts and Inbox unification

**Files:** contacts/inbox routes and components.

- Show Facebook and Instagram contacts in the same contact profile with channel badges, tags, custom fields, sequences, and conversation history.
- Make read/unread, assignment, pause automation, and handoff actions persistent.

### Task 6: Verification and deployment

- Run typecheck, unit tests, Prisma validation, and browser smoke tests for both channels.
- Verify OAuth discovery, individual Page disconnect, webhook receipt, workflow publish, and outbound test message.
- Deploy through EasyPanel and record the production commit/deployment.
