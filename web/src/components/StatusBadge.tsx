const COLORS: Record<string, string> = {
  PENDING: "#888", QUEUED: "#d4a017", RUNNING: "#1a73e8",
  SUCCEEDED: "#2e7d32", FAILED: "#c62828", RETRYING: "#e65100", CANCELED: "#666",
};
export function StatusBadge({ status }: { status: string }) {
  return (
    <span style={{ color: "#fff", background: COLORS[status] ?? "#999", padding: "2px 8px", borderRadius: 12, fontSize: 12, fontWeight: 600 }}>
      {status}
    </span>
  );
}