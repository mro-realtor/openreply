import { z } from "zod";

/**
 * Input schemas for API/MCP draft campaigns.
 *
 * All objects are strict: unknown keys are rejected. That is what stops a
 * client from sneaking in `isActive`, `isDraft` or workspace fields.
 */

export const CONVERSATION_MODES = [
  "direct_capture",
  "ai_qualification",
  "ai_assistance",
  "human_only",
] as const;

export const LEAD_FIELDS = [
  "full_name",
  "phone",
  "email",
  "contact_authorization",
] as const;

export const draftConfigSchema = z
  .object({
    conversationMode: z.enum(CONVERSATION_MODES).optional(),
    leadCapture: z
      .object({
        requiredFields: z.array(z.enum(LEAD_FIELDS)).max(LEAD_FIELDS.length).optional(),
        markReadyOnlyWhenComplete: z.boolean().optional(),
      })
      .strict()
      .optional(),
    assignee: z.string().trim().min(1).max(80).optional(),
    notes: z.string().max(1000).optional(),
  })
  .strict();

export type DraftConfig = z.infer<typeof draftConfigSchema>;

const optionalText = (max: number) => z.string().max(max).optional().nullable();

const draftFields = {
  name: z.string().trim().min(1).max(100),
  goal: z.string().trim().min(1).max(120).optional().nullable(),

  // Trigger. A draft may have no post at all (no Reel selected).
  postId: z.string().min(1).optional().nullable(),
  postUrl: z.string().url().optional().nullable(),
  matchAnyPost: z.boolean().optional(),
  pendingNextReel: z.boolean().optional(),
  keywords: z.array(z.string().trim().min(1).max(50)).max(10).optional(),
  matchAnyWord: z.boolean().optional(),
  wholeWordMatch: z.boolean().optional(),
  dmTriggerEnabled: z.boolean().optional(),

  // Messages
  dmMessage: z.string().min(1).max(1000),
  openingDmEnabled: z.boolean().optional(),
  openingDmMessage: optionalText(1000),
  openingDmButtonLabel: optionalText(64),
  linkButtonLabel: optionalText(20),
  trackedDestinationUrl: z
    .union([z.string().url(), z.literal("")])
    .optional()
    .nullable(),

  // Follow gate
  requireFollow: z.boolean().optional(),
  followPromptMessage: optionalText(1000),
  followPromptButtonLabel: optionalText(20),
  // Only a confirmed follower gets the link. Needs requireFollow.
  followGateStrict: z.boolean().optional(),

  // Plain text with the link inline, no buttons.
  textOnly: z.boolean().optional(),

  // New people from this campaign go to this teammate (a member of the workspace).
  defaultAssigneeUserId: z.string().min(1).optional().nullable(),

  // Follow-up
  followUpEnabled: z.boolean().optional(),
  followUpMessage: optionalText(1000),
  followUpDelayMinutes: z.number().int().min(0).max(1440).optional(),

  // Public reply
  publicReplyEnabled: z.boolean().optional(),
  publicReplyMessages: z.array(z.string().max(1000)).max(10).optional(),

  draftConfig: draftConfigSchema.optional(),
};

function openingDmComplete(d: {
  openingDmEnabled?: boolean;
  openingDmMessage?: string | null;
  openingDmButtonLabel?: string | null;
}) {
  return (
    !d.openingDmEnabled ||
    (Boolean(d.openingDmMessage?.trim()) && Boolean(d.openingDmButtonLabel?.trim()))
  );
}

export const createDraftObject = z
  .object({
    ...draftFields,
    instagramAccountId: z.string().min(1).optional(),
    instagramUsername: z.string().trim().min(1).max(60).optional(),
  })
  .strict();

const accountSelectorOk = (d: {
  instagramAccountId?: string;
  instagramUsername?: string;
}) => Boolean(d.instagramAccountId) !== Boolean(d.instagramUsername);

const accountSelectorIssue = {
  message: "Provide exactly one of instagramAccountId or instagramUsername",
  path: ["instagramAccountId"],
};

const openingDmIssue = {
  message: "Opening DM needs a message and a button label",
  path: ["openingDmMessage"],
};

export const createDraftSchema = createDraftObject
  .refine(accountSelectorOk, accountSelectorIssue)
  .refine(openingDmComplete, openingDmIssue);

export type CreateDraftInput = z.infer<typeof createDraftSchema>;

export const updateDraftObject = z
  .object({
    ...draftFields,
    name: draftFields.name.optional(),
    dmMessage: draftFields.dmMessage.optional(),
  })
  .strict();

export const updateDraftSchema = updateDraftObject
  .refine((d) => Object.keys(d).length > 0, {
    message: "Provide at least one field to change",
  })
  .refine(openingDmComplete, openingDmIssue);

export type UpdateDraftInput = z.infer<typeof updateDraftSchema>;

export { accountSelectorOk, accountSelectorIssue, openingDmComplete, openingDmIssue };

export const GUARDED_KEYS = ["isActive", "isDraft", "workspaceId", "id"] as const;

/** Friendlier message than "unrecognized key" for the fields that matter. */
export function explainGuardedKeys(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const present = GUARDED_KEYS.filter((key) => key in (body as object));
  if (present.length === 0) return null;
  return `These fields cannot be set through the API: ${present.join(", ")}. Campaigns created here are always inactive drafts, and a person activates them in the dashboard.`;
}
