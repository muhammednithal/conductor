# Conductor

**Conductor** is a distributed AI workflow orchestrator. It lets you define multi-step pipelines as DAGs (Directed Acyclic Graphs), execute them reliably across a pool of workers, and monitor progress in real time — with built-in fault tolerance, automatic retries, and crash recovery.

---

## Table of Contents

1. [What is Conductor?](#what-is-conductor)
2. [Architecture Overview](#architecture-overview)
3. [Tech Stack](#tech-stack)
4. [Repository Structure](#repository-structure)
5. [Prerequisites](#prerequisites)
6. [Quick Start](#quick-start)
7. [Service Deep Dives](#service-deep-dives)
   - [Orchestrator (Go)](#orchestrator-go)
   - [Worker (Go)](#worker-go)
   - [API-AI (Python FastAPI)](#api-ai-python-fastapi)
   - [Web Dashboard (React)](#web-dashboard-react)
8. [Database Schema](#database-schema)
9. [Redis Usage](#redis-usage)
10. [The State Machine](#the-state-machine)
11. [Step Types](#step-types)
12. [End-to-End Flow](#end-to-end-flow)
13. [Fault Tolerance](#fault-tolerance)
14. [API Reference](#api-reference)
15. [Configuration](#configuration)
16. [Development Guide](#development-guide)
17. [Running Tests](#running-tests)

---

## What is Conductor?

Conductor solves the problem of running reliable multi-step AI pipelines in production. Instead of writing brittle scripts that fail silently, you define your workflow as a DAG and Conductor handles:

- **Scheduling** — steps run in dependency order, fan-out when possible
- **Fault tolerance** — crashed workers are detected and steps are re-assigned
- **Retries** — failed steps retry with exponential backoff
- **Idempotency** — each step has a unique key preventing double-execution
- **Visibility** — live dashboard shows every step's state in real time

### Example Workflow

```
fetch-article  →  summarize-it  →  save-result
     (http)         (summarize)      (transform)
```

Step 2 waits for step 1. Step 3 waits for step 2. If step 2 fails, it retries automatically.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser :3000                                                   │
│  React + TypeScript + MUI                                        │
│       │  REST API + SSE (live updates)                           │
│       ▼                                                          │
│  api-ai :8000                                                    │
│  Python FastAPI                                                  │
│  Auth · Workflow CRUD · Run triggering · AI endpoints            │
│       │                                                          │
│       │  Both services share the same Postgres database          │
│       ▼                                                          │
│  Postgres :5432 ◄───────────── orchestrator :9000               │
│  Source of truth                Go service                       │
│                                 Scheduler · State machine        │
│  Redis :6379 ◄──────────────►  Lease manager · gRPC server      │
│  Task queue + pub/sub                │ gRPC                      │
│                                      ▼                           │
│                                 worker                           │
│                                 Go service                       │
│                                 Step executors                   │
└─────────────────────────────────────────────────────────────────┘
```

**Data flow for a run:**
1. Browser triggers run → api-ai inserts `workflow_runs` + `step_executions` (all PENDING)
2. Orchestrator scheduler sees PENDING steps → advances to QUEUED → pushes ID to Redis
3. Orchestrator gRPC server pops from Redis → inserts lease → step → RUNNING → sends to worker
4. Worker executes step → calls AckTask(SUCCEEDED/FAILED)
5. Orchestrator updates DB → publishes event to Redis pub/sub
6. api-ai SSE endpoint receives event → streams to browser → step turns green live

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Orchestrator | Go 1.22 | Goroutines for concurrency, gRPC, fast startup |
| Worker | Go 1.22 | Same module as orchestrator, shares proto stubs |
| API | Python 3.12 + FastAPI | Best LLM SDK ecosystem, async, auto OpenAPI docs |
| Frontend | React 18 + TypeScript + Vite | Component model, type safety, fast dev server |
| Database | PostgreSQL 16 | ACID transactions for the state machine |
| Queue/PubSub | Redis 7 | Sub-millisecond BLPOP, pub/sub for SSE fan-out |
| UI Components | Material UI v5 | Comprehensive dark-mode component library |
| Flow Canvas | @xyflow/react | React Flow for the DAG builder |

---

## Repository Structure

```
conductor/
├── orchestrator/              Go: scheduling, state machine, gRPC server
│   ├── cmd/orchestrator/      Entry point
│   ├── internal/
│   │   ├── statemachine/      THE core — only place step status is written
│   │   ├── scheduler/         Advances PENDING→QUEUED every 1s
│   │   ├── grpcserver/        RegisterWorker, AckTask, Heartbeat RPCs
│   │   ├── lease/             Lease reclaimer — detects crashed workers
│   │   ├── recovery/          Startup crash recovery
│   │   ├── db/                All Postgres queries
│   │   └── redis/             Task queue + pub/sub client
│   └── migrations/            SQL schema files (run automatically on start)
│
├── worker/                    Go: step execution
│   ├── cmd/worker/            Entry point
│   └── internal/
│       ├── grpcclient/        Connects to orchestrator, receives tasks
│       └── executor/          http, transform, delay, summarize, embed, rag
│
├── api-ai/                    Python FastAPI: API + AI
│   └── app/
│       ├── auth/              JWT register/login
│       ├── workflows/         Workflow CRUD
│       ├── runs/              Run trigger, history, SSE stream
│       ├── ai/                LLM endpoints + vector store
│       └── workers_router.py  Worker pool read-only endpoint
│
├── web/                       React dashboard
│   └── src/
│       ├── auth/              Login/register + JWT context
│       ├── runs/              Run list + live detail
│       ├── workflows/         Workflow list + DAG builder
│       ├── workers/           Worker pool table
│       ├── hooks/             useRunStream (SSE)
│       └── api/client.ts      Typed fetch helpers
│
├── shared/proto/              Protobuf definition + pre-generated Go stubs
│   └── conductorpb/           Generated — both Go services import this
│
├── deploy/
│   ├── docker-compose.yml         Full stack (all 6 services)
│   └── docker-compose-infra.yml   Infra only (Postgres + Redis)
│
├── start.sh                   One-command dev startup
└── stop.sh                    Kill all services
```

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Docker Desktop | Latest | https://docker.com |
| Go | 1.22+ | https://go.dev/dl |
| Python | 3.12+ | https://python.org |
| Node.js | 18+ | https://nodejs.org |
| Git Bash (Windows) | — | Included with Git |

---

## Quick Start

### Option A — One command (recommended)

```bash
# Clone the repo
git clone <repo-url> conductor
cd conductor

# Start everything (builds Go, installs Python deps, starts all services)
./start.sh

# Open the dashboard
open http://localhost:3000

# Stop everything
./stop.sh
```

### Option B — Full Docker (production-like)

```bash
cd deploy
docker compose up --build

# All services at http://localhost:3000
```

### Option C — Manual (each service separately)

```bash
# 1. Start infrastructure
cd deploy && docker compose -f docker-compose-infra.yml up -d

# 2. Orchestrator
cd orchestrator
export DATABASE_URL="postgres://conductor:conductor@localhost:5432/conductor"
export REDIS_ADDR="localhost:6379"
export MIGRATIONS_DIR="migrations"
go run ./cmd/orchestrator

# 3. Worker (new terminal)
cd worker
export ORCHESTRATOR_ADDR=":9000"
go run ./cmd/worker

# 4. API-AI (new terminal)
cd api-ai
pip install -r requirements.txt
export DATABASE_URL="postgresql://conductor:conductor@localhost:5432/conductor"
export REDIS_URL="redis://localhost:6379"
export LLM_PROVIDER="mock"   # use "openai" for real LLM
uvicorn app.main:app --port 8000 --reload

# 5. Web (new terminal)
cd web
npm install
npm run dev   # http://localhost:3000
```

---

## Service Deep Dives

### Orchestrator (Go)

**Port:** 9000 (gRPC)
**Entry:** `orchestrator/cmd/orchestrator/main.go`

The orchestrator is the brain. It runs three background loops:

#### 1. Scheduler (`internal/scheduler/scheduler.go`)
Polls every 1 second. Finds PENDING steps whose dependencies are all SUCCEEDED, transitions them to QUEUED, and pushes their IDs to Redis.

```go
// Pseudo-code
every 1 second:
  steps = db.GetPendingReadySteps()   // deps all SUCCEEDED
  for step in steps:
    statemachine.Transition(step.ID, "QUEUED")
    redis.PushTask(step.ID)           // RPUSH conductor:tasks
```

#### 2. gRPC Server (`internal/grpcserver/server.go`)
Handles three RPCs:

- **RegisterWorker** — worker connects, orchestrator loops popping from Redis and streaming tasks
- **AckTask** — worker reports success/failure, orchestrator updates state and publishes SSE event
- **Heartbeat** — worker sends every 10s to renew its lease

#### 3. Lease Reclaimer (`internal/lease/reclaimer.go`)
Scans every 15 seconds for expired leases (worker crashed). Re-queues with backoff or marks FAILED.

#### Crash Recovery (`internal/recovery/recovery.go`)
Runs **once at startup** before any loops start:
1. Re-pushes all QUEUED steps to Redis (queue was lost on crash)
2. Handles RUNNING steps with no valid lease
3. Re-queues eligible RETRYING steps

---

### Worker (Go)

**Entry:** `worker/cmd/worker/main.go`

The worker registers once via gRPC and receives a stream of tasks. For each task it spawns a goroutine.

**Executor registry** (`internal/executor/registry.go`):
```
"http"      → HTTPExecutor      Makes HTTP calls
"transform" → TransformExecutor Remaps JSON keys using dot-notation
"delay"     → DelayExecutor     Sleeps N seconds
"summarize" → AIExecutor        POST /ai/summarize on api-ai
"embed"     → AIExecutor        POST /ai/embed on api-ai
"rag"       → AIExecutor        POST /ai/rag/query on api-ai
```

**Worker ID** is `SHA256(hostname)` — deterministic, so restarts update the same DB row instead of creating duplicates.

---

### API-AI (Python FastAPI)

**Port:** 8000
**Entry:** `api-ai/app/main.py`
**Docs:** http://localhost:8000/docs (auto-generated Swagger UI)

Handles all external client interactions:

| Route group | What it does |
|-------------|-------------|
| `POST /auth/register` | Creates user, returns JWT |
| `POST /auth/login` | Verifies password, returns JWT |
| `GET/POST/PUT/DELETE /workflows` | Workflow CRUD |
| `POST /workflows/{id}/runs` | Triggers a run (creates DB rows) |
| `GET /runs` | List runs for current user |
| `GET /runs/{id}` | Run detail with step executions |
| `GET /runs/{id}/stream` | SSE — live step updates |
| `POST /ai/summarize` | LLM summarization (cached 24h) |
| `POST /ai/embed` | Text embeddings (cached 24h) |
| `POST /ai/rag/query` | RAG query, streaming SSE response |
| `POST /ai/vectors/upsert` | Store document in vector store |
| `GET /ai/cost` | Token usage and cost summary |
| `GET /workers` | Worker pool (read-only) |

**LLM Provider** is pluggable. Set `LLM_PROVIDER=mock` for development (no API key needed) or `LLM_PROVIDER=openai` with `OPENAI_API_KEY=sk-...` for real calls.

---

### Web Dashboard (React)

**Port:** 3000 (Vite dev server)
**Entry:** `web/src/main.tsx`

| Page | Route | What you do there |
|------|-------|------------------|
| Login/Register | `/login` | Sign in or create account |
| Runs | `/runs` | View all workflow run history |
| Run Detail | `/runs/:id` | Live step-by-step progress |
| Workflows | `/workflows` | List saved workflows, trigger runs |
| Builder | `/workflows/new` | Drag-and-drop DAG editor |
| Workers | `/workers` | Live worker pool status |

**Builder tips:**
- Click a step type button to add it — steps auto-connect in sequence
- **Click a node** to open the config panel on the right — edit URL, duration, etc.
- Drag the white dot at the **bottom** of one node to the **top** of another for custom connections
- Click **Save Workflow** → redirected to Workflows list → click ▶ to trigger

---

## Database Schema

All tables in `orchestrator/migrations/001_initial.sql`. Migrations run automatically on orchestrator startup.

```sql
users               -- Authentication
  id UUID PK
  email TEXT UNIQUE
  password_hash TEXT -- bcrypt
  created_at

workflows           -- DAG definitions
  id UUID PK
  owner_id → users.id
  name TEXT
  dag_definition JSONB  -- the full workflow JSON
  version INT

workflow_runs       -- One execution instance per trigger
  id UUID PK
  workflow_id → workflows.id
  status TEXT  -- PENDING|RUNNING|SUCCEEDED|FAILED|CANCELED
  input JSONB
  output JSONB
  started_at, completed_at

step_executions     -- *** Most important table ***
  id UUID PK
  run_id → workflow_runs.id
  step_name TEXT       -- "fetch-article"
  step_type TEXT       -- "http"
  status TEXT          -- PENDING|QUEUED|RUNNING|SUCCEEDED|FAILED|RETRYING|CANCELED
  attempt_count INT    -- incremented per retry
  max_attempts INT     -- from dag config
  idempotency_key TEXT -- "{run_id}:{step_name}:{attempt}" prevents duplicates
  input JSONB          -- step config
  output JSONB         -- executor result (populated on SUCCEEDED)
  error_msg TEXT       -- failure reason
  scheduled_after TIMESTAMPTZ -- RETRYING: don't retry before this

workers             -- Registered worker processes
  id UUID PK         -- SHA256(hostname) for stability
  hostname TEXT
  status TEXT        -- ONLINE|OFFLINE|DRAINING
  capacity INT
  last_heartbeat_at TIMESTAMPTZ

leases              -- Worker ownership tokens
  step_execution_id → step_executions.id UNIQUE
  worker_id → workers.id
  expires_at TIMESTAMPTZ  -- NOW()+30s, renewed by heartbeat

ai_token_usage      -- LLM cost tracking
  user_id → users.id
  operation TEXT     -- summarize|embed|rag
  tokens_used INT
```

---

## Redis Usage

Redis serves three independent purposes:

### 1. Task Queue (List)
```
Key:     conductor:tasks
Type:    List
Write:   RPUSH by orchestrator scheduler when step → QUEUED
Read:    BLPOP by orchestrator gRPC server (blocks until item available)
Purpose: Dispatch step IDs to workers with zero polling
```

### 2. Event Bus (Pub/Sub)
```
Channel: conductor:events:{run_id}
Write:   PUBLISH by orchestrator after every step state change
Read:    SUBSCRIBE by api-ai SSE endpoint per connected browser tab
Purpose: Push live updates to browser without polling
         Browser sees step turn green within ~100ms of completion
```

### 3. Idempotency Cache (String)
```
Key:     idempotency:{idempotency_key}
TTL:     86400s (24 hours)
Write:   api-ai after LLM call
Read:    api-ai before LLM call
Purpose: Return cached result if same request is retried
         Prevents paying for duplicate LLM calls
```

---

## The State Machine

**File:** `orchestrator/internal/statemachine/statemachine.go`

The single most important invariant in the system:

> **`statemachine.Transition()` is the ONLY function allowed to write `step_executions.status`.**

No other code — not api-ai, not the worker, nothing — may update that column directly.

```
                    PENDING
                       │ deps SUCCEEDED
                       ▼
                    QUEUED ──────────────────────────────┐
                       │ worker picks up                  │
                       ▼                                  │
                    RUNNING                               │
                  /    |    \                             │
           success   error  lease                        │
                │     │    expired                        │
                │     │       │                          │
         SUCCEEDED  (attempt < max)                      │
                      │                                  │
                   RETRYING ──(delay elapsed)────────────┘
                      │
               (attempt >= max)
                      │
                   FAILED

CANCELED — any non-terminal state can be canceled
```

Valid transitions:
```go
var validTransitions = map[string]map[string]bool{
    "PENDING":  {"QUEUED": true, "CANCELED": true},
    "QUEUED":   {"RUNNING": true, "CANCELED": true},
    "RUNNING":  {"SUCCEEDED": true, "FAILED": true, "RETRYING": true, "CANCELED": true},
    "RETRYING": {"QUEUED": true, "CANCELED": true},
}
```

---

## Step Types

| Type | Config fields | What it does |
|------|-------------|-------------|
| `http` | `url`, `method` | Makes HTTP request, returns response body |
| `transform` | `mapping: {outKey: "dot.path"}` | Remaps JSON fields using dot notation |
| `delay` | `duration_seconds` | Sleeps for N seconds |
| `summarize` | `max_length` | Calls api-ai → LLM → returns `{summary, tokens_used}` |
| `embed` | `texts: []` | Calls api-ai → embedding model → returns `{embeddings, tokens_used}` |
| `rag` | `query`, `top_k` | Vector search + LLM streaming response |

### Example: HTTP step config
```json
{
  "url": "https://hacker-news.firebaseio.com/v0/item/1.json",
  "method": "GET"
}
```

### Example: Transform step config (remap keys)
```json
{
  "mapping": {
    "article_title": "title",
    "by_user": "by",
    "link": "url"
  }
}
```

### Example: Full 3-step DAG definition
```json
{
  "steps": [
    {
      "name": "fetch",
      "type": "http",
      "depends_on": [],
      "config": { "url": "https://api.example.com/article/1", "method": "GET" },
      "max_attempts": 3,
      "timeout_seconds": 30
    },
    {
      "name": "summarize",
      "type": "summarize",
      "depends_on": ["fetch"],
      "config": { "max_length": 150 },
      "max_attempts": 2
    },
    {
      "name": "reshape",
      "type": "transform",
      "depends_on": ["summarize"],
      "config": { "mapping": { "result": "summary", "cost": "tokens_used" } },
      "max_attempts": 1
    }
  ]
}
```

---

## End-to-End Flow

```
1. Register/login  →  JWT token stored in browser localStorage

2. Build workflow  →  drag steps in Builder, click nodes to set config
                      click Save → POST /workflows → stored in Postgres

3. Trigger run     →  click ▶ on Workflows page
                      POST /workflows/{id}/runs
                      api-ai: INSERT workflow_runs + step_executions (all PENDING)
                      redirects to live Run Detail page

4. Scheduler       →  within 1s, step with no deps → QUEUED → pushed to Redis

5. gRPC dispatch   →  orchestrator pops from Redis → inserts lease → RUNNING
                      sends TaskAssignment to worker via gRPC stream

6. Worker executes →  runs the executor (http/transform/delay/AI)
                      calls AckTask(SUCCEEDED, output)

7. Orchestrator    →  stores output → SUCCEEDED → deletes lease
                      PUBLISH event to Redis pub/sub

8. Browser         →  SSE endpoint receives event
                      step row turns green in real time (~100ms)

9. Repeat          →  scheduler advances next step in the DAG
```

---

## Fault Tolerance

### Worker Crash
```
Worker stops heartbeating → lease expires in 30s
Reclaimer scans every 15s → finds expired lease
  attempt < max_attempts → RETRYING (with backoff)
  attempt >= max_attempts → FAILED
Scheduler re-queues when backoff elapses
New worker picks it up
Total recovery time: ≤ 45 seconds
```

### Orchestrator Crash
```
On restart → recovery.Recover() runs first:
  1. Re-push all QUEUED steps to Redis (queue was lost)
  2. Handle RUNNING steps with expired leases
  3. Re-queue elapsed RETRYING steps
No data lost — Postgres is always the source of truth
```

### Exponential Backoff Formula
```
delay = min(1s × 2^attempt, 300s) × random(0.8, 1.2)

attempt 0: ~1s
attempt 1: ~2s
attempt 2: ~4s
attempt 3: ~8s
...
max: 300s (5 minutes)
```

---

## API Reference

Full interactive docs at **http://localhost:8000/docs** when api-ai is running.

### Authentication
```
POST /auth/register  {"email":"...", "password":"..."}  → {"token":"eyJ..."}
POST /auth/login     {"email":"...", "password":"..."}  → {"token":"eyJ..."}

All other endpoints require: Authorization: Bearer {token}
```

### Workflows
```
GET    /workflows              List all your workflows
POST   /workflows              Create workflow (body: name + dag_definition)
GET    /workflows/{id}         Get one workflow
PUT    /workflows/{id}         Update workflow
DELETE /workflows/{id}         Delete workflow
```

### Runs
```
POST   /workflows/{id}/runs    Trigger a run  → {"id":"run-uuid"}
GET    /runs                   List your runs
GET    /runs/{id}              Run detail + step executions
DELETE /runs/{id}              Cancel a run
GET    /runs/{id}/stream       SSE: live step updates
```

### AI Endpoints
```
POST   /ai/summarize           {"text":"...", "max_length":200}
POST   /ai/embed               {"texts":["...", "..."]}
POST   /ai/rag/query           {"query":"...", "top_k":5}  → SSE stream
POST   /ai/vectors/upsert      {"doc_id":"...", "text":"...", "embedding":[...]}
GET    /ai/cost                Token usage and cost summary
```

### Workers
```
GET    /workers                Live worker pool
```

---

## Configuration

### Orchestrator
| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | required | Postgres DSN |
| `REDIS_ADDR` | `localhost:6379` | Redis host:port |
| `GRPC_ADDR` | `:9000` | gRPC listen address |
| `MIGRATIONS_DIR` | `migrations` | Path to SQL migration files |

### Worker
| Variable | Default | Description |
|----------|---------|-------------|
| `ORCHESTRATOR_ADDR` | `:9000` | Orchestrator gRPC address |
| `WORKER_HOSTNAME` | `os.Hostname()` | Reported hostname |

### API-AI
| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | required | Postgres DSN (postgresql:// scheme) |
| `REDIS_URL` | `redis://localhost:6379` | Redis URL |
| `JWT_SECRET` | `change-me-in-production` | Secret for signing JWTs |
| `LLM_PROVIDER` | `mock` | `mock` or `openai` |
| `OPENAI_API_KEY` | — | Required if `LLM_PROVIDER=openai` |

---

## Development Guide

### Adding a New Step Type

**1. Create executor in worker:**
```go
// worker/internal/executor/mytype.go
type MyTypeExecutor struct{}

func (e *MyTypeExecutor) Execute(ctx context.Context, input, config json.RawMessage) (json.RawMessage, error) {
    // your logic here
    return json.RawMessage(`{"result":"done"}`), nil
}
```

**2. Register in worker main:**
```go
// worker/cmd/worker/main.go
reg.Register("mytype", &executor.MyTypeExecutor{})
```

**3. Add to SQL CHECK constraint:**
```sql
-- orchestrator/migrations/003_add_mytype.sql
ALTER TABLE step_executions
DROP CONSTRAINT step_executions_step_type_check,
ADD CONSTRAINT step_executions_step_type_check
  CHECK (step_type IN ('http','transform','delay','summarize','embed','rag','mytype'));
```

**4. Add default config in web:**
```typescript
// web/src/workflows/dagUtils.ts
DEFAULT_CONFIG["mytype"] = { my_param: "default_value" }
ICONS["mytype"] = "🔧"
GRADIENTS["mytype"] = "linear-gradient(135deg,#1a1a2e,#4a4e69)"
```

### Changing Backoff Parameters
Edit `orchestrator/internal/backoff/backoff.go`:
```go
func Compute(attempt int) time.Duration {
    base    := float64(time.Second)     // 1s base
    maxSecs := float64(300*time.Second) // 300s cap
    ...
}
```

### Adding a New API Endpoint
Add to `api-ai/app/` following the existing pattern, then register in `app/main.py`:
```python
from app.mymodule.router import router as my_router
app.include_router(my_router)
```

---

## Running Tests

### Go — Orchestrator unit tests (no infrastructure needed)
```bash
cd orchestrator
go test ./internal/statemachine/...
# 30 tests: all valid/invalid transitions
```

### Go — Integration tests (requires Postgres + Redis)
```bash
cd orchestrator
export TEST_DATABASE_URL="postgres://conductor:conductor@localhost:5432/conductor"
export TEST_REDIS_URL="localhost:6379"
go test -tags integration -timeout 120s ./internal/integration/...
# Tests: linear workflow, diamond DAG, worker kill + reclaim, crash recovery
```

### Python — api-ai unit tests (no infrastructure needed)
```bash
cd api-ai
pytest tests/ -v
# 12 tests: auth, AI endpoints, RAG, vector store
```

### TypeScript — web unit tests
```bash
cd web
node node_modules/jest/bin/jest.js --config jest.config.cjs --forceExit
# 3 test suites: runs list, run detail, DAG utils
```

---

## Milestones

| Milestone | Status | What was built |
|-----------|--------|----------------|
| M1 | ✅ | Single-worker linear execution, gRPC, Postgres schema |
| M2 | ✅ | Diamond DAG, lease reclaim, crash recovery, retries |
| M3 | ✅ | FastAPI, JWT auth, workflow CRUD, summarize/embed |
| M4 | ✅ | React dashboard, live SSE run viewer, worker page |
| M5 | ✅ | Workflow builder (React Flow), RAG endpoint, vector store |
| M6 | 🔜 | Prometheus metrics, OpenTelemetry tracing, rate limiting |

---

## Known Limitations (by design for current milestones)

- **In-memory vector store** — embeddings reset on api-ai restart. Production should use Chroma, Pinecone, or pgvector.
- **Worker capacity not enforced** — `capacity=1` is metadata only; workers can receive multiple tasks concurrently.
- **No authentication on SSE** — the SSE endpoint uses token in query param; a real deployment should use cookies.
- **Mock LLM by default** — set `LLM_PROVIDER=openai` and provide `OPENAI_API_KEY` for real summarization.
- **Single worker instance** — run multiple `./worker/bin/worker` processes on the same or different machines to scale out.

---

## Contributing

1. Fork and create a feature branch: `feat/my-feature`
2. Follow the hard rules in `AGENTS.md`
3. Every change ships with at least one unit test and one integration test
4. Run `make test && make lint` in each affected service before committing
5. Never edit applied migration files — add a new numbered file instead
6. Update `docs/PROGRESS.md` after completing work

---

*Built with Go, Python, React, Postgres, and Redis.*