import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMMENT_POLL_FIRST_RUN_DELAY_MS,
  DEFAULT_COMMENT_POLL_INTERVAL_MS,
  commentPollIntervalMs,
  isCommentPollingEnabled,
  startCommentPolling,
} from "@/lib/polling/scheduler";
import { startInstagramMaintenance } from "@/lib/instagram/scheduler";

const DAY = 86_400_000;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

// Anything other than the exact text "true" must leave polling off.
const OFF: [string, Record<string, string | undefined>][] = [
  ["absent", {}],
  ["undefined", { COMMENT_POLLING_ENABLED: undefined }],
  ["empty", { COMMENT_POLLING_ENABLED: "" }],
  ["spaces only", { COMMENT_POLLING_ENABLED: "  " }],
  ["false", { COMMENT_POLLING_ENABLED: "false" }],
  ["FALSE", { COMMENT_POLLING_ENABLED: "FALSE" }],
  ["0", { COMMENT_POLLING_ENABLED: "0" }],
  ["True (wrong case)", { COMMENT_POLLING_ENABLED: "True" }],
  ["TRUE (wrong case)", { COMMENT_POLLING_ENABLED: "TRUE" }],
  ["1", { COMMENT_POLLING_ENABLED: "1" }],
  ["yes", { COMMENT_POLLING_ENABLED: "yes" }],
  ["on", { COMMENT_POLLING_ENABLED: "on" }],
  ["enabled", { COMMENT_POLLING_ENABLED: "enabled" }],
  ["trailing space", { COMMENT_POLLING_ENABLED: "true " }],
  ["leading space", { COMMENT_POLLING_ENABLED: " true" }],
  ["quoted", { COMMENT_POLLING_ENABLED: '"true"' }],
  ["misspelled name", { COMMENT_POLLING_ENABLE: "true", COMMENT_POLL_ENABLED: "true", COMMENT_POLLINGS_ENABLED: "true" }],
  ["only the interval is set", { COMMENT_POLL_INTERVAL_MS: "60000" }],
  ["only the old maintenance flag is true", { IG_MAINTENANCE_ENABLED: "true" }],
];

describe("comment polling is opt-in", () => {
  for (const [label, env] of OFF) {
    it(`never runs and sets no timers when the variable is ${label}`, async () => {
      const run = vi.fn();
      const log = vi.fn();
      expect(isCommentPollingEnabled(env)).toBe(false);
      expect(startCommentPolling(run, { env, log })).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(90 * DAY);
      expect(run).not.toHaveBeenCalled();
      expect(log.mock.calls[0][0]).toContain("OFF");
    });
  }

  it("is off with no options when the real environment has no value", async () => {
    vi.stubEnv("COMMENT_POLLING_ENABLED", "");
    const run = vi.fn();
    expect(startCommentPolling(run)).toBeNull();
    await vi.advanceTimersByTimeAsync(30 * DAY);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs only when the value is exactly true, first after 10 seconds then on the interval", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const handle = startCommentPolling(run, { env: { COMMENT_POLLING_ENABLED: "true" } });
    expect(handle).not.toBeNull();
    await vi.advanceTimersByTimeAsync(COMMENT_POLL_FIRST_RUN_DELAY_MS - 1);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DEFAULT_COMMENT_POLL_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(2);
    handle?.stop();
    await vi.advanceTimersByTimeAsync(DAY);
    expect(run).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("survives a failing run without logging its message", async () => {
    const run = vi.fn().mockRejectedValue(new Error("Bearer abcdef0123456789 should never be logged"));
    const log = vi.fn();
    startCommentPolling(run, { env: { COMMENT_POLLING_ENABLED: "true" }, log });
    await vi.advanceTimersByTimeAsync(COMMENT_POLL_FIRST_RUN_DELAY_MS);
    expect(run).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.map((c) => String(c[0])).join(" ")).not.toContain("abcdef0123456789");
  });
});

describe("poll interval", () => {
  it("uses 5 minutes when missing, empty or unusable, never a tight loop", () => {
    for (const v of [undefined, "", " ", "abc", "NaN", "Infinity", "-1", "0", "1", "1000", "59999", "99999999999", "1e99"]) {
      expect(commentPollIntervalMs({ COMMENT_POLL_INTERVAL_MS: v })).toBe(DEFAULT_COMMENT_POLL_INTERVAL_MS);
    }
  });
  it("accepts a sensible value", () => {
    expect(commentPollIntervalMs({ COMMENT_POLL_INTERVAL_MS: "60000" })).toBe(60_000);
    expect(commentPollIntervalMs({ COMMENT_POLL_INTERVAL_MS: "600000" })).toBe(600_000);
  });
  it("is applied when polling is on", async () => {
    const run = vi.fn();
    startCommentPolling(run, { env: { COMMENT_POLLING_ENABLED: "true", COMMENT_POLL_INTERVAL_MS: "garbage" } });
    await vi.advanceTimersByTimeAsync(COMMENT_POLL_FIRST_RUN_DELAY_MS);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("polling and Instagram token maintenance are independent", () => {
  const combos: [string | undefined, string | undefined][] = [
    [undefined, undefined],
    ["true", undefined],
    [undefined, "true"],
    ["true", "true"],
    ["false", "true"],
    ["true", "false"],
    ["1", "true"],
    ["true", "yes"],
  ];
  for (const [poll, maint] of combos) {
    it(`COMMENT_POLLING_ENABLED=${poll} and IG_MAINTENANCE_ENABLED=${maint}: each runs only if its own flag is exactly true`, async () => {
      const env = { COMMENT_POLLING_ENABLED: poll, IG_MAINTENANCE_ENABLED: maint };
      const pollRun = vi.fn();
      const maintRun = vi.fn();
      const a = startCommentPolling(pollRun, { env });
      const b = startInstagramMaintenance(maintRun, { env });
      await vi.advanceTimersByTimeAsync(2 * DAY);
      expect(pollRun.mock.calls.length > 0).toBe(poll === "true");
      expect(maintRun.mock.calls.length > 0).toBe(maint === "true");
      a?.stop();
      b?.stop();
      expect(vi.getTimerCount()).toBe(0);
    });
  }

  it("stopping one leaves the other running", async () => {
    const env = { COMMENT_POLLING_ENABLED: "true", IG_MAINTENANCE_ENABLED: "true" };
    const pollRun = vi.fn();
    const maintRun = vi.fn();
    const a = startCommentPolling(pollRun, { env });
    startInstagramMaintenance(maintRun, { env });
    a?.stop();
    await vi.advanceTimersByTimeAsync(DAY);
    expect(pollRun).not.toHaveBeenCalled();
    expect(maintRun).toHaveBeenCalled();
  });
});

describe("wiring", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("the worker starts polling only through the opt-in scheduler", () => {
    const worker = read("worker/dm-worker.ts");
    expect(worker).toContain("startCommentPolling(");
    expect(worker).not.toMatch(/setInterval\(\(\) => void poll\(/);
    expect(worker).not.toMatch(/setTimeout\(\(\) => void poll\(/);
    expect(worker).not.toMatch(/Number\(\s*process\.env\.COMMENT_POLL_INTERVAL_MS/);
  });

  it(".env.example ships with polling off", () => {
    const line = read(".env.example").split("\n").find((l) => l.startsWith("COMMENT_POLLING_ENABLED="));
    expect(line).toBe("COMMENT_POLLING_ENABLED=false");
  });
});
