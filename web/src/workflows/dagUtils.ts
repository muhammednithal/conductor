export interface StepNode {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  maxAttempts?: number;
  timeoutSeconds?: number;
}

export interface StepEdge {
  source: string;
  target: string;
}

export interface DagDefinition {
  steps: Array<{
    name: string;
    type: string;
    depends_on: string[];
    config: Record<string, unknown>;
    max_attempts: number;
    timeout_seconds: number;
  }>;
}

/**
 * Detect cycles using Kahn's topological sort (BFS-based).
 * If the number of nodes visited equals nodes.length, the graph is acyclic.
 * Edges referencing unknown node IDs are silently skipped.
 */
export function hasCycle(nodes: StepNode[], edges: StepEdge[]): boolean {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    if (!inDegree.has(e.source) || !inDegree.has(e.target)) continue;
    adj.get(e.source)!.push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  let visited = 0;
  while (queue.length > 0) {
    const node = queue.shift()!;
    visited++;
    for (const neighbor of adj.get(node) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  return visited !== nodes.length;
}

/** Build a dag_definition JSON object from canvas nodes and edges. */
export function exportDag(nodes: StepNode[], edges: StepEdge[]): DagDefinition {
  const idToName = new Map(nodes.map(n => [n.id, n.name]));
  return {
    steps: nodes.map(n => ({
      name: n.name,
      type: n.type,
      depends_on: edges.filter(e => e.target === n.id).map(e => idToName.get(e.source) ?? e.source),
      config: n.config,
      max_attempts: n.maxAttempts ?? 3,
      timeout_seconds: n.timeoutSeconds ?? 300,
    })),
  };
}

export const STEP_TYPES = ["http", "transform", "delay", "summarize", "embed", "rag"] as const;

export const DEFAULT_CONFIG: Record<string, Record<string, unknown>> = {
  http: { url: "https://example.com/api", method: "POST" },
  transform: { mapping: {} },
  delay: { duration_seconds: 1 },
  summarize: { max_length: 200 },
  embed: { texts: [] },
  rag: { query: "", top_k: 5 },
};