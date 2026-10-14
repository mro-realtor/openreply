import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MAINTENANCE_INTERVAL_MS,
  FIRST_RUN_DELAY_MS,
  isIgMaintenanceEnabled,
  maintenanceIntervalMs,
  startInstagramMaintenance,
} from "@/lib/instagram/scheduler";

const DAY = 86_400_000;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

// Anything other than the exact text "true" must leave the upkeep off.
const OFF: [string, Record<string, string | undefined>][] = [
  ["missing", {}],
  ["undefined", { IG_MAINTENANCE_ENABLED: undefined }],
  ["empty", { IG_MAINTENANCE_ENABLED: "" }],
  ["spaces only", { IG_MAINTENANCE_ENABLED: "   " }],
  ["false", { IG_MAINTENANCE_ENABLED: "false" }],
  ["FALSE", { IG_MAINTENANCE_ENABLED: "FALSE" }],
  ["0", { IG_MAINTENANCE_ENABLED: "0" }],
  ["True (wrong case)", { IG_MAINTENANCE_ENABLED: "True" }],
  ["TRUE (wrong case)", { IG_MAINTENANCE_ENABLED: "TRUE" }],
  ["1", { IG_MAINTENANCE_ENABLED: "1" }],
  ["yes", { IG_MAINTENANCE_ENABLED: "yes" }],
  ["on", { IG_MAINTENANCE_ENABLED: "on" }],
  ["enabled", { IG_MAINTENANCE_ENABLED: "enabled" }],
  ["trailing space", { IG_MAINTENANCE_ENABLED: "true " }],
  ["leading space", { IG_MAINTENANCE_ENABLED: " true" }],
  ["quoted", { IG_MAINTENANCE_ENABLED: '"true"' }],
  ["misspelled name", { IG_MAINTENANCE_ENABLE: "true", IG_MAINTENANCES_ENABLED: "true" }],
];

describe("Instagram maintenance is opt-in", () => {
  for (const [label, env] of OFF) {
    it(`never runs and sets no timers when the variable is ${label}`, async () => {
      const run = vi.fn();
      const log = vi.fn();
      expect(isIgMaintenanceEnabled(env)).toBe(false);
      const handle = startInstagramMaintenance(run, { env, log });
      expect(handle).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(90 * DAY);
      expect(run).not.toHaveBeenCalled();
      expect(log.mock.calls[0][0]).toContain("OFF");
    });
  }

  it("is off when no options are given and the real environment has no value", async () => {
    vi.stubEnv("IG_MAINTENANCE_ENABLED", "");
    const run = vi.fn();
    expect(startInstagramMaintenance(run)).toBeNull();
    await vi.advanceTimersByTimeAsync(30 * DAY);
    expect(run).not.toHaveBeenCalled();
  });

  it("does not even use the interval setting when off", () => {
    const run = vi.fn();
    startInstagramMaintenance(run, { env: { IG_MAINTENANCE_INTERVAL_MS: "900000" } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("runs only when the value is exactly true: first run after a minute, then on the interval", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const handle = startInstagramMaintenance(run, { env: { IG_MAINTENANCE_ENABLED: "true" } });
    expect(handle).not.toBeNull();
    await vi.advanceTimersByTimeAsync(FIRST_RUN_DELAY_MS - 1);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DEFAULT_MAINTENANCE_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(2);
    handle?.stop();
    await vi.advanceTimersByTimeAsync(DAY);
    expect(run).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("survives a failing run without an unhandled rejection", async () => {
    const run = vi.fn().mockRejectedValue(new Error("Bearer abcdef0123456789 should never be logged"));
    const log = vi.fn();
    startInstagramMaintenance(run, { env: { IG_MAINTENANCE_ENABLED: "true" }, log });
    await vi.advanceTimersByTimeAsync(FIRST_RUN_DELAY_MS);
    expect(run).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.map((c) => String(c[0])).join(" ")).not.toContain("abcdef0123456789");
  });
});

describe("maintenance interval", () => {
  it("uses 6 hours when missing, empty or unusable, never a tight loop", () => {
    for (const v of [undefined, "", "  ", "abc", "NaN", "Infinity", "-1", "0", "1", "1000", "899999", "99999999999", "1e99"]) {
      expect(maintenanceIntervalMs({ IG_MAINTENANCE_INTERVAL_MS: v })).toBe(DEFAULT_MAINTENANCE_INTERVAL_MS);
    }
  });
  it("accepts a sensible value", () => {
    expect(maintenanceIntervalMs({ IG_MAINTENANCE_INTERVAL_MS: "900000" })).toBe(900_000);
    expect(maintenanceIntervalMs({ IG_MAINTENANCE_INTERVAL_MS: "3600000" })).toBe(3_600_000);
  });
  it("is applied when the upkeep is on", async () => {
    const run = vi.fn();
    startInstagramMaintenance(run, { env: { IG_MAINTENANCE_ENABLED: "true", IG_MAINTENANCE_INTERVAL_MS: "garbage" } });
    await vi.advanceTimersByTimeAsync(FIRST_RUN_DELAY_MS);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("wiring", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("the worker starts the upkeep only through the opt-in scheduler", () => {
    const worker = read("worker/dm-worker.ts");
    expect(worker).toContain("startInstagramMaintenance(");
    expect(worker).not.toMatch(/IG_MAINTENANCE_ENABLED\s*!==/);
    expect(worker).not.toMatch(/setInterval\(\(\) => void maintainInstagram/);
    expect(worker).not.toMatch(/setTimeout\(\(\) => void maintainInstagram/);
  });

  it(".env.example ships with the upkeep off", () => {
    const line = read(".env.example").split("\n").find((l) => l.startsWith("IG_MAINTENANCE_ENABLED="));
    expect(line).toBe("IG_MAINTENANCE_ENABLED=false");
  });
});
