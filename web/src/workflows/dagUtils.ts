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

/** Detect cycles using DFS (WHITE=0, GRAY=1, BLACK=2). */
export function hasCycle(nodes: StepNode[], edges: StepEdge[]): boolean {
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) adj.get(e.source)?.push(e.target);

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const n of nodes) color.set(n.id, WHITE);

  function dfs(id: string): boolean {
    color.set(id, GRAY);
    for (const nb of adj.get(id) ?? []) {
      if (color.get(nb) === GRAY) return true;
      if (color.get(nb) === WHITE && dfs(nb)) return true;
    }
    color.set(id, BLACK);
    return false;
  }

  for (const n of nodes) {
    if (color.get(n.id) === WHITE && dfs(n.id)) return true;
  }
  return false;
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