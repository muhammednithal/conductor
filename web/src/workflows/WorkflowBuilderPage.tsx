import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ReactFlow, addEdge, Background, Controls, MiniMap,
  useEdgesState, useNodesState,
} from "@xyflow/react";
import type { Connection, Edge, Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Box, Paper, Button, TextField, Typography,
  Stack, Chip, Snackbar, Alert, Tooltip,
} from "@mui/material";
import SaveIcon from "@mui/icons-material/Save";
import DeleteIcon from "@mui/icons-material/Delete";
import { api } from "../api/client";
import { DEFAULT_CONFIG, exportDag, hasCycle, STEP_TYPES } from "./dagUtils";
import type { StepEdge, StepNode } from "./dagUtils";

let nodeCounter = 1;

const TYPE_COLORS: Record<string, string> = {
  http: "#1565c0", transform: "#6a1b9a", delay: "#e65100",
  summarize: "#2e7d32", embed: "#00695c", rag: "#b71c1c",
};

const TYPE_ICONS: Record<string, string> = {
  http: "🌐", transform: "🔄", delay: "⏱", summarize: "📝", embed: "🔢", rag: "🔍",
};

export function WorkflowBuilderPage() {
  const navigate = useNavigate();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [name, setName] = useState("My Workflow");
  const [saving, setSaving] = useState(false);
  const [snack, setSnack] = useState<{ msg: string; severity: "success"|"error"|"warning" } | null>(null);

  const onConnect = useCallback((p: Connection) => setEdges(e => addEdge(p, e)), [setEdges]);

  function addNode(type: string) {
    const id = `n${nodeCounter++}`;
    const stepName = `${type}-${nodeCounter - 1}`;
    const node: Node = {
      id,
      position: { x: 80 + ((nodeCounter - 2) % 3) * 220, y: 80 + Math.floor((nodeCounter - 2) / 3) * 130 },
      data: { label: `${TYPE_ICONS[type] ?? ""} ${stepName}`, stepType: type, stepName, config: DEFAULT_CONFIG[type] ?? {} },
      style: {
        background: TYPE_COLORS[type] ?? "#555", color: "#fff",
        borderRadius: 10, padding: "10px 18px", fontWeight: 700,
        fontSize: 13, border: "none", boxShadow: "0 3px 8px rgba(0,0,0,0.25)",
        minWidth: 140, textAlign: "center",
      },
    };
    setNodes(ns => [...ns, node]);
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
    if (nodes.length === 0) {
      setSnack({ msg: "Add at least one step before saving.", severity: "warning" });
      return;
    }
    const [stepNodes, stepEdges] = buildStepData();
    if (hasCycle(stepNodes, stepEdges)) {
      setSnack({ msg: "Cycle detected — remove the circular dependency.", severity: "error" });
      return;
    }
    setSaving(true);
    try {
      await api.createWorkflow(name, null, exportDag(stepNodes, stepEdges));
      setSnack({ msg: `"${name}" saved!`, severity: "success" });
      setTimeout(() => navigate("/workflows"), 1200);
    } catch (e) {
      setSnack({ msg: `Save failed: ${e instanceof Error ? e.message : e}`, severity: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Box sx={{ height: "calc(100vh - 64px)", display: "flex", flexDirection: "column" }}>
      {/* Toolbar */}
      <Paper elevation={2} sx={{ px: 2, py: 1.5, display: "flex", gap: 1.5, alignItems: "center", flexWrap: "wrap", zIndex: 10 }}>
        <TextField
          value={name} onChange={e => setName(e.target.value)}
          size="small" label="Workflow name" sx={{ width: 220 }}
        />
        <Typography variant="body2" color="text.secondary" sx={{ mx: 1 }}>Add step:</Typography>
        {STEP_TYPES.map(t => (
          <Tooltip key={t} title={`Add ${t} step`}>
            <Chip
              label={`${TYPE_ICONS[t] ?? ""} ${t}`}
              onClick={() => addNode(t)}
              clickable
              sx={{ bgcolor: TYPE_COLORS[t], color: "#fff", fontWeight: 700, "&:hover": { opacity: 0.85 } }}
            />
          </Tooltip>
        ))}
        {nodes.length > 0 && (
          <Tooltip title="Clear canvas">
            <Button size="small" color="error" startIcon={<DeleteIcon />}
              onClick={() => { setNodes([]); setEdges([]); nodeCounter = 1; }}>
              Clear
            </Button>
          </Tooltip>
        )}
        <Button
          variant="contained" startIcon={<SaveIcon />}
          onClick={saveWorkflow} disabled={saving}
          sx={{ ml: "auto" }}
        >
          {saving ? "Saving…" : "Save Workflow"}
        </Button>
      </Paper>

      {nodes.length === 0 && (
        <Box sx={{ position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)", textAlign:"center", pointerEvents:"none", zIndex:5 }}>
          <Typography variant="h6" color="text.disabled">Click a step type above to add it to the canvas</Typography>
          <Typography variant="body2" color="text.disabled" mt={1}>Connect steps by dragging from one node to another</Typography>
        </Box>
      )}

      {/* Canvas */}
      <Box sx={{ flex: 1 }}>
        <ReactFlow nodes={nodes} edges={edges}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onConnect={onConnect} fitView>
          <Background color="#e0e0e0" gap={20} />
          <Controls />
          <MiniMap nodeStrokeWidth={3} zoomable pannable />
        </ReactFlow>
      </Box>

      <Snackbar open={!!snack} autoHideDuration={3000} onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        <Alert severity={snack?.severity ?? "info"} onClose={() => setSnack(null)} variant="filled">
          {snack?.msg}
        </Alert>
      </Snackbar>
    </Box>
  );
}