import { useEffect, useState } from "react";
import {
  Box, Card, Typography, Table, TableHead, TableRow,
  TableCell, TableBody, CircularProgress, Alert,
  TableContainer, Stack, Chip,
} from "@mui/material";
import { api, Worker } from "../api/client";
import { StatusChip } from "../components/StatusChip";

export function WorkersPage() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => api.listWorkers().then(setWorkers).catch(e => setError(e.message)).finally(() => setLoading(false));

  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);

  const online = workers.filter(w => w.status === "ONLINE").length;

  if (loading) return <Box sx={{ display:"flex", justifyContent:"center", mt:8 }}><CircularProgress /></Box>;

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h5">Worker Pool</Typography>
        <Chip label={`${online} online`} color={online > 0 ? "success" : "default"} />
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Card>
        {workers.length === 0 ? (
          <Box sx={{ textAlign:"center", py:6 }}>
            <Typography color="text.secondary">No workers connected. Start a worker with: <code>./bin/worker.exe</code></Typography>
          </Box>
        ) : (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow sx={{ "& th": { fontWeight:700, bgcolor:"grey.50" } }}>
                  <TableCell>Hostname</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Capacity</TableCell>
                  <TableCell>Last Heartbeat</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {workers.map(w => (
                  <TableRow key={w.id} hover>
                    <TableCell>
                      <Typography fontWeight={600}>{w.hostname}</Typography>
                      <Typography variant="caption" color="text.secondary" fontFamily="monospace">{w.id.slice(0,8)}…</Typography>
                    </TableCell>
                    <TableCell><StatusChip status={w.status} /></TableCell>
                    <TableCell>{w.capacity}</TableCell>
                    <TableCell>{new Date(w.last_heartbeat_at).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>
    </Box>
  );
}