import type { PrismaClient } from "@/app/generated/prisma/client";

/** Type-only import, so pure modules and tests never load the Prisma client. */
export type Db = PrismaClient;

export type Channel = "REST" | "MCP" | "DASHBOARD" | "OAUTH";

export interface ApiContext {
  workspaceId: string;
  tokenId: string;
  tokenName: string;
  scopes: string[];
  createdByUserId: string | null;
}
