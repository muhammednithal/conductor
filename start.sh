#!/usr/bin/env bash
# start.sh — Start all Conductor services (Git Bash / Linux / macOS)
# Usage: bash start.sh
# Press Ctrl+C to stop all services.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
LOGS="$ROOT/.logs"
mkdir -p "$LOGS"

# ── Colour helpers ────────────────────────────────────────────────────────────
cyan()  { echo -e "\033[36m[Conductor] $*\033[0m"; }
green() { echo -e "\033[32m[  OK  ] $*\033[0m"; }
red()   { echo -e "\033[31m[ FAIL ] $*\033[0m"; }

# ── Find go binary ────────────────────────────────────────────────────────────
if command -v go &>/dev/null; then
  GO="go"
elif [ -f "/c/Program Files/Go/bin/go" ]; then
  GO="/c/Program Files/Go/bin/go"
elif [ -f "/usr/local/go/bin/go" ]; then
  GO="/usr/local/go/bin/go"
else
  red "go not found — install from https://go.dev/dl/"
  exit 1
fi

# ── Build Go binaries ─────────────────────────────────────────────────────────
cyan "Building orchestrator..."
(cd "$ROOT/orchestrator" && "$GO" build -o bin/orchestrator ./cmd/orchestrator) || {
  red "Orchestrator build failed"; exit 1
}
green "Orchestrator built"

cyan "Building worker..."
(cd "$ROOT/worker" && "$GO" build -o bin/worker ./cmd/worker) || {
  red "Worker build failed"; exit 1
}
green "Worker built"

# ── Start Docker infrastructure ───────────────────────────────────────────────
cyan "Starting Docker infrastructure (Postgres + Redis)..."
docker compose -f "$ROOT/deploy/docker-compose-infra.yml" up -d || {
  red "Docker failed — is Docker Desktop running?"
  exit 1
}

cyan "Waiting for Postgres to be ready..."
for i in $(seq 1 30); do
  if docker exec conductor-postgres pg_isready -U conductor -q 2>/dev/null; then
    break
  fi
  sleep 1
done
green "Infrastructure ready"

# ── PIDs array for cleanup ─────────────────────────────────────────────────────
PIDS=()

cleanup() {
  echo ""
  cyan "Shutting down all services..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null && echo "  stopped PID $pid"
  done
  docker compose -f "$ROOT/deploy/docker-compose-infra.yml" stop 2>/dev/null
  green "All services stopped."
  exit 0
}
trap cleanup SIGINT SIGTERM

# ── Orchestrator ──────────────────────────────────────────────────────────────
cyan "Starting Orchestrator on :9000..."
export DATABASE_URL="postgres://conductor:conductor@localhost:5432/conductor"
export REDIS_ADDR="localhost:6379"
export MIGRATIONS_DIR="migrations"

"$ROOT/orchestrator/bin/orchestrator" \
  2>"$LOGS/orchestrator.log" &
PIDS+=($!)
sleep 5

if ! kill -0 "${PIDS[-1]}" 2>/dev/null; then
  red "Orchestrator crashed — check $LOGS/orchestrator.log"
  cat "$LOGS/orchestrator.log"
  exit 1
fi
green "Orchestrator running (PID ${PIDS[-1]})"

# ── Worker ────────────────────────────────────────────────────────────────────
cyan "Starting Worker..."
export ORCHESTRATOR_ADDR=":9000"

"$ROOT/worker/bin/worker" \
  2>"$LOGS/worker.log" &
PIDS+=($!)
sleep 2
green "Worker running (PID ${PIDS[-1]})"

# ── api-ai ────────────────────────────────────────────────────────────────────
cyan "Starting api-ai on :8000..."
export DATABASE_URL="postgresql://conductor:conductor@localhost:5432/conductor"
export REDIS_URL="redis://localhost:6379"
export LLM_PROVIDER="mock"

(cd "$ROOT/api-ai" && python -m uvicorn app.main:app \
  --port 8000 --log-level warning) \
  2>"$LOGS/api-ai.log" &
PIDS+=($!)
sleep 4

if ! kill -0 "${PIDS[-1]}" 2>/dev/null; then
  red "api-ai crashed — check $LOGS/api-ai.log"
  cat "$LOGS/api-ai.log"
  exit 1
fi
green "api-ai running (PID ${PIDS[-1]})"

# ── Web dashboard (Vite) ──────────────────────────────────────────────────────
cyan "Starting Web dashboard on :3000..."
(cd "$ROOT/web" && node node_modules/vite/bin/vite.js --port 3000) \
  >"$LOGS/web.log" 2>&1 &
PIDS+=($!)
sleep 3
green "Web running (PID ${PIDS[-1]})"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "\033[32m==================================================\033[0m"
echo -e "\033[32m  🎼 Conductor is running!\033[0m"
echo ""
echo -e "\033[36m  Dashboard : http://localhost:3000\033[0m"
echo -e "\033[36m  API docs  : http://localhost:8000/docs\033[0m"
echo ""
echo -e "\033[90m  Logs      : $LOGS/\033[0m"
echo -e "\033[33m  Ctrl+C to stop all services\033[0m"
echo -e "\033[32m==================================================\033[0m"
echo ""

# ── Block until Ctrl+C ────────────────────────────────────────────────────────
wait