export type SequenceGraphNode = {
  id?: string;
  routes?: Record<string, string | null>;
  quickReplies?: Array<{ id: string; title: string }>;
  delayMinutes?: number;
  [key: string]: unknown;
};

export function arrangeSequencePositions<T extends SequenceGraphNode>(
  steps: readonly T[],
): Array<T & { position: { x: number; y: number } }> {
  return steps.map((step, index) => ({
    ...step,
    position: {
      x: index % 2 ? 710 : 365,
      y: 45 + Math.floor(index / 2) * 210 + (index % 2) * 95,
    },
  }));
}

export function validateSequenceGraph(
  steps: readonly SequenceGraphNode[],
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
    if (step.quickReplies) {
      const ids = new Set<string>();
      for (const reply of step.quickReplies) {
        if (!reply.id?.trim() || ids.has(reply.id)) throw new Error("Quick reply IDs must be nonempty and unique.");
        ids.add(reply.id);
      }
    }
    if (step.routes === undefined) return;
    const allowedOutputs = step.quickReplies?.length
      ? step.quickReplies.map((reply) => `quickReply:${reply.id}`)
      : ["next"];
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

  if (current.quickReplies?.length && !current.routes[output]) return null;
  const targetId = current.routes[output];
  if (typeof targetId !== "string") return null;
  const targetIndex = steps.findIndex((step) => step.id === targetId);
  if (targetIndex < 0) throw new Error(`Sequence route target does not exist: ${targetId}.`);
  return targetIndex;
}

export function normalizeSequenceGraph<T extends SequenceGraphNode>(
  steps: readonly T[],
  createId: () => string = () => globalThis.crypto.randomUUID(),
): Array<T & { id: string; routes: Record<string, string | null> }> {
  const withIds = steps.map((step) => ({ ...step, id: step.id ?? createId() }));
  const normalized = withIds.map((step, index) => ({
    ...step,
    routes: step.routes ?? (step.quickReplies?.length
      ? Object.fromEntries(step.quickReplies.map((reply) => [`quickReply:${reply.id}`, null]))
      : { next: withIds[index + 1]?.id ?? null }),
  }));
  validateSequenceGraph(normalized);
  return normalized;
}

export function traceSequencePath(
  steps: readonly SequenceGraphNode[],
  startIndex = 0,
  output = "next",
): number[] {
  const path: number[] = [];
  const visited = new Set<number>();
  let current: number | null = startIndex;
  while (current !== null && current >= 0 && current < steps.length && !visited.has(current)) {
    path.push(current);
    visited.add(current);
    current = resolveSequenceRoute(steps, current, output);
  }
  return path;
}

export function maxSequencePathDelay(steps: readonly SequenceGraphNode[]): number {
  if (!steps.length) return 0;
  validateSequenceGraph(steps);
  const indexes = new Map(steps.map((step, index) => [step.id, index]));
  const memo = new Map<number, number>();

  const maxFrom = (index: number): number => {
    const cached = memo.get(index);
    if (cached !== undefined) return cached;
    const step = steps[index];
    const targets = step.routes === undefined
      ? index + 1 < steps.length ? [index + 1] : []
      : Object.values(step.routes)
          .filter((targetId): targetId is string => targetId !== null)
          .map((targetId) => indexes.get(targetId)!)
          .filter((targetIndex) => targetIndex !== undefined);
    const continuation = targets.length ? Math.max(...targets.map(maxFrom)) : 0;
    const total = (step.delayMinutes ?? 0) + continuation;
    memo.set(index, total);
    return total;
  };

  return maxFrom(0);
}
