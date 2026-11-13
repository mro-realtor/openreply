import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "@/lib/mcp/server";
import type { ApiContext, Db } from "@/lib/api/types";

const NOW = new Date("2026-10-14T00:00:00Z");

function campaignRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1", name: "NOR | Historia Primera Casa | CASA", goal: null, isActive: false, isDraft: true,
    postId: null, postUrl: null, matchAnyPost: false, pendingNextReel: false, keywords: ["CASA"],
    matchAnyWord: false, wholeWordMatch: true, dmTriggerEnabled: false, dmMessage: "Hola!",
    openingDmEnabled: false, openingDmMessage: null, openingDmButtonLabel: null, linkButtonLabel: null,
    requireFollow: false, followPromptMessage: null, followPromptButtonLabel: null,
    followUpEnabled: false, followUpMessage: null, followUpDelayMinutes: 0,
    publicReplyEnabled: false, publicReplyMessages: [], draftConfig: null,
    createdAt: NOW, updatedAt: NOW,
    instagramAccount: { id: "a1", username: "mro.realtor" }, trackedLinks: [],
    ...overrides,
  };
}

function fakeDb() {
  const automationCreate = vi.fn().mockResolvedValue(campaignRow());
  const audit = vi.fn().mockResolvedValue({});
  const db = {
    instagramAccount: {
      findFirst: vi.fn().mockResolvedValue({ id: "a1" }),
      findMany: vi.fn().mockResolvedValue([
        {
          id: "a1", instagramId: "17841", username: "mro.realtor", name: "MRO", connectedAt: NOW,
          tokenExpiresAt: new Date(NOW.getTime() + 40 * 86_400_000), webhookSubscribed: true,
          _count: { automations: 2 },
          // a leaked secret on the row must never reach the client
          accessToken: "SHOULD-NEVER-APPEAR",
        },
      ]),
    },
    automation: { create: automationCreate, findMany: vi.fn().mockResolvedValue([campaignRow()]) },
    auditLog: { create: audit },
    idempotencyKey: {
      create: vi.fn().mockResolvedValue({ id: "k1" }),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
    },
  } as unknown as Db;
  return { db, automationCreate, audit };
}

async function connect(scopes: string[]) {
  const { db, automationCreate, audit } = fakeDb();
  const ctx: ApiContext = { workspaceId: "ws1", tokenId: "t1", tokenName: "test", scopes, createdByUserId: "u1" };
  const server = createMcpServer(db, ctx);
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, automationCreate, audit };
}

const text = (r: unknown) =>
  ((r as { content: { text: string }[] }).content)[0].text;

describe("MCP server", () => {
  it("shows a read-only token only the read tools", async () => {
    const { client } = await connect(["read"]);
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["get_account", "get_campaign", "list_accounts", "list_campaign_logs", "list_campaigns"]);
  });

  it("adds the draft tools only with drafts:write, and never a send, delete or activate tool", async () => {
    const { client } = await connect(["read", "drafts:write"]);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("create_draft_campaign");
    expect(names).toContain("update_draft_campaign");
    for (const forbidden of ["send", "delete", "activate", "sql", "shell", "secret", "token"]) {
      expect(names.some((n) => n.includes(forbidden))).toBe(false);
    }
  });

  it("marks read tools read-only and exposes no isActive input on create", async () => {
    const { client } = await connect(["read", "drafts:write"]);
    const tools = (await client.listTools()).tools;
    expect(tools.find((t) => t.name === "list_campaigns")?.annotations?.readOnlyHint).toBe(true);
    const create = tools.find((t) => t.name === "create_draft_campaign")!;
    expect(Object.keys(create.inputSchema.properties ?? {})).not.toContain("isActive");
    expect(create.inputSchema.additionalProperties).toBe(false);
  });

  it("lists accounts without ever returning credentials", async () => {
    const { client } = await connect(["read"]);
    const result = await client.callTool({ name: "list_accounts", arguments: {} });
    const body = text(result);
    expect(body).toContain("mro.realtor");
    expect(body).toContain("\"tokenHealth\": \"valid\"");
    expect(body).not.toMatch(/SHOULD-NEVER-APPEAR|accessToken/);
  });

  it("creates the CASA campaign as an inactive draft with no reel", async () => {
    const { client, automationCreate, audit } = await connect(["read", "drafts:write"]);
    const result = await client.callTool({
      name: "create_draft_campaign",
      arguments: {
        instagramUsername: "mro.realtor",
        name: "NOR | Historia Primera Casa | CASA",
        keywords: ["CASA"],
        dmMessage: "Hola!",
        idempotencyKey: "casa-draft-0001",
        draftConfig: { conversationMode: "direct_capture", assignee: "Nancy Orellana" },
      },
    });
    expect(result.isError).toBeFalsy();
    const created = JSON.parse(text(result));
    expect(created.status).toBe("draft");
    expect(created.trigger.postId).toBeNull();

    const data = automationCreate.mock.calls[0][0].data;
    expect(data.isActive).toBe(false);
    expect(data.isDraft).toBe(true);
    expect(data.workspaceId).toBe("ws1");

    const actions = audit.mock.calls.map((c) => c[0].data.action);
    expect(actions).toContain("campaign.draft.create");
    expect(actions).toContain("mcp.create_draft_campaign");
  });

  it("refuses to create an active campaign", async () => {
    const { client, automationCreate } = await connect(["read", "drafts:write"]);
    const result = await client.callTool({
      name: "create_draft_campaign",
      arguments: { instagramUsername: "mro.realtor", name: "x", dmMessage: "y", isActive: true },
    });
    expect(result.isError).toBe(true);
    expect(automationCreate).not.toHaveBeenCalled();
  });

  it("cannot call a tool the token's scopes do not allow", async () => {
    const { client } = await connect(["read"]);
    const result = await client.callTool({
      name: "create_draft_campaign",
      arguments: { instagramUsername: "mro.realtor", name: "x", dmMessage: "y" },
    });
    expect(result.isError).toBe(true);
  });
});
