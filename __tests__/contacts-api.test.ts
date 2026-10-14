import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ISSUABLE_SCOPES, hasScope } from "@/lib/api/scopes";
import type { ApiContext, Db } from "@/lib/api/types";
import { deriveFollowUpState, toContactView } from "@/lib/contacts/manage";
import { DM_PERMISSION_LABEL, FOLLOW_UP_LABEL } from "@/lib/contacts/labels";
import { createMcpServer } from "@/lib/mcp/server";
import { toApiContact } from "@/lib/services/contacts";

const T0 = new Date("2026-10-01T10:00:00Z");

function row(over: Record<string, unknown> = {}) {
  return {
    id: "c1",
    displayName: "Pat",
    status: "ACTIVE",
    optedOutAt: null,
    humanTakeoverAt: null,
    lastDmSentAt: null,
    firstSeenAt: T0,
    lastSeenAt: T0,
    createdAt: T0,
    consentStatus: "UNKNOWN",
    consentUpdatedAt: null,
    consentSource: null,
    assignedToUserId: null,
    assignedAt: null,
    identities: [{ id: "i1", platform: "INSTAGRAM", externalId: "1784", handle: "pat" }],
    ...over,
  };
}

describe("contacts:read scope", () => {
  it("is issuable, and the reserved leads:read scope is still not", () => {
    expect(ISSUABLE_SCOPES).toContain("contacts:read");
    expect(ISSUABLE_SCOPES).not.toContain("leads:read");
  });

  it("is not implied by read or drafts:write", () => {
    expect(hasScope(["read", "drafts:write"], "contacts:read")).toBe(false);
    expect(hasScope(["contacts:read"], "contacts:read")).toBe(true);
  });
});

describe("follow up state", () => {
  const base = { status: "ACTIVE", humanTakeoverAt: null, assignedToUserId: null };
  it("is derived with opt-out first, then a person handling, then assignment", () => {
    expect(deriveFollowUpState(base)).toBe("UNASSIGNED");
    expect(deriveFollowUpState({ ...base, assignedToUserId: "u1" })).toBe("ASSIGNED");
    expect(deriveFollowUpState({ ...base, assignedToUserId: "u1", humanTakeoverAt: T0 })).toBe("HUMAN_TAKEOVER");
    expect(deriveFollowUpState({ ...base, status: "OPTED_OUT", humanTakeoverAt: T0, assignedToUserId: "u1" })).toBe("OPTED_OUT");
  });
  it("has a plain label for every state", () => {
    for (const s of ["UNASSIGNED", "ASSIGNED", "HUMAN_TAKEOVER", "OPTED_OUT"]) expect(FOLLOW_UP_LABEL[s]).toBeTruthy();
    for (const s of ["UNKNOWN", "GRANTED", "WITHDRAWN"]) expect(DM_PERMISSION_LABEL[s]).toBeTruthy();
  });
});

describe("API contact shape", () => {
  it("keeps Instagram DM consent separate and never implies SMS or voice consent", () => {
    const dto = toApiContact(toContactView(row({ consentStatus: "GRANTED", consentSource: "dm_reply", consentUpdatedAt: T0 })));
    expect(dto.consent.instagramDm).toEqual({ status: "GRANTED", updatedAt: T0.toISOString(), source: "dm_reply" });
    expect(dto.consent.sms).toEqual({ status: "NOT_TRACKED" });
    expect(dto.consent.voice).toEqual({ status: "NOT_TRACKED" });
  });

  it("scopes opt-out to the Instagram DM channel", () => {
    const dto = toApiContact(toContactView(row({ status: "OPTED_OUT", optedOutAt: T0 })));
    expect(dto.optOut).toEqual({ optedOut: true, at: T0.toISOString(), channel: "instagram_dm" });
    expect(dto.followUpState).toBe("OPTED_OUT");
  });

  it("exposes stable ids and linked identities, with the platform id kept as data", () => {
    const dto = toApiContact(toContactView(row()));
    expect(dto.id).toBe("c1");
    expect(dto.identities).toEqual([{ id: "i1", platform: "INSTAGRAM", externalId: "1784", handle: "pat" }]);
  });

  it("carries no workspace id, token or message text", () => {
    const text = JSON.stringify(toApiContact(toContactView(row({ workspaceId: "ws-secret", accessToken: "tok" }))));
    expect(text).not.toMatch(/ws-secret|accessToken|tok"|commentText/);
  });
});

function fakeDb() {
  const findMany = vi.fn().mockResolvedValue([row()]);
  const findFirst = vi.fn().mockResolvedValue(null);
  const db = {
    contact: { findMany, findFirst },
    contactConsentEvent: { findMany: vi.fn().mockResolvedValue([]) },
    dmLog: { findMany: vi.fn().mockResolvedValue([]) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  } as unknown as Db;
  return { db, findMany, findFirst };
}

async function connect(scopes: string[]) {
  const f = fakeDb();
  const ctx: ApiContext = { workspaceId: "ws1", tokenId: "t1", tokenName: "test", scopes, createdByUserId: "u1" };
  const server = createMcpServer(f.db, ctx);
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, ...f };
}

const bodyOf = (r: unknown) => JSON.parse(((r as { content: { text: string }[] }).content)[0].text);

describe("contacts MCP tools", () => {
  it("are hidden without contacts:read", async () => {
    const { client } = await connect(["read", "drafts:write"]);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names.some((n) => n.includes("contact"))).toBe(false);
  });

  it("are three read-only tools with contacts:read", async () => {
    const { client } = await connect(["contacts:read"]);
    const tools = (await client.listTools()).tools;
    expect(tools.map((t) => t.name).sort()).toEqual(["get_contact", "list_contact_history", "list_contacts"]);
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint).toBe(true);
      expect(t.inputSchema.additionalProperties).toBe(false);
    }
  });

  it("cannot be pointed at another workspace through the arguments", async () => {
    const { client, findMany } = await connect(["contacts:read"]);
    const res = await client.callTool({ name: "list_contacts", arguments: { workspaceId: "other-ws" } });
    expect(res.isError).toBe(true);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("always queries with the token's own workspace", async () => {
    const { client, findMany } = await connect(["contacts:read"]);
    const res = await client.callTool({ name: "list_contacts", arguments: { q: "pat" } });
    expect(res.isError).toBeFalsy();
    expect(findMany.mock.calls[0][0].where.workspaceId).toBe("ws1");
    expect(bodyOf(res).items[0].consent.sms.status).toBe("NOT_TRACKED");
  });

  it("answers 404 for a contact that is not in the workspace", async () => {
    const { client, findFirst } = await connect(["contacts:read"]);
    const res = await client.callTool({ name: "get_contact", arguments: { contactId: "someone-elses" } });
    expect(res.isError).toBe(true);
    expect(bodyOf(res).error.code).toBe("NOT_FOUND");
    expect(findFirst.mock.calls[0][0].where).toEqual({ id: "someone-elses", workspaceId: "ws1" });
  });

  it("rejects a malformed identity lookup before touching the database", async () => {
    const { client, findMany } = await connect(["contacts:read"]);
    for (const identity of ["1784", "TIKTOK:1", "INSTAGRAM:", ":1"]) {
      const res = await client.callTool({ name: "list_contacts", arguments: { identity } });
      expect(res.isError).toBe(true);
      expect(bodyOf(res).error.code).toBe("VALIDATION_FAILED");
    }
    expect(findMany).not.toHaveBeenCalled();
  });
});
