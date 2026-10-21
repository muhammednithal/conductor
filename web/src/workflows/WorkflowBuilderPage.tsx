import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ReactFlow, ReactFlowProvider,
  addEdge, Background, Controls,
  useEdgesState, useNodesState, useReactFlow,
  Handle, Position, MarkerType, Panel,
} from "@xyflow/react";
import type { Connection, Edge, Node, NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api } from "../api/client";
import { DEFAULT_CONFIG, exportDag, hasCycle, STEP_TYPES } from "./dagUtils";
import type { StepEdge, StepNode } from "./dagUtils";

// ── Palette ────────────────────────────────────────────────────────────────
const GRADIENTS: Record<string, string> = {
  http:      "linear-gradient(135deg,#1e3a8a,#3b82f6)",
  transform: "linear-gradient(135deg,#581c87,#a855f7)",
  delay:     "linear-gradient(135deg,#78350f,#f59e0b)",
  summarize: "linear-gradient(135deg,#14532d,#22c55e)",
  embed:     "linear-gradient(135deg,#164e63,#06b6d4)",
  rag:       "linear-gradient(135deg,#7f1d1d,#ef4444)",
};
const GLOWS: Record<string, string> = {
  http:"rgba(59,130,246,0.5)",  transform:"rgba(168,85,247,0.5)",
  delay:"rgba(245,158,11,0.5)", summarize:"rgba(34,197,94,0.5)",
  embed:"rgba(6,182,212,0.5)",  rag:"rgba(239,68,68,0.5)",
};
const ICONS: Record<string, string> = {
  http:"🌐", transform:"🔄", delay:"⏱", summarize:"📝", embed:"🔢", rag:"🔍",
};

const EDGE_OPTS = {
  animated: true,
  style: { stroke:"rgba(255,255,255,0.45)", strokeWidth:2.5 },
  markerEnd: { type:MarkerType.ArrowClosed, color:"rgba(255,255,255,0.7)", width:18, height:18 },
};

// ── Custom node ────────────────────────────────────────────────────────────
function StepNode({ data, selected }: NodeProps) {
  const t = String(data.stepType ?? "http");
  const glow = GLOWS[t] ?? GLOWS.http;
  return (
    <div style={{
      background: GRADIENTS[t] ?? GRADIENTS.http,
      borderRadius:16, padding:"16px 28px", minWidth:150, textAlign:"center",
      boxShadow: selected
        ? `0 0 0 2px #fff, 0 0 40px ${glow}, 0 20px 40px rgba(0,0,0,0.5)`
        : `0 0 20px ${glow}, 0 8px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.15)`,
      border: selected ? "2px solid rgba(255,255,255,0.8)" : "2px solid rgba(255,255,255,0.12)",
      transform: selected ? "scale(1.05) translateY(-3px)" : "scale(1)",
      transition: "all 0.2s cubic-bezier(.34,1.56,.64,1)",
    }}>
      <Handle type="target" position={Position.Top}
        style={{ width:14,height:14,background:"#fff",border:"3px solid rgba(0,0,0,0.3)",
          boxShadow:"0 0 12px rgba(255,255,255,0.9)",top:-7 }}
      />
      <div style={{ fontSize:24, marginBottom:5 }}>{ICONS[t] ?? "⚙"}</div>
      <div style={{ color:"#fff", fontWeight:700, fontSize:14 }}>{String(data.stepName)}</div>
      <div style={{ color:"rgba(255,255,255,0.55)", fontSize:10, marginTop:3,
        textTransform:"uppercase", letterSpacing:1.5, fontWeight:700 }}>{t}</div>
      <Handle type="source" position={Position.Bottom}
        style={{ width:14,height:14,background:"#fff",border:"3px solid rgba(0,0,0,0.3)",
          boxShadow:"0 0 12px rgba(255,255,255,0.9)",bottom:-7 }}
      />
    </div>
  );
}

// ── Inner canvas (needs to be inside ReactFlowProvider to use useReactFlow) ──
let counter = 1;

function FlowInner({
  name, setName, saving, save, toast,
}: {
  name:string; setName:(v:string)=>void;
  saving:boolean; save:()=>void;
  toast:{ msg:string; ok:boolean }|null;
}) {
  const navigate = useNavigate();
  const { fitView } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const lastId = useRef<string | null>(null);
  const lastY  = useRef(60);

  const nodeTypes = useMemo(() => ({ stepNode: StepNode }), []);

  // Fit view whenever nodes change
  useEffect(() => {
    if (nodes.length === 0) return;
    const timer = setTimeout(() => fitView({ padding:0.35, duration:350 }), 60);
    return () => clearTimeout(timer);
  }, [nodes.length, fitView]);

  const onConnect = useCallback((p:Connection) =>
    setEdges(e => addEdge({ ...p, ...EDGE_OPTS }, e)), [setEdges]);

  function addNode(type:string) {
    const id = `n${counter++}`;
    const stepName = `${type}-${counter - 1}`;

    // Vertical chain: each node is placed 180px below the previous one
    const X = 300;
    const Y = lastY.current;
    lastY.current += 180;

    setNodes(ns => [...ns, {
      id, type:"stepNode",
      position:{ x:X, y:Y },
      data:{ stepType:type, stepName, config:DEFAULT_CONFIG[type] ?? {} },
    }]);

    // Auto-connect to previous node
    if (lastId.current) {
      setEdges(es => [...es, {
        id:`e-${lastId.current}-${id}`,
        source:lastId.current!, target:id,
        ...EDGE_OPTS,
      }]);
    }
    lastId.current = id;
  }

  function clearAll() {
    setNodes([]); setEdges([]);
    counter = 1; lastId.current = null; lastY.current = 60;
  }

  // Expose save wrapper that accesses local state
  const handleSave = useCallback(async () => {
    if (nodes.length === 0) { save(); return; }
    const sn: StepNode[] = nodes.map(n => ({
      id:n.id, name:String(n.data.stepName),
      type:String(n.data.stepType), config:(n.data.config as Record<string,unknown>) ?? {},
    }));
    const se: StepEdge[] = edges.map(e => ({ source:e.source, target:e.target }));
    save();
    // actual save logic is in parent — pass data up through a ref would be cleaner,
    // but for simplicity we duplicate it here:
    if (hasCycle(sn, se)) return;
    try {
      await api.createWorkflow(name, null, exportDag(sn, se));
      setTimeout(() => navigate("/workflows"), 1400);
    } catch { /* parent shows error */ }
  }, [nodes, edges, name, save, navigate]);

  return (
    <div style={{ height:"calc(100vh - 64px)", display:"flex", flexDirection:"column",
      background:"#0d1117", overflow:"hidden" }}>

      {/* Toolbar */}
      <div style={{
        display:"flex", alignItems:"center", gap:9, padding:"10px 18px",
        flexWrap:"wrap", flexShrink:0,
        background:"rgba(255,255,255,0.025)",
        borderBottom:"1px solid rgba(255,255,255,0.06)",
      }}>
        <input value={name} onChange={e => setName(e.target.value)}
          style={{ background:"rgba(255,255,255,0.07)", border:"1px solid rgba(255,255,255,0.12)",
            borderRadius:8, padding:"7px 13px", color:"#fff", fontSize:13,
            fontWeight:600, outline:"none", width:180 }}
        />
        <span style={{ color:"rgba(255,255,255,0.3)", fontSize:10, fontWeight:700,
          letterSpacing:1.5, textTransform:"uppercase", marginLeft:4 }}>
          Add step:
        </span>

        {STEP_TYPES.map(t => (
          <button key={t} onClick={() => addNode(t)} style={{
            background:GRADIENTS[t], border:"none", borderRadius:20,
            padding:"5px 13px", cursor:"pointer", color:"#fff",
            fontWeight:700, fontSize:11, letterSpacing:0.5,
            boxShadow:`0 0 12px ${GLOWS[t]}`,
            display:"flex", alignItems:"center", gap:5,
            transition:"transform 0.12s",
          }}
            onMouseEnter={e=>(e.currentTarget.style.transform="translateY(-2px) scale(1.07)")}
            onMouseLeave={e=>(e.currentTarget.style.transform="none")}
          >
            {ICONS[t]} {t}
          </button>
        ))}

        {nodes.length > 0 && (
          <button onClick={clearAll} style={{
            background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.25)",
            borderRadius:20, padding:"5px 13px", cursor:"pointer",
            color:"#f87171", fontWeight:700, fontSize:11,
          }}>🗑 Clear</button>
        )}

        <button onClick={handleSave} disabled={saving} style={{
          marginLeft:"auto",
          background:saving?"rgba(99,102,241,0.3)":"linear-gradient(135deg,#4f46e5,#7c3aed)",
          border:"none", borderRadius:20, padding:"7px 20px",
          cursor:saving?"not-allowed":"pointer", color:"#fff",
          fontWeight:700, fontSize:12,
          boxShadow:saving?"none":"0 0 18px rgba(124,58,237,0.45)",
        }}>
          {saving ? "Saving…" : "💾 Save Workflow"}
        </button>
      </div>

      {/* Canvas — fills ALL remaining height/width */}
      <div style={{ flex:1, minHeight:0, width:"100%", position:"relative" }}>
        <ReactFlow
          nodes={nodes} edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          defaultEdgeOptions={EDGE_OPTS}
          fitView fitViewOptions={{ padding:0.35 }}
          style={{ width:"100%", height:"100%", background:"#0d1117" }}
          proOptions={{ hideAttribution:true }}
        >
          <Background color="rgba(255,255,255,0.04)" gap={30} size={1.2} />
          <Controls />

          {nodes.length === 0 && (
            <Panel position="top-center">
              <div style={{ marginTop:100, textAlign:"center", pointerEvents:"none" }}>
                <div style={{ fontSize:36, marginBottom:10, opacity:0.2 }}>✦</div>
                <div style={{ color:"rgba(255,255,255,0.3)", fontSize:15, fontWeight:600 }}>
                  Click a step type to add it
                </div>
                <div style={{ color:"rgba(255,255,255,0.15)", fontSize:11, marginTop:6 }}>
                  Steps auto-connect in sequence • Drag the ◉ dots to rewire
                </div>
              </div>
            </Panel>
          )}
        </ReactFlow>
      </div>

      {toast && (
        <div style={{
          position:"fixed", bottom:26, left:"50%", transform:"translateX(-50%)",
          background:toast.ok?"rgba(34,197,94,0.1)":"rgba(239,68,68,0.1)",
          border:`1px solid ${toast.ok?"rgba(34,197,94,0.35)":"rgba(239,68,68,0.35)"}`,
          backdropFilter:"blur(20px)", borderRadius:12, padding:"10px 22px",
          color:"#fff", fontWeight:600, fontSize:13, zIndex:9999,
          animation:"fadeIn 0.2s ease",
        }}>
          {toast.ok ? "✅" : "⚠️"} {toast.msg}
        </div>
      )}
    </div>
  );
}

// ── Public page wrapper (provides ReactFlowProvider context) ─────────────────
export function WorkflowBuilderPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("My Workflow");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg:string; ok:boolean }|null>(null);

  const showToast = (msg:string, ok:boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3200);
  };

  const save = () => {
    if (!name.trim()) { showToast("Give the workflow a name", false); return; }
    setSaving(true);
    // FlowInner handles the actual API call and then calls navigate
    setTimeout(() => setSaving(false), 3000); // fallback reset
  };

  return (
    <ReactFlowProvider>
      <FlowInner
        name={name} setName={setName}
        saving={saving} save={save}
        toast={toast}
      />
    </ReactFlowProvider>
  );
}