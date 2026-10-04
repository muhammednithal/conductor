# Design Document: M1 — Single-Worker Linear Job Execution

## Overview

M1 assembles the minimal viable execution loop: the Orchestrator schedules steps and serves gRPC to workers, one Worker registers, receives tasks over a streaming connection, executes them, and reports results back. All durable state lives in Postgres; step IDs flow through Redis as a lightweight handoff queue. The statemachine package is the single chokepoint for every status write to `step_executions`.

## Go Version and Module Layout

- **Go version**: 1.22 (both modules)
- **Orchestrator module**: `github.com/conductor/orchestrator` at `orchestrator/go.mod`
- **Worker module**: `github.com/conductor/worker` at `worker/go.mod`

### Orchestrator Directory Tree

```
orchestrator/
├── cmd/orchestrator/main.go         ← process entry point; wires all components
├── internal/
│   ├── db/db.go                     ← pgx pool, RunMigrations, CRUD helpers
│   ├── statemachine/
│   │   ├── statemachine.go          ← Transition(), valid transitions table, DB interface
│   │   └── statemachine_test.go     ← unit tests for every valid/invalid transition
│   ├── redis/client.go              ← NewClient, PushTask, PopTask
│   ├── grpcserver/server.go         ← RegisterWorker, AckTask, Heartbeat handlers
│   ├── scheduler/scheduler.go       ← polling loop: PENDING→QUEUED, RETRYING→QUEUED
│   └── integration/
│       └── linear_workflow_test.go  ← end-to-end 3-step integration test
├── migrations/001_initial.sql
└── Makefile
```

### Worker Directory Tree

```
worker/
├── cmd/worker/main.go               ← process entry point
├── internal/
│   ├── grpcclient/client.go         ← RegisterWorker stream, heartbeat goroutine
│   └── executor/
│       ├── registry.go              ← map[string]Executor, Lookup()
│       ├── http.go                  ← HTTP step executor
│       ├── transform.go             ← key-remap transform executor
│       └── delay.go                 ← sleep executor
└── Makefile
```

## External Dependencies (Pinned)

Both `go.mod` files use these exact versions. No other external dependencies are permitted for M1.

| Module | Version | Purpose |
|--------|---------|---------|
| `github.com/jackc/pgx/v5` | `v5.5.5` | Postgres driver and connection pool |
| `github.com/redis/go-redis/v9` | `v9.5.1` | Redis client (RPUSH, BLPOP) |
| `google.golang.org/grpc` | `v1.63.2` | gRPC runtime |
| `google.golang.org/protobuf` | `v1.34.0` | Protobuf runtime |
| `github.com/stretchr/testify` | `v1.9.0` | Test assertions (require, assert) |

## Proto Definition

File: `shared/proto/conductor.proto`

```protobuf
syntax = "proto3";
package conductor;

option go_package = "github.com/conductor/orchestrator/shared/proto/conductorpb";

service OrchestratorService {
  rpc RegisterWorker(RegisterWorkerRequest) returns (stream TaskAssignment);
  rpc AckTask(AckTaskRequest) returns (AckTaskResponse);
  rpc Heartbeat(HeartbeatRequest) returns (HeartbeatResponse);
}

message RegisterWorkerRequest {
  string worker_id = 1;
  string hostname  = 2;
  int32  capacity  = 3;
}

message TaskAssignment {
  string task_id           = 1;
  string step_execution_id = 2;
  string step_type         = 3;
  bytes  config            = 4;
  bytes  input             = 5;
  string idempotency_key   = 6;
}

message AckTaskRequest {
  string task_id       = 1;
  string worker_id     = 2;
  string status        = 3;
  bytes  output        = 4;
  string error_message = 5;
}

message AckTaskResponse {
  bool success = 1;
}

message HeartbeatRequest {
  string          worker_id = 1;
  repeated string task_ids  = 2;
}

message HeartbeatResponse {
  repeated string canceled_task_ids = 1;
}
```

Pre-generated Go stubs are committed at `shared/proto/conductorpb/conductor.pb.go` and `conductor_grpc.pb.go`. Generated with `protoc-gen-go v1.34.0` and `protoc-gen-go-grpc v1.3.0`. Neither service's Makefile runs `protoc`; the stubs are treated as ordinary source files.

## Statemachine Package

### DB Interface

The package defines a minimal interface so it can be tested without a live Postgres instance:

```go
// DB is the minimal database interface required by the statemachine package.
// Only this package calls UpdateStepStatus; all others read via their own queries.
type DB interface {
    GetStepStatus(ctx context.Context, stepID string) (string, error)
    // UpdateStepStatus executes UPDATE step_executions SET status=$2 WHERE id=$1
    // and returns an error if zero rows were matched.
    UpdateStepStatus(ctx context.Context, stepID, newStatus string) error
}
```

### Valid Transitions Table

```go
// validTransitions maps each non-terminal status to its set of reachable statuses.
var validTransitions = map[string]map[string]bool{
    "PENDING":  {"QUEUED": true, "CANCELED": true},
    "QUEUED":   {"RUNNING": true, "CANCELED": true},
    "RUNNING":  {"SUCCEEDED": true, "FAILED": true, "RETRYING": true, "CANCELED": true},
    "RETRYING": {"QUEUED": true, "CANCELED": true},
}
```

Terminal states (`SUCCEEDED`, `FAILED`, `CANCELED`) are intentionally absent from the map. Any lookup on a terminal state returns a nil inner map, which is treated as "no valid transitions."

### Transition Function

```go
// Transition atomically moves the step execution identified by stepID to newStatus.
// It returns a descriptive error if the transition is invalid or the row is not found.
func Transition(ctx context.Context, db DB, stepID, newStatus string) error {
    current, err := db.GetStepStatus(ctx, stepID)
    if err != nil {
        return fmt.Errorf("statemachine: get step %s: %w", stepID, err)
    }
    allowed, ok := validTransitions[current]
    if !ok || !allowed[newStatus] {
        return fmt.Errorf("statemachine: invalid transition %s -> %s for step %s", current, newStatus, stepID)
    }
    if err := db.UpdateStepStatus(ctx, stepID, newStatus); err != nil {
        return fmt.Errorf("statemachine: update step %s to %s: %w", stepID, newStatus, err)
    }
    return nil
}
```

### Error Semantics

- `GetStepStatus` returns `sql.ErrNoRows` (or wrapped equivalent) when the step ID does not exist. `Transition` propagates this as an error.
- `UpdateStepStatus` should use a conditional `WHERE id = $1 AND status = $2` (optimistic locking) and return an error if zero rows are matched, guarding against concurrent transitions.

## DB Layer (`orchestrator/internal/db/db.go`)

### Pool Initialization

```go
type DB struct {
    pool *pgxpool.Pool
}

func New(ctx context.Context, databaseURL string) (*DB, error) {
    cfg, err := pgxpool.ParseConfig(databaseURL)
    // ...
    pool, err := pgxpool.NewWithConfig(ctx, cfg)
    // ...
    return &DB{pool: pool}, nil
}
```

### RunMigrations

```go
// RunMigrations reads orchestrator/migrations/001_initial.sql and executes it
// against the connected database. Called once at startup.
func (d *DB) RunMigrations(ctx context.Context, migrationsDir string) error
```

Implementation: reads every `*.sql` file from `migrationsDir` in lexicographic order and executes each in a transaction. For M1, only `001_initial.sql` exists.

### Required CRUD Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `GetStepStatus` | `(ctx, stepID string) (string, error)` | SELECT status FROM step_executions WHERE id = $1 |
| `UpdateStepStatus` | `(ctx, stepID, newStatus string) error` | UPDATE step_executions SET status=$2 WHERE id=$1 AND status != newStatus (returns error if 0 rows) |
| `GetPendingReadySteps` | `(ctx, runID string) ([]StepExecution, error)` | Returns PENDING steps whose depends_on steps are all SUCCEEDED |
| `GetRetryingReadySteps` | `(ctx) ([]StepExecution, error)` | SELECT * FROM step_executions WHERE status='RETRYING' AND scheduled_after <= NOW() |
| `GetStepByID` | `(ctx, stepID string) (*StepExecution, error)` | Full row fetch |
| `UpsertWorker` | `(ctx, w Worker) error` | INSERT ... ON CONFLICT (id) DO UPDATE |
| `UpdateWorkerHeartbeat` | `(ctx, workerID string) error` | UPDATE workers SET last_heartbeat_at = NOW() |
| `InsertLease` | `(ctx, l Lease) error` | INSERT INTO leases ... |
| `DeleteLease` | `(ctx, stepExecutionID string) error` | DELETE FROM leases WHERE step_execution_id = $1 |
| `RenewLease` | `(ctx, stepExecutionID string) error` | UPDATE leases SET renewed_at=NOW(), expires_at=NOW()+30s WHERE step_execution_id=$1 |
| `UpdateStepOutput` | `(ctx, stepID string, output json.RawMessage) error` | UPDATE step_executions SET output=$2 WHERE id=$1 |
| `UpdateStepError` | `(ctx, stepID, errMsg string) error` | UPDATE step_executions SET error_msg=$2 WHERE id=$1 |
| `SetStepScheduledAfter` | `(ctx, stepID string, after time.Time) error` | UPDATE step_executions SET scheduled_after=$2 WHERE id=$1 |
| `CreateRun` | `(ctx, r WorkflowRun) (string, error)` | INSERT INTO workflow_runs, returns new id |
| `CreateStepExecution` | `(ctx, se StepExecution) error` | INSERT ... ON CONFLICT (run_id, step_name) DO NOTHING |
| `GetRunStepExecutions` | `(ctx, runID string) ([]StepExecution, error)` | All steps for a run |

### Go Structs

```go
type StepExecution struct {
    ID              string
    RunID           string
    StepName        string
    StepType        string
    Status          string
    AttemptCount    int
    MaxAttempts     int
    IdempotencyKey  string
    Input           json.RawMessage
    Output          json.RawMessage
    ErrorMsg        string
    ScheduledAfter  *time.Time
    StartedAt       *time.Time
    CompletedAt     *time.Time
}

type Worker struct {
    ID              string
    Hostname        string
    GRPCAddress     string
    Status          string
    Capacity        int
    RegisteredAt    time.Time
    LastHeartbeatAt time.Time
}

type Lease struct {
    ID               string
    StepExecutionID  string
    WorkerID         string
    AcquiredAt       time.Time
    ExpiresAt        time.Time
    RenewedAt        time.Time
}
```

## Redis Client (`orchestrator/internal/redis/client.go`)

```go
type Client struct {
    rdb *goredis.Client
}

func NewClient(addr string) *Client {
    rdb := goredis.NewClient(&goredis.Options{Addr: addr})
    return &Client{rdb: rdb}
}

// PushTask appends a step execution ID to the right end of conductor:tasks.
func (c *Client) PushTask(ctx context.Context, stepExecutionID string) error {
    return c.rdb.RPush(ctx, "conductor:tasks", stepExecutionID).Err()
}

// PopTask blocks until a step execution ID is available or the timeout elapses.
// Returns ("", nil) on timeout (BLPOP returns nil on timeout, not an error).
func (c *Client) PopTask(ctx context.Context, timeout time.Duration) (string, error) {
    result, err := c.rdb.BLPop(ctx, timeout, "conductor:tasks").Result()
    if err == goredis.Nil {
        return "", nil // timeout, no item available
    }
    if err != nil {
        return "", err
    }
    return result[1], nil // result[0] is the key name, result[1] is the value
}
```

The Orchestrator's gRPC server calls `PopTask` inside the `RegisterWorker` stream handler loop. The Worker does NOT interact with Redis directly — it receives tasks exclusively via the gRPC stream.

## Orchestrator gRPC Server (`orchestrator/internal/grpcserver/server.go`)

### Struct

```go
type Server struct {
    conductorpb.UnimplementedOrchestratorServiceServer
    db    *db.DB
    redis *redis.Client
}
```

### RegisterWorker Handler Sequence

```
1. Upsert workers row: status=ONLINE, hostname, capacity from request
2. Loop:
   a. Call redis.PopTask(ctx, 5*time.Second)
   b. If empty (timeout), continue loop
   c. Fetch StepExecution row from DB by ID
   d. Insert leases row: expires_at = NOW() + 30s, worker_id from request
   e. Call statemachine.Transition(ctx, db, stepID, "RUNNING")
   f. stream.Send(&TaskAssignment{...}) with step data
3. On stream context cancel: set worker status=OFFLINE
```

### AckTask Handler

```go
func (s *Server) AckTask(ctx context.Context, req *conductorpb.AckTaskRequest) (*conductorpb.AckTaskResponse, error) {
    switch req.Status {
    case "SUCCEEDED":
        s.db.UpdateStepOutput(ctx, req.TaskId, req.Output)
        statemachine.Transition(ctx, s.db, req.TaskId, "SUCCEEDED")
        s.db.DeleteLease(ctx, req.TaskId)
    case "FAILED":
        step, _ := s.db.GetStepByID(ctx, req.TaskId)
        s.db.UpdateStepError(ctx, req.TaskId, req.ErrorMessage)
        if step.AttemptCount < step.MaxAttempts {
            backoff := computeBackoff(step.AttemptCount)
            s.db.SetStepScheduledAfter(ctx, req.TaskId, time.Now().Add(backoff))
            statemachine.Transition(ctx, s.db, req.TaskId, "RETRYING")
        } else {
            statemachine.Transition(ctx, s.db, req.TaskId, "FAILED")
        }
        s.db.DeleteLease(ctx, req.TaskId)
    case "CANCELED":
        statemachine.Transition(ctx, s.db, req.TaskId, "CANCELED")
        s.db.DeleteLease(ctx, req.TaskId)
    }
    return &conductorpb.AckTaskResponse{Success: true}, nil
}
```

### Heartbeat Handler

```go
func (s *Server) Heartbeat(ctx context.Context, req *conductorpb.HeartbeatRequest) (*conductorpb.HeartbeatResponse, error) {
    s.db.UpdateWorkerHeartbeat(ctx, req.WorkerId)
    var canceledIDs []string
    for _, taskID := range req.TaskIds {
        s.db.RenewLease(ctx, taskID)
        step, _ := s.db.GetStepByID(ctx, taskID)
        if step.Status == "CANCELED" {
            canceledIDs = append(canceledIDs, taskID)
        }
    }
    return &conductorpb.HeartbeatResponse{CanceledTaskIds: canceledIDs}, nil
}
```

### Backoff Formula

```go
// computeBackoff returns the delay for attempt n (0-indexed).
// Formula: min(1s * 2^n, 300s) * uniform(0.8, 1.2)
func computeBackoff(attempt int) time.Duration {
    base := time.Second
    exp := math.Min(float64(base)*math.Pow(2, float64(attempt)), 300)
    jitter := 0.8 + rand.Float64()*0.4 // uniform [0.8, 1.2]
    return time.Duration(exp * jitter * float64(time.Second))
}
```

## Orchestrator Scheduler Loop (`orchestrator/internal/scheduler/scheduler.go`)

### Struct and Run

```go
type Scheduler struct {
    db    *db.DB
    redis *redis.Client
    sm    *statemachine.Package // injected for testability
}

func (s *Scheduler) Run(ctx context.Context) {
    ticker := time.NewTicker(time.Second)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            s.advancePendingSteps(ctx)
            s.requeueRetryingSteps(ctx)
        }
    }
}
```

### advancePendingSteps

```go
func (s *Scheduler) advancePendingSteps(ctx context.Context) {
    // Query: all PENDING step_executions where every step in depends_on has status=SUCCEEDED
    // For linear DAGs in M1: depends_on has 0 or 1 entries.
    steps, err := s.db.GetPendingReadySteps(ctx)
    if err != nil {
        log.Printf("scheduler: get pending ready: %v", err)
        return
    }
    for _, step := range steps {
        if err := statemachine.Transition(ctx, s.db, step.ID, "QUEUED"); err != nil {
            log.Printf("scheduler: transition %s to QUEUED: %v", step.ID, err)
            continue
        }
        if err := s.redis.PushTask(ctx, step.ID); err != nil {
            log.Printf("scheduler: push task %s: %v", step.ID, err)
            // Step is now QUEUED in DB; next iteration will re-push if Redis recovers.
        }
    }
}
```

### requeueRetryingSteps

```go
func (s *Scheduler) requeueRetryingSteps(ctx context.Context) {
    steps, err := s.db.GetRetryingReadySteps(ctx)
    if err != nil {
        log.Printf("scheduler: get retrying ready: %v", err)
        return
    }
    for _, step := range steps {
        if err := statemachine.Transition(ctx, s.db, step.ID, "QUEUED"); err != nil {
            log.Printf("scheduler: retrying transition %s: %v", step.ID, err)
            continue
        }
        if err := s.redis.PushTask(ctx, step.ID); err != nil {
            log.Printf("scheduler: push retrying task %s: %v", step.ID, err)
        }
    }
}
```

### GetPendingReadySteps SQL

```sql
SELECT se.*
FROM step_executions se
WHERE se.status = 'PENDING'
  AND NOT EXISTS (
      SELECT 1
      FROM step_executions dep
      WHERE dep.run_id = se.run_id
        AND dep.step_name = ANY(
            -- depends_on is stored as a JSON array in the dag_definition;
            -- for M1, we pass the depends_on array as a parameter from the parsed DAG.
            -- Implementation note: store depends_on in a separate column or join via run metadata.
            $1::text[]
        )
        AND dep.status != 'SUCCEEDED'
  );
```

**Implementation note**: For M1, the simplest approach is to fetch all `PENDING` step executions along with the run's `dag_definition`, parse the depends_on list in Go, and check each dependency's status in a second query rather than in a single SQL subquery. This is simpler and correct for linear DAGs with low step counts.

## Orchestrator Main (`orchestrator/cmd/orchestrator/main.go`)

Environment variables read at startup:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | *(required)* | Postgres connection string |
| `REDIS_ADDR` | `localhost:6379` | Redis address |
| `GRPC_ADDR` | `:9000` | gRPC listen address |
| `MIGRATIONS_DIR` | `migrations` | Path to migrations directory |

Startup sequence:
1. Parse env vars
2. `db.New(ctx, databaseURL)` — connect to Postgres
3. `db.RunMigrations(ctx, migrationsDir)` — apply schema
4. `redis.NewClient(redisAddr)` — connect to Redis
5. Start `Scheduler.Run(ctx)` in a goroutine
6. Create gRPC server, register `grpcserver.Server`
7. `grpc.Serve(listener)` (blocks)
8. Handle `SIGTERM`/`SIGINT` → cancel context → graceful shutdown

## Worker gRPC Client (`worker/internal/grpcclient/client.go`)

### Struct

```go
type Client struct {
    conn       *grpc.ClientConn
    stub       conductorpb.OrchestratorServiceClient
    workerID   string
    hostname   string
    executors  *executor.Registry
    activeTasks sync.Map // map[stepExecutionID]cancelFunc
}
```

### Registration and Dispatch Loop

```go
func (c *Client) Run(ctx context.Context) error {
    req := &conductorpb.RegisterWorkerRequest{
        WorkerId: c.workerID,
        Hostname: c.hostname,
        Capacity: 1, // M1: single goroutine
    }
    stream, err := c.stub.RegisterWorker(ctx, req)
    if err != nil {
        return fmt.Errorf("register worker: %w", err)
    }

    go c.heartbeatLoop(ctx)

    for {
        assignment, err := stream.Recv()
        if err != nil {
            return fmt.Errorf("recv task: %w", err)
        }
        go c.executeTask(ctx, assignment)
    }
}
```

### executeTask

```go
func (c *Client) executeTask(ctx context.Context, a *conductorpb.TaskAssignment) {
    taskCtx, cancel := context.WithCancel(ctx)
    c.activeTasks.Store(a.StepExecutionId, cancel)
    defer func() {
        c.activeTasks.Delete(a.StepExecutionId)
        cancel()
    }()

    exec, err := c.executors.Lookup(a.StepType)
    if err != nil {
        c.ackFailed(ctx, a, err.Error())
        return
    }

    output, err := exec.Execute(taskCtx, a.Input, a.Config)
    if err != nil {
        c.ackFailed(ctx, a, err.Error())
        return
    }
    c.ackSucceeded(ctx, a, output)
}
```

### Heartbeat Loop

```go
func (c *Client) heartbeatLoop(ctx context.Context) {
    ticker := time.NewTicker(10 * time.Second)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            var ids []string
            c.activeTasks.Range(func(k, _ any) bool {
                ids = append(ids, k.(string))
                return true
            })
            resp, err := c.stub.Heartbeat(ctx, &conductorpb.HeartbeatRequest{
                WorkerId: c.workerID,
                TaskIds:  ids,
            })
            if err != nil {
                log.Printf("heartbeat error: %v", err)
                continue
            }
            for _, canceledID := range resp.CanceledTaskIds {
                if cancel, ok := c.activeTasks.Load(canceledID); ok {
                    cancel.(context.CancelFunc)()
                }
            }
        }
    }
}
```

## Worker Main (`worker/cmd/worker/main.go`)

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `ORCHESTRATOR_ADDR` | `:9000` | gRPC server address |
| `WORKER_HOSTNAME` | `os.Hostname()` | Hostname reported on registration |

Startup sequence:
1. Parse env vars
2. `grpc.Dial(orchestratorAddr)` — establish connection
3. Build `executor.Registry` with `http`, `transform`, `delay` executors registered
4. Create `grpcclient.Client`
5. Handle `SIGTERM`/`SIGINT` → cancel context
6. `client.Run(ctx)` — blocks until context canceled

## Step Executor Interface and Implementations

### Interface (`worker/internal/executor/registry.go`)

```go
// Executor executes a single workflow step.
type Executor interface {
    Execute(ctx context.Context, input json.RawMessage, config json.RawMessage) (json.RawMessage, error)
}

type Registry struct {
    m map[string]Executor
}

func NewRegistry() *Registry {
    return &Registry{m: make(map[string]Executor)}
}

func (r *Registry) Register(stepType string, e Executor) {
    r.m[stepType] = e
}

func (r *Registry) Lookup(stepType string) (Executor, error) {
    e, ok := r.m[stepType]
    if !ok {
        return nil, fmt.Errorf("executor: unknown step type %q", stepType)
    }
    return e, nil
}
```

### HTTP Executor (`worker/internal/executor/http.go`)

Config schema:
```json
{ "url": "https://example.com/api", "method": "POST" }
```

```go
type httpConfig struct {
    URL    string `json:"url"`
    Method string `json:"method"`
}

type HTTPExecutor struct {
    client *http.Client
}

func (e *HTTPExecutor) Execute(ctx context.Context, input, config json.RawMessage) (json.RawMessage, error) {
    var cfg httpConfig
    if err := json.Unmarshal(config, &cfg); err != nil {
        return nil, fmt.Errorf("http: parse config: %w", err)
    }
    if cfg.Method == "" {
        cfg.Method = "POST"
    }
    req, err := http.NewRequestWithContext(ctx, cfg.Method, cfg.URL, bytes.NewReader(input))
    if err != nil {
        return nil, err
    }
    req.Header.Set("Content-Type", "application/json")
    resp, err := e.client.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20)) // 1 MB cap
    if resp.StatusCode < 200 || resp.StatusCode >= 300 {
        preview := body
        if len(preview) > 512 {
            preview = preview[:512]
        }
        return nil, fmt.Errorf("http: status %d: %s", resp.StatusCode, preview)
    }
    return json.RawMessage(body), nil
}
```

### Transform Executor (`worker/internal/executor/transform.go`)

Config schema:
```json
{ "mapping": { "outputField": "input.path.to.value", "other": "another.path" } }
```

```go
type transformConfig struct {
    Mapping map[string]string `json:"mapping"`
}

type TransformExecutor struct{}

// Execute applies dot-notation path extraction from input to build the output object.
func (e *TransformExecutor) Execute(ctx context.Context, input, config json.RawMessage) (json.RawMessage, error) {
    var cfg transformConfig
    if err := json.Unmarshal(config, &cfg); err != nil {
        return nil, fmt.Errorf("transform: parse config: %w", err)
    }
    var src map[string]any
    if err := json.Unmarshal(input, &src); err != nil {
        return nil, fmt.Errorf("transform: parse input: %w", err)
    }
    out := make(map[string]any, len(cfg.Mapping))
    for outKey, path := range cfg.Mapping {
        val, err := extractPath(src, path)
        if err != nil {
            return nil, fmt.Errorf("transform: extract %q: %w", path, err)
        }
        out[outKey] = val
    }
    return json.Marshal(out)
}

// extractPath traverses a nested map following dot-separated segments.
// e.g. extractPath({"a":{"b":1}}, "a.b") == 1
func extractPath(obj map[string]any, path string) (any, error) {
    parts := strings.SplitN(path, ".", 2)
    val, ok := obj[parts[0]]
    if !ok {
        return nil, fmt.Errorf("key %q not found", parts[0])
    }
    if len(parts) == 1 {
        return val, nil
    }
    nested, ok := val.(map[string]any)
    if !ok {
        return nil, fmt.Errorf("cannot traverse into non-object at %q", parts[0])
    }
    return extractPath(nested, parts[1])
}
```

### Delay Executor (`worker/internal/executor/delay.go`)

Config schema:
```json
{ "duration_seconds": 5 }
```

```go
type delayConfig struct {
    DurationSeconds int `json:"duration_seconds"`
}

type DelayExecutor struct{}

func (e *DelayExecutor) Execute(ctx context.Context, input, config json.RawMessage) (json.RawMessage, error) {
    var cfg delayConfig
    if err := json.Unmarshal(config, &cfg); err != nil {
        return nil, fmt.Errorf("delay: parse config: %w", err)
    }
    select {
    case <-time.After(time.Duration(cfg.DurationSeconds) * time.Second):
        return json.RawMessage(`{}`), nil
    case <-ctx.Done():
        return nil, ctx.Err()
    }
}
```

## Integration Test Strategy

File: `orchestrator/internal/integration/linear_workflow_test.go`

### Test Setup

```go
func TestLinearWorkflow(t *testing.T) {
    dbURL := os.Getenv("TEST_DATABASE_URL")
    redisURL := os.Getenv("TEST_REDIS_URL")
    if dbURL == "" || redisURL == "" {
        t.Skip("TEST_DATABASE_URL and TEST_REDIS_URL must be set")
    }

    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()

    // 1. Connect DB, run migrations
    // 2. Connect Redis, flush test data
    // 3. Insert workflow with dag_definition containing steps a→b→c
    // 4. Insert workflow_run (status=PENDING), insert step_executions (all PENDING)
    // 5. Start scheduler in goroutine
    // 6. Start gRPC server in goroutine
    // 7. Start worker in goroutine (in-process, using grpcclient.Client)
    // 8. Poll step_executions every 200ms until all SUCCEEDED or ctx times out
    // 9. Assert all three steps SUCCEEDED
    // 10. Assert workers row exists with status=ONLINE
    // 11. Cleanup (defer)
}
```

### 3-Step Workflow DAG

```json
{
  "steps": [
    {
      "name": "a",
      "type": "delay",
      "depends_on": [],
      "config": {"duration_seconds": 0},
      "timeout_seconds": 10,
      "max_attempts": 1
    },
    {
      "name": "b",
      "type": "transform",
      "depends_on": ["a"],
      "config": {"mapping": {"result": "value"}},
      "timeout_seconds": 10,
      "max_attempts": 1
    },
    {
      "name": "c",
      "type": "delay",
      "depends_on": ["b"],
      "config": {"duration_seconds": 0},
      "timeout_seconds": 10,
      "max_attempts": 1
    }
  ]
}
```

The test uses `duration_seconds: 0` for delay steps and a trivial transform so execution completes immediately. The 30-second `context.WithTimeout` provides the upper bound for the entire pipeline.

### Assertions

```go
require.Eventually(t, func() bool {
    steps, _ := db.GetRunStepExecutions(ctx, runID)
    for _, s := range steps {
        if s.Status != "SUCCEEDED" {
            return false
        }
    }
    return len(steps) == 3
}, 30*time.Second, 200*time.Millisecond, "all steps should reach SUCCEEDED within 30s")
```

## Environment Variables Summary

| Service | Variable | Default | Description |
|---------|----------|---------|-------------|
| Orchestrator | `DATABASE_URL` | *(required)* | Postgres DSN |
| Orchestrator | `REDIS_ADDR` | `localhost:6379` | Redis address |
| Orchestrator | `GRPC_ADDR` | `:9000` | gRPC listen address |
| Orchestrator | `MIGRATIONS_DIR` | `migrations` | Relative path to migrations |
| Worker | `ORCHESTRATOR_ADDR` | `:9000` | Orchestrator gRPC address |
| Worker | `WORKER_HOSTNAME` | `os.Hostname()` | Reported hostname |
| Integration test | `TEST_DATABASE_URL` | *(skip if absent)* | Postgres DSN for tests |
| Integration test | `TEST_REDIS_URL` | *(skip if absent)* | Redis address for tests |

## Makefile Targets

Both `orchestrator/Makefile` and `worker/Makefile` define these targets identically (substituting binary name):

```makefile
.PHONY: build test lint run

build:
	go build -o bin/orchestrator ./cmd/orchestrator   # (or bin/worker ./cmd/worker)

test:
	go test ./...

lint:
	go vet ./...

run:
	go run ./cmd/orchestrator   # (or ./cmd/worker)
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Valid transitions succeed and persist

*For any* step execution in a non-terminal state (`PENDING`, `QUEUED`, `RUNNING`, or `RETRYING`) and *for any* target state that is valid for that current state per the transition table, calling `Transition()` returns a nil error AND a subsequent read of `step_executions.status` for that step returns the target state.

**Validates: Requirements 3.2, 3.5**

### Property 2: Invalid transitions are rejected without DB mutation

*For any* step execution in any status (including terminal states `SUCCEEDED`, `FAILED`, `CANCELED`) and *for any* target state that is NOT in the valid-next-state set for the current status, calling `Transition()` returns a non-nil error AND the step's status in the database remains unchanged.

**Validates: Requirements 3.3, 3.4**

### Property 3: Linear DAG ordering is topologically correct

*For any* linear workflow `dag_definition` with N steps where each step at index `i > 0` declares `depends_on = [steps[i-1].name]`, the DAG Parser returns a step slice of length N where step at position `i` always appears after all steps it depends on — that is, for every pair `(step[i], dep)` where `dep ∈ step[i].depends_on`, `dep` appears at a lower index in the returned slice.

**Validates: Requirements 4.1, 4.3**

### Property 4: Transform executor produces exactly the mapped keys with correct values

*For any* non-empty JSON input object and *for any* valid mapping configuration where every path references an existing key in the input, the transform executor output is a JSON object containing exactly the keys specified in the mapping (no more, no fewer), where each output key's value equals the value obtained by traversing the input along the corresponding dot-notation path.

**Validates: Requirements 8.4**
