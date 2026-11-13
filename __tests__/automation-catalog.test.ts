import { describe, expect, it } from "vitest";
import {
  automationTemplates,
  canStartAutomationFromScratch,
  filterAutomationTemplates,
  getTemplateDestination,
} from "@/lib/automation-catalog";

describe("automation template catalog", () => {
  it("allows Instagram comment setup through the existing campaign builder", () => {
    const template = automationTemplates.find(
      (item) => item.id === "instagram-comment-to-dm"
    );

    expect(template?.channel).toBe("instagram");
    expect(getTemplateDestination(template!)).toBe("/campaigns/new");
  });

  it("keeps unsupported Facebook and AI templates disabled without destinations", () => {
    const unsupported = automationTemplates.filter(
      (item) => item.channel === "facebook" || item.id === "instagram-ai"
    );

    expect(unsupported.length).toBeGreaterThan(0);
    expect(unsupported.every((item) => item.support === "unavailable")).toBe(true);
    expect(unsupported.every((item) => getTemplateDestination(item) === null)).toBe(
      true
    );
  });

  it("filters templates by channel, goal, trigger, and search together", () => {
    const result = filterAutomationTemplates({
      channel: "instagram",
      goal: "traffic",
      trigger: "comment",
      search: "links",
    });

    expect(result.map((item) => item.id)).toEqual(["instagram-comment-to-dm"]);
  });

  it("only offers scratch setup for a channel with an existing builder", () => {
    expect(canStartAutomationFromScratch("instagram")).toBe(true);
    expect(canStartAutomationFromScratch("facebook")).toBe(false);
  });
});
