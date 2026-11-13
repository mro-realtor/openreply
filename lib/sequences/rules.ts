import { z } from "zod";

const WINDOW_MINUTES = 24 * 60;

export const sequenceSteps = z.array(z.object({
  message: z.string().trim().min(1).max(1000),
  position: z.object({ x: z.number().min(0).max(100000), y: z.number().min(0).max(100000) }).optional(),
  delayMinutes: z.number().int().min(0).max(WINDOW_MINUTES - 1),
})).min(1).refine(
  (steps) => steps.reduce((total, step) => total + step.delayMinutes, 0) < WINDOW_MINUTES,
  "Total delay must be under 24 hours."
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
