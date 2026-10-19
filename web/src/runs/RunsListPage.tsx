import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, Run } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";

export function RunsListPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api.listRuns().then(setRuns).catch(e => setError(String(e)));
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <h2>Workflow Runs</h2>
      {error && <p style={{ color: "red" }}>{error}</p>}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr><th>ID</th><th>Status</th><th>Started</th></tr></thead>
        <tbody>
          {runs.map(r => (
            <tr key={r.id} style={{ borderBottom: "1px solid #eee" }}>
              <td><Link to={`/runs/${r.id}`}>{r.id.slice(0, 8)}…</Link></td>
              <td><StatusBadge status={r.status} /></td>
              <td>{new Date(r.started_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}