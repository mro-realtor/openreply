import { afterEach, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    messengerEvent: { createMany: vi.fn(), update: vi.fn() },
    messengerPage: { findUnique: vi.fn() },
    messengerAutomation: { findMany: vi.fn() },
    messengerSequenceEnrollment: { createMany: vi.fn() },
  },
}));

vi.mock("@/lib/db/client", () => ({ prisma: prismaMock }));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: vi.fn(() => "page-token") }));
vi.mock("@/lib/env", () => ({ getMetaGraphApiVersion: () => "v25.0" }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  prismaMock.messengerEvent.createMany.mockReset();
  prismaMock.messengerEvent.update.mockReset();
  prismaMock.messengerPage.findUnique.mockReset();
  prismaMock.messengerAutomation.findMany.mockReset();
  prismaMock.messengerSequenceEnrollment.createMany.mockReset();
});

const incoming = {
  pageId: "page-1", recipientId: "contact-1", eventId: "in-1", kind: "MESSAGE",
  text: "Hello PLEASE send details", receivedAt: new Date(Date.now() - 1000),
};
const automation = {
  id: "trigger-1", keywords: ["please"], reply: "Here are details", sequenceId: "sequence-1",
  sequence: { id: "sequence-1", enabled: true, steps: [{ id: "first", message: "Next", delayMinutes: 2 }] },
};

it("deduplicates an inbound event before routing or sending", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  prismaMock.messengerEvent.createMany.mockResolvedValue({ count: 0 });
  const { routeMessengerEvent } = await import("@/lib/messenger/router");
  expect(await routeMessengerEvent(incoming)).toEqual({ duplicate: true });
  expect(prismaMock.messengerPage.findUnique).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("routes keyword matches to a sequence and records the Messenger reply", async () => {
  prismaMock.messengerEvent.createMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 });
  prismaMock.messengerPage.findUnique.mockResolvedValue({ accessToken: "encrypted" });
  prismaMock.messengerAutomation.findMany.mockResolvedValue([automation]);
  prismaMock.messengerSequenceEnrollment.createMany.mockResolvedValue({ count: 1 });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message_id: "out-1" }), { status: 200 })));
  const { routeMessengerEvent } = await import("@/lib/messenger/router");

  expect(await routeMessengerEvent(incoming)).toEqual({ duplicate: false, automationId: "trigger-1", enrolled: true });
  expect(prismaMock.messengerSequenceEnrollment.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({
    sequenceId: "sequence-1", automationId: "trigger-1", pageId: "page-1", recipientId: "contact-1",
    dueAt: new Date(incoming.receivedAt.getTime() + 120_000),
  })], skipDuplicates: true });
  expect(fetch).toHaveBeenCalledWith("https://graph.facebook.com/v25.0/page-1/messages", expect.objectContaining({
    body: JSON.stringify({ recipient: { id: "contact-1" }, messaging_type: "RESPONSE", message: { text: "Here are details" } }),
  }));
  expect(prismaMock.messengerEvent.createMany).toHaveBeenLastCalledWith({ data: [{
    pageId: "page-1", recipientId: "contact-1", eventId: "out-1", receivedAt: expect.any(Date), kind: "OUTBOUND", text: "Here are details",
  }], skipDuplicates: true });
});

it("records Meta delivery errors against the original event", async () => {
  prismaMock.messengerEvent.createMany.mockResolvedValue({ count: 1 });
  prismaMock.messengerPage.findUnique.mockResolvedValue({ accessToken: "encrypted" });
  prismaMock.messengerAutomation.findMany.mockResolvedValue([automation]);
  prismaMock.messengerSequenceEnrollment.createMany.mockResolvedValue({ count: 1 });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "Window expired" } }), { status: 400 })));
  const { routeMessengerEvent } = await import("@/lib/messenger/router");

  expect(await routeMessengerEvent(incoming)).toMatchObject({ error: "Window expired", enrolled: true });
  expect(prismaMock.messengerEvent.update).toHaveBeenCalledWith({
    where: { pageId_eventId: { pageId: "page-1", eventId: "in-1" } },
    data: { kind: "DELIVERY_FAILED", text: expect.stringContaining("Reply failed: Window expired") },
  });
});
