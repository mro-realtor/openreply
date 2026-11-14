import { z } from "zod";
import { maxSequencePathDelay, validateSequenceGraph } from "./graph";

const WINDOW_MINUTES = 24 * 60;

const sequenceStep = z.object({
  id: z.string().trim().min(1).max(100).optional(),
  routes: z.record(z.string(), z.string().nullable()).optional(),
  message: z.string().trim().min(1).max(1000),
  quickReplies: z.array(z.object({
    id: z.string().trim().min(1).max(100),
    title: z.string().trim().min(1).max(20),
  })).max(13).optional(),
  buttons: z.array(z.object({
    title: z.string().trim().min(1).max(20),
    url: z.url({ protocol: /^https?$/ }),
  })).max(3).optional(),
  contentBlocks: z.array(z.object({
    type: z.enum(["image", "pdf", "data", "audio", "video", "card", "gallery", "dynamic"]),
    url: z.string().max(2000).optional(),
    title: z.string().max(200).optional(),
  })).max(20).optional(),
  position: z.object({
    x: z.number().min(0).max(100000),
    y: z.number().min(0).max(100000),
  }).optional(),
  delayMinutes: z.number().int().min(0).max(WINDOW_MINUTES - 1),
}).refine(
  (step) => !step.buttons?.length || step.message.length <= 640,
  "Messages with buttons must be 640 characters or fewer.",
).refine((step) => !(step.buttons?.length && step.quickReplies?.length), "Website buttons and quick replies cannot be combined.");

export const sequenceSteps = z.array(sequenceStep).min(1).superRefine((steps, context) => {
  try {
    validateSequenceGraph(steps);
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : "Invalid sequence graph.",
    });
  }
}).refine(
  (steps) => maxSequencePathDelay(steps) < WINDOW_MINUTES,
  "Total delay must be under 24 hours.",
);

export const sequenceInput = z.object({
  name: z.string().trim().min(1).max(100),
  steps: z.union([sequenceSteps, z.tuple([])]),
  campaignIds: z.array(z.string().min(1)).max(100),
  enabled: z.boolean(),
}).partial({ campaignIds: true, enabled: true }).refine(
  (sequence) => !sequence.enabled || sequence.steps.length > 0,
  { message: "Add a message before enabling the sequence.", path: ["steps"] }
);

export function isInstagramWindowOpen(interaction: number | undefined, now: number) {
  return interaction !== undefined &&
    Number.isFinite(interaction) &&
    interaction > 0 &&
    interaction <= now &&
    now - interaction < WINDOW_MINUTES * 60_000;
}
