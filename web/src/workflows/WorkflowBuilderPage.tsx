import { useCallback, useState } from "react";
import {
  ReactFlow,
  addEdge,
  Background,
  Controls,
  MiniMap,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import type { Connection, Edge, Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api } from "../api/client";
import { DEFAULT_CONFIG, exportDag, hasCycle, STEP_TYPES } from "./dagUtils";
import type { StepEdge, StepNode } from "./dagUtils";

let nodeCounter = 1;

const COLORS: Record<string, string> = {
  http: "#1a73e8", transform: "#7b1fa2", delay: "#e65100",
  summarize: "#2e7d32", embed: "#00838f", rag: "#c62828",
};

export function WorkflowBuilderPage() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [workflowName, setWorkflowName] = useState("New Workflow");
  const [status, setStatus] = useState("");
  const [cycleError, setCycleError] = useState(false);

  const onConnect = useCallback(
    (params: Connection) => setEdges(eds => addEdge(params, eds)),
    [setEdges],
  );

  function addStepNode(type: string) {
    const id = `node-${nodeCounter++}`;
    const name = `${type}-${id.split("-")[1]}`;
    const newNode: Node = {
      id,
      position: { x: 80 + (nodes.length % 3) * 200, y: 80 + Math.floor(nodes.length / 3) * 120 },
      data: {
        label: `${name}\n(${type})`,
        stepType: type,
        stepName: name,
        config: DEFAULT_CONFIG[type] ?? {},
      },
      style: {
        background: COLORS[type] ?? "#555",
        color: "#fff",
        borderRadius: 8,
        padding: "8px 16px",
        border: "none",
        fontWeight: 600,
      },
    };
    setNodes(nds => [...nds, newNode]);
  }

  function buildStepData(): [StepNode[], StepEdge[]] {
    const stepNodes: StepNode[] = nodes.map(n => ({
      id: n.id,
      name: String(n.data.stepName ?? n.id),
      type: String(n.data.stepType ?? "http"),
      config: (n.data.config as Record<string, unknown>) ?? {},
    }));
    const stepEdges: StepEdge[] = edges.map(e => ({ source: e.source, target: e.target }));
    return [stepNodes, stepEdges];
  }

  async function saveWorkflow() {
    setCycleError(false);
    const [stepNodes, stepEdges] = buildStepData();

    if (hasCycle(stepNodes, stepEdges)) {
      setCycleError(true);
      setStatus("Error: DAG contains a cycle — remove circular dependencies before saving.");
      return;
    }

    const dagDef = exportDag(stepNodes, stepEdges);
    try {
      setStatus("Saving…");
      await api.createWorkflow(workflowName, null, dagDef);
      setStatus("✓ Workflow saved successfully.");
    } catch (e) {
      setStatus(`Error saving: ${e}`);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 48px)" }}>
      {/* Toolbar */}
      <div style={{ padding: "8px 16px", background: "#f5f5f5", borderBottom: "1px solid #ddd", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={workflowName}
          onChange={e => setWorkflowName(e.target.value)}
          style={{ padding: "4px 8px", fontWeight: 600, width: 200 }}
        />
        <span style={{ color: "#666", fontSize: 12 }}>Add step:</span>
        {STEP_TYPES.map(t => (
          <button
            key={t}
            onClick={() => addStepNode(t)}
            style={{ background: COLORS[t], color: "#fff", border: "none", borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: 12 }}
          >
            + {t}
          </button>
        ))}
        <button onClick={saveWorkflow} style={{ marginLeft: "auto", padding: "4px 16px", fontWeight: 700, cursor: "pointer" }}>
          Save Workflow
        </button>
      </div>

      {status && (
        <div style={{ padding: "4px 16px", background: cycleError ? "#ffebee" : "#e8f5e9", fontSize: 13, borderBottom: "1px solid #ddd" }}>
          {status}
        </div>
      )}

      <div style={{ flex: 1 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
    </div>
  );
}