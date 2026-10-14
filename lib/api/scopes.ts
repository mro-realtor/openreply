/**
 * Permission scopes for API tokens.
 *
 * Only scopes whose features exist are issuable. The rest are reserved names
 * so the permission model is stable, but a token cannot be created with them
 * until the matching tools ship and are reviewed.
 */

export const SCOPE_DEFINITIONS = {
  read: {
    description: "View connected accounts, campaigns and delivery logs",
    issuable: true,
  },
  "drafts:write": {
    description: "Create and edit inactive draft campaigns",
    issuable: true,
  },
  "campaigns:modify": {
    description: "Edit campaigns that are already active (reserved)",
    issuable: false,
  },
  "leads:read": {
    description: "Read lead and contact data (reserved)",
    issuable: false,
  },
  send: {
    description: "Send messages (reserved, no tool exposes this)",
    issuable: false,
  },
  activate: {
    description: "Activate or pause campaigns (reserved)",
    issuable: false,
  },
} as const;

export type Scope = keyof typeof SCOPE_DEFINITIONS;

export const ALL_SCOPES = Object.keys(SCOPE_DEFINITIONS) as Scope[];

export const ISSUABLE_SCOPES = ALL_SCOPES.filter(
  (scope) => SCOPE_DEFINITIONS[scope].issuable
);

/** Scope granted when a token is created without an explicit choice. */
export const DEFAULT_SCOPES: Scope[] = ["read"];

export function isScope(value: string): value is Scope {
  return (ALL_SCOPES as string[]).includes(value);
}

export function isIssuableScope(value: string): value is Scope {
  return (ISSUABLE_SCOPES as string[]).includes(value);
}

export function hasScope(granted: readonly string[], required: Scope): boolean {
  return granted.includes(required);
}
