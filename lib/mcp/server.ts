import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { recordAudit } from "@/lib/api/audit";
import { ApiError, apiErrors } from "@/lib/api/errors";
import { validateIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { redactString } from "@/lib/api/redact";
import { hasScope, type Scope } from "@/lib/api/scopes";
import type { ApiContext, Db } from "@/lib/api/types";
import { getAccount, listAccounts } from "@/lib/services/accounts";
import {
  accountSelectorIssue,
  accountSelectorOk,
  createDraftObject,
  openingDmComplete,
  openingDmIssue,
  updateDraftObject,
} from "@/lib/services/campaign-schemas";
import {
  createDraftCampaign,
  getCampaign,
  listCampaigns,
  updateDraftCampaign,
} from "@/lib/services/campaigns";
import { listCampaignLogs } from "@/lib/services/logs";

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const paging = {
  limit: z.number().int().min(1).max(100).optional().describe("Page size, default 25"),
  cursor: z.string().optional().describe("nextCursor from the previous page"),
};

const createInput = createDraftObject
  .extend({
    idempotencyKey: z
      .string()
      .optional()
      .describe("Optional. Reuse the same value to safely retry without creating a duplicate."),
  })
  .refine(accountSelectorOk, accountSelectorIssue)
  .refine(openingDmComplete, openingDmIssue);

const updateInput = updateDraftObject
  .extend({ campaignId: z.string().min(1) })
  .refine(openingDmComplete, openingDmIssue);

type Json = Record<string, unknown> | unknown[];

function ok(data: Json): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(error: unknown): CallToolResult {
  if (error instanceof ApiError) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: {
              code: error.code,
              message: error.message,
              ...(error.details !== undefined ? { details: error.details } : {}),
            },
          }),
        },
      ],
    };
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`[mcp] unhandled: ${redactString(message)}`);
  return {
    isError: true,
    content: [
      { type: "text", text: JSON.stringify({ error: { code: "INTERNAL", message: "Internal server error" } }) },
    ],
  };
}

/**
 * Builds a per-request MCP server exposing only the tools this token's scopes
 * allow. Scope is checked again at call time, and every call is audited.
 */
export function createMcpServer(db: Db, ctx: ApiContext): McpServer {
  const server = new McpServer(
    { name: "openreply", version: "0.1.0" },
    {
      instructions:
        "OpenReply admin tools. Campaigns created here are always inactive drafts; a person activates them in the OpenReply dashboard. No tool sends messages.",
    }
  );

  function tool<S extends z.ZodType>(
    name: string,
    scope: Scope,
    config: {
      title: string;
      description: string;
      inputSchema: S;
      annotations: Record<string, boolean>;
    },
    run: (args: z.infer<S>) => Promise<Json>,
    audit: { targetId?: (args: z.infer<S>) => string | undefined } = {}
  ) {
    if (!hasScope(ctx.scopes, scope)) return;

    server.registerTool(
      name,
      {
        title: config.title,
        description: config.description,
        inputSchema: config.inputSchema as never,
        annotations: config.annotations,
      },
      (async (args: z.infer<S>) => {
        const base = {
          workspaceId: ctx.workspaceId,
          apiTokenId: ctx.tokenId,
          actorUserId: ctx.createdByUserId,
          channel: "MCP" as const,
          action: `mcp.${name}`,
          targetType: "tool",
          targetId: audit.targetId?.(args),
        };
        try {
          if (!hasScope(ctx.scopes, scope)) throw apiErrors.forbidden();
          const result = await run(args);
          await recordAudit(db, { ...base, outcome: "SUCCESS", details: { argumentKeys: Object.keys(args as object) } });
          return ok(result);
        } catch (error) {
          await recordAudit(db, {
            ...base,
            outcome: error instanceof ApiError && error.code === "FORBIDDEN" ? "DENIED" : "ERROR",
            details: { argumentKeys: Object.keys((args ?? {}) as object), error: error instanceof ApiError ? error.code : "INTERNAL" },
          });
          return fail(error);
        }
      }) as never
    );
  }

  tool(
    "list_accounts",
    "read",
    {
      title: "List connected accounts",
      description:
        "Lists the Instagram accounts connected to this workspace, with webhook and token health. Never returns credentials.",
      inputSchema: z.object(paging).strict(),
      annotations: READ_ONLY,
    },
    async (args) => ({ ...(await listAccounts(db, ctx, args)) })
  );

  tool(
    "get_account",
    "read",
    {
      title: "Get account status",
      description: "Returns connection status for one connected account.",
      inputSchema: z.object({ accountId: z.string().min(1) }).strict(),
      annotations: READ_ONLY,
    },
    async ({ accountId }) => ({ ...(await getAccount(db, ctx, accountId)) }),
    { targetId: (a) => a.accountId }
  );

  tool(
    "list_campaigns",
    "read",
    {
      title: "List campaigns",
      description:
        "Lists campaigns with their status (draft, active or paused). Read-only.",
      inputSchema: z
        .object({
          ...paging,
          accountId: z.string().optional(),
          status: z.enum(["draft", "active", "paused"]).optional(),
        })
        .strict(),
      annotations: READ_ONLY,
    },
    async (args) => ({ ...(await listCampaigns(db, ctx, args)) })
  );

  tool(
    "get_campaign",
    "read",
    {
      title: "Get campaign",
      description:
        "Returns one campaign's trigger, messages, follow gate, tracked links, delivery counts and what still blocks activation.",
      inputSchema: z.object({ campaignId: z.string().min(1) }).strict(),
      annotations: READ_ONLY,
    },
    async ({ campaignId }) => ({ ...(await getCampaign(db, ctx, campaignId)) }),
    { targetId: (a) => a.campaignId }
  );

  tool(
    "list_campaign_logs",
    "read",
    {
      title: "List delivery logs",
      description:
        "Delivery outcomes for campaigns (sent, failed, skipped). Does not include commenter identities or comment text.",
      inputSchema: z
        .object({
          ...paging,
          campaignId: z.string().optional(),
          status: z
            .enum([
              "PENDING",
              "SENT",
              "FAILED",
              "SKIPPED_DEDUP",
              "SKIPPED_RATE_LIMIT",
              "SKIPPED_PLAN_LIMIT",
              "SKIPPED_NO_MATCH",
            ])
            .optional(),
        })
        .strict(),
      annotations: READ_ONLY,
    },
    async (args) => ({ ...(await listCampaignLogs(db, ctx, args)) })
  );

  tool(
    "create_draft_campaign",
    "drafts:write",
    {
      title: "Create draft campaign",
      description:
        "Creates a new campaign as an INACTIVE draft. It cannot be activated through this tool and does not send anything. A post or Reel does not need to be selected. A person reviews and activates it in the dashboard.",
      inputSchema: createInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      const { idempotencyKey, ...input } = args;
      const key = validateIdempotencyKey(idempotencyKey);
      const result = await withIdempotency(
        db,
        ctx,
        key,
        "mcp.create_draft_campaign",
        input,
        async () => ({
          status: 201,
          body: await createDraftCampaign(db, { ctx, channel: "MCP" }, input),
        })
      );
      return { ...result.body, replayed: result.replayed };
    }
  );

  tool(
    "update_draft_campaign",
    "drafts:write",
    {
      title: "Edit draft campaign",
      description:
        "Edits an inactive draft campaign. Fails for active or paused campaigns. Cannot activate a campaign.",
      inputSchema: updateInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ campaignId, ...changes }) => {
      if (Object.keys(changes).length === 0) {
        throw apiErrors.validation("Provide at least one field to change");
      }
      return {
        ...(await updateDraftCampaign(db, { ctx, channel: "MCP" }, campaignId, changes)),
      };
    },
    { targetId: (a) => a.campaignId }
  );

  return server;
}
