import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Box, Card, CardContent, Typography, Table, TableHead,
  TableRow, TableCell, TableBody, CircularProgress, Alert,
  Stack, Chip, Button, LinearProgress,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { api, RunDetail, StepExecution } from "../api/client";
import { StatusChip } from "../components/StatusChip";
import { useRunStream } from "../hooks/useRunStream";

export function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [steps, setSteps] = useState<StepExecution[]>([]);
  const [error, setError] = useState("");
  const [streaming, setStreaming] = useState(true);

  useEffect(() => {
    if (!id) return;
    api.getRun(id)
      .then(r => { setRun(r); setSteps(r.step_executions); })
      .catch(e => setError(e.message));
  }, [id]);

  useRunStream(id ?? "", (event) => {
    setSteps(prev => prev.map(s =>
      s.id === event.step_execution_id ? { ...s, status: event.status } : s
    ));
  });

  // Stop showing "live" indicator when all terminal
  const allDone = steps.length > 0 && steps.every(s => ["SUCCEEDED","FAILED","CANCELED"].includes(s.status));
  useEffect(() => { if (allDone) setStreaming(false); }, [allDone]);

  if (error) return <Box sx={{p:3}}><Alert severity="error">{error}</Alert></Box>;
  if (!run) return <Box sx={{display:"flex",justifyContent:"center",mt:8}}><CircularProgress /></Box>;

  const succeededCount = steps.filter(s => s.status === "SUCCEEDED").length;
  const progress = steps.length > 0 ? (succeededCount / steps.length) * 100 : 0;

  return (
    <Box sx={{ p: 3 }}>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate("/runs")} sx={{ mb: 2 }}>
        Back to Runs
      </Button>

      {/* Run header */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
            <Box>
              <Typography variant="h6">Run Details</Typography>
              <Typography variant="body2" fontFamily="monospace" color="text.secondary" mt={0.5}>
                {run.id}
              </Typography>
            </Box>
            <Stack alignItems="flex-end" spacing={1}>
              <StatusChip status={run.status} />
              {streaming && !allDone && (
                <Chip label="● Live" color="info" size="small" sx={{ animation: "pulse 1.5s infinite" }} />
              )}
            </Stack>
          </Stack>

          <Stack direction="row" spacing={3} mt={2}>
            <Box>
              <Typography variant="caption" color="text.secondary">Started</Typography>
              <Typography variant="body2">{new Date(run.started_at).toLocaleString()}</Typography>
            </Box>
            {run.completed_at && (
              <Box>
                <Typography variant="caption" color="text.secondary">Completed</Typography>
                <Typography variant="body2">{new Date(run.completed_at).toLocaleString()}</Typography>
              </Box>
            )}
            <Box>
              <Typography variant="caption" color="text.secondary">Progress</Typography>
              <Typography variant="body2">{succeededCount} / {steps.length} steps</Typography>
            </Box>
          </Stack>

          {!allDone && steps.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <LinearProgress variant="determinate" value={progress} sx={{ height: 6, borderRadius: 3 }} />
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Step table */}
      <Card>
        <CardContent sx={{ p: 0 }}>
          <Table>
            <TableHead>
              <TableRow sx={{ "& th": { fontWeight: 700, bgcolor: "grey.50" } }}>
                <TableCell>Step</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Attempts</TableCell>
                <TableCell>Error</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {steps.map(s => (
                <TableRow key={s.id} sx={{
                  bgcolor: s.status === "RUNNING" ? "rgba(25,118,210,0.04)" :
                           s.status === "FAILED"  ? "rgba(211,47,47,0.04)" : "inherit"
                }}>
                  <TableCell>
                    <Typography fontWeight={600}>{s.step_name}</Typography>
                  </TableCell>
                  <TableCell>
                    <Chip label={s.step_type} size="small" variant="outlined" />
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <StatusChip status={s.status} />
                      {s.status === "RUNNING" && <CircularProgress size={14} />}
                    </Stack>
                  </TableCell>
                  <TableCell>{s.attempt_count}</TableCell>
                  <TableCell>
                    {s.error_msg && (
                      <Typography variant="caption" color="error.main" sx={{ fontFamily: "monospace" }}>
                        {s.error_msg.slice(0, 80)}
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </Box>
  );
}