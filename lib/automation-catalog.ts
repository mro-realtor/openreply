export type AutomationChannel = "instagram" | "facebook";

export type AutomationTemplate = {
  id: string;
  name: string;
  description: string;
  channel: AutomationChannel;
  goal: "engage" | "traffic" | "growth";
  trigger: "comment" | "dm" | "story" | "live";
  builder: "Quick Setup" | "Flow Builder";
  support: "supported" | "unavailable";
  destination?: string;
  unavailableReason?: string;
};

export const automationTemplates: AutomationTemplate[] = [
  {
    id: "instagram-comment-to-dm",
    name: "Auto-DM links from comments",
    description: "Send a private reply when someone comments on a post or reel.",
    channel: "instagram",
    goal: "traffic",
    trigger: "comment",
    builder: "Quick Setup",
    support: "supported",
    destination: "/campaigns/new",
  },
  {
    id: "instagram-story-reply",
    name: "Generate leads with stories",
    description: "Start a DM flow when someone replies to your story.",
    channel: "instagram",
    goal: "engage",
    trigger: "story",
    builder: "Quick Setup",
    support: "unavailable",
    unavailableReason: "Story-triggered automation setup is not available yet.",
  },
  {
    id: "instagram-dm-all",
    name: "Respond to all your DMs",
    description: "Build an automated response for incoming Instagram messages.",
    channel: "instagram",
    goal: "engage",
    trigger: "dm",
    builder: "Quick Setup",
    support: "unavailable",
    unavailableReason: "An all-message default reply is not available yet.",
  },
  {
    id: "instagram-ai",
    name: "Automate conversations with AI",
    description: "Let AI collect details and recommend the next step.",
    channel: "instagram",
    goal: "growth",
    trigger: "dm",
    builder: "Flow Builder",
    support: "unavailable",
    unavailableReason: "AI workflow actions are not available yet.",
  },
  {
    id: "facebook-message",
    name: "Automate Messenger conversations",
    description: "Respond to a Facebook Page message with an automation.",
    channel: "facebook",
    goal: "engage",
    trigger: "dm",
    builder: "Flow Builder",
    support: "unavailable",
    unavailableReason: "The Facebook automation builder is not available yet.",
  },
  {
    id: "facebook-comment",
    name: "Reply to Facebook post comments",
    description: "Send a Messenger reply when someone comments on a post.",
    channel: "facebook",
    goal: "traffic",
    trigger: "comment",
    builder: "Flow Builder",
    support: "unavailable",
    unavailableReason: "Facebook comment triggers are not available yet.",
  },
];

export type AutomationTemplateFilters = {
  channel: AutomationChannel;
  goal: "all" | AutomationTemplate["goal"];
  trigger: "all" | AutomationTemplate["trigger"];
  search: string;
};

export function filterAutomationTemplates({
  channel,
  goal,
  trigger,
  search,
}: AutomationTemplateFilters): AutomationTemplate[] {
  const query = search.trim().toLowerCase();
  return automationTemplates.filter((template) => {
    if (template.channel !== channel) return false;
    if (goal !== "all" && template.goal !== goal) return false;
    if (trigger !== "all" && template.trigger !== trigger) return false;
    return !query || `${template.name} ${template.description}`.toLowerCase().includes(query);
  });
}

export function getTemplateDestination(
  template: AutomationTemplate | undefined
): string | null {
  return template?.support === "supported" ? template.destination ?? null : null;
}

export function canStartAutomationFromScratch(channel: AutomationChannel): boolean {
  return channel === "instagram";
}
