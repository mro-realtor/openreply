import { describe, expect, it } from "vitest";
import { isInstagramWindowOpen, sequenceInput } from "@/lib/sequences/rules";

describe("Instagram sequences", () => {
  const interaction = 1_700_000_000_000;
  const day = 24 * 60 * 60 * 1000;

  it("only sends within 24 hours of a real interaction", () => {
    expect(isInstagramWindowOpen(undefined, interaction)).toBe(false);
    expect(isInstagramWindowOpen(interaction + 1, interaction)).toBe(false);
    expect(isInstagramWindowOpen(interaction, interaction + day - 1)).toBe(true);
    expect(isInstagramWindowOpen(interaction, interaction + day)).toBe(false);
  });

  it("rejects blank messages and schedules at or beyond the window", () => {
    const parse = (steps: unknown) => sequenceInput.safeParse({ name: "IB", steps });
    expect(parse([{ message: "Hi", delayMinutes: 60 }]).success).toBe(true);
    expect(parse([{ message: "  ", delayMinutes: 0 }]).success).toBe(false);
    expect(parse([
      { message: "Hi", delayMinutes: 120 },
      { message: "Hello", delayMinutes: 1320 },
    ]).success).toBe(false);
  });
});
