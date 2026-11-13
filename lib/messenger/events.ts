import { z } from "zod";

const event = z.object({
  sender: z.object({ id: z.string() }),
  recipient: z.object({ id: z.string() }),
  timestamp: z.number().int().positive(),
  message: z.object({ mid: z.string(), text: z.string().optional(), is_echo: z.boolean().optional() }).optional(),
  postback: z.object({ mid: z.string().optional(), payload: z.string() }).optional(),
});
const envelope = z.object({
  object: z.literal("page"),
  entry: z.array(z.object({ id: z.string(), messaging: z.array(z.unknown()).optional() })),
});

export function messengerEvents(payload: unknown) {
  const parsed = envelope.safeParse(payload);
  if (!parsed.success) return [];
  return parsed.data.entry.flatMap(({ id: pageId, messaging }) => (messaging ?? []).flatMap((raw) => {
    const result = event.safeParse(raw);
    if (!result.success) return [];
    const { sender, recipient, message, postback, timestamp } = result.data;
    if (recipient.id !== pageId || sender.id === pageId || message?.is_echo || (!message && !postback)) return [];
    if (timestamp > Date.now()) return [];
    return [{
      pageId, recipientId: sender.id, receivedAt: new Date(timestamp),
      eventId: message?.mid ?? postback?.mid ?? `postback:${sender.id}:${timestamp}:${postback?.payload}`,
      text: message?.text ?? postback?.payload ?? null,
      kind: postback ? "POSTBACK" : "MESSAGE",
    }];
  }));
}
