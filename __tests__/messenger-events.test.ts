import { expect, it } from "vitest";
import { messengerEvents } from "@/lib/messenger/events";

it("accepts Page DMs and postbacks while dropping echoes and unrelated recipients", () => {
  const base = { sender: { id: "contact" }, recipient: { id: "page" }, timestamp: Date.now() - 1000 };
  expect(messengerEvents({ object: "page", entry: [{ id: "page", messaging: [
    { ...base, message: { mid: "a", text: "Hello" } },
    { ...base, message: { mid: "b", is_echo: true } },
    { ...base, recipient: { id: "wrong" }, message: { mid: "c" } },
    { ...base, postback: { mid: "d", payload: "start" } },
  ] }] }).map(({ eventId, kind }) => [eventId, kind])).toEqual([
    ["a", "MESSAGE"], ["d", "POSTBACK"],
  ]);
});
