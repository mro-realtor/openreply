import { beforeEach, describe, expect, it, vi } from "vitest";

const { enrollment, send, usage } = vi.hoisted(() => ({
  enrollment: {
    createMany: vi.fn(),
    updateMany: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
  },
  send: vi.fn(),
  usage: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: { sequenceEnrollment: enrollment, sequence: { findFirst: async () => ({ id: "seq", steps }) } },
}));
vi.mock("@/lib/meta/client", () => ({ sendDirectMessage: send }));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: () => "token" }));
vi.mock("@/lib/billing/usage", () => ({
  reserveWorkspaceDMSend: usage,
  releaseWorkspaceDMReservation: vi.fn(),
}));

import { cancelOnReply, deliverDueSequenceSteps, enrollInSequence } from "@/lib/sequences/delivery";

const steps = [{ message: "First", delayMinutes: 0 }, { message: "Second", delayMinutes: 2 }];
const campaign = { id: "campaign", sequenceId: "seq", workspaceId: "workspace", instagramAccountId: "account" };

describe("sequence delivery", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    enrollment.findMany.mockResolvedValue([{ id: "entry" }]);
    enrollment.findUnique.mockResolvedValue({
      status: "PENDING",
      sequence: { id: "seq", enabled: true, workspaceId: "workspace" },
      automation: { ...campaign, isActive: true },
      account: { instagramId: "ig", accessToken: "encrypted" },
      nextStep: 0,
      recipientId: "contact",
      recipientName: null,
      interactionAt: new Date(Date.now() - 1_000),
      steps,
    });
    enrollment.updateMany.mockResolvedValue({ count: 1 });
    enrollment.findFirst.mockResolvedValue({ id: "entry" });
    usage.mockResolvedValue({ allowed: true });
  });

  it("requires a qualifying interaction and deduplicates enrollment", async () => {
    await enrollInSequence(campaign, "contact", null);
    expect(enrollment.createMany).not.toHaveBeenCalled();
    await enrollInSequence(campaign, "contact", null, Date.now() - 100);
    expect(enrollment.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
  });

  it("delivers a claimed step and schedules the next one", async () => {
    await deliverDueSequenceSteps();
    expect(send).toHaveBeenCalledWith("token", "ig", "contact", "First");
    expect(enrollment.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "PENDING", nextStep: 1 }),
    }));
  });

  it("follows a saved route to a non-adjacent message and schedules its delay", async () => {
    const entry = await enrollment.findUnique();
    enrollment.findUnique.mockResolvedValue({
      ...entry,
      steps: [
        { id: "start", routes: { next: "finish" }, message: "Start", delayMinutes: 0 },
        { id: "skipped", routes: { next: null }, message: "Skip", delayMinutes: 1 },
        { id: "finish", routes: { next: null }, message: "Finish", delayMinutes: 7 },
      ],
    });
    await deliverDueSequenceSteps();
    expect(send).toHaveBeenCalledWith("token", "ig", "contact", "Start");
    expect(enrollment.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "PENDING", nextStep: 2, dueAt: expect.any(Date) }),
    }));
  });

  it("delivers an Inbox subscription without a campaign", async () => {
    const entry = await enrollment.findUnique();
    enrollment.findUnique.mockResolvedValue({ ...entry, automation: null });
    await deliverDueSequenceSteps();
    expect(send).toHaveBeenCalledWith("token", "ig", "contact", "First");
  });

  it("skips the send if another worker already claimed it", async () => {
    enrollment.updateMany.mockResolvedValue({ count: 0 });
    await deliverDueSequenceSteps();
    expect(send).not.toHaveBeenCalled();
  });

  it("skips the send if a reply cancelled it after the claim", async () => {
    enrollment.findFirst.mockResolvedValue(null);
    await deliverDueSequenceSteps();
    expect(send).not.toHaveBeenCalled();
  });

  it("cancels older enrollments when the contact replies", async () => {
    const now = Date.now();
    await cancelOnReply("ig", "contact", now);
    expect(enrollment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ interactionAt: { lt: new Date(now) }, recipientId: "contact" }),
      data: expect.objectContaining({ status: "CANCELLED" }),
    }));
  });

  it("marks an ambiguous delivery as failed without advancing", async () => {
    send.mockRejectedValueOnce(new Error("network interrupted"));
    await deliverDueSequenceSteps();
    expect(send).toHaveBeenCalledTimes(1);
    expect(enrollment.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: { status: "FAILED", reason: "network interrupted" },
    }));
  });
});
