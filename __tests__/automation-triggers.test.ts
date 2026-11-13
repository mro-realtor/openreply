import { describe, expect, it } from "vitest";
import { hasCommentTrigger } from "@/lib/automation-triggers";

describe("automation trigger classification", () => {
  it("does not include DM-only automations in the post comment filter", () => {
    expect(
      hasCommentTrigger({
        postId: null,
        matchAnyPost: false,
        pendingNextReel: false,
      })
    ).toBe(false);
  });

  it("includes specific, any-post, and next-reel comment automations", () => {
    expect(hasCommentTrigger({ postId: "post-1", matchAnyPost: false, pendingNextReel: false })).toBe(true);
    expect(hasCommentTrigger({ postId: null, matchAnyPost: true, pendingNextReel: false })).toBe(true);
    expect(hasCommentTrigger({ postId: null, matchAnyPost: false, pendingNextReel: true })).toBe(true);
  });
});
