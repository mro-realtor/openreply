/**
 * Runs against a real, disposable Postgres. Skipped unless RUN_DB_TESTS=1.
 * Drives the real route handlers end to end: register, authorize, consent,
 * token, refresh, revoke, and then uses the issued access token on the MCP
 * and REST authentication path. Never point it at production.
 */
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  userId: null as null | string,
  ctx: null as null | { userId: string; workspaceId: string; role: "OWNER" | "MEMBER" },
}));

vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: async () => state.ctx,
  canManageWorkspace: () => true,
  canManageBilling: (role: string) => role === "OWNER",
}));
vi.mock("@/lib/auth", () => ({
  getCurrentWorkspaceId: async () => state.ctx?.workspaceId ?? null,
  getCurrentUserId: async () => state.userId,
}));
vi.mock("@/lib/oauth/limit", () => ({
  limitByIp: async () => {},
  getClientIp: () => "test",
}));

import { prisma } from "@/lib/db/client";
import { authenticateBearer } from "@/lib/api/auth";
import type { RateLimitStore } from "@/lib/api/rate-limit";
import { POST as register } from "@/app/api/oauth/register/route";
import { GET as authorize } from "@/app/api/oauth/authorize/route";
import { POST as consent } from "@/app/api/oauth/consent/route";
import { POST as token } from "@/app/api/oauth/token/route";
import { POST as revoke } from "@/app/api/oauth/revoke/route";
import { GET as listGrants, DELETE as deleteGrant } from "@/app/api/settings/oauth-grants/route";
import { GET as listTokens } from "@/app/api/settings/api-tokens/route";
import { createMcpServer } from "@/lib/mcp/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const enabled = process.env.RUN_DB_TESTS === "1";
const suffix = Math.random().toString(36).slice(2, 8);
const ORIGIN = "https://app.example.test";
const REDIRECT = "https://chatgpt.example/callback";
const memoryStore: RateLimitStore = { increment: async () => 1 };

function pkcePair() {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

const post = (path: string, body: Record<string, string>, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(body).toString(),
  });

describe.skipIf(!enabled)("oauth integration", () => {
  let userId = "";
  let workspaceId = "";
  let otherWorkspaceId = "";
  let otherUserId = "";
  let clientId = "";

  beforeAll(async () => {
    process.env.NEXTAUTH_URL = ORIGIN;
    process.env.OAUTH_ENABLED = "true";
    const user = await prisma.user.create({ data: { email: `oauth-${suffix}@example.test` } });
    userId = user.id;
    const ws = await prisma.workspace.create({
      data: { name: `oauth-${suffix}`, ownerId: user.id, members: { create: { userId: user.id, role: "OWNER" } } },
    });
    workspaceId = ws.id;
    const other = await prisma.user.create({ data: { email: `oauth-other-${suffix}@example.test` } });
    otherUserId = other.id;
    const ows = await prisma.workspace.create({
      data: { name: `oauth-other-${suffix}`, ownerId: other.id, members: { create: { userId: other.id, role: "OWNER" } } },
    });
    otherWorkspaceId = ows.id;
    state.userId = userId;
    state.ctx = { userId, workspaceId, role: "OWNER" };
  });

  afterAll(async () => {
    if (clientId) await prisma.oAuthClient.deleteMany({ where: { clientId } });
    await prisma.auditLog.deleteMany({ where: { workspaceId: { in: [workspaceId, otherWorkspaceId] } } });
    await prisma.workspace.deleteMany({ where: { id: { in: [workspaceId, otherWorkspaceId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  async function registerClient() {
    const res = await register(
      new Request(`${ORIGIN}/api/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_name: "ChatGPT test", redirect_uris: [REDIRECT] }),
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    clientId = body.client_id;
    return body.client_id as string;
  }

  /** Walks authorize -> consent and returns the authorization code. */
  async function authorizeAndApprove(
    cid: string,
    opts: { scope?: string; approveScopes?: string[]; decision?: "approve" | "deny"; challenge: string }
  ) {
    const url = new URL(`${ORIGIN}/api/oauth/authorize`);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: cid,
      redirect_uri: REDIRECT,
      scope: opts.scope ?? "read",
      state: "s-123",
      code_challenge: opts.challenge,
      code_challenge_method: "S256",
      resource: `${ORIGIN}/api/mcp`,
    }).toString();
    const start = await authorize(new NextRequest(url));
    expect(start.status).toBe(303);
    const consentUrl = new URL(start.headers.get("location")!);
    expect(consentUrl.pathname).toBe("/oauth/consent");
    const requestId = consentUrl.searchParams.get("request")!;

    const form = new FormData();
    form.set("request", requestId);
    form.set("decision", opts.decision ?? "approve");
    for (const scope of opts.approveScopes ?? ["read"]) form.append("scope", scope);
    const decided = await consent(
      new NextRequest(`${ORIGIN}/api/oauth/consent`, { method: "POST", body: form, headers: { origin: ORIGIN } })
    );
    expect(decided.status).toBe(303);
    return { location: new URL(decided.headers.get("location")!), requestId };
  }

  it("requires sign-in before showing consent", async () => {
    const cid = await registerClient();
    const { challenge } = pkcePair();
    state.userId = null;
    const url = new URL(`${ORIGIN}/api/oauth/authorize`);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: cid,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    const res = await authorize(new NextRequest(url));
    state.userId = userId;
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });

  it("runs the full flow and the access token works through the normal auth path", async () => {
    const cid = clientId;
    const { verifier, challenge } = pkcePair();
    const { location } = await authorizeAndApprove(cid, {
      scope: "read drafts:write",
      approveScopes: ["read"], // owner narrows it: drafts:write is NOT granted
      challenge,
    });
    expect(location.origin + location.pathname).toBe(REDIRECT);
    expect(location.searchParams.get("state")).toBe("s-123");
    expect(location.searchParams.get("iss")).toBe(ORIGIN);
    const code = location.searchParams.get("code")!;

    // Wrong verifier fails and burns the code.
    const bad = await token(post("/api/oauth/token", {
      grant_type: "authorization_code", client_id: cid, code, redirect_uri: REDIRECT, code_verifier: randomBytes(48).toString("base64url"),
    }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("invalid_grant");

    // New attempt with a fresh authorization.
    const second = await authorizeAndApprove(cid, { scope: "read drafts:write", approveScopes: ["read"], challenge });
    const code2 = second.location.searchParams.get("code")!;

    const mismatch = await token(post("/api/oauth/token", {
      grant_type: "authorization_code", client_id: cid, code: code2, redirect_uri: "https://chatgpt.example/other", code_verifier: verifier,
    }));
    expect((await mismatch.json()).error).toBe("invalid_grant");

    const third = await authorizeAndApprove(cid, { scope: "read drafts:write", approveScopes: ["read"], challenge });
    const code3 = third.location.searchParams.get("code")!;
    const ok = await token(post("/api/oauth/token", {
      grant_type: "authorization_code", client_id: cid, code: code3, redirect_uri: REDIRECT, code_verifier: verifier,
      resource: `${ORIGIN}/api/mcp`,
    }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const tokens = await ok.json();
    expect(tokens.token_type).toBe("Bearer");
    expect(tokens.scope).toBe("read");
    expect(tokens.expires_in).toBe(3600);
    expect(tokens.access_token).toMatch(/^orp_/);
    expect(tokens.refresh_token).toMatch(/^orr_/);

    // The OAuth access token goes through the SAME authenticator as manual tokens.
    const ctx = await authenticateBearer(prisma, `Bearer ${tokens.access_token}`, { rateLimitStore: memoryStore });
    expect(ctx.workspaceId).toBe(workspaceId);
    expect(ctx.scopes).toEqual(["read"]);

    // ...and the MCP server hides write tools for it, exactly like a read-only token.
    const server = createMcpServer(prisma, ctx);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: "oauth-test", version: "1.0.0" });
    await client.connect(ct);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("list_campaigns");
    expect(names).not.toContain("create_draft_campaign");
    await client.close();

    // Replaying the first (already used) code kills the grant.
    const replay = await token(post("/api/oauth/token", {
      grant_type: "authorization_code", client_id: cid, code: code3, redirect_uri: REDIRECT, code_verifier: verifier,
    }));
    expect((await replay.json()).error).toBe("invalid_grant");
    await expect(
      authenticateBearer(prisma, `Bearer ${tokens.access_token}`, { rateLimitStore: memoryStore })
    ).rejects.toMatchObject({ status: 401 });
  });

  it("rotates refresh tokens, blocks scope widening, and revokes on reuse", async () => {
    const cid = clientId;
    const { verifier, challenge } = pkcePair();
    const { location } = await authorizeAndApprove(cid, { scope: "read drafts:write", approveScopes: ["read", "drafts:write"], challenge });
    const first = await (
      await token(post("/api/oauth/token", {
        grant_type: "authorization_code", client_id: cid, code: location.searchParams.get("code")!, redirect_uri: REDIRECT, code_verifier: verifier,
      }))
    ).json();
    expect(first.scope).toBe("read drafts:write");

    // Widening to a reserved scope is refused, and does not burn the refresh token.
    const widen = await token(post("/api/oauth/token", {
      grant_type: "refresh_token", client_id: cid, refresh_token: first.refresh_token, scope: "read send",
    }));
    expect((await widen.json()).error).toBe("invalid_scope");

    const rotated = await token(post("/api/oauth/token", {
      grant_type: "refresh_token", client_id: cid, refresh_token: first.refresh_token,
    }));
    expect(rotated.status).toBe(200);
    const second = await rotated.json();

    // The spent refresh token shows up again: treated as theft, whole grant revoked.
    const reuse = await token(post("/api/oauth/token", {
      grant_type: "refresh_token", client_id: cid, refresh_token: first.refresh_token,
    }));
    expect((await reuse.json()).error).toBe("invalid_grant");
    for (const access of [first.access_token, second.access_token]) {
      await expect(
        authenticateBearer(prisma, `Bearer ${access}`, { rateLimitStore: memoryStore })
      ).rejects.toMatchObject({ status: 401 });
    }
    const afterTheft = await token(post("/api/oauth/token", {
      grant_type: "refresh_token", client_id: cid, refresh_token: second.refresh_token,
    }));
    expect((await afterTheft.json()).error).toBe("invalid_grant");
  });

  it("refreshes cleanly, narrows scope, and the old refresh token is dead", async () => {
    const cid = clientId;
    const { verifier, challenge } = pkcePair();
    const { location } = await authorizeAndApprove(cid, { scope: "read drafts:write", approveScopes: ["read", "drafts:write"], challenge });
    const first = await (
      await token(post("/api/oauth/token", {
        grant_type: "authorization_code", client_id: cid, code: location.searchParams.get("code")!, redirect_uri: REDIRECT, code_verifier: verifier,
      }))
    ).json();

    const refreshed = await token(post("/api/oauth/token", {
      grant_type: "refresh_token", client_id: cid, refresh_token: first.refresh_token, scope: "read",
    }));
    expect(refreshed.status).toBe(200);
    const next = await refreshed.json();
    expect(next.scope).toBe("read");
    expect(next.refresh_token).not.toBe(first.refresh_token);
    const ctx = await authenticateBearer(prisma, `Bearer ${next.access_token}`, { rateLimitStore: memoryStore });
    expect(ctx.scopes).toEqual(["read"]);

    // Manual-token list does not show OAuth-issued tokens; the grants list does.
    const manual = await (await listTokens()).json();
    expect(manual.data.tokens.every((t: { name: string }) => !t.name.startsWith("OAuth:"))).toBe(true);
    const grants = await (await listGrants()).json();
    expect(grants.data.grants.length).toBeGreaterThan(0);

    // Revocation by the client kills everything.
    const rev = await revoke(post("/api/oauth/revoke", { client_id: cid, token: next.refresh_token }));
    expect(rev.status).toBe(200);
    await expect(
      authenticateBearer(prisma, `Bearer ${next.access_token}`, { rateLimitStore: memoryStore })
    ).rejects.toMatchObject({ status: 401 });
    const after = await token(post("/api/oauth/token", {
      grant_type: "refresh_token", client_id: cid, refresh_token: next.refresh_token,
    }));
    expect((await after.json()).error).toBe("invalid_grant");
  });

  it("lets the owner disconnect an app, and only for their own workspace", async () => {
    const cid = clientId;
    const { verifier, challenge } = pkcePair();
    const { location } = await authorizeAndApprove(cid, { challenge });
    const tokens = await (
      await token(post("/api/oauth/token", {
        grant_type: "authorization_code", client_id: cid, code: location.searchParams.get("code")!, redirect_uri: REDIRECT, code_verifier: verifier,
      }))
    ).json();
    const grant = await prisma.oAuthGrant.findFirstOrThrow({ where: { workspaceId, revokedAt: null } });

    // Another workspace's owner cannot see or revoke it.
    state.ctx = { userId: otherUserId, workspaceId: otherWorkspaceId, role: "OWNER" };
    const foreign = await deleteGrant(new NextRequest(`${ORIGIN}/api/settings/oauth-grants?id=${grant.id}`, { method: "DELETE" }));
    expect(foreign.status).toBe(404);
    state.ctx = { userId, workspaceId, role: "OWNER" };

    const own = await deleteGrant(new NextRequest(`${ORIGIN}/api/settings/oauth-grants?id=${grant.id}`, { method: "DELETE" }));
    expect(own.status).toBe(200);
    await expect(
      authenticateBearer(prisma, `Bearer ${tokens.access_token}`, { rateLimitStore: memoryStore })
    ).rejects.toMatchObject({ status: 401 });
  });

  it("refuses consent from non-owners, other origins, other users, and replays", async () => {
    const cid = clientId;
    const { challenge } = pkcePair();
    const url = new URL(`${ORIGIN}/api/oauth/authorize`);
    url.search = new URLSearchParams({
      response_type: "code", client_id: cid, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256",
    }).toString();
    const start = await authorize(new NextRequest(url));
    const requestId = new URL(start.headers.get("location")!).searchParams.get("request")!;
    const make = (origin: string) => {
      const form = new FormData();
      form.set("request", requestId);
      form.set("decision", "approve");
      form.append("scope", "read");
      return new NextRequest(`${ORIGIN}/api/oauth/consent`, { method: "POST", body: form, headers: { origin } });
    };

    expect((await consent(make("https://evil.example"))).status).toBe(403);

    state.ctx = { userId, workspaceId, role: "MEMBER" };
    expect((await consent(make(ORIGIN))).status).toBe(403);

    // A different signed-in user cannot complete someone else's request.
    state.ctx = { userId: otherUserId, workspaceId: otherWorkspaceId, role: "OWNER" };
    const stolen = await consent(make(ORIGIN));
    expect(stolen.status).toBe(303);
    expect(new URL(stolen.headers.get("location")!).pathname).toBe("/oauth/consent");

    state.ctx = { userId, workspaceId, role: "OWNER" };
    const good = await consent(make(ORIGIN));
    expect(new URL(good.headers.get("location")!).origin).toBe(new URL(REDIRECT).origin);
    // Replay of the same request id does not mint a second code.
    const replay = await consent(make(ORIGIN));
    expect(new URL(replay.headers.get("location")!).pathname).toBe("/oauth/consent");
  });

  it("returns access_denied to the client when the owner cancels", async () => {
    const { challenge } = pkcePair();
    const { location } = await authorizeAndApprove(clientId, { decision: "deny", challenge });
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.get("code")).toBeNull();
    expect(location.searchParams.get("state")).toBe("s-123");
  });

  it("rejects client secrets and unknown grant types at the token endpoint", async () => {
    const secret = await token(post("/api/oauth/token", { grant_type: "authorization_code", client_id: clientId, client_secret: "x" }));
    expect(secret.status).toBe(401);
    const bad = await token(post("/api/oauth/token", { grant_type: "password", client_id: clientId }));
    expect((await bad.json()).error).toBe("unsupported_grant_type");
  });

  it("writes audit rows for OAuth events without secrets", async () => {
    const rows = await prisma.auditLog.findMany({ where: { workspaceId }, select: { action: true, details: true } });
    const actions = new Set(rows.map((r) => r.action));
    for (const a of ["oauth.authorize_approved", "oauth.token_issued", "oauth.token_refreshed", "oauth.code_reuse", "oauth.refresh_reuse"]) {
      expect(actions.has(a)).toBe(true);
    }
    const dump = JSON.stringify(rows);
    expect(dump).not.toMatch(/orp_[A-Za-z0-9_-]{20}/);
    expect(dump).not.toMatch(/orr_[A-Za-z0-9_-]{20}/);
  });
});
