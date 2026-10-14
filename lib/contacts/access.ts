/**
 * Who may do what to a contact. Pure so it is easy to test and reuse from the
 * dashboard routes now and from the REST/MCP layer later.
 *
 * - Everyone in the workspace can see contacts.
 * - Owners and admins can do everything, including assigning people.
 * - A member can record consent, opt-outs and takeovers only for the contacts
 *   assigned to them, and cannot reverse an opt-out or reassign anyone.
 */
export type ContactRole = "MEMBER" | "ADMIN" | "OWNER";
export type ContactAction = "view" | "assign" | "consent" | "optOut" | "optIn" | "takeover";

export function canActOnContact(input: {
  role: ContactRole;
  userId: string;
  assignedToUserId: string | null;
  action: ContactAction;
}): boolean {
  const manager = input.role === "ADMIN" || input.role === "OWNER";
  switch (input.action) {
    case "view":
      return true;
    case "assign":
    case "optIn":
      return manager;
    case "consent":
    case "optOut":
    case "takeover":
      return manager || (input.assignedToUserId !== null && input.assignedToUserId === input.userId);
  }
}
