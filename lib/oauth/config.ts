import { ISSUABLE_SCOPES } from "@/lib/api/scopes";

/** OAuth ships disabled. Set OAUTH_ENABLED=true to turn it on. */
export function isOAuthEnabled(): boolean {
  return process.env.OAUTH_ENABLED === "true";
}

export const ACCESS_TOKEN_TTL_SECONDS = 3600;
export const REFRESH_TOKEN_TTL_DAYS = 30;
export const MAX_GRANT_LIFETIME_DAYS = 90;
export const AUTH_CODE_TTL_SECONDS = 60;
export const AUTH_REQUEST_TTL_SECONDS = 600;

/** Public origin of this deployment, from NEXTAUTH_URL. No trailing slash. */
export function getIssuer(): string {
  const raw = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  return new URL(raw).origin;
}

/** The protected resource tokens are issued for (RFC 8707 audience). */
export function getMcpResource(): string {
  return `${getIssuer()}/api/mcp`;
}

export function getResourceMetadataUrl(): string {
  return `${getIssuer()}/.well-known/oauth-protected-resource/api/mcp`;
}

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

/**
 * A client may name the MCP endpoint or the server origin as its resource.
 * Anything else is a request for a token for someone else's service.
 */
export function isAcceptedResource(value: string): boolean {
  const normalized = stripTrailingSlash(value);
  return normalized === getMcpResource() || normalized === getIssuer();
}

export function getAuthorizationServerMetadata() {
  const issuer = getIssuer();
  return {
    issuer,
    authorization_endpoint: `${issuer}/api/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    registration_endpoint: `${issuer}/api/oauth/register`,
    revocation_endpoint: `${issuer}/api/oauth/revoke`,
    scopes_supported: [...ISSUABLE_SCOPES],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: false,
  };
}

export function getProtectedResourceMetadata() {
  return {
    resource: getMcpResource(),
    authorization_servers: [getIssuer()],
    scopes_supported: [...ISSUABLE_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "OpenReply",
  };
}
