import { apiErrors } from "@/lib/api/errors";

/** Both surfaces ship disabled. Set the env var to "true" to turn one on. */
export function isApiV1Enabled(): boolean {
  return process.env.API_V1_ENABLED === "true";
}

export function isMcpEnabled(): boolean {
  return process.env.MCP_ENABLED === "true";
}

export function assertApiEnabled(): void {
  if (!isApiV1Enabled()) throw apiErrors.featureDisabled();
}

export function assertMcpEnabled(): void {
  if (!isMcpEnabled()) throw apiErrors.featureDisabled();
}
