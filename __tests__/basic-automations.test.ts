import { describe, expect, it } from "vitest";
import { resolveBasicAccountsResponse } from "@/lib/basic-automations";

describe("basic automation account loading", () => {
  it("distinguishes a successful empty account list from an API failure", () => {
    expect(resolveBasicAccountsResponse(true, { success: true, data: { instagramAccounts: [] } })).toEqual({
      status: "loaded",
      accounts: [],
    });
    expect(resolveBasicAccountsResponse(false, { success: false })).toEqual({ status: "error" });
    expect(resolveBasicAccountsResponse(true, { success: false })).toEqual({ status: "error" });
    expect(resolveBasicAccountsResponse(false, null)).toEqual({ status: "error" });
  });
});
