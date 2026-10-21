import { useCallback, useMemo, useRef, useState } from "react";
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
  Panel,
} from "@xyflow/react";
import type { Connection, Edge, Node, NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api } from "../api/client";
import { DEFAULT_CONFIG, exportDag, hasCycle, STEP_TYPES } from "./dagUtils";
import type { StepEdge, StepNode } from "./dagUtils";

// ── Gradients & meta ──────────────────────────────────────────────────────────
const GRADIENTS: Record<string, string> = {
  http:      "linear-gradient(135deg,#1e3a8a 0%,#3b82f6 100%)",
  transform: "linear-gradient(135deg,#581c87 0%,#a855f7 100%)",
  delay:     "linear-gradient(135deg,#78350f 0%,#f59e0b 100%)",
  summarize: "linear-gradient(135deg,#14532d 0%,#22c55e 100%)",
  embed:     "linear-gradient(135deg,#164e63 0%,#06b6d4 100%)",
  rag:       "linear-gradient(135deg,#7f1d1d 0%,#ef4444 100%)",
};
const GLOWS: Record<string, string> = {
  http:"rgba(59,130,246,0.5)", transform:"rgba(168,85,247,0.5)",
  delay:"rgba(245,158,11,0.5)", summarize:"rgba(34,197,94,0.5)",
  embed:"rgba(6,182,212,0.5)", rag:"rgba(239,68,68,0.5)",
};
const ICONS: Record<string, string> = {
  http:"🌐", transform:"🔄", delay:"⏱", summarize:"📝", embed:"🔢", rag:"🔍",
};

// ── Custom node ───────────────────────────────────────────────────────────────
function StepNode({ data, selected }: NodeProps) {
  const type = String(data.stepType ?? "http");
  const glow = GLOWS[type] ?? GLOWS.http;

  return (
    <div style={{
      background: GRADIENTS[type] ?? GRADIENTS.http,
      borderRadius: 16, padding: "16px 28px", minWidth: 160,
      textAlign: "center",
      boxShadow: selected
        ? `0 0 0 2px rgba(255,255,255,0.7), 0 0 40px ${glow}, 0 20px 40px rgba(0,0,0,0.5)`
        : `0 0 20px ${glow}, 0 10px 30px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.15)`,
      border: selected ? "2px solid rgba(255,255,255,0.7)" : "2px solid rgba(255,255,255,0.12)",
      transform: selected ? "scale(1.05) translateY(-3px)" : "scale(1)",
      transition: "all 0.2s cubic-bezier(.34,1.56,.64,1)",
      cursor: "grab",
    }}>
      {/* TARGET — top */}
      <Handle type="target" position={Position.Top}
        style={{ width:14, height:14, background:"#fff", border:"3px solid rgba(0,0,0,0.3)",
          boxShadow:`0 0 14px rgba(255,255,255,0.9)`, top:-7 }} />

      <div style={{ fontSize:26, marginBottom:6 }}>{ICONS[type] ?? "⚙"}</div>
      <div style={{ color:"#fff", fontWeight:700, fontSize:15 }}>{String(data.stepName)}</div>
      <div style={{ color:"rgba(255,255,255,0.6)", fontSize:11, marginTop:3,
        textTransform:"uppercase", letterSpacing:1.5, fontWeight:600 }}>
        {type}
      </div>

      {/* SOURCE — bottom */}
      <Handle type="source" position={Position.Bottom}
        style={{ width:14, height:14, background:"#fff", border:"3px solid rgba(0,0,0,0.3)",
          boxShadow:`0 0 14px rgba(255,255,255,0.9)`, bottom:-7 }} />
    </div>
  );
}

// ── Default edge style ────────────────────────────────────────────────────────
const EDGE_STYLE = {
  animated: true,
  style: { stroke:"rgba(255,255,255,0.5)", strokeWidth:2.5 },
  markerEnd: { type:MarkerType.ArrowClosed, color:"rgba(255,255,255,0.7)", width:18, height:18 },
};

// ── Builder page ──────────────────────────────────────────────────────────────
let counter = 1;

export function WorkflowBuilderPage() {
  const navigate = useNavigate();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [name, setName] = useState("My Workflow");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg:string; ok:boolean } | null>(null);
  const lastNodeId = useRef<string | null>(null);

  const nodeTypes = useMemo(() => ({ stepNode: StepNode }), []);

  const showToast = (msg:string, ok:boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3200);
  };

  const onConnect = useCallback((params:Connection) =>
    setEdges(e => addEdge({ ...params, ...EDGE_STYLE }, e)), [setEdges]);

  function addNode(type: string) {
    const id = `n${counter++}`;
    const stepName = `${type}-${counter - 1}`;

    const newNode: Node = {
      id, type:"stepNode",
      position: { x: 100 + ((counter - 2) % 3) * 230, y: 80 + Math.floor((counter - 2) / 3) * 180 },
      data: { stepType:type, stepName, config: DEFAULT_CONFIG[type] ?? {} },
    };

    setNodes(ns => [...ns, newNode]);

    // ── Auto-connect to previous node ──────────────────────────────────────
    if (lastNodeId.current) {
      const edgeId = `e-${lastNodeId.current}-${id}`;
      setEdges(es => [...es, {
        id: edgeId,
        source: lastNodeId.current!,
        target: id,
        ...EDGE_STYLE,
      }]);
    }
    lastNodeId.current = id;
  }

  function clearAll() {
    setNodes([]); setEdges([]); counter = 1; lastNodeId.current = null;
  }

  async function save() {
    if (nodes.length === 0) { showToast("Add at least one step first", false); return; }
    const sn: StepNode[] = nodes.map(n => ({
      id:n.id, name:String(n.data.stepName),
      type:String(n.data.stepType), config:(n.data.config as Record<string,unknown>) ?? {},
    }));
    const se: StepEdge[] = edges.map(e => ({ source:e.source, target:e.target }));
    if (hasCycle(sn, se)) { showToast("Cycle detected — remove the circular dependency", false); return; }
    setSaving(true);
    try {
      await api.createWorkflow(name, null, exportDag(sn, se));
      showToast(`"${name}" saved!`, true);
      setTimeout(() => navigate("/workflows"), 1400);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Save failed", false);
    } finally { setSaving(false); }
  }

  return (
    <div style={{ height:"calc(100vh - 64px)", display:"flex", flexDirection:"column", background:"#0d1117", overflow:"hidden" }}>

      {/* ── Toolbar ── */}
      <div style={{
        display:"flex", alignItems:"center", gap:10, padding:"10px 20px",
        flexWrap:"wrap", flexShrink:0,
        background:"rgba(255,255,255,0.03)",
        borderBottom:"1px solid rgba(255,255,255,0.07)",
      }}>
        <input
          value={name} onChange={e => setName(e.target.value)}
          style={{
            background:"rgba(255,255,255,0.07)", border:"1px solid rgba(255,255,255,0.12)",
            borderRadius:8, padding:"7px 14px", color:"#fff", fontSize:13,
            fontWeight:600, outline:"none", width:190,
          }}
        />
        <span style={{ color:"rgba(255,255,255,0.35)", fontSize:11, fontWeight:700, letterSpacing:1.2, textTransform:"uppercase", marginLeft:4 }}>
          Add step:
        </span>

        {STEP_TYPES.map(t => (
          <button key={t} onClick={() => addNode(t)} style={{
            background:GRADIENTS[t], border:"none", borderRadius:20,
            padding:"6px 14px", cursor:"pointer", color:"#fff",
            fontWeight:700, fontSize:12, letterSpacing:0.5,
            boxShadow:`0 0 14px ${GLOWS[t]}`,
            display:"flex", alignItems:"center", gap:5,
            transition:"transform 0.15s",
          }}
            onMouseEnter={e=>(e.currentTarget.style.transform="translateY(-2px) scale(1.06)")}
            onMouseLeave={e=>(e.currentTarget.style.transform="none")}
          >
            {ICONS[t]} {t}
          </button>
        ))}

        {nodes.length > 0 && (
          <button onClick={clearAll} style={{
            background:"rgba(239,68,68,0.12)", border:"1px solid rgba(239,68,68,0.3)",
            borderRadius:20, padding:"6px 14px", cursor:"pointer",
            color:"#f87171", fontWeight:700, fontSize:12,
          }}>
            🗑 Clear
          </button>
        )}

        <button onClick={save} disabled={saving} style={{
          marginLeft:"auto",
          background:saving?"rgba(99,102,241,0.35)":"linear-gradient(135deg,#4f46e5,#7c3aed)",
          border:"none", borderRadius:20, padding:"8px 22px",
          cursor:saving?"not-allowed":"pointer",
          color:"#fff", fontWeight:700, fontSize:13,
          boxShadow:saving?"none":"0 0 20px rgba(124,58,237,0.5)",
        }}>
          {saving ? "Saving…" : "💾 Save Workflow"}
        </button>
      </div>

      {/* ── Canvas — fills ALL remaining space ── */}
      <div style={{ flex:1, width:"100%", position:"relative", minHeight:0 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
          fitViewOptions={{ padding:0.3 }}
          defaultEdgeOptions={EDGE_STYLE}
          style={{ width:"100%", height:"100%", background:"#0d1117" }}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="rgba(255,255,255,0.05)" gap={28} size={1.3} />
          <Controls
            style={{
              background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)",
              borderRadius:10, bottom:16, left:16,
            }}
          />

          {nodes.length === 0 && (
            <Panel position="top-center">
              <div style={{
                marginTop:80, textAlign:"center",
                color:"rgba(255,255,255,0.25)", pointerEvents:"none",
              }}>
                <div style={{ fontSize:40, marginBottom:12 }}>✦</div>
                <div style={{ fontSize:16, fontWeight:600 }}>Click a step above to add it to the canvas</div>
                <div style={{ fontSize:12, marginTop:6, color:"rgba(255,255,255,0.15)" }}>
                  Steps auto-connect • Drag the ◉ dots to rewire manually
                </div>
              </div>
            </Panel>
          )}
        </ReactFlow>
      </div>

      {/* ── Toast ── */}
      {toast && (
        <div style={{
          position:"fixed", bottom:28, left:"50%", transform:"translateX(-50%)",
          background:toast.ok?"rgba(34,197,94,0.12)":"rgba(239,68,68,0.12)",
          border:`1px solid ${toast.ok?"rgba(34,197,94,0.4)":"rgba(239,68,68,0.4)"}`,
          backdropFilter:"blur(20px)", borderRadius:12, padding:"11px 22px",
          color:"#fff", fontWeight:600, fontSize:13, zIndex:9999,
          boxShadow:toast.ok?"0 0 20px rgba(34,197,94,0.25)":"0 0 20px rgba(239,68,68,0.25)",
        }}>
          {toast.ok ? "✅" : "⚠️"} {toast.msg}
        </div>
      )}
    </div>
  );
}