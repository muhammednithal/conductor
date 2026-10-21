import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box, Card, Typography, Table, TableHead, TableRow,
  TableCell, TableBody, CircularProgress, Alert,
  TableContainer, Chip, Stack,
} from "@mui/material";
import { api, Run } from "../api/client";
import { StatusChip } from "../components/StatusChip";

export function RunsListPage() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api.listRuns()
      .then(setRuns)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const duration = (r: Run) => {
    if (!r.completed_at) return "—";
    const ms = new Date(r.completed_at).getTime() - new Date(r.started_at).getTime();
    return `${(ms / 1000).toFixed(1)}s`;
  };

  if (loading) return <Box sx={{ display:"flex", justifyContent:"center", mt:8 }}><CircularProgress /></Box>;

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h5">Workflow Runs</Typography>
        <Chip label={`${runs.length} total`} variant="outlined" />
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {runs.length === 0 ? (
        <Card>
          <Box sx={{ textAlign:"center", py:6 }}>
            <Typography color="text.secondary">No runs yet. Go to Workflows and click ▶ to start one.</Typography>
          </Box>
        </Card>
      ) : (
        <Card>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow sx={{ "& th": { fontWeight: 700, bgcolor: "grey.50" } }}>
                  <TableCell>Run ID</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Started</TableCell>
                  <TableCell>Duration</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {runs.map(r => (
                  <TableRow
                    key={r.id} hover
                    onClick={() => navigate(`/runs/${r.id}`)}
                    sx={{ cursor: "pointer" }}
                  >
                    <TableCell>
                      <Typography variant="body2" fontFamily="monospace" fontSize={13}>
                        {r.id.slice(0, 8)}…
                      </Typography>
                    </TableCell>
                    <TableCell><StatusChip status={r.status} /></TableCell>
                    <TableCell>{new Date(r.started_at).toLocaleString()}</TableCell>
                    <TableCell>{duration(r)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      )}
    </Box>
  );
}