import { isInstagramWindowOpen, sequenceSteps } from "@/lib/sequences/rules";

type Event = {
  pageId: string; recipientId: string; eventId: string; kind: string;
  text: string | null; receivedAt: Date;
};

function matchesKeyword(message: string, keywords: string[]) {
  const normalized = message.trim().toLocaleLowerCase();
  return keywords.some((keyword) => {
    const needle = keyword.trim().toLocaleLowerCase();
    return needle.length > 0 && normalized.includes(needle);
  });
}

export async function routeMessengerEvent(event: Event) {
  const { prisma } = await import("@/lib/db/client");
  const inserted = await prisma.messengerEvent.createMany({
    data: [{ ...event, kind: event.kind, text: event.text }], skipDuplicates: true,
  });
  if (!inserted.count) return { duplicate: true as const };
  if ((event.kind !== "MESSAGE" && event.kind !== "POSTBACK") || !event.text) return { duplicate: false as const };

  const [page, automations] = await Promise.all([
    prisma.messengerPage.findUnique({ where: { id: event.pageId } }),
    prisma.messengerAutomation.findMany({
      where: { pageId: event.pageId, isActive: true },
      include: { sequence: { select: { id: true, enabled: true, steps: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  if (!page) return { duplicate: false as const };
  const automation = automations.find((item) => matchesKeyword(event.text!, item.keywords));
  if (!automation) return { duplicate: false as const };

  const steps = sequenceSteps.parse(automation.sequence.steps);
  const enrolled = await prisma.messengerSequenceEnrollment.createMany({
    data: automation.sequence.enabled && isInstagramWindowOpen(event.receivedAt.getTime(), Date.now()) ? [{
      sequenceId: automation.sequence.id,
      automationId: automation.id,
      pageId: event.pageId,
      recipientId: event.recipientId,
      interactionAt: event.receivedAt,
      dueAt: new Date(event.receivedAt.getTime() + steps[0].delayMinutes * 60_000),
      steps,
    }] : [],
    skipDuplicates: true,
  });

  // Keep the configured immediate keyword response, and ensure provider failures
  // stay attached to the inbound event for diagnostics and support.
  try {
    const { decryptToken } = await import("@/lib/meta/oauth");
    const { getMetaGraphApiVersion } = await import("@/lib/env");
    const response = await fetch(`https://graph.facebook.com/${getMetaGraphApiVersion()}/${event.pageId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${decryptToken(page.accessToken)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: event.recipientId }, messaging_type: "RESPONSE", message: { text: automation.reply } }),
    });
    const result = await response.json().catch(() => ({})) as { message_id?: string; error?: { message?: string } };
    if (!response.ok) throw new Error(result.error?.message ?? `Meta rejected the reply (${response.status}).`);
    if (result.message_id) await prisma.messengerEvent.createMany({
      data: [{ pageId: event.pageId, recipientId: event.recipientId, eventId: result.message_id, receivedAt: new Date(), kind: "OUTBOUND", text: automation.reply }],
      skipDuplicates: true,
    });
    return { duplicate: false as const, automationId: automation.id, enrolled: enrolled.count > 0 };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "Messenger delivery failed.";
    await prisma.messengerEvent.update({
      where: { pageId_eventId: { pageId: event.pageId, eventId: event.eventId } },
      data: { kind: "DELIVERY_FAILED", text: `${event.text}\n\nReply failed: ${message}` },
    });
    return { duplicate: false as const, automationId: automation.id, enrolled: enrolled.count > 0, error: message };
  }
}
