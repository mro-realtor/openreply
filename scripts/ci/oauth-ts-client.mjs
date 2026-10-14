// Independent client #5: the official TypeScript MCP SDK's own OAuth machinery
// (discovery, dynamic registration, PKCE, token exchange, refresh) against a real
// running server. The one step a person does in a browser (sign in and click Allow)
// is done over HTTP with a seeded database session, exactly as a signed-in browser would.
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import {
  discoverOAuthServerInfo,
  refreshAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js";

const mcpUrl = new URL(process.env.MCP_URL);
const origin = mcpUrl.origin;
const cookie = `authjs.session-token=${process.env.SESSION_TOKEN}`;
const redirectUrl = "http://127.0.0.1:8765/callback";

let saved = {};
let authorizationUrl = null;
const provider = {
  get redirectUrl() { return redirectUrl; },
  get clientMetadata() {
    return {
      client_name: "ci oauth sdk client",
      redirect_uris: [redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "read drafts:write",
    };
  },
  clientInformation: () => saved.clientInformation,
  saveClientInformation: (info) => { saved.clientInformation = info; },
  tokens: () => saved.tokens,
  saveTokens: (tokens) => { saved.tokens = tokens; },
  redirectToAuthorization: (url) => { authorizationUrl = url; },
  saveCodeVerifier: (v) => { saved.verifier = v; },
  codeVerifier: () => saved.verifier,
};

const connect = async () => {
  const client = new Client({ name: "ci-oauth-client", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(mcpUrl, { authProvider: provider });
  await client.connect(transport);
  return { client, transport };
};

// 1. Unauthenticated connect: the 401 must lead the SDK to discovery, registration and an authorization URL.
{
  const client = new Client({ name: "ci-oauth-client", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(mcpUrl, { authProvider: provider });
  await assert.rejects(client.connect(transport), UnauthorizedError);
  assert.ok(authorizationUrl, "SDK produced an authorization URL");
  assert.ok(saved.clientInformation?.client_id?.startsWith("orcl_"), "client registered dynamically");
  assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorizationUrl.searchParams.get("resource"), mcpUrl.href);

  // 2. The human step: open the authorization URL signed in, then press Allow on the consent form (read only).
  // Signed out, the same URL must bounce to login instead.
  const anon = await fetch(authorizationUrl, { redirect: "manual" });
  assert.equal(new URL(anon.headers.get("location"), origin).pathname, "/login");
  const signedIn = await fetch(authorizationUrl, { redirect: "manual", headers: { cookie } });
  const consentUrl2 = new URL(signedIn.headers.get("location"), origin);
  assert.equal(consentUrl2.pathname, "/oauth/consent");

  const page = await fetch(consentUrl2, { headers: { cookie } });
  const html = await page.text();
  assert.match(html, /ci oauth sdk client/);
  assert.match(html, /Allow/);

  const form = new URLSearchParams();
  form.set("request", consentUrl2.searchParams.get("request"));
  form.set("decision", "approve");
  form.append("scope", "read"); // owner leaves drafts:write unticked
  const decided = await fetch(`${origin}/api/oauth/consent`, {
    method: "POST",
    redirect: "manual",
    headers: { cookie, origin, "content-type": "application/x-www-form-urlencoded" },
    body: form,
  });
  assert.equal(decided.status, 303);
  const back = new URL(decided.headers.get("location"));
  assert.equal(back.origin + back.pathname, redirectUrl);
  assert.equal(back.searchParams.get("iss"), origin);
  assert.equal(back.searchParams.get("state"), authorizationUrl.searchParams.get("state"));

  // 3. The SDK exchanges the code (PKCE) and stores tokens.
  await transport.finishAuth(back.searchParams.get("code"));
  assert.ok(saved.tokens?.access_token?.startsWith("orp_"));
  assert.ok(saved.tokens?.refresh_token?.startsWith("orr_"));
  assert.equal(saved.tokens.scope, "read");
}

// 4. Authenticated MCP session works and only the granted (read) tools exist.
{
  const { client } = await connect();
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["get_account", "get_campaign", "list_accounts", "list_campaign_logs", "list_campaigns"]);
  const accounts = await client.callTool({ name: "list_accounts", arguments: {} });
  assert.match(accounts.content[0].text, /interop\.account/);
  assert.ok(!accounts.content[0].text.includes("enc-ci-secret"));
  await client.close();
}

// 5. Refresh rotation through the SDK; the old refresh token is dead afterwards.
{
  const info = await discoverOAuthServerInfo(mcpUrl);
  const oldRefresh = saved.tokens.refresh_token;
  const refreshed = await refreshAuthorization(info.authorizationServerUrl, {
    metadata: info.authorizationServerMetadata,
    clientInformation: saved.clientInformation,
    refreshToken: oldRefresh,
    resource: mcpUrl,
  });
  assert.ok(refreshed.access_token.startsWith("orp_"));
  assert.notEqual(refreshed.refresh_token, oldRefresh);
  assert.equal(refreshed.scope, "read");
  saved.tokens = { ...refreshed };

  const replay = await fetch(`${origin}/api/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: saved.clientInformation.client_id, refresh_token: oldRefresh }),
  });
  assert.equal(replay.status, 400);
  assert.equal((await replay.json()).error, "invalid_grant");

  // Reuse of the spent token is treated as theft: the live tokens must now be dead too.
  const res = await fetch(mcpUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${saved.tokens.access_token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(res.status, 401);
}

// 6. A bad redirect URI never redirects, and an unknown scope is refused.
{
  const bad = new URL(authorizationUrl);
  bad.searchParams.set("redirect_uri", "https://evil.example/cb");
  const res = await fetch(bad, { redirect: "manual", headers: { cookie } });
  assert.equal(res.status, 400);
  assert.equal(res.headers.get("location"), null);

  const scoped = new URL(authorizationUrl);
  scoped.searchParams.set("scope", "read send");
  const res2 = await fetch(scoped, { redirect: "manual", headers: { cookie } });
  assert.equal(res2.status, 303);
  assert.equal(new URL(res2.headers.get("location")).searchParams.get("error"), "invalid_scope");
}

console.log("oauth sdk client: all assertions passed");
