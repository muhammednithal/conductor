import { useEffect, useRef } from "react";
import { getToken } from "../api/client";

export interface StepEvent {
  step_execution_id: string;
  step_name: string;
  status: string;
}

/**
 * Subscribes to the SSE stream for a run.
 * Automatically reconnects on disconnect (using EventSource retry or manual).
 */
export function useRunStream(runId: string, onEvent: (e: StepEvent) => void) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!runId) return;
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout>;

    function connect() {
      const token = getToken();
      const url = `/api/runs/${runId}/stream${token ? `?token=${encodeURIComponent(token)}` : ""}`;
      es = new EventSource(url);

      es.onmessage = (e) => {
        try { onEventRef.current(JSON.parse(e.data) as StepEvent); } catch { /* skip malformed */ }
      };
      es.onerror = () => {
        es?.close();
        // Reconnect after 3 seconds
        timer = setTimeout(connect, 3000);
      };
    }

    connect();
    return () => { es?.close(); clearTimeout(timer); };
  }, [runId]);
}