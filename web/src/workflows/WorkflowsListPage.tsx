import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box, Button, Card, CardContent, Typography, Table,
  TableHead, TableRow, TableCell, TableBody, IconButton,
  Tooltip, CircularProgress, Alert, Stack,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import { api, Workflow } from "../api/client";

export function WorkflowsListPage() {
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [triggering, setTriggering] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    api.listWorkflows()
      .then(setWorkflows)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function triggerRun(wf: Workflow) {
    setTriggering(wf.id);
    setMessage("");
    try {
      const run = await api.triggerRun(wf.id);
      setMessage(`Run started for "${wf.name}"`);
      setTimeout(() => navigate(`/runs/${run.id}`), 800);
    } catch (e) {
      setError(`Failed to trigger: ${e instanceof Error ? e.message : e}`);
    } finally {
      setTriggering(null);
    }
  }

  if (loading) return <Box sx={{ display:"flex", justifyContent:"center", mt:8 }}><CircularProgress /></Box>;

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h5">Workflows</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate("/workflows/new")}>
          New Workflow
        </Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}

      {workflows.length === 0 ? (
        <Card>
          <CardContent sx={{ textAlign: "center", py: 6 }}>
            <Typography color="text.secondary" mb={2}>No workflows yet.</Typography>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate("/workflows/new")}>
              Build your first workflow
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell><strong>Name</strong></TableCell>
                <TableCell><strong>Steps</strong></TableCell>
                <TableCell><strong>Version</strong></TableCell>
                <TableCell><strong>Created</strong></TableCell>
                <TableCell align="center"><strong>Actions</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {workflows.map(wf => {
                const dag = wf.dag_definition as { steps?: unknown[] };
                return (
                  <TableRow key={wf.id} hover>
                    <TableCell>
                      <Typography fontWeight={600}>{wf.name}</Typography>
                      {wf.description && <Typography variant="caption" color="text.secondary">{wf.description}</Typography>}
                    </TableCell>
                    <TableCell>{dag.steps?.length ?? 0}</TableCell>
                    <TableCell>v{wf.version}</TableCell>
                    <TableCell>{new Date(wf.created_at).toLocaleString()}</TableCell>
                    <TableCell align="center">
                      <Tooltip title="Trigger a run">
                        <span>
                          <IconButton
                            color="success"
                            onClick={() => triggerRun(wf)}
                            disabled={triggering === wf.id}
                          >
                            {triggering === wf.id ? <CircularProgress size={18} /> : <PlayArrowIcon />}
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </Box>
  );
}