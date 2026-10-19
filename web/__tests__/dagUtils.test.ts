import { describe, it, expect } from "@jest/globals";
import { exportDag, hasCycle, StepEdge, StepNode } from "../src/workflows/dagUtils";

const nodes: StepNode[] = [
  { id: "a", name: "step-a", type: "delay", config: {} },
  { id: "b", name: "step-b", type: "delay", config: {} },
  { id: "c", name: "step-c", type: "delay", config: {} },
];

describe("hasCycle", () => {
  it("returns false for a linear DAG", () => {
    const edges: StepEdge[] = [{ source: "a", target: "b" }, { source: "b", target: "c" }];
    expect(hasCycle(nodes, edges)).toBe(false);
  });

  it("returns true for a simple cycle", () => {
    const edges: StepEdge[] = [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
      { source: "c", target: "a" }, // cycle
    ];
    expect(hasCycle(nodes, edges)).toBe(true);
  });

  it("returns true for self-loop", () => {
    expect(hasCycle(nodes, [{ source: "a", target: "a" }])).toBe(true);
  });

  it("returns false for diamond DAG", () => {
    const edges: StepEdge[] = [
      { source: "a", target: "b" },
      { source: "a", target: "c" },
      { source: "b", target: "c" }, // fan-in is ok
    ];
    expect(hasCycle(nodes, edges)).toBe(false);
  });
});

describe("exportDag", () => {
  it("correctly maps edges to depends_on", () => {
    const edges: StepEdge[] = [{ source: "a", target: "b" }];
    const dag = exportDag(nodes, edges);
    const b = dag.steps.find(s => s.name === "step-b");
    expect(b?.depends_on).toEqual(["step-a"]);
    const a = dag.steps.find(s => s.name === "step-a");
    expect(a?.depends_on).toEqual([]);
  });

  it("includes all steps in output", () => {
    const dag = exportDag(nodes, []);
    expect(dag.steps).toHaveLength(3);
  });
});