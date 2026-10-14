import { describe, expect, it } from "vitest";
import { followGateAllowsReveal, missingForActivation, validateComposerSettings } from "@/lib/campaigns/settings";

describe("follow gate after a tap", () => {
  it("normal mode keeps the original behaviour: only a confirmed non-follower is refused", () => {
    expect(followGateAllowsReveal({ strict: false, follows: true })).toBe(true);
    expect(followGateAllowsReveal({ strict: false, follows: null })).toBe(true);
    expect(followGateAllowsReveal({ strict: false, follows: false })).toBe(false);
  });
  it("strict mode needs a confirmed follower", () => {
    expect(followGateAllowsReveal({ strict: true, follows: true })).toBe(true);
    expect(followGateAllowsReveal({ strict: true, follows: null })).toBe(false);
    expect(followGateAllowsReveal({ strict: true, follows: false })).toBe(false);
  });
});

describe("composer setting combinations", () => {
  const base = { requireFollow: false, followGateStrict: false, textOnly: false, openingDmEnabled: false };
  it("accepts every setting on its own and the defaults", () => {
    expect(validateComposerSettings(base)).toBeNull();
    expect(validateComposerSettings({ ...base, textOnly: true })).toBeNull();
    expect(validateComposerSettings({ ...base, requireFollow: true })).toBeNull();
    expect(validateComposerSettings({ ...base, requireFollow: true, followGateStrict: true })).toBeNull();
    expect(validateComposerSettings({ ...base, requireFollow: true, openingDmEnabled: true })).toBeNull();
  });
  it("rejects strict without the follow gate", () => {
    expect(validateComposerSettings({ ...base, followGateStrict: true })).toMatch(/strict/i);
  });
  it("rejects text-only together with anything that needs a button", () => {
    expect(validateComposerSettings({ ...base, textOnly: true, requireFollow: true })).toMatch(/follow gate/i);
    expect(validateComposerSettings({ ...base, textOnly: true, openingDmEnabled: true })).toMatch(/opening DM/i);
  });
});

describe("what a draft needs before it can go live", () => {
  const ready = { name: "Spring", dmMessage: "hi", postId: "p1", matchAnyPost: false, pendingNextReel: false, matchAnyWord: false, keywords: ["link"] };
  it("is ready when it has a name, a message and a keyword (a trigger post is not required)", () => {
    expect(missingForActivation(ready)).toEqual([]);
    expect(missingForActivation({ ...ready, postId: null, matchAnyPost: true, keywords: [], matchAnyWord: true })).toEqual([]);
    expect(missingForActivation({ ...ready, postId: null, pendingNextReel: true })).toEqual([]);
  });
  it("lists everything that is missing in plain words", () => {
    expect(missingForActivation({ ...ready, postId: null })).toEqual([]);
    expect(missingForActivation({ ...ready, keywords: [] })).toEqual(["a keyword, or match any word"]);
    expect(missingForActivation({ ...ready, name: " ", dmMessage: "", postId: null, keywords: [] })).toEqual([
      "a name",
      "the message to send",
      "a keyword, or match any word",
    ]);
  });
});
