/**
 * Real disposable Postgres, mocked Instagram. Skipped unless RUN_DB_TESTS=1.
 * Proves a reconnect can only renew the account it was started for, and only
 * for the person who started it.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string } },
  ctx: null as null | { userId: string; workspaceId: string; role: "OWNER" | "MEMBER" },
  userInfo: { id: "app-1", user_id: "ig-1", username: "x" } as { id: string; user_id?: string; username: string; name?: string },
}));

vi.mock("@/lib/auth", () => ({ auth: async () => state.session }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: async () => state.ctx,
  canManageWorkspace: () => true,
}));
vi.mock("@/lib/meta/oauth", async (orig) => ({
  ...((await orig()) as object),
  exchangeCodeForToken: async () => ({
    accessToken: "short-lived",
    userId: "x",
    permissions: [
      "instagram_business_basic",
      "instagram_business_manage_messages",
      "instagram_business_manage_comments",
    ],
  }),
}));
vi.mock("@/lib/meta/client", async (orig) => ({
  ...((await orig()) as object),
  getLongLivedToken: async () => ({ accessToken: "long-lived-new", expiresIn: 5_184_000 }),
  getUserInfo: async () => state.userInfo,
  subscribeInstagramAccountToWebhooks: async () => ({ success: true }),
}));

import { prisma } from "@/lib/db/client";
import { createOAuthState, decryptToken, encryptToken } from "@/lib/meta/oauth";
import { GET as callback } from "@/app/api/instagram/callback/route";
import { GET as connect } from "@/app/api/instagram/connect/route";

const run = process.env.RUN_DB_TESTS === "1" ? describe : describe.skip;
const suffix = randomBytes(4).toString("hex");

run("instagram reconnect (database, mocked Instagram)", () => {
  let wsId: string;
  let otherWsId: string;
  let mineId: string;
  let nancyId: string;
  let foreignId: string;
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({ data: { email: `rc-${suffix}@example.test` } });
    userId = user.id;
    const ws = await prisma.workspace.create({
      data: { name: `rc-${suffix}`, ownerId: user.id, members: { create: { userId: user.id, role: "OWNER" } } },
    });
    wsId = ws.id;
    const other = await prisma.user.create({ data: { email: `rc2-${suffix}@example.test` } });
    const ws2 = await prisma.workspace.create({ data: { name: `rc2-${suffix}`, ownerId: other.id } });
    otherWsId = ws2.id;
    const mk = (workspaceId: string, instagramId: string, status: "ACTIVE" | "NEEDS_RECONNECT") =>
      prisma.instagramAccount.create({
        data: {
          workspaceId, instagramId, username: `${instagramId}.${suffix}`, accessToken: encryptToken(`old-${instagramId}`),
          tokenExpiresAt: new Date(Date.now() - 86_400_000), connectionStatus: status, needsReconnectReason: status === "ACTIVE" ? null : "expired",
        },
      });
    mineId = (await mk(wsId, "ig-mine", "ACTIVE")).id;
    nancyId = (await mk(wsId, "ig-nancy", "NEEDS_RECONNECT")).id;
    foreignId = (await mk(otherWsId, "ig-foreign", "ACTIVE")).id;
    state.session = { user: { id: userId } };
    state.ctx = { userId, workspaceId: wsId, role: "OWNER" };
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const call = (stateValue: string) =>
    callback(new NextRequest(`http://localhost:3000/api/instagram/callback?code=abc&state=${encodeURIComponent(stateValue)}`));
  const location = (res: Response) => res.headers.get("location") ?? "";

  it("reconnects only the chosen account when the right Instagram login is used", async () => {
    state.userInfo = { id: "app-n", user_id: "ig-nancy", username: "nancy" };
    const res = await call(createOAuthState(wsId, { userId, reconnectAccountId: nancyId }));
    expect(location(res)).toContain("/dashboard?connected=true");

    const nancy = await prisma.instagramAccount.findUniqueOrThrow({ where: { id: nancyId } });
    expect(nancy.connectionStatus).toBe("ACTIVE");
    expect(nancy.needsReconnectReason).toBeNull();
    expect(decryptToken(nancy.accessToken)).toBe("long-lived-new");
    expect(nancy.connectedByUserId).toBe(userId);
    expect(nancy.grantedScopes).toContain("instagram_business_manage_messages");
    expect(nancy.nextRefreshAt).not.toBeNull();

    // The other accounts keep their own credentials.
    const mine = await prisma.instagramAccount.findUniqueOrThrow({ where: { id: mineId } });
    expect(decryptToken(mine.accessToken)).toBe("old-ig-mine");
    const foreign = await prisma.instagramAccount.findUniqueOrThrow({ where: { id: foreignId } });
    expect(decryptToken(foreign.accessToken)).toBe("old-ig-foreign");
  });

  it("refuses when someone logs in to a different Instagram account, and changes nothing", async () => {
    await prisma.instagramAccount.update({ where: { id: nancyId }, data: { connectionStatus: "NEEDS_RECONNECT", accessToken: encryptToken("old-ig-nancy") } });
    state.userInfo = { id: "app-m", user_id: "ig-mine", username: "mine" };
    const res = await call(createOAuthState(wsId, { userId, reconnectAccountId: nancyId }));
    expect(location(res)).toContain("instagram=wrong_account");
    const nancy = await prisma.instagramAccount.findUniqueOrThrow({ where: { id: nancyId } });
    expect(nancy.connectionStatus).toBe("NEEDS_RECONNECT");
    expect(decryptToken(nancy.accessToken)).toBe("old-ig-nancy");
    const mine = await prisma.instagramAccount.findUniqueOrThrow({ where: { id: mineId } });
    expect(decryptToken(mine.accessToken)).toBe("old-ig-mine");
  });

  it("rejects a reconnect link used by a different signed in person", async () => {
    state.userInfo = { id: "app-n", user_id: "ig-nancy", username: "nancy" };
    const res = await call(createOAuthState(wsId, { userId: "someone-else", reconnectAccountId: nancyId }));
    expect(location(res)).toContain("instagram=invalid");
    expect(decryptToken((await prisma.instagramAccount.findUniqueOrThrow({ where: { id: nancyId } })).accessToken)).toBe("old-ig-nancy");
  });

  it("will not start a reconnect for an account in another workspace", async () => {
    const res = await connect(new NextRequest(`http://localhost:3000/api/instagram/connect?account=${foreignId}`));
    expect(location(res)).toContain("instagram=invalid");
  });

  it("starts a reconnect for an own account with a forced login prompt", async () => {
    const res = await connect(new NextRequest(`http://localhost:3000/api/instagram/connect?account=${nancyId}`));
    const url = location(res);
    expect(url).toContain("instagram.com/oauth/authorize");
    expect(url).toContain("force_reauth=true");
  });

  it("a normal connect has no forced login", async () => {
    const res = await connect(new NextRequest("http://localhost:3000/api/instagram/connect"));
    expect(location(res)).not.toContain("force_reauth");
  });
});
