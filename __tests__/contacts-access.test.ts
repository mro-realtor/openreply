import { describe, expect, it } from "vitest";
import { canActOnContact, type ContactAction } from "@/lib/contacts/access";

const base = { userId: "nancy", assignedToUserId: "nancy" as string | null };
const can = (role: "MEMBER" | "ADMIN" | "OWNER", action: ContactAction, over: Partial<typeof base> = {}) =>
  canActOnContact({ role, ...base, ...over, action });

describe("contact permissions", () => {
  it("lets everyone view", () => {
    for (const role of ["MEMBER", "ADMIN", "OWNER"] as const) expect(can(role, "view", { assignedToUserId: null })).toBe(true);
  });
  it("lets owners and admins do everything", () => {
    for (const role of ["ADMIN", "OWNER"] as const) {
      for (const action of ["assign", "consent", "optOut", "optIn", "takeover"] as const) {
        expect(can(role, action, { assignedToUserId: "someone-else" })).toBe(true);
      }
    }
  });
  it("lets a member act only on contacts assigned to them", () => {
    for (const action of ["consent", "optOut", "takeover"] as const) {
      expect(can("MEMBER", action)).toBe(true);
      expect(can("MEMBER", action, { assignedToUserId: "someone-else" })).toBe(false);
      expect(can("MEMBER", action, { assignedToUserId: null })).toBe(false);
    }
  });
  it("never lets a member reassign or reverse an opt-out", () => {
    expect(can("MEMBER", "assign")).toBe(false);
    expect(can("MEMBER", "optIn")).toBe(false);
  });
});
