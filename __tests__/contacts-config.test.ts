import { describe, expect, it } from "vitest";
import { getCooldownHours, isContactsDedupEnabled } from "@/lib/contacts/config";

const env = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv;

describe("contacts config", () => {
  it("is off unless explicitly enabled", () => {
    expect(isContactsDedupEnabled(env({}))).toBe(false);
    expect(isContactsDedupEnabled(env({ CONTACTS_DEDUP_ENABLED: "1" }))).toBe(false);
    expect(isContactsDedupEnabled(env({ CONTACTS_DEDUP_ENABLED: "true" }))).toBe(true);
  });
  it("cooldown defaults to off and ignores junk", () => {
    expect(getCooldownHours(env({}))).toBe(0);
    expect(getCooldownHours(env({ CONTACT_DM_COOLDOWN_HOURS: "abc" }))).toBe(0);
    expect(getCooldownHours(env({ CONTACT_DM_COOLDOWN_HOURS: "-5" }))).toBe(0);
    expect(getCooldownHours(env({ CONTACT_DM_COOLDOWN_HOURS: "24" }))).toBe(24);
  });
});
