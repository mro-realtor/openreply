import { describe, expect, it } from "vitest";
import { getCooldownHours, isContactsDedupEnabled } from "@/lib/contacts/config";

describe("contacts config", () => {
  it("is off unless explicitly enabled", () => {
    expect(isContactsDedupEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isContactsDedupEnabled({ CONTACTS_DEDUP_ENABLED: "1" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(isContactsDedupEnabled({ CONTACTS_DEDUP_ENABLED: "true" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
  it("cooldown defaults to off and ignores junk", () => {
    expect(getCooldownHours({} as NodeJS.ProcessEnv)).toBe(0);
    expect(getCooldownHours({ CONTACT_DM_COOLDOWN_HOURS: "abc" } as unknown as NodeJS.ProcessEnv)).toBe(0);
    expect(getCooldownHours({ CONTACT_DM_COOLDOWN_HOURS: "-5" } as unknown as NodeJS.ProcessEnv)).toBe(0);
    expect(getCooldownHours({ CONTACT_DM_COOLDOWN_HOURS: "24" } as unknown as NodeJS.ProcessEnv)).toBe(24);
  });
});
