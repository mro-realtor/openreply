import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { encryptToken, exchangeFacebookCodeForToken, verifyOAuthState } from "@/lib/meta/oauth";

const PUBLIC_APP_URL = "https://sdo-agents-mrorealtor-web.nd2api.easypanel.host";

export async function GET(request: Request) {
  const context = await getCurrentWorkspaceContext();
  const url = new URL(request.url);
  const redirectBase = PUBLIC_APP_URL;
  const state = verifyOAuthState(url.searchParams.get("state"));
  if (!context || !state || state.workspaceId !== context.workspaceId || !canManageWorkspace(context.role)) {
    return NextResponse.redirect(new URL("/messenger?error=facebook_authorization", redirectBase));
  }
  try {
    const code = url.searchParams.get("code");
    if (!code) throw new Error("Missing code");
    const token = await exchangeFacebookCodeForToken(code, `${redirectBase}/api/messenger/callback`);
    const headers = { Authorization: `Bearer ${token}` };
    const response = await fetch("https://graph.facebook.com/v25.0/me/accounts?fields=id,name,access_token", { headers });
    const payload = await response.json() as { data?: Array<{ id: string; name: string; access_token: string }> };
    if (!response.ok || !payload.data) throw new Error("Pages unavailable");
    const pages = new Map(payload.data.map((page) => [page.id, page]));
    const businessesResponse = await fetch("https://graph.facebook.com/v25.0/me/businesses?fields=id", { headers });
    const businesses = await businessesResponse.json() as { data?: Array<{ id: string }> };
    for (const business of businesses.data ?? []) {
      for (const endpoint of ["owned_pages", "client_pages"]) {
        const pageResponse = await fetch(`https://graph.facebook.com/v25.0/${business.id}/${endpoint}?fields=id,name,access_token`, { headers });
        const pagePayload = await pageResponse.json() as { data?: Array<{ id: string; name: string; access_token: string }> };
        for (const page of pagePayload.data ?? []) pages.set(page.id, page);
      }
    }
    for (const page of pages.values()) {
      const accessToken = encryptToken(page.access_token);
      await prisma.messengerPage.createMany({ data: [{ id: page.id, name: page.name, accessToken, workspaceId: context.workspaceId }], skipDuplicates: true });
      await prisma.messengerPage.updateMany({ where: { id: page.id, workspaceId: context.workspaceId }, data: { name: page.name, accessToken } });
    }
    return NextResponse.redirect(new URL(`/messenger?connected=${pages.size}`, redirectBase));
  } catch {
    return NextResponse.redirect(new URL("/messenger?error=facebook_authorization", redirectBase));
  }
}
