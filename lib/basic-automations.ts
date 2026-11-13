export type BasicAutomationAccount = {
  id: string;
  username: string;
  name: string | null;
};

export type BasicAccountsResult =
  | { status: "loaded"; accounts: BasicAutomationAccount[] }
  | { status: "error" };

export function resolveBasicAccountsResponse(
  responseOk: boolean,
  payload: unknown
): BasicAccountsResult {
  if (!responseOk || !payload || typeof payload !== "object") {
    return { status: "error" };
  }

  const data = payload as {
    success?: unknown;
    data?: { instagramAccounts?: unknown };
  };
  if (data.success !== true || !Array.isArray(data.data?.instagramAccounts)) {
    return { status: "error" };
  }

  return {
    status: "loaded",
    accounts: data.data.instagramAccounts as BasicAutomationAccount[],
  };
}
