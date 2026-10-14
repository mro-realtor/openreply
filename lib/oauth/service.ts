import { z } from "zod";
import { recordAudit } from "@/lib/api/audit";
import { ISSUABLE_SCOPES, isIssuableScope, type Scope } from "@/lib/api/scopes";
import { generateApiToken } from "@/lib/api/tokens";
import type { Db } from "@/lib/api/types";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AUTH_CODE_TTL_SECONDS,
  AUTH_REQUEST_TTL_SECONDS,
  MAX_GRANT_LIFETIME_DAYS,
  REFRESH_TOKEN_TTL_DAYS,
  getIssuer,
  isAcceptedResource,
} from "@/lib/oauth/config";
import { OAuthError } from "@/lib/oauth/errors";
import { isValidCodeChallenge, verifyPkce } from "@/lib/oauth/pkce";
import { isValidRedirectUri, redirectUriMatches } from "@/lib/oauth/redirect";
import { parseRequestedScopes } from "@/lib/oauth/scopes";
import {
  generateAuthorizationCode,
  generateClientId,
  generateRefreshToken,
  generateRequestId,
  hashSecret,
  isWellFormedRefreshToken,
} from "@/lib/oauth/secrets";

const DAY_MS = 86_400_000;
const STALE_CLIENT_DAYS = 7;

// ---------- Dynamic Client Registration (RFC 7591) ----------

const registrationSchema = z.object({
  client_name: z.string().optional(),
  redirect_uris: z.array(z.string()).min(1).max(5),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
});

function cleanClientName(value: string | undefined): string {
  // Strip control and bidi override characters so the name cannot spoof the consent screen.
  const cleaned = (value ?? "")
    .replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, "")
    .trim()
    .slice(0, 80);
  return cleaned || "MCP client";
}

export async function registerClient(db: Db, body: unknown, now = new Date()) {
  const parsed = registrationSchema.safeParse(body);
  if (!parsed.success) {
    throw new OAuthError("invalid_client_metadata", "redirect_uris is required (1 to 5 URIs)");
  }
  const input = parsed.data;
  if (!input.redirect_uris.every(isValidRedirectUri)) {
    throw new OAuthError(
      "invalid_redirect_uri",
      "Redirect URIs must be https, or http on localhost, without fragments"
    );
  }
  const grantTypes = input.grant_types ?? ["authorization_code"];
  if (!grantTypes.every((g) => g === "authorization_code" || g === "refresh_token")) {
    throw new OAuthError("invalid_client_metadata", "Only authorization_code and refresh_token grants are supported");
  }
  const responseTypes = input.response_types ?? ["code"];
  if (!responseTypes.every((r) => r === "code")) {
    throw new OAuthError("invalid_client_metadata", "Only the code response type is supported");
  }

  // Registration is open by design (MCP clients register themselves), so keep
  // the table small: drop clients that never completed an authorization.
  await db.oAuthClient
    .deleteMany({
      where: {
        createdAt: { lt: new Date(now.getTime() - STALE_CLIENT_DAYS * DAY_MS) },
        grants: { none: {} },
      },
    })
    .catch(() => {});

  const clientId = generateClientId();
  const name = cleanClientName(input.client_name);
  const redirectUris = Array.from(new Set(input.redirect_uris));
  await db.oAuthClient.create({ data: { clientId, name, redirectUris } });
  await recordAudit(db, {
    channel: "OAUTH",
    action: "oauth.client_register",
    targetType: "OAuthClient",
    targetId: clientId,
    outcome: "SUCCESS",
    details: { name, redirectUris },
  });

  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(now.getTime() / 1000),
    client_name: name,
    redirect_uris: redirectUris,
    grant_types: grantTypes,
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

// ---------- Authorization request ----------

export interface AuthorizeParams {
  clientId: string | null;
  redirectUri: string | null;
  responseType: string | null;
  scope: string | null;
  state: string | null;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
  resource: string | null;
}

export type AuthorizeValidation =
  | { ok: false; kind: "page"; message: string }
  | {
      ok: false;
      kind: "redirect";
      redirectUri: string;
      state: string | null;
      error: string;
      description: string;
    }
  | {
      ok: true;
      client: { id: string; clientId: string; name: string };
      redirectUri: string;
      scopes: Scope[];
      state: string | null;
      codeChallenge: string;
      resource: string | null;
    };

/**
 * Per RFC 6749 section 4.1.2.1, problems with the client or redirect URI are
 * shown to the user and never redirected, so this endpoint cannot be used as
 * an open redirector. Everything else is returned to the client as an error.
 */
export async function validateAuthorizeRequest(
  db: Db,
  params: AuthorizeParams
): Promise<AuthorizeValidation> {
  if (!params.clientId) return { ok: false, kind: "page", message: "Missing client_id." };
  const client = await db.oAuthClient.findUnique({ where: { clientId: params.clientId } });
  if (!client) return { ok: false, kind: "page", message: "Unknown application." };
  if (!params.redirectUri || !redirectUriMatches(client.redirectUris, params.redirectUri)) {
    return {
      ok: false,
      kind: "page",
      message: "The redirect address does not match what this application registered.",
    };
  }
  const redirectUri = params.redirectUri;
  const state = params.state && params.state.length <= 2048 ? params.state : null;
  const fail = (error: string, description: string): AuthorizeValidation => ({
    ok: false,
    kind: "redirect",
    redirectUri,
    state,
    error,
    description,
  });

  if (params.state && params.state.length > 2048) return fail("invalid_request", "state is too long");
  if (params.responseType !== "code") return fail("unsupported_response_type", "Only response_type=code is supported");
  if (!params.codeChallenge || !isValidCodeChallenge(params.codeChallenge)) {
    return fail("invalid_request", "A PKCE code_challenge is required");
  }
  if (params.codeChallengeMethod !== "S256") {
    return fail("invalid_request", "code_challenge_method must be S256");
  }
  let resource: string | null = null;
  if (params.resource) {
    if (!isAcceptedResource(params.resource)) {
      return fail("invalid_target", "resource must be this server's MCP endpoint");
    }
    resource = params.resource;
  }
  let scopes: Scope[];
  try {
    scopes = parseRequestedScopes(params.scope);
  } catch (error) {
    if (error instanceof OAuthError) return fail(error.error, error.message);
    throw error;
  }

  return {
    ok: true,
    client: { id: client.id, clientId: client.clientId, name: client.name },
    redirectUri,
    scopes,
    state,
    codeChallenge: params.codeChallenge,
    resource,
  };
}

export async function createAuthorizationRequest(
  db: Db,
  input: {
    clientRefId: string;
    userId: string;
    redirectUri: string;
    scopes: Scope[];
    state: string | null;
    codeChallenge: string;
    resource: string | null;
  },
  now = new Date()
): Promise<string> {
  const id = generateRequestId();
  // Housekeeping: expired, unused requests are of no further use.
  await db.oAuthAuthorizationRequest
    .deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - DAY_MS) } } })
    .catch(() => {});
  await db.oAuthAuthorizationRequest.create({
    data: {
      id,
      clientRefId: input.clientRefId,
      userId: input.userId,
      redirectUri: input.redirectUri,
      scopes: input.scopes,
      state: input.state,
      codeChallenge: input.codeChallenge,
      resource: input.resource,
      expiresAt: new Date(now.getTime() + AUTH_REQUEST_TTL_SECONDS * 1000),
    },
  });
  return id;
}

export function buildAuthorizationRedirect(
  redirectUri: string,
  params: Record<string, string | null>
): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null) url.searchParams.set(key, value);
  }
  // RFC 9207: tells the client which server answered, defeating mix-up attacks.
  url.searchParams.set("iss", getIssuer());
  return url.toString();
}

/** Loads a pending request for the consent page. Returns null if unusable. */
export async function loadPendingRequest(
  db: Db,
  requestId: string,
  userId: string,
  now = new Date()
) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(requestId)) return null;
  const request = await db.oAuthAuthorizationRequest.findUnique({
    where: { id: requestId },
    include: { client: { select: { name: true, clientId: true } } },
  });
  if (!request || request.userId !== userId) return null;
  if (request.usedAt || request.expiresAt.getTime() <= now.getTime()) return null;
  return request;
}

export interface Decision {
  redirectTo: string;
  approved: boolean;
}

/**
 * Records the owner's decision. The request row is claimed atomically, so a
 * double submit or a replay cannot mint two codes. The approved scopes are the
 * intersection of what the client asked for and what the owner left ticked.
 */
export async function decideAuthorization(
  db: Db,
  input: {
    requestId: string;
    userId: string;
    workspaceId: string;
    approve: boolean;
    approvedScopes: string[];
  },
  now = new Date()
): Promise<Decision> {
  const request = await loadPendingRequest(db, input.requestId, input.userId, now);
  if (!request) throw new OAuthError("invalid_request", "This authorization request has expired", 400);

  const claimed = await db.oAuthAuthorizationRequest.updateMany({
    where: { id: request.id, usedAt: null, userId: input.userId },
    data: { usedAt: now },
  });
  if (claimed.count !== 1) {
    throw new OAuthError("invalid_request", "This authorization request was already used", 400);
  }

  if (!input.approve) {
    await recordAudit(db, {
      workspaceId: input.workspaceId,
      actorUserId: input.userId,
      channel: "OAUTH",
      action: "oauth.authorize_denied",
      targetType: "OAuthClient",
      targetId: request.client.clientId,
      outcome: "DENIED",
    });
    return {
      approved: false,
      redirectTo: buildAuthorizationRedirect(request.redirectUri, {
        error: "access_denied",
        error_description: "The owner declined the request",
        state: request.state,
      }),
    };
  }

  const scopes = request.scopes.filter(
    (scope) => input.approvedScopes.includes(scope) && isIssuableScope(scope)
  );
  if (scopes.length === 0) {
    throw new OAuthError("invalid_scope", "Approve at least one permission", 400);
  }

  const code = generateAuthorizationCode();
  const grant = await db.oAuthGrant.create({
    data: {
      clientRefId: request.clientRefId,
      userId: input.userId,
      workspaceId: input.workspaceId,
      scopes,
      codes: {
        create: {
          codeHash: code.hash,
          redirectUri: request.redirectUri,
          codeChallenge: request.codeChallenge,
          resource: request.resource,
          expiresAt: new Date(now.getTime() + AUTH_CODE_TTL_SECONDS * 1000),
        },
      },
    },
    select: { id: true },
  });
  await recordAudit(db, {
    workspaceId: input.workspaceId,
    actorUserId: input.userId,
    channel: "OAUTH",
    action: "oauth.authorize_approved",
    targetType: "OAuthGrant",
    targetId: grant.id,
    outcome: "SUCCESS",
    details: { client: request.client.name, scopes },
  });

  return {
    approved: true,
    redirectTo: buildAuthorizationRedirect(request.redirectUri, {
      code: code.secret,
      state: request.state,
    }),
  };
}

// ---------- Token endpoint ----------

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

async function issueTokens(
  db: Db,
  grant: { id: string; userId: string; workspaceId: string; scopes: string[]; createdAt: Date },
  clientName: string,
  scopes: string[],
  now: Date
): Promise<TokenResponse> {
  const access = generateApiToken();
  const refresh = generateRefreshToken();
  const grantEnd = grant.createdAt.getTime() + MAX_GRANT_LIFETIME_DAYS * DAY_MS;
  const refreshExpiry = Math.min(now.getTime() + REFRESH_TOKEN_TTL_DAYS * DAY_MS, grantEnd);

  await db.apiToken.create({
    data: {
      workspaceId: grant.workspaceId,
      createdByUserId: grant.userId,
      name: `OAuth: ${clientName}`.slice(0, 60),
      tokenPrefix: access.displayPrefix,
      tokenHash: access.hash,
      scopes,
      expiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000),
      grantId: grant.id,
    },
  });
  await db.oAuthRefreshToken.create({
    data: { tokenHash: refresh.hash, grantId: grant.id, expiresAt: new Date(refreshExpiry) },
  });

  return {
    access_token: access.secret,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refresh.secret,
    scope: scopes.join(" "),
  };
}

export async function revokeGrant(db: Db, grantId: string, now = new Date()): Promise<void> {
  await db.oAuthGrant.updateMany({
    where: { id: grantId, revokedAt: null },
    data: { revokedAt: now },
  });
  await db.apiToken.updateMany({
    where: { grantId, revokedAt: null },
    data: { revokedAt: now },
  });
}

export async function exchangeAuthorizationCode(
  db: Db,
  input: {
    clientId: string | null;
    code: string | null;
    redirectUri: string | null;
    codeVerifier: string | null;
    resource: string | null;
  },
  now = new Date()
): Promise<TokenResponse> {
  const invalidGrant = () => new OAuthError("invalid_grant", "The authorization code is invalid or expired");
  if (!input.clientId) throw new OAuthError("invalid_request", "client_id is required");
  if (!input.code || !input.codeVerifier || !input.redirectUri) {
    throw new OAuthError("invalid_request", "code, redirect_uri and code_verifier are required");
  }
  const client = await db.oAuthClient.findUnique({ where: { clientId: input.clientId } });
  if (!client) throw new OAuthError("invalid_client", "Unknown client");

  const record = await db.oAuthAuthorizationCode.findUnique({
    where: { codeHash: hashSecret(input.code) },
    include: { grant: true },
  });
  if (!record || record.grant.clientRefId !== client.id) throw invalidGrant();

  // A code can be used once. Seeing it again means it leaked, so kill what it produced.
  const claimed = await db.oAuthAuthorizationCode.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: now },
  });
  if (claimed.count !== 1) {
    await revokeGrant(db, record.grantId, now);
    await recordAudit(db, {
      workspaceId: record.grant.workspaceId,
      channel: "OAUTH",
      action: "oauth.code_reuse",
      targetType: "OAuthGrant",
      targetId: record.grantId,
      outcome: "DENIED",
    });
    throw invalidGrant();
  }

  if (record.expiresAt.getTime() <= now.getTime() || record.grant.revokedAt) throw invalidGrant();
  if (record.redirectUri !== input.redirectUri) throw invalidGrant();
  if (!verifyPkce(input.codeVerifier, record.codeChallenge)) throw invalidGrant();
  if (input.resource) {
    if (!isAcceptedResource(input.resource) || (record.resource && record.resource !== input.resource)) {
      throw new OAuthError("invalid_target", "resource does not match the authorization request");
    }
  }

  const tokens = await issueTokens(db, record.grant, client.name, record.grant.scopes, now);
  await recordAudit(db, {
    workspaceId: record.grant.workspaceId,
    actorUserId: record.grant.userId,
    channel: "OAUTH",
    action: "oauth.token_issued",
    targetType: "OAuthGrant",
    targetId: record.grantId,
    outcome: "SUCCESS",
    details: { grant_type: "authorization_code", scopes: record.grant.scopes },
  });
  return tokens;
}

export async function exchangeRefreshToken(
  db: Db,
  input: {
    clientId: string | null;
    refreshToken: string | null;
    scope: string | null;
    resource: string | null;
  },
  now = new Date()
): Promise<TokenResponse> {
  const invalidGrant = () => new OAuthError("invalid_grant", "The refresh token is invalid or expired");
  if (!input.clientId) throw new OAuthError("invalid_request", "client_id is required");
  if (!input.refreshToken || !isWellFormedRefreshToken(input.refreshToken)) throw invalidGrant();
  const client = await db.oAuthClient.findUnique({ where: { clientId: input.clientId } });
  if (!client) throw new OAuthError("invalid_client", "Unknown client");

  const record = await db.oAuthRefreshToken.findUnique({
    where: { tokenHash: hashSecret(input.refreshToken) },
    include: { grant: true },
  });
  if (!record || record.grant.clientRefId !== client.id) throw invalidGrant();

  if (record.grant.revokedAt || record.expiresAt.getTime() <= now.getTime()) throw invalidGrant();
  if (input.resource && !isAcceptedResource(input.resource)) {
    throw new OAuthError("invalid_target", "resource must be this server's MCP endpoint");
  }

  // A refresh may narrow scope, never widen it. Checked before the token is
  // spent, so a client mistake does not burn a good refresh token.
  let scopes = record.grant.scopes;
  if (input.scope) {
    const requested = parseRequestedScopes(input.scope);
    if (!requested.every((scope) => record.grant.scopes.includes(scope))) {
      throw new OAuthError("invalid_scope", "Requested scope exceeds the original grant");
    }
    scopes = requested;
  }

  // Rotation: each refresh token works once. Presenting a spent one means two
  // parties hold it, so the whole grant is revoked (OAuth 2.1 section 4.3.1).
  const claimed = await db.oAuthRefreshToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: now },
  });
  if (claimed.count !== 1) {
    await revokeGrant(db, record.grantId, now);
    await recordAudit(db, {
      workspaceId: record.grant.workspaceId,
      channel: "OAUTH",
      action: "oauth.refresh_reuse",
      targetType: "OAuthGrant",
      targetId: record.grantId,
      outcome: "DENIED",
    });
    throw invalidGrant();
  }

  const tokens = await issueTokens(db, record.grant, client.name, scopes, now);
  await recordAudit(db, {
    workspaceId: record.grant.workspaceId,
    actorUserId: record.grant.userId,
    channel: "OAUTH",
    action: "oauth.token_refreshed",
    targetType: "OAuthGrant",
    targetId: record.grantId,
    outcome: "SUCCESS",
    details: { scopes },
  });
  return tokens;
}

/** RFC 7009. Always succeeds from the caller's point of view; revokes the whole grant. */
export async function revokeByToken(
  db: Db,
  input: { clientId: string | null; token: string | null },
  now = new Date()
): Promise<void> {
  if (!input.clientId || !input.token) return;
  const client = await db.oAuthClient.findUnique({ where: { clientId: input.clientId } });
  if (!client) return;

  let grantId: string | null = null;
  if (isWellFormedRefreshToken(input.token)) {
    const refresh = await db.oAuthRefreshToken.findUnique({
      where: { tokenHash: hashSecret(input.token) },
      select: { grant: { select: { id: true, clientRefId: true } } },
    });
    if (refresh?.grant.clientRefId === client.id) grantId = refresh.grant.id;
  } else {
    const access = await db.apiToken.findUnique({
      where: { tokenHash: hashSecret(input.token) },
      select: { grantId: true },
    });
    if (access?.grantId) {
      const grant = await db.oAuthGrant.findUnique({
        where: { id: access.grantId },
        select: { id: true, clientRefId: true },
      });
      if (grant?.clientRefId === client.id) grantId = grant.id;
    }
  }
  if (!grantId) return;
  await revokeGrant(db, grantId, now);
  await recordAudit(db, {
    channel: "OAUTH",
    action: "oauth.revoked_by_client",
    targetType: "OAuthGrant",
    targetId: grantId,
    outcome: "SUCCESS",
  });
}

export { ISSUABLE_SCOPES };
