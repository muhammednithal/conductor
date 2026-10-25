import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ReactFlow, ReactFlowProvider,
  addEdge, Background, Controls,
  useEdgesState, useNodesState, useReactFlow,
  Handle, Position, MarkerType, Panel,
} from "@xyflow/react";
import type { Connection, Edge, Node, NodeProps, NodeMouseHandler } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Box, Drawer, Typography, TextField, Button,
  Stack, Divider, Chip, Paper,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import SaveIcon from "@mui/icons-material/Save";
import DeleteIcon from "@mui/icons-material/Delete";
import { api } from "../api/client";
import { DEFAULT_CONFIG, exportDag, hasCycle, STEP_TYPES } from "./dagUtils";
import type { StepEdge, StepNode } from "./dagUtils";

const GRADIENTS: Record<string, string> = {
  http:"linear-gradient(135deg,#1e3a8a,#3b82f6)",
  transform:"linear-gradient(135deg,#581c87,#a855f7)",
  delay:"linear-gradient(135deg,#78350f,#f59e0b)",
  summarize:"linear-gradient(135deg,#14532d,#22c55e)",
  embed:"linear-gradient(135deg,#164e63,#06b6d4)",
  rag:"linear-gradient(135deg,#7f1d1d,#ef4444)",
};
const GLOWS: Record<string, string> = {
  http:"rgba(59,130,246,0.45)",transform:"rgba(168,85,247,0.45)",
  delay:"rgba(245,158,11,0.45)",summarize:"rgba(34,197,94,0.45)",
  embed:"rgba(6,182,212,0.45)",rag:"rgba(239,68,68,0.45)",
};
const ICONS: Record<string,string> = {
  http:"ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸Ãƒâ€¦Ã¢â‚¬â„¢Ãƒâ€šÃ‚Â",transform:"ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾",delay:"ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â±",summarize:"ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€šÃ‚Â",embed:"ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â¢",rag:"ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â",
};

const EDGE_OPTS = {
  animated:true,
  style:{ stroke:"rgba(255,255,255,0.45)", strokeWidth:2.5 },
  markerEnd:{ type:MarkerType.ArrowClosed, color:"rgba(255,255,255,0.7)", width:18, height:18 },
};

function StepNode({ data, selected }: NodeProps) {
  const t = String(data.stepType ?? "http");
  const glow = GLOWS[t] ?? GLOWS.http;
  return (
    <div style={{
      background:GRADIENTS[t] ?? GRADIENTS.http,
      borderRadius:16, padding:"16px 28px", minWidth:150, textAlign:"center",
      boxShadow:selected
        ? `0 0 0 2px #fff, 0 0 40px ${glow}, 0 20px 40px rgba(0,0,0,0.5)`
        : `0 0 18px ${glow}, 0 8px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.15)`,
      border:selected?"2px solid rgba(255,255,255,0.8)":"2px solid rgba(255,255,255,0.12)",
      transform:selected?"scale(1.05) translateY(-3px)":"scale(1)",
      transition:"all 0.2s cubic-bezier(.34,1.56,.64,1)",
    }}>
      <Handle type="target" position={Position.Top}
        style={{width:14,height:14,background:"#fff",border:"3px solid rgba(0,0,0,0.3)",
          boxShadow:"0 0 12px rgba(255,255,255,0.9)",top:-7}} />
      <div style={{fontSize:24,marginBottom:5}}>{ICONS[t]??""}</div>
      <div style={{color:"#fff",fontWeight:700,fontSize:14}}>{String(data.stepName)}</div>
      <div style={{color:"rgba(255,255,255,0.55)",fontSize:10,marginTop:3,
        textTransform:"uppercase",letterSpacing:1.5,fontWeight:700}}>{t}</div>
      <Handle type="source" position={Position.Bottom}
        style={{width:14,height:14,background:"#fff",border:"3px solid rgba(0,0,0,0.3)",
          boxShadow:"0 0 12px rgba(255,255,255,0.9)",bottom:-7}} />
    </div>
  );
}

let counter = 1;

function FlowInner({ name, setName, onSave, toast }:{
  name:string; setName:(v:string)=>void;
  onSave:(nodes:StepNode[], edges:StepEdge[])=>Promise<void>;
  toast:{msg:string;ok:boolean}|null;
}) {
  const { fitView } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selected, setSelected] = useState<Node | null>(null);
  const [saving, setSaving] = useState(false);
  const lastId = useRef<string|null>(null);
  const lastY  = useRef(60);
  const nodeTypes = useMemo(() => ({ stepNode:StepNode }), []);

  useEffect(() => {
    if (nodes.length === 0) return;
    const t = setTimeout(() => fitView({ padding:0.35, duration:350 }), 60);
    return () => clearTimeout(t);
  }, [nodes.length, fitView]);

  const onConnect = useCallback((p:Connection) => {
    // Prevent self-loops
    if (p.source === p.target) return;
    // Prevent cycles
    const tempEdges: StepEdge[] = [
      ...edges.map(e => ({ source:e.source, target:e.target })),
      { source:p.source!, target:p.target! },
    ];
    const sn: StepNode[] = nodes.map(n => ({
      id:n.id, name:String(n.data.stepName), type:String(n.data.stepType), config:{},
    }));
    if (hasCycle(sn, tempEdges)) return; // silently reject — no cycle allowed
    setEdges(e => addEdge({ ...p, ...EDGE_OPTS }, e));
  }, [nodes, edges, setEdges]);

  // When a node is deleted via keyboard (not our button), reset lastId
  // so the next auto-added node does not connect to a ghost node
  const handleNodesChange = useCallback((changes: import("@xyflow/react").NodeChange[]) => {
    changes.forEach(c => {
      if (c.type === "remove" && c.id === lastId.current) {
        lastId.current = null;
      }
    });
    onNodesChange(changes);
  }, [onNodesChange]);

  // Prevent drawing an edge that would create a cycle
  const isValidConnection = useCallback((conn: Connection) => {
    if (!conn.source || !conn.target) return false;
    if (conn.source === conn.target) return false; // no self-loops
    const tempEdges: StepEdge[] = [
      ...edges.map(e => ({ source: e.source, target: e.target })),
      { source: conn.source, target: conn.target },
    ];
    const sn: StepNode[] = nodes.map(n => ({
      id: n.id, name: String(n.data.stepName),
      type: String(n.data.stepType), config: {},
    }));
    return !hasCycle(sn, tempEdges);
  }, [nodes, edges]);

  const onNodeClick: NodeMouseHandler = useCallback((_, node) => {
    setSelected(node);
  }, []);

  function addNode(type:string) {
    const id = `n${counter++}`;
    const stepName = `${type}-${counter-1}`;
    setNodes(ns => [...ns, {
      id, type:"stepNode",
      position:{ x:300, y:lastY.current },
      data:{ stepType:type, stepName, config:DEFAULT_CONFIG[type]??{} },
    }]);
    if (lastId.current) {
      setEdges(es => [...es, {
        id:`e-${lastId.current}-${id}`,
        source:lastId.current!, target:id, ...EDGE_OPTS,
      }]);
    }
    lastId.current = id;
    lastY.current += 180;
  }

  function deleteSelected() {
    if (!selected) return;
    setNodes(ns => ns.filter(n => n.id !== selected.id));
    setEdges(es => es.filter(e => e.source !== selected.id && e.target !== selected.id));
    if (lastId.current === selected.id) lastId.current = null;
    setSelected(null);
  }

  function updateConfig(key:string, value:string) {
    if (!selected) return;
    const newConfig = { ...(selected.data.config as Record<string,unknown>), [key]: value };
    const newData = { ...selected.data, config: newConfig };
    setNodes(ns => ns.map(n => n.id === selected.id ? { ...n, data: newData } : n));
    setSelected(prev => prev ? { ...prev, data: newData } : prev);
  }

  function updateStepName(value:string) {
    if (!selected) return;
    const newData = { ...selected.data, stepName: value };
    setNodes(ns => ns.map(n => n.id === selected.id ? { ...n, data: newData } : n));
    setSelected(prev => prev ? { ...prev, data: newData } : prev);
  }

  async function handleSave() {
    if (nodes.length === 0) return;
    const sn: StepNode[] = nodes.map(n => ({
      id:n.id, name:String(n.data.stepName),
      type:String(n.data.stepType), config:(n.data.config as Record<string,unknown>)??{},
    }));
    const se: StepEdge[] = edges.map(e => ({ source:e.source, target:e.target }));
    setSaving(true);
    try { await onSave(sn, se); } finally { setSaving(false); }
  }

  const config = selected ? (selected.data.config as Record<string, unknown>) : {};

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
          placeholder="Workflow name"
          style={{ background:"rgba(255,255,255,0.07)", border:"1px solid rgba(255,255,255,0.12)",
            borderRadius:8, padding:"7px 13px", color:"#fff", fontSize:13,
            fontWeight:600, outline:"none", width:190 }} />
        <span style={{ color:"rgba(255,255,255,0.3)", fontSize:10, fontWeight:700,
          letterSpacing:1.5, textTransform:"uppercase" }}>Add step:</span>
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
          <button onClick={() => { setNodes([]); setEdges([]); counter=1; lastId.current=null; lastY.current=60; setSelected(null); }}
            style={{ background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.25)",
              borderRadius:20, padding:"5px 13px", cursor:"pointer",
              color:"#f87171", fontWeight:700, fontSize:11 }}>ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬ÂÃƒÂ¢Ã¢â€šÂ¬Ã‹Å“ Clear</button>
        )}
        <button onClick={handleSave} disabled={saving || nodes.length===0} style={{
          marginLeft:"auto",
          background:(saving||nodes.length===0)?"rgba(99,102,241,0.3)":"linear-gradient(135deg,#4f46e5,#7c3aed)",
          border:"none", borderRadius:20, padding:"7px 20px",
          cursor:(saving||nodes.length===0)?"not-allowed":"pointer",
          color:"#fff", fontWeight:700, fontSize:12,
          boxShadow:(saving||nodes.length===0)?"none":"0 0 18px rgba(124,58,237,0.45)",
        }}>{saving ? "SavingÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦" : "ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢Ãƒâ€šÃ‚Â¾ Save Workflow"}</button>
      </div>

      {/* Canvas + Config panel */}
      <div style={{ flex:1, display:"flex", minHeight:0 }}>
        {/* Canvas */}
        <div style={{ flex:1, position:"relative" }}>
          <ReactFlow
            nodes={nodes} edges={edges} nodeTypes={nodeTypes}
            onNodesChange={handleNodesChange} onEdgesChange={onEdgesChange}
            onConnect={onConnect} onNodeClick={onNodeClick} 
            onPaneClick={() => setSelected(null)}
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
                  <div style={{ fontSize:36, opacity:0.15, marginBottom:10 }}>ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“Ãƒâ€šÃ‚Â¦</div>
                  <div style={{ color:"rgba(255,255,255,0.3)", fontSize:15, fontWeight:600 }}>
                    Click a step type to add it
                  </div>
                  <div style={{ color:"rgba(255,255,255,0.15)", fontSize:11, marginTop:6 }}>
                    Steps auto-connect ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ Click a node to edit its config
                  </div>
                </div>
              </Panel>
            )}
          </ReactFlow>
        </div>

        {/* Config panel ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â slides in when a node is selected */}
        {selected && (
          <Paper elevation={0} sx={{
            width:300, flexShrink:0,
            background:"rgba(15,19,32,0.98)",
            borderLeft:"1px solid rgba(255,255,255,0.08)",
            p:2.5, overflowY:"auto",
          }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <span style={{ fontSize:20 }}>{ICONS[String(selected.data.stepType)] ?? "ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢"}</span>
                <Typography variant="subtitle1" fontWeight={700}>
                  {String(selected.data.stepType)} step
                </Typography>
              </Stack>
              <button onClick={() => setSelected(null)}
                style={{ background:"none", border:"none", cursor:"pointer",
                  color:"rgba(255,255,255,0.4)", fontSize:18 }}>ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â</button>
            </Stack>

            <Divider sx={{ mb:2, borderColor:"rgba(255,255,255,0.08)" }} />

            {/* Step name */}
            <TextField fullWidth size="small" label="Step name"
              value={String(selected.data.stepName)}
              onChange={e => updateStepName(e.target.value)}
              sx={{ mb:2 }}
            />

            {/* Config fields */}
            <Typography variant="caption" color="text.secondary"
              sx={{ textTransform:"uppercase", letterSpacing:1, fontWeight:700, mb:1, display:"block" }}>
              Config
            </Typography>
            {Object.entries(config).map(([key, val]) => (
              <TextField key={key} fullWidth size="small" label={key}
                value={String(val)}
                onChange={e => updateConfig(key, e.target.value)}
                multiline={String(val).length > 60}
                rows={String(val).length > 60 ? 3 : 1}
                sx={{ mb:1.5 }}
                helperText={
                  key === "url" ? "Full URL including https://" :
                  key === "method" ? "GET, POST, PUT, DELETE" :
                  key === "duration_seconds" ? "How many seconds to wait" :
                  key === "max_length" ? "Max words in the summary" :
                  undefined
                }
              />
            ))}

            <Divider sx={{ my:2, borderColor:"rgba(255,255,255,0.08)" }} />

            <Button fullWidth size="small" color="error" variant="outlined"
              startIcon={<DeleteIcon />}
              onClick={deleteSelected}
              sx={{ borderColor:"rgba(239,68,68,0.3)", color:"#f87171" }}>
              Delete step
            </Button>
          </Paper>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position:"fixed", bottom:26, left:"50%", transform:"translateX(-50%)",
          background:toast.ok?"rgba(34,197,94,0.1)":"rgba(239,68,68,0.1)",
          border:`1px solid ${toast.ok?"rgba(34,197,94,0.35)":"rgba(239,68,68,0.35)"}`,
          backdropFilter:"blur(20px)", borderRadius:12, padding:"10px 22px",
          color:"#fff", fontWeight:600, fontSize:13, zIndex:9999,
        }}>
          {toast.ok ? "ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦" : "ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â"} {toast.msg}
        </div>
      )}
    </div>
  );
}

export function WorkflowBuilderPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("My Workflow");
  const [toast, setToast] = useState<{msg:string;ok:boolean}|null>(null);
  const showToast = (msg:string, ok:boolean) => { setToast({msg,ok}); setTimeout(()=>setToast(null),3200); };

  async function onSave(sn: StepNode[], se: StepEdge[]) {
    if (sn.length === 0) { showToast("Add at least one step first", false); return; }
    if (hasCycle(sn, se)) { showToast("Cycle detected ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â remove the circular dependency", false); return; }
    try {
      await api.createWorkflow(name, null, exportDag(sn, se));
      showToast(`"${name}" saved!`, true);
      setTimeout(() => navigate("/workflows"), 1400);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Save failed", false);
    }
  }

  return (
    <ReactFlowProvider>
      <FlowInner name={name} setName={setName} onSave={onSave} toast={toast} />
    </ReactFlowProvider>
  );
}