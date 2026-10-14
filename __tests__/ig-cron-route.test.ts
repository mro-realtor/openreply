import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  maintain: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: { workspace: { updateMany: h.updateMany } } }));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: vi.fn(), encryptToken: vi.fn() }));
vi.mock("@/lib/instagram/meta-ops", () => ({ liveMetaOps: {} }));
vi.mock("@/lib/instagram/maintenance", () => ({ maintainInstagramAccounts: h.maintain }));

import { GET } from "@/app/api/cron/refresh-tokens/route";

function call(auth: string | null = "Bearer cron-test-secret") {
  return GET(
    new NextRequest("http://localhost/api/cron/refresh-tokens", auth ? { headers: { authorization: auth } } : {})
  );
}

beforeEach(() => {
  h.maintain.mockReset().mockResolvedValue([{ refresh: "refreshed", status: "ACTIVE" }]);
  h.updateMany.mockReset().mockResolvedValue({ count: 0 });
  vi.stubEnv("CRON_SECRET", "cron-test-secret");
});
afterEach(() => vi.unstubAllEnvs());

describe("cron route for Instagram upkeep", () => {
  it("still requires the cron secret", async () => {
    vi.stubEnv("IG_MAINTENANCE_ENABLED", "true");
    expect((await call(null)).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    expect(h.maintain).not.toHaveBeenCalled();
  });

  for (const value of [undefined, "", "false", "FALSE", "True", "1", "yes", " true"]) {
    it(`does not renew tokens or contact Meta when the variable is ${JSON.stringify(value)}`, async () => {
      if (value === undefined) vi.stubEnv("IG_MAINTENANCE_ENABLED", undefined as unknown as string);
      else vi.stubEnv("IG_MAINTENANCE_ENABLED", value);
      const res = await call();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.maintenance).toBe("disabled");
      expect(body.data.totalProcessed).toBe(0);
      expect(h.maintain).not.toHaveBeenCalled();
    });
  }

  it("runs the upkeep only when the variable is exactly true", async () => {
    vi.stubEnv("IG_MAINTENANCE_ENABLED", "true");
    const res = await call();
    expect((await res.json()).data.maintenance).toBe("ran");
    expect(h.maintain).toHaveBeenCalledTimes(1);
  });
});
