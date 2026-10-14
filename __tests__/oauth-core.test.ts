import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/api/types";
import {
  getAuthorizationServerMetadata,
  getMcpResource,
  getProtectedResourceMetadata,
  isAcceptedResource,
  isOAuthEnabled,
} from "@/lib/oauth/config";
import { verifyPkce, isValidCodeChallenge } from "@/lib/oauth/pkce";
import { isValidRedirectUri, redirectUriMatches } from "@/lib/oauth/redirect";
import { parseRequestedScopes } from "@/lib/oauth/scopes";
import {
  generateAuthorizationCode,
  generateClientId,
  generateRefreshToken,
  isWellFormedRefreshToken,
} from "@/lib/oauth/secrets";
import { OAuthError } from "@/lib/oauth/errors";
import { registerClient, validateAuthorizeRequest } from "@/lib/oauth/service";
import { GET as protectedResource } from "@/app/.well-known/oauth-protected-resource/[[...path]]/route";
import { GET as authServer } from "@/app/.well-known/oauth-authorization-server/[[...path]]/route";

const saved = { ...process.env };
beforeEach(() => {
  process.env.NEXTAUTH_URL = "https://app.example.test";
});
afterEach(() => {
  process.env = { ...saved };
});

describe("PKCE", () => {
  // Test vector from RFC 7636 appendix B.
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

  it("accepts the RFC 7636 example", () => {
    expect(verifyPkce(verifier, challenge)).toBe(true);
  });
  it("rejects a wrong verifier, a short verifier and a plain challenge", () => {
    expect(verifyPkce(verifier.replace("d", "e"), challenge)).toBe(false);
    expect(verifyPkce("short", challenge)).toBe(false);
    expect(verifyPkce(verifier, verifier)).toBe(false);
    expect(isValidCodeChallenge("not-a-challenge")).toBe(false);
  });
});

describe("redirect URIs", () => {
  it("allows https and loopback http only", () => {
    expect(isValidRedirectUri("https://chatgpt.com/connector_platform_oauth_redirect")).toBe(true);
    expect(isValidRedirectUri("http://127.0.0.1:8123/callback")).toBe(true);
    expect(isValidRedirectUri("http://localhost:3000/cb")).toBe(true);
    expect(isValidRedirectUri("http://evil.example/cb")).toBe(false);
    expect(isValidRedirectUri("javascript:alert(1)")).toBe(false);
    expect(isValidRedirectUri("myapp://callback")).toBe(false);
    expect(isValidRedirectUri("https://a.example/cb#frag")).toBe(false);
    expect(isValidRedirectUri("https://user:pw@a.example/cb")).toBe(false);
  });
  it("matches exactly, except the port on loopback", () => {
    const registered = ["https://a.example/cb", "http://127.0.0.1:5000/cb"];
    expect(redirectUriMatches(registered, "https://a.example/cb")).toBe(true);
    expect(redirectUriMatches(registered, "https://a.example/cb2")).toBe(false);
    expect(redirectUriMatches(registered, "https://a.example/cb?x=1")).toBe(false);
    expect(redirectUriMatches(registered, "http://127.0.0.1:61234/cb")).toBe(true);
    expect(redirectUriMatches(registered, "http://127.0.0.1:61234/other")).toBe(false);
    expect(redirectUriMatches(registered, "https://a.example:444/cb")).toBe(false);
  });
});

describe("scopes", () => {
  it("defaults to read and dedupes", () => {
    expect(parseRequestedScopes(null)).toEqual(["read"]);
    expect(parseRequestedScopes("read drafts:write read")).toEqual(["read", "drafts:write"]);
  });
  it("rejects reserved and unknown scopes instead of dropping them", () => {
    for (const bad of ["send", "activate", "campaigns:modify", "leads:read", "admin", "read send"]) {
      expect(() => parseRequestedScopes(bad)).toThrowError(OAuthError);
    }
  });
});

describe("secrets", () => {
  it("generates well formed, distinct values", () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(isWellFormedRefreshToken(a.secret)).toBe(true);
    expect(a.secret).not.toBe(b.secret);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(generateClientId()).toMatch(/^orcl_/);
    expect(generateAuthorizationCode().secret.length).toBeGreaterThanOrEqual(43);
  });
});

describe("resource binding", () => {
  it("accepts only this server's MCP endpoint or origin", () => {
    expect(getMcpResource()).toBe("https://app.example.test/api/mcp");
    expect(isAcceptedResource("https://app.example.test/api/mcp")).toBe(true);
    expect(isAcceptedResource("https://app.example.test/api/mcp/")).toBe(true);
    expect(isAcceptedResource("https://app.example.test")).toBe(true);
    expect(isAcceptedResource("https://other.example/api/mcp")).toBe(false);
    expect(isAcceptedResource("https://app.example.test/api/v1/../x")).toBe(false);
  });
});

describe("metadata", () => {
  it("advertises PKCE S256, public clients and RFC 9207 iss", () => {
    const meta = getAuthorizationServerMetadata();
    expect(meta.issuer).toBe("https://app.example.test");
    expect(meta.code_challenge_methods_supported).toEqual(["S256"]);
    expect(meta.token_endpoint_auth_methods_supported).toEqual(["none"]);
    expect(meta.authorization_response_iss_parameter_supported).toBe(true);
    expect(meta.scopes_supported).toEqual(["read", "drafts:write"]);
    expect(meta.registration_endpoint).toBe("https://app.example.test/api/oauth/register");
  });
  it("points the MCP resource at this issuer", () => {
    const meta = getProtectedResourceMetadata();
    expect(meta.resource).toBe("https://app.example.test/api/mcp");
    expect(meta.authorization_servers).toEqual(["https://app.example.test"]);
  });
  it("is hidden (404) until OAUTH_ENABLED=true", async () => {
    delete process.env.OAUTH_ENABLED;
    expect(isOAuthEnabled()).toBe(false);
    expect((await protectedResource()).status).toBe(404);
    expect((await authServer()).status).toBe(404);
    process.env.OAUTH_ENABLED = "true";
    const res = await authServer();
    expect(res.status).toBe(200);
    expect((await res.json()).issuer).toBe("https://app.example.test");
  });
});

function fakeDb(clients: Array<{ id: string; clientId: string; name: string; redirectUris: string[] }> = []) {
  const created: Array<Record<string, unknown>> = [];
  const db = {
    oAuthClient: {
      deleteMany: async () => ({ count: 0 }),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return data;
      },
      findUnique: async ({ where }: { where: { clientId: string } }) =>
        clients.find((c) => c.clientId === where.clientId) ?? null,
    },
    auditLog: { create: async () => ({}) },
  } as unknown as Db;
  return { db, created };
}

describe("client registration", () => {
  it("registers a public client and strips spoofing characters from the name", async () => {
    const { db, created } = fakeDb();
    const result = await registerClient(db, {
      client_name: "Chat‮GPT\u0000 ",
      redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
      token_endpoint_auth_method: "client_secret_basic",
    });
    expect(result.token_endpoint_auth_method).toBe("none");
    expect(result.client_name).toBe("ChatGPT");
    expect(result.client_id).toMatch(/^orcl_/);
    expect(created).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("secret\":");
  });
  it("rejects bad redirect URIs, grants and empty input", async () => {
    const { db } = fakeDb();
    await expect(registerClient(db, { redirect_uris: ["http://evil.example/cb"] })).rejects.toMatchObject({ error: "invalid_redirect_uri" });
    await expect(registerClient(db, { redirect_uris: ["https://a.example/cb"], grant_types: ["password"] })).rejects.toMatchObject({ error: "invalid_client_metadata" });
    await expect(registerClient(db, {})).rejects.toMatchObject({ error: "invalid_client_metadata" });
    await expect(registerClient(db, { redirect_uris: [] })).rejects.toMatchObject({ error: "invalid_client_metadata" });
  });
});

describe("authorize request validation", () => {
  const client = { id: "c1", clientId: "orcl_test", name: "Test", redirectUris: ["https://a.example/cb"] };
  const base = {
    clientId: "orcl_test",
    redirectUri: "https://a.example/cb",
    responseType: "code",
    scope: "read",
    state: "xyz",
    codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    codeChallengeMethod: "S256",
    resource: null,
  };

  it("accepts a good request", async () => {
    const { db } = fakeDb([client]);
    const result = await validateAuthorizeRequest(db, base);
    expect(result.ok).toBe(true);
  });
  it("never redirects when the client or redirect URI is wrong (no open redirector)", async () => {
    const { db } = fakeDb([client]);
    expect(await validateAuthorizeRequest(db, { ...base, clientId: "nope" })).toMatchObject({ ok: false, kind: "page" });
    expect(await validateAuthorizeRequest(db, { ...base, redirectUri: "https://evil.example/cb" })).toMatchObject({ ok: false, kind: "page" });
    expect(await validateAuthorizeRequest(db, { ...base, redirectUri: null })).toMatchObject({ ok: false, kind: "page" });
  });
  it("returns protocol errors to the client", async () => {
    const { db } = fakeDb([client]);
    const cases: Array<[Partial<typeof base>, string]> = [
      [{ codeChallenge: null as unknown as string }, "invalid_request"],
      [{ codeChallengeMethod: "plain" }, "invalid_request"],
      [{ responseType: "token" }, "unsupported_response_type"],
      [{ scope: "read send" }, "invalid_scope"],
      [{ resource: "https://other.example/api/mcp" }, "invalid_target"],
    ];
    for (const [override, error] of cases) {
      expect(await validateAuthorizeRequest(db, { ...base, ...override })).toMatchObject({ ok: false, kind: "redirect", error });
    }
  });
});
