import { useEffect, useState } from "react";
import { api, Worker } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";

export function WorkersPage() {
  const [workers, setWorkers] = useState<Worker[]>([]);

  useEffect(() => {
    api.listWorkers().then(setWorkers).catch(console.error);
    const t = setInterval(() => api.listWorkers().then(setWorkers).catch(() => {}), 10_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <h2>Workers</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr><th>Hostname</th><th>Status</th><th>Capacity</th><th>Last Heartbeat</th></tr></thead>
        <tbody>
          {workers.map(w => (
            <tr key={w.id} style={{ borderBottom: "1px solid #eee" }}>
              <td>{w.hostname}</td>
              <td><StatusBadge status={w.status} /></td>
              <td>{w.capacity}</td>
              <td>{new Date(w.last_heartbeat_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}