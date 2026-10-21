import { Chip } from "@mui/material";

const STATUS_COLOR: Record<string, "default" | "warning" | "info" | "success" | "error"> = {
  PENDING:   "default",
  QUEUED:    "warning",
  RUNNING:   "info",
  SUCCEEDED: "success",
  FAILED:    "error",
  RETRYING:  "warning",
  CANCELED:  "default",
  ONLINE:    "success",
  OFFLINE:   "error",
  DRAINING:  "warning",
};

export function StatusChip({ status }: { status: string }) {
  return (
    <Chip
      label={status}
      color={STATUS_COLOR[status] ?? "default"}
      size="small"
      sx={{ fontWeight: 700, letterSpacing: 0.5 }}
    />
  );
}