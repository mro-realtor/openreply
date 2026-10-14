import { generateReportShareSlug } from "@/lib/reports/share";
import { buildTrackedUrl } from "@/lib/tracking/message";
import { generateTrackedLinkSlug } from "@/lib/tracking/server";
import type {
  CreateDraftInput,
  UpdateDraftInput,
} from "@/lib/services/campaign-schemas";

/** Fields every campaign read selects. Never includes tokens or share slugs. */
export const CAMPAIGN_SELECT = {
  id: true,
  name: true,
  goal: true,
  isActive: true,
  isDraft: true,
  postId: true,
  postUrl: true,
  matchAnyPost: true,
  pendingNextReel: true,
  keywords: true,
  matchAnyWord: true,
  wholeWordMatch: true,
  dmTriggerEnabled: true,
  dmMessage: true,
  openingDmEnabled: true,
  openingDmMessage: true,
  openingDmButtonLabel: true,
  linkButtonLabel: true,
  requireFollow: true,
  followPromptMessage: true,
  followPromptButtonLabel: true,
  followGateStrict: true,
  textOnly: true,
  defaultAssigneeUserId: true,
  followUpEnabled: true,
  followUpMessage: true,
  followUpDelayMinutes: true,
  publicReplyEnabled: true,
  publicReplyMessages: true,
  draftConfig: true,
  createdAt: true,
  updatedAt: true,
  instagramAccount: { select: { id: true, username: true } },
  trackedLinks: {
    select: { id: true, slug: true, label: true, destinationUrl: true },
    orderBy: { createdAt: "asc" },
  },
} as const;

export interface CampaignRow {
  id: string;
  name: string;
  goal: string | null;
  isActive: boolean;
  isDraft: boolean;
  postId: string | null;
  postUrl: string | null;
  matchAnyPost: boolean;
  pendingNextReel: boolean;
  keywords: string[];
  matchAnyWord: boolean;
  wholeWordMatch: boolean;
  dmTriggerEnabled: boolean;
  dmMessage: string;
  openingDmEnabled: boolean;
  openingDmMessage: string | null;
  openingDmButtonLabel: string | null;
  linkButtonLabel: string | null;
  requireFollow: boolean;
  followPromptMessage: string | null;
  followPromptButtonLabel: string | null;
  followGateStrict: boolean;
  textOnly: boolean;
  defaultAssigneeUserId: string | null;
  followUpEnabled: boolean;
  followUpMessage: string | null;
  followUpDelayMinutes: number;
  publicReplyEnabled: boolean;
  publicReplyMessages: string[];
  draftConfig: unknown;
  createdAt: Date;
  updatedAt: Date;
  instagramAccount: { id: string; username: string };
  trackedLinks: {
    id: string;
    slug: string;
    label: string | null;
    destinationUrl: string;
  }[];
}

export type CampaignStatus = "draft" | "active" | "paused";

export function campaignStatus(row: Pick<CampaignRow, "isActive" | "isDraft">): CampaignStatus {
  if (row.isActive) return "active";
  return row.isDraft ? "draft" : "paused";
}

/** What still blocks a human from sensibly activating this campaign. */
export function activationChecklist(row: CampaignRow): string[] {
  const issues: string[] = [];
  if (!row.matchAnyPost && !row.pendingNextReel && !row.postId) {
    issues.push("No post selected. Choose a post, any post, or the next reel.");
  }
  if (!row.matchAnyWord && row.keywords.length === 0) {
    issues.push("No trigger keyword. Add a keyword or match any word.");
  }
  if (row.requireFollow && !row.followPromptMessage?.trim()) {
    issues.push("Follow gate is on but has no prompt message.");
  }
  return issues;
}

export function toCampaignDto(row: CampaignRow) {
  return {
    id: row.id,
    name: row.name,
    goal: row.goal,
    status: campaignStatus(row),
    account: { id: row.instagramAccount.id, username: row.instagramAccount.username },
    trigger: {
      postId: row.postId,
      postUrl: row.postUrl,
      matchAnyPost: row.matchAnyPost,
      pendingNextReel: row.pendingNextReel,
      keywords: row.keywords,
      matchAnyWord: row.matchAnyWord,
      wholeWordMatch: row.wholeWordMatch,
      dmTriggerEnabled: row.dmTriggerEnabled,
    },
    messages: {
      dmMessage: row.dmMessage,
      openingDmEnabled: row.openingDmEnabled,
      openingDmMessage: row.openingDmMessage,
      openingDmButtonLabel: row.openingDmButtonLabel,
      linkButtonLabel: row.linkButtonLabel,
      publicReplyEnabled: row.publicReplyEnabled,
      publicReplyMessages: row.publicReplyMessages,
      followUpEnabled: row.followUpEnabled,
      followUpMessage: row.followUpMessage,
      followUpDelayMinutes: row.followUpDelayMinutes,
    },
    followGate: {
      enabled: row.requireFollow,
      promptMessage: row.followPromptMessage,
      promptButtonLabel: row.followPromptButtonLabel,
      strict: row.followGateStrict,
    },
    settings: {
      textOnly: row.textOnly,
      defaultAssigneeUserId: row.defaultAssigneeUserId,
    },
    trackedLinks: row.trackedLinks.map((link) => ({
      id: link.id,
      label: link.label,
      destinationUrl: link.destinationUrl,
      trackedUrl: buildTrackedUrl(link.slug),
    })),
    draftConfig: row.draftConfig ?? null,
    activationChecklist: activationChecklist(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type CampaignDto = ReturnType<typeof toCampaignDto>;

function cleanKeywords(keywords: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of keywords) {
    const word = raw.trim();
    const key = word.toLowerCase();
    if (!word || seen.has(key)) continue;
    seen.add(key);
    out.push(word);
  }
  return out;
}

function cleanReplies(messages: string[]): string[] {
  return messages.map((m) => m.trim()).filter(Boolean);
}

/**
 * Prisma create data for a new draft. The two lines that make a draft safe
 * are `isActive: false` and `isDraft: true`; nothing the client sends can
 * change them because the input schema is strict.
 */
export function buildDraftCreateData(input: CreateDraftInput) {
  const matchAnyPost = input.matchAnyPost ?? false;
  const pendingNextReel = input.pendingNextReel ?? false;
  const matchAnyWord = input.matchAnyWord ?? false;
  const openingDmEnabled = input.openingDmEnabled ?? false;
  const requireFollow = input.requireFollow ?? false;
  const followUpEnabled = input.followUpEnabled ?? false;
  const publicReplyEnabled = input.publicReplyEnabled ?? false;
  const replies = cleanReplies(input.publicReplyMessages ?? []);
  const specificPost = !matchAnyPost && !pendingNextReel;

  return {
    name: input.name,
    goal: input.goal ?? null,
    postId: specificPost ? (input.postId ?? null) : null,
    postUrl: specificPost ? (input.postUrl ?? null) : null,
    matchAnyPost,
    pendingNextReel,
    keywords: matchAnyWord ? [] : cleanKeywords(input.keywords ?? []),
    matchAnyWord,
    wholeWordMatch: input.wholeWordMatch ?? true,
    dmTriggerEnabled: input.dmTriggerEnabled ?? false,
    dmMessage: input.dmMessage,
    openingDmEnabled,
    openingDmMessage: openingDmEnabled ? input.openingDmMessage || null : null,
    openingDmButtonLabel: openingDmEnabled ? input.openingDmButtonLabel || null : null,
    linkButtonLabel: input.linkButtonLabel || null,
    requireFollow,
    followPromptMessage: requireFollow ? input.followPromptMessage || null : null,
    followPromptButtonLabel: requireFollow ? input.followPromptButtonLabel || null : null,
    followGateStrict: requireFollow ? (input.followGateStrict ?? false) : false,
    textOnly: input.textOnly ?? false,
    defaultAssigneeUserId: input.defaultAssigneeUserId ?? null,
    followUpEnabled,
    followUpMessage: followUpEnabled ? input.followUpMessage || null : null,
    followUpDelayMinutes: followUpEnabled ? (input.followUpDelayMinutes ?? 0) : 0,
    publicReplyEnabled,
    publicReplyMessages: publicReplyEnabled ? replies : [],
    publicReplyMessage: publicReplyEnabled ? (replies[0] ?? null) : null,
    draftConfig: input.draftConfig ?? undefined,
    isActive: false as const,
    isDraft: true as const,
    reportShareSlug: generateReportShareSlug(),
  };
}

/** Partial update data. Never touches isActive or isDraft. */
export function buildDraftUpdateData(input: UpdateDraftInput) {
  const data: Record<string, unknown> = {};
  const copy = (key: keyof UpdateDraftInput) => {
    if (input[key] !== undefined) data[key] = input[key];
  };

  for (const key of [
    "name",
    "goal",
    "wholeWordMatch",
    "dmTriggerEnabled",
    "dmMessage",
    "linkButtonLabel",
    "followUpDelayMinutes",
    "draftConfig",
    "textOnly",
    "defaultAssigneeUserId",
  ] as const) {
    copy(key);
  }

  if (input.keywords !== undefined) data.keywords = cleanKeywords(input.keywords);
  if (input.matchAnyWord !== undefined) {
    data.matchAnyWord = input.matchAnyWord;
    if (input.matchAnyWord) data.keywords = [];
  }

  if (input.matchAnyPost !== undefined) data.matchAnyPost = input.matchAnyPost;
  if (input.pendingNextReel !== undefined) data.pendingNextReel = input.pendingNextReel;
  if (input.postId !== undefined) data.postId = input.postId;
  if (input.postUrl !== undefined) data.postUrl = input.postUrl;
  if (input.matchAnyPost === true || input.pendingNextReel === true) {
    data.postId = null;
    data.postUrl = null;
  }

  if (input.openingDmEnabled !== undefined) {
    data.openingDmEnabled = input.openingDmEnabled;
    if (!input.openingDmEnabled) {
      data.openingDmMessage = null;
      data.openingDmButtonLabel = null;
    }
  }
  if (input.openingDmEnabled !== false) {
    if (input.openingDmMessage !== undefined) data.openingDmMessage = input.openingDmMessage;
    if (input.openingDmButtonLabel !== undefined) {
      data.openingDmButtonLabel = input.openingDmButtonLabel;
    }
  }

  if (input.requireFollow !== undefined) {
    data.requireFollow = input.requireFollow;
    if (!input.requireFollow) {
      data.followPromptMessage = null;
      data.followPromptButtonLabel = null;
      data.followGateStrict = false;
    }
  }
  if (input.requireFollow !== false && input.followGateStrict !== undefined) {
    data.followGateStrict = input.followGateStrict;
  }
  if (input.requireFollow !== false) {
    if (input.followPromptMessage !== undefined) {
      data.followPromptMessage = input.followPromptMessage;
    }
    if (input.followPromptButtonLabel !== undefined) {
      data.followPromptButtonLabel = input.followPromptButtonLabel;
    }
  }

  if (input.followUpEnabled !== undefined) {
    data.followUpEnabled = input.followUpEnabled;
    if (!input.followUpEnabled) {
      data.followUpMessage = null;
      data.followUpDelayMinutes = 0;
    }
  }
  if (input.followUpEnabled !== false && input.followUpMessage !== undefined) {
    data.followUpMessage = input.followUpMessage;
  }

  if (input.publicReplyEnabled !== undefined) {
    data.publicReplyEnabled = input.publicReplyEnabled;
    if (!input.publicReplyEnabled) {
      data.publicReplyMessages = [];
      data.publicReplyMessage = null;
    }
  }
  if (input.publicReplyEnabled !== false && input.publicReplyMessages !== undefined) {
    const replies = cleanReplies(input.publicReplyMessages);
    data.publicReplyMessages = replies;
    data.publicReplyMessage = replies[0] ?? null;
  }

  // Defence in depth: these must never leave this function.
  delete data.isActive;
  delete data.isDraft;
  return data;
}

export function newTrackedLinkData(workspaceId: string, destinationUrl: string) {
  return {
    workspaceId,
    slug: generateTrackedLinkSlug(),
    label: "Primary campaign link",
    destinationUrl,
  };
}

/**
 * Campaigns the "next reel" cron may bind to a post. Drafts are excluded so
 * an API-created draft keeps its Reel unselected until a person decides.
 * Paused (non-draft) campaigns keep their existing behavior.
 */
export const NEXT_REEL_BINDABLE_WHERE = {
  pendingNextReel: true,
  isDraft: false,
} as const;
