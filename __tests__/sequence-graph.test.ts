import { describe, expect, it } from "vitest";
import { normalizeSequenceGraph, resolveSequenceRoute, traceSequencePath, validateSequenceGraph } from "@/lib/sequences/graph";

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

  it("treats an explicit missing output as the end of that path", () => {
    const steps = [{ id: "start", routes: {} }, { id: "unreachable" }];
    expect(resolveSequenceRoute(steps, 0, "next")).toBeNull();
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
