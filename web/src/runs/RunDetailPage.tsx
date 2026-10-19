import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, RunDetail, StepExecution } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import { useRunStream } from "../hooks/useRunStream";

export function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [steps, setSteps] = useState<StepExecution[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    api.getRun(id).then(r => { setRun(r); setSteps(r.step_executions); })
       .catch(e => setError(String(e)));
  }, [id]);

  useRunStream(id ?? "", (event) => {
    setSteps(prev => prev.map(s =>
      s.id === event.step_execution_id ? { ...s, status: event.status } : s
    ));
  });

  if (error) return <p style={{ color: "red", padding: 24 }}>{error}</p>;
  if (!run) return <p style={{ padding: 24 }}>Loading…</p>;

  return (
    <div style={{ padding: 24 }}>
      <h2>Run {run.id.slice(0, 8)}…</h2>
      <p>Status: <StatusBadge status={run.status} /></p>
      <h3>Steps</h3>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr><th>Step</th><th>Type</th><th>Status</th><th>Attempts</th></tr></thead>
        <tbody>
          {steps.map(s => (
            <tr key={s.id} style={{ borderBottom: "1px solid #eee" }}>
              <td>{s.step_name}</td>
              <td>{s.step_type}</td>
              <td><StatusBadge status={s.status} /></td>
              <td>{s.attempt_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}