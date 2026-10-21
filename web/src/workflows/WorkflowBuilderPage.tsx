import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ReactFlow,
  addEdge,
  Background,
  Controls,
  useEdgesState,
  useNodesState,
  Handle,
  Position,
  MarkerType,
} from "@xyflow/react";
import type { Connection, Edge, Node, NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api } from "../api/client";
import { DEFAULT_CONFIG, exportDag, hasCycle, STEP_TYPES } from "./dagUtils";
import type { StepEdge, StepNode } from "./dagUtils";

// ── Gradients & icons ─────────────────────────────────────────────────────────
const GRADIENTS: Record<string, string> = {
  http:      "linear-gradient(135deg,#1e3a8a 0%,#3b82f6 100%)",
  transform: "linear-gradient(135deg,#581c87 0%,#a855f7 100%)",
  delay:     "linear-gradient(135deg,#78350f 0%,#f59e0b 100%)",
  summarize: "linear-gradient(135deg,#14532d 0%,#22c55e 100%)",
  embed:     "linear-gradient(135deg,#164e63 0%,#06b6d4 100%)",
  rag:       "linear-gradient(135deg,#7f1d1d 0%,#ef4444 100%)",
};

const GLOWS: Record<string, string> = {
  http:      "0 0 30px rgba(59,130,246,0.5)",
  transform: "0 0 30px rgba(168,85,247,0.5)",
  delay:     "0 0 30px rgba(245,158,11,0.5)",
  summarize: "0 0 30px rgba(34,197,94,0.5)",
  embed:     "0 0 30px rgba(6,182,212,0.5)",
  rag:       "0 0 30px rgba(239,68,68,0.5)",
};

const ICONS: Record<string, string> = {
  http:"🌐", transform:"🔄", delay:"⏱", summarize:"📝", embed:"🔢", rag:"🔍",
};

// ── Custom node component ─────────────────────────────────────────────────────
function StepNode({ data, selected }: NodeProps) {
  const type = String(data.stepType ?? "http");
  const gradient = GRADIENTS[type] ?? GRADIENTS.http;
  const glow     = GLOWS[type]     ?? GLOWS.http;

  return (
    <div style={{
      background: gradient,
      borderRadius: 16,
      padding: "14px 24px",
      minWidth: 160,
      textAlign: "center",
      boxShadow: selected
        ? `${glow}, 0 20px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.2)`
        : `0 10px 30px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.15)`,
      border: selected ? "2px solid rgba(255,255,255,0.6)" : "2px solid rgba(255,255,255,0.12)",
      cursor: "grab",
      position: "relative",
      transform: selected ? "scale(1.04) translateY(-2px)" : "scale(1)",
      transition: "all 0.2s cubic-bezier(.34,1.56,.64,1)",
      userSelect: "none",
    }}>
      {/* Target handle — top */}
      <Handle
        type="target"
        position={Position.Top}
        style={{
          width: 16, height: 16,
          background: "rgba(255,255,255,0.9)",
          border: "3px solid rgba(255,255,255,0.3)",
          boxShadow: "0 0 12px rgba(255,255,255,0.8)",
          top: -8,
        }}
      />

      <div style={{ fontSize: 24, marginBottom: 4 }}>{ICONS[type] ?? "⚙"}</div>
      <div style={{ color:"#fff", fontWeight:700, fontSize:14, letterSpacing:0.3 }}>
        {String(data.stepName)}
      </div>
      <div style={{
        color:"rgba(255,255,255,0.65)", fontSize:11, marginTop:2,
        textTransform:"uppercase", letterSpacing:1.5, fontWeight:600,
      }}>
        {type}
      </div>

      {/* Source handle — bottom */}
      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          width: 16, height: 16,
          background: "rgba(255,255,255,0.9)",
          border: "3px solid rgba(255,255,255,0.3)",
          boxShadow: "0 0 12px rgba(255,255,255,0.8)",
          bottom: -8,
        }}
      />
    </div>
  );
}

// ── Main builder ──────────────────────────────────────────────────────────────
let nodeCounter = 1;

export function WorkflowBuilderPage() {
  const navigate = useNavigate();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [name, setName] = useState("My Workflow");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const nodeTypes = useMemo(() => ({ stepNode: StepNode }), []);

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const onConnect = useCallback((params: Connection) => {
    setEdges(e => addEdge({
      ...params,
      animated: true,
      style: { stroke: "rgba(255,255,255,0.4)", strokeWidth: 2.5 },
      markerEnd: { type: MarkerType.ArrowClosed, color: "rgba(255,255,255,0.6)", width: 20, height: 20 },
    }, e));
  }, [setEdges]);

  function addNode(type: string) {
    const id = `n${nodeCounter++}`;
    const stepName = `${type}-${nodeCounter - 1}`;
    setNodes(ns => [...ns, {
      id,
      type: "stepNode",
      position: { x: 60 + ((nodeCounter - 2) % 4) * 220, y: 60 + Math.floor((nodeCounter - 2) / 4) * 160 },
      data: { stepType: type, stepName, config: DEFAULT_CONFIG[type] ?? {} },
    }]);
  }

  async function save() {
    if (nodes.length === 0) { showToast("Add at least one step first", false); return; }
    const sn: StepNode[] = nodes.map(n => ({ id: n.id, name: String(n.data.stepName), type: String(n.data.stepType), config: (n.data.config as Record<string, unknown>) ?? {} }));
    const se: StepEdge[] = edges.map(e => ({ source: e.source, target: e.target }));
    if (hasCycle(sn, se)) { showToast("Cycle detected — remove circular dependencies", false); return; }
    setSaving(true);
    try {
      await api.createWorkflow(name, null, exportDag(sn, se));
      showToast(`"${name}" saved successfully!`, true);
      setTimeout(() => navigate("/workflows"), 1400);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Save failed", false);
    } finally { setSaving(false); }
  }

  return (
    <div style={{ height: "calc(100vh - 64px)", display:"flex", flexDirection:"column", background:"#0d1117" }}>

      {/* ── Toolbar ── */}
      <div style={{
        display:"flex", alignItems:"center", gap:10, padding:"12px 20px", flexWrap:"wrap",
        background:"rgba(255,255,255,0.04)",
        borderBottom:"1px solid rgba(255,255,255,0.08)",
        backdropFilter:"blur(20px)",
      }}>
        <input
          value={name} onChange={e => setName(e.target.value)}
          placeholder="Workflow name"
          style={{
            background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.15)",
            borderRadius:8, padding:"8px 14px", color:"#fff", fontSize:14, fontWeight:600,
            outline:"none", width:200,
          }}
        />

        <div style={{ color:"rgba(255,255,255,0.4)", fontSize:12, marginLeft:8, fontWeight:600, letterSpacing:1, textTransform:"uppercase" }}>
          Add step:
        </div>

        {STEP_TYPES.map(t => (
          <button key={t} onClick={() => addNode(t)} style={{
            background: GRADIENTS[t], border:"none", borderRadius:20,
            padding:"6px 16px", cursor:"pointer", color:"#fff",
            fontWeight:700, fontSize:12, letterSpacing:0.5,
            boxShadow: GLOWS[t], transition:"all 0.15s ease",
            display:"flex", alignItems:"center", gap:6,
          }}
            onMouseEnter={e => (e.currentTarget.style.transform = "translateY(-2px) scale(1.05)")}
            onMouseLeave={e => (e.currentTarget.style.transform = "none")}
          >
            <span>{ICONS[t]}</span> {t}
          </button>
        ))}

        {nodes.length > 0 && (
          <button onClick={() => { setNodes([]); setEdges([]); nodeCounter = 1; }} style={{
            background:"rgba(239,68,68,0.15)", border:"1px solid rgba(239,68,68,0.3)",
            borderRadius:20, padding:"6px 14px", cursor:"pointer",
            color:"#f87171", fontWeight:700, fontSize:12,
            transition:"all 0.15s ease",
          }}>
            🗑 Clear
          </button>
        )}

        <button onClick={save} disabled={saving} style={{
          marginLeft:"auto",
          background: saving ? "rgba(99,102,241,0.4)" : "linear-gradient(135deg,#4f46e5,#7c3aed)",
          border:"none", borderRadius:20, padding:"8px 24px",
          cursor: saving ? "not-allowed" : "pointer",
          color:"#fff", fontWeight:700, fontSize:13, letterSpacing:0.5,
          boxShadow: saving ? "none" : "0 0 20px rgba(124,58,237,0.5)",
          transition:"all 0.15s ease",
        }}>
          {saving ? "Saving…" : "💾 Save Workflow"}
        </button>
      </div>

      {/* ── Helper text ── */}
      {nodes.length === 0 && (
        <div style={{
          position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-30%)",
          textAlign:"center", pointerEvents:"none", zIndex:5,
        }}>
          <div style={{ fontSize:48, marginBottom:16 }}>✦</div>
          <div style={{ color:"rgba(255,255,255,0.5)", fontSize:18, fontWeight:600 }}>
            Click a step type above to add it
          </div>
          <div style={{ color:"rgba(255,255,255,0.25)", fontSize:13, marginTop:8 }}>
            Drag the <span style={{ color:"rgba(255,255,255,0.5)", fontWeight:700 }}>white dot</span> at the bottom of a node onto the top of another to connect them
          </div>
        </div>
      )}

      {/* ── Canvas ── */}
      <div style={{ flex:1, position:"relative" }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
          defaultEdgeOptions={{
            animated: true,
            style: { stroke:"rgba(255,255,255,0.35)", strokeWidth:2.5 },
            markerEnd: { type: MarkerType.ArrowClosed, color:"rgba(255,255,255,0.6)", width:20, height:20 },
          }}
          style={{ background:"transparent" }}
        >
          <Background color="rgba(255,255,255,0.06)" gap={28} size={1.2} />
          <Controls style={{
            background:"rgba(255,255,255,0.06)",
            border:"1px solid rgba(255,255,255,0.1)",
            borderRadius:12,
          }} />
        </ReactFlow>
      </div>

      {/* ── Toast ── */}
      {toast && (
        <div style={{
          position:"fixed", bottom:32, left:"50%", transform:"translateX(-50%)",
          background: toast.ok ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
          border: `1px solid ${toast.ok ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)"}`,
          backdropFilter:"blur(20px)", borderRadius:12, padding:"12px 24px",
          color:"#fff", fontWeight:600, fontSize:14, zIndex:9999,
          boxShadow: toast.ok ? "0 0 20px rgba(34,197,94,0.3)" : "0 0 20px rgba(239,68,68,0.3)",
          animation:"fadeIn 0.2s ease",
        }}>
          {toast.ok ? "✅" : "⚠️"} {toast.msg}
        </div>
      )}
    </div>
  );
}