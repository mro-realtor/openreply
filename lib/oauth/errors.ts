export class OAuthError extends Error {
  readonly error: string;
  readonly status: number;
  readonly headers: Record<string, string>;

  constructor(
    error: string,
    description: string,
    status = 400,
    headers: Record<string, string> = {}
  ) {
    super(description);
    this.name = "OAuthError";
    this.error = error;
    this.status = status;
    this.headers = headers;
  }
}

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

export const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

export function oauthJson(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: { ...NO_STORE_HEADERS, ...CORS_HEADERS, ...extra },
  });
}

export function oauthErrorResponse(error: OAuthError) {
  return oauthJson(
    { error: error.error, error_description: error.message },
    error.status,
    error.headers
  );
}

export function corsPreflight() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function notFoundResponse() {
  return new Response("Not found", { status: 404, headers: NO_STORE_HEADERS });
}
