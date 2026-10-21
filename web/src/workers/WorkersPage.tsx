import { useEffect, useState } from "react";
import {
  Box, Card, Typography, Table, TableHead, TableRow,
  TableCell, TableBody, CircularProgress, Alert,
  TableContainer, Stack, Chip, Switch, FormControlLabel,
} from "@mui/material";
import { api, Worker } from "../api/client";
import { StatusChip } from "../components/StatusChip";

export function WorkersPage() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showOffline, setShowOffline] = useState(false);

  const load = () =>
    api.listWorkers()
       .then(setWorkers)
       .catch(e => setError(e.message))
       .finally(() => setLoading(false));

  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);

  const online  = workers.filter(w => w.status === "ONLINE");
  const offline = workers.filter(w => w.status !== "ONLINE");
  const visible = showOffline ? workers : online;

  if (loading) return <Box sx={{ display:"flex", justifyContent:"center", mt:8 }}><CircularProgress /></Box>;

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Stack direction="row" alignItems="center" spacing={2}>
          <Typography variant="h5">Worker Pool</Typography>
          <Chip label={`${online.length} online`}  color={online.length > 0 ? "success" : "default"} size="small" />
          {offline.length > 0 && (
            <Chip label={`${offline.length} offline`} color="error" size="small" variant="outlined" />
          )}
        </Stack>
        {offline.length > 0 && (
          <FormControlLabel
            control={<Switch size="small" checked={showOffline} onChange={e => setShowOffline(e.target.checked)} />}
            label={<Typography variant="caption" color="text.secondary">Show offline</Typography>}
          />
        )}
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Card>
        {visible.length === 0 ? (
          <Box sx={{ textAlign:"center", py:6 }}>
            <Typography color="text.secondary">
              {online.length === 0
                ? "No workers connected. Start a worker with: ./bin/worker"
                : "All workers are offline."}
            </Typography>
          </Box>
        ) : (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow sx={{ "& th": { fontWeight:700 } }}>
                  <TableCell>Hostname</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Capacity</TableCell>
                  <TableCell>Last Heartbeat</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visible.map(w => (
                  <TableRow key={w.id} hover sx={{ opacity: w.status !== "ONLINE" ? 0.5 : 1 }}>
                    <TableCell>
                      <Typography sx={{ fontWeight:600 }}>{w.hostname}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ fontFamily:"monospace" }}>
                        {w.id.slice(0, 8)}…
                      </Typography>
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

      {!showOffline && offline.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ mt:1, display:"block", textAlign:"center" }}>
          {offline.length} offline worker{offline.length > 1 ? "s" : ""} hidden — toggle "Show offline" to view
        </Typography>
      )}
    </Box>
  );
}