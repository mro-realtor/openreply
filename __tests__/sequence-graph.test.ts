import { describe, expect, it } from "vitest";
import { arrangeSequencePositions, maxSequencePathDelay, normalizeSequenceGraph, resolveSequenceRoute, traceSequencePath, validateSequenceGraph } from "@/lib/sequences/graph";
import { sequenceSteps } from "@/lib/sequences/rules";

describe("sequence graph", () => {
  it("keeps legacy steps in array order", () => {
    const steps = [{ message: "First" }, { message: "Second" }];
    expect(resolveSequenceRoute(steps, 0, "next")).toBe(1);
    expect(resolveSequenceRoute(steps, 1, "next")).toBeNull();
    expect(() => validateSequenceGraph(steps)).not.toThrow();
  });

  it("routes a stable named output to a non-adjacent step", () => {
    const steps = [
      { id: "start", routes: { next: "finish" } },
      { id: "skipped", routes: { next: null } },
      { id: "finish", routes: { next: null } },
    ];
    expect(resolveSequenceRoute(steps, 0, "next")).toBe(2);
    expect(() => validateSequenceGraph(steps)).not.toThrow();
  });

  it("normalizes legacy steps once and traces the same routed path used by delivery", () => {
    let nextId = 0;
    const normalized = normalizeSequenceGraph(
      [{ message: "First" }, { message: "Second" }, { message: "Third" }],
      () => `step-${++nextId}`,
    );
    expect(normalized.map((step) => step.id)).toEqual(["step-1", "step-2", "step-3"]);
    expect(traceSequencePath(normalized)).toEqual([0, 1, 2]);

    normalized[0].routes.next = "step-3";
    expect(traceSequencePath(normalized)).toEqual([0, 2]);
  });

  it("validates the longest reachable route rather than summing skipped steps", () => {
    const steps = [
      { id: "start", routes: { next: "finish" }, message: "Start", delayMinutes: 5 },
      { id: "skipped", routes: { next: null }, message: "Skip", delayMinutes: 1430 },
      { id: "finish", routes: { next: null }, message: "Finish", delayMinutes: 5 },
    ];
    expect(maxSequencePathDelay(steps)).toBe(10);
    expect(sequenceSteps.safeParse(steps).success).toBe(true);
    expect(sequenceSteps.safeParse([
      { id: "start", routes: { next: "finish" }, message: "Start", delayMinutes: 720 },
      { id: "finish", routes: { next: null }, message: "Finish", delayMinutes: 720 },
    ]).success).toBe(false);
  });

  it("treats an explicit missing output as the end of that path", () => {
    const steps = [{ id: "start", routes: {} }, { id: "unreachable" }];
    expect(resolveSequenceRoute(steps, 0, "next")).toBeNull();
  });

  it("arranges cards in a deterministic two-column flow layout", () => {
    const arranged = arrangeSequencePositions([
      { id: "a", position: { x: 999, y: 999 } },
      { id: "b" },
      { id: "c" },
    ]);
    expect(arranged.map((step) => step.position)).toEqual([
      { x: 365, y: 45 },
      { x: 710, y: 140 },
      { x: 365, y: 255 },
    ]);
  });

  it("rejects duplicate IDs, dangling targets, unsupported outputs, and cycles", () => {
    expect(() => validateSequenceGraph([
      { id: "same", routes: { next: null } },
      { id: "same", routes: { next: null } },
    ])).toThrow(/unique/i);

    expect(() => validateSequenceGraph([
      { id: "start", routes: { next: "missing" } },
    ])).toThrow(/target/i);

    expect(() => validateSequenceGraph([
      { id: "start", routes: { mystery: null } },
    ])).toThrow(/output/i);

    expect(() => validateSequenceGraph([
      { id: "start", routes: { next: "back" } },
      { id: "back", routes: { next: "start" } },
    ])).toThrow(/cycle/i);
  });
});
