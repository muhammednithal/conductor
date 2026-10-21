#!/usr/bin/env bash
# stop.sh - Kill all Conductor services
ROOT="$(cd "$(dirname "$0")" && pwd)"
pkill -f "$ROOT/orchestrator/bin/orchestrator" 2>/dev/null && echo "stopped orchestrator" || true
pkill -f "$ROOT/worker/bin/worker" 2>/dev/null && echo "stopped worker" || true
pkill -f "uvicorn app.main" 2>/dev/null && echo "stopped api-ai" || true
pkill -f "vite.js" 2>/dev/null && echo "stopped web" || true
docker compose -f "$ROOT/deploy/docker-compose-infra.yml" stop 2>/dev/null
echo "All services stopped."
