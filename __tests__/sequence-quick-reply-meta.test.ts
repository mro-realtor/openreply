import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Instagram sequence quick replies", () => {
  it("sends provider quick-reply choices with stable route payloads", async () => {
    const sendQuickReplies = Reflect.get(
      await import("@/lib/meta/client"),
      "sendDirectMessageWithQuickReplies",
    ) as (
      token: string,
      instagramId: string,
      recipientId: string,
      text: string,
      replies: Array<{ title: string; payload: string }>,
    ) => Promise<unknown>;
    expect(sendQuickReplies).toBeTypeOf("function");

    const response = new Response(JSON.stringify({ recipient_id: "user_999", message_id: "mid_outgoing" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);

    await sendQuickReplies("token", "ig_456", "user_999", "What are you looking for?", [
      { title: "Buy", payload: "sequence:seq:step:question:reply:buy" },
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/ig_456/messages"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          recipient: { id: "user_999" },
          message: {
            text: "What are you looking for?",
            quick_replies: [{
              content_type: "text",
              title: "Buy",
              payload: "sequence:seq:step:question:reply:buy",
            }],
          },
        }),
      }),
    );
  });
});
