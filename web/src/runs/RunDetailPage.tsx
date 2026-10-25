import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Box, Card, CardContent, Typography, Table, TableHead,
  TableRow, TableCell, TableBody, CircularProgress, Alert,
  Stack, Chip, Button, LinearProgress, Collapse,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import { api, RunDetail, StepExecution } from "../api/client";
import { StatusChip } from "../components/StatusChip";
import { useRunStream } from "../hooks/useRunStream";

function OutputViewer({ output }: { output: unknown }) {
  const [open, setOpen] = useState(false);
  if (!output) return null;
  const text = JSON.stringify(output, null, 2);
  return (
    <Box>
      <Button size="small" onClick={() => setOpen(o => !o)}
        endIcon={open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        sx={{ fontSize:11, py:0, color:"success.main", minWidth:0 }}>
        {open ? "hide" : "view output"}
      </Button>
      <Collapse in={open}>
        <Box sx={{
          mt:1, p:1.5, borderRadius:1,
          background:"rgba(0,0,0,0.35)",
          border:"1px solid rgba(34,197,94,0.2)",
          fontFamily:"monospace", fontSize:11,
          color:"#86efac", whiteSpace:"pre-wrap",
          maxHeight:220, overflowY:"auto",
        }}>{text}</Box>
      </Collapse>
    </Box>
  );
}

export function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [run, setRun]   = useState<RunDetail | null>(null);
  const [steps, setSteps] = useState<StepExecution[]>([]);
  const [error, setError] = useState("");
  const [live, setLive] = useState(true);

  const refresh = () => {
    if (!id) return;
    api.getRun(id)
      .then(r => { setRun(r); setSteps(r.step_executions); })
      .catch(e => setError(e.message));
  };

  useEffect(() => { refresh(); }, [id]);

  // Re-fetch full run data on every SSE event so output values populate
  useRunStream(id ?? "", () => { refresh(); });

  const allDone = steps.length > 0 &&
    steps.every(s => ["SUCCEEDED","FAILED","CANCELED"].includes(s.status));
  useEffect(() => { if (allDone) setLive(false); }, [allDone]);

  if (error) return <Box sx={{p:3}}><Alert severity="error">{error}</Alert></Box>;
  if (!run)  return <Box sx={{display:"flex",justifyContent:"center",mt:8}}><CircularProgress /></Box>;

  const done     = steps.filter(s => s.status === "SUCCEEDED").length;
  const progress = steps.length > 0 ? (done / steps.length) * 100 : 0;
  const duration = run.completed_at
    ? ((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000).toFixed(1) + "s"
    : null;

  return (
    <Box sx={{ p:3 }}>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate("/runs")} sx={{ mb:2 }}>
        Back to Runs
      </Button>

      {/* Header */}
      <Card sx={{ mb:3 }}>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
            <Box>
              <Typography variant="h6" gutterBottom>Run Detail</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily:"monospace" }}>
                {run.id}
              </Typography>
            </Box>
            <Stack alignItems="flex-end" spacing={1}>
              <StatusChip status={run.status} />
              {live && !allDone && <Chip label="● Live" color="info" size="small" />}
            </Stack>
          </Stack>

          <Stack direction="row" spacing={4} mt={2} flexWrap="wrap">
            <Box><Typography variant="caption" color="text.secondary">Started</Typography>
              <Typography variant="body2">{new Date(run.started_at).toLocaleString()}</Typography></Box>
            {duration && <Box><Typography variant="caption" color="text.secondary">Duration</Typography>
              <Typography variant="body2">{duration}</Typography></Box>}
            <Box><Typography variant="caption" color="text.secondary">Progress</Typography>
              <Typography variant="body2">{done} / {steps.length} steps</Typography></Box>
          </Stack>

          {!allDone && steps.length > 0 && (
            <Box sx={{ mt:2 }}>
              <LinearProgress variant="determinate" value={progress} sx={{ height:6, borderRadius:3 }} />
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Steps */}
      <Card>
        <Table>
          <TableHead>
            <TableRow sx={{ "& th": { fontWeight:700 } }}>
              <TableCell>Step</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Attempts</TableCell>
              <TableCell>Output / Error</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {steps.map(s => (
              <TableRow key={s.id} sx={{
                verticalAlign:"top",
                bgcolor: s.status === "RUNNING" ? "rgba(25,118,210,0.05)" :
                         s.status === "FAILED"  ? "rgba(211,47,47,0.05)"  : "inherit",
              }}>
                <TableCell sx={{ fontWeight:700 }}>{s.step_name}</TableCell>
                <TableCell><Chip label={s.step_type} size="small" variant="outlined" /></TableCell>
                <TableCell>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <StatusChip status={s.status} />
                    {s.status === "RUNNING" && <CircularProgress size={13} />}
                  </Stack>
                </TableCell>
                <TableCell>{s.attempt_count}</TableCell>
                <TableCell>
                  {s.status === "SUCCEEDED" && <OutputViewer output={s.output} />}
                  {s.error_msg && (
                    <Typography variant="caption" color="error.main"
                      sx={{ fontFamily:"monospace", display:"block", fontSize:11 }}>
                      {s.error_msg}
                    </Typography>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </Box>
  );
}