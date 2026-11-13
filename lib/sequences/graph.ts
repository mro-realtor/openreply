export type SequenceGraphNode = {
  id?: string;
  routes?: Record<string, string | null>;
};

export function validateSequenceGraph(
  steps: readonly SequenceGraphNode[],
  allowedOutputs: readonly string[] = ["next"],
): void {
  const hasGraphMetadata = steps.some((step) => step.id !== undefined || step.routes !== undefined);
  if (!hasGraphMetadata) return;

  const indexes = new Map<string, number>();
  steps.forEach((step, index) => {
    if (!step.id?.trim()) throw new Error("Every routed sequence step must have a stable ID.");
    if (indexes.has(step.id)) throw new Error("Sequence step IDs must be unique.");
    indexes.set(step.id, index);
  });

  steps.forEach((step) => {
    if (step.routes === undefined) return;
    for (const [output, targetId] of Object.entries(step.routes)) {
      if (!allowedOutputs.includes(output)) throw new Error(`Unsupported sequence output: ${output}.`);
      if (targetId !== null && !indexes.has(targetId)) {
        throw new Error(`Sequence route target does not exist: ${targetId}.`);
      }
    }
  });

  const visiting = new Set<number>();
  const visited = new Set<number>();
  const visit = (index: number) => {
    if (visiting.has(index)) throw new Error("Sequence routes cannot contain a cycle.");
    if (visited.has(index)) return;
    visiting.add(index);
    const step = steps[index];
    const targets = step.routes === undefined
      ? index + 1 < steps.length ? [index + 1] : []
      : Object.values(step.routes)
          .filter((targetId): targetId is string => targetId !== null)
          .map((targetId) => indexes.get(targetId)!);
    for (const target of targets) visit(target);
    visiting.delete(index);
    visited.add(index);
  };
  steps.forEach((_, index) => visit(index));
}

export function resolveSequenceRoute(
  steps: readonly SequenceGraphNode[],
  currentIndex: number,
  output: string,
): number | null {
  const current = steps[currentIndex];
  if (!current) return null;

  if (current.routes === undefined) {
    return currentIndex + 1 < steps.length ? currentIndex + 1 : null;
  }

  const targetId = current.routes[output];
  if (typeof targetId !== "string") return null;
  const targetIndex = steps.findIndex((step) => step.id === targetId);
  if (targetIndex < 0) throw new Error(`Sequence route target does not exist: ${targetId}.`);
  return targetIndex;
}
