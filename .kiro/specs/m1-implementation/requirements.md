# Requirements Document

## Introduction

Milestone 1 establishes the minimal end-to-end foundation of the Conductor distributed workflow orchestrator. It delivers a single-worker, linear-DAG execution pipeline with durable Postgres state, Redis task queuing, gRPC-based orchestrator-worker communication, and three concrete step executor types (`http`, `transform`, `delay`). All step state transitions are enforced exclusively through the `statemachine` package — no code outside that package may write `step_executions.status` directly via SQL.

Out of scope for M1: DAG branching, AI step types, the web dashboard, crash recovery on orchestrator restart, and full exponential-backoff retry (the retry state transition is wired but the full reclaim loop is deferred to M2).

## Glossary

- **Orchestrator**: The Go service at `orchestrator/` responsible for DAG parsing, step scheduling, state persistence, and gRPC communication with workers.
- **Worker**: The Go service at `worker/` responsible for task execution, heartbeat, and step-handler dispatch.
- **Statemachine Package**: The Go package `orchestrator/internal/statemachine` that is the **sole authority** for updating `step_executions.status`. No other package may write this column directly via SQL.
- **Step Execution**: A single row in the `step_executions` Postgres table representing one attempt to execute one named step within one workflow run.
- **Linear DAG**: A `dag_definition` in which all steps form a single sequential chain where each step's `depends_on` list contains at most one prior step name.
- **Lease**: A time-bounded ownership token stored in the `leases` table that grants a specific worker the right to execute a specific step execution.
- **Redis Task Queue**: The Redis list key `conductor:tasks` used by the Orchestrator to push step execution IDs and by the Worker to pop them.
- **Terminal State**: Any of `SUCCEEDED`, `FAILED`, or `CANCELED` — states from which no further transitions are permitted.
- **TaskAssignment**: The gRPC streaming message the Orchestrator sends to a Worker containing everything the Worker needs to execute a step.
- **OrchestratorService**: The gRPC service declared in `shared/proto/conductor.proto`.
- **DAG Parser**: The component inside the Orchestrator that deserializes a `dag_definition` JSON column into an ordered list of step definitions.
- **Scheduler Loop**: The background goroutine in the Orchestrator that periodically advances ready steps from `PENDING` to `QUEUED` and re-queues `RETRYING` steps.

## Requirements

### Requirement 1: Postgres Schema

**User Story:** As a platform engineer, I want a well-defined, referentially consistent Postgres schema, so that all service state is durably persisted and can be reasoned about across restarts.

#### Acceptance Criteria

1. THE Database SHALL define a `users` table with columns: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `email TEXT NOT NULL UNIQUE`, `password_hash TEXT NOT NULL`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.

2. THE Database SHALL define a `workflows` table with columns: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `owner_id UUID NOT NULL REFERENCES users(id)`, `name TEXT NOT NULL`, `description TEXT`, `dag_definition JSONB NOT NULL`, `version INT NOT NULL DEFAULT 1`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.

3. THE Database SHALL define a `workflow_runs` table with columns: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `workflow_id UUID NOT NULL REFERENCES workflows(id)`, `status TEXT NOT NULL CHECK (status IN ('PENDING','RUNNING','SUCCEEDED','FAILED','CANCELED'))`, `input JSONB`, `output JSONB`, `triggered_by UUID REFERENCES users(id)`, `started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `completed_at TIMESTAMPTZ`, `error_msg TEXT`.

4. THE Database SHALL define a `step_executions` table with columns: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `run_id UUID NOT NULL REFERENCES workflow_runs(id)`, `step_name TEXT NOT NULL`, `step_type TEXT NOT NULL CHECK (step_type IN ('http','transform','delay','summarize','embed','rag'))`, `status TEXT NOT NULL CHECK (status IN ('PENDING','QUEUED','RUNNING','SUCCEEDED','FAILED','RETRYING','CANCELED'))`, `attempt_count INT NOT NULL DEFAULT 0`, `max_attempts INT NOT NULL DEFAULT 3`, `idempotency_key TEXT NOT NULL UNIQUE`, `input JSONB`, `output JSONB`, `error_msg TEXT`, `scheduled_after TIMESTAMPTZ`, `started_at TIMESTAMPTZ`, `completed_at TIMESTAMPTZ`, and a composite unique constraint `UNIQUE (run_id, step_name)`.

5. THE Database SHALL define a `workers` table with columns: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `hostname TEXT NOT NULL`, `grpc_address TEXT NOT NULL`, `status TEXT NOT NULL CHECK (status IN ('ONLINE','OFFLINE','DRAINING'))`, `capacity INT NOT NULL DEFAULT 10`, `registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.

6. THE Database SHALL define a `leases` table with columns: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `step_execution_id UUID NOT NULL REFERENCES step_executions(id) UNIQUE`, `worker_id UUID NOT NULL REFERENCES workers(id)`, `acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `expires_at TIMESTAMPTZ NOT NULL`, `renewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.

### Requirement 2: SQL Migration File

**User Story:** As a platform engineer, I want a versioned, idempotent migration file, so that the full schema can be applied to any fresh Postgres instance reproducibly without manual steps.

#### Acceptance Criteria

1. THE Orchestrator SHALL contain a migration file at the path `orchestrator/migrations/001_initial.sql` with `CREATE TABLE` statements for all six tables defined in Requirement 1.

2. THE Migration File SHALL include every column definition, PRIMARY KEY, FOREIGN KEY reference, UNIQUE constraint, and CHECK constraint exactly as specified in Requirement 1.

3. THE Migration File SHALL use `CREATE TABLE IF NOT EXISTS` syntax for each table so that re-running the file against a database that already has the tables does not produce an error.

### Requirement 3: Statemachine Package

**User Story:** As a platform engineer, I want all step state transitions enforced by a single, authoritative package, so that invalid state changes are structurally impossible and audit-proof.

#### Acceptance Criteria

1. THE Statemachine Package SHALL expose a function with the signature `Transition(ctx context.Context, db DB, stepID string, newStatus string) error` as the sole code path that writes `step_executions.status`.

2. THE Statemachine Package SHALL permit exactly the following transitions and reject all others:

   | From      | To                                          |
   |-----------|---------------------------------------------|
   | PENDING   | QUEUED, CANCELED                            |
   | QUEUED    | RUNNING, CANCELED                           |
   | RUNNING   | SUCCEEDED, FAILED, RETRYING, CANCELED       |
   | RETRYING  | QUEUED, CANCELED                            |

3. WHEN `Transition` is called with a `newStatus` that is not reachable from the step's current status, THE Statemachine Package SHALL return a non-nil error that includes both the current status and the attempted target status, and SHALL NOT modify the database.

4. WHEN `Transition` is called with a step execution whose current status is `SUCCEEDED`, `FAILED`, or `CANCELED`, THE Statemachine Package SHALL return a non-nil error regardless of `newStatus`, and SHALL NOT modify the database.

5. WHEN `Transition` is called with a valid `(currentStatus, newStatus)` pair, THE Statemachine Package SHALL execute a single SQL `UPDATE` that sets `step_executions.status = newStatus` where `id = stepID` and the current status matches, return nil on success, and return a non-nil error if the row is not found or the conditional update matches zero rows.

6. THE Statemachine Package SHALL define a minimal `DB` interface (e.g., `GetStepStatus` and `UpdateStepStatus`) so that it can be tested with a mock without requiring a live database.

### Requirement 4: Orchestrator DAG Parser

**User Story:** As a platform engineer, I want the orchestrator to parse `dag_definition` JSONB into a structured Go representation, so that the scheduler can determine step ordering and dependency relationships.

#### Acceptance Criteria

1. WHEN the DAG Parser receives a `dag_definition` JSON object, THE DAG Parser SHALL deserialize it into a Go struct containing an ordered slice of step definitions, where each step definition carries `name`, `type`, `config` (raw JSON), `depends_on` (string slice), `timeout_seconds` (int, default 300), and `max_attempts` (int, default 3).

2. WHEN the DAG Parser receives a `dag_definition` containing a step with a `type` value that is not one of `http`, `transform`, `delay`, `summarize`, `embed`, or `rag`, THE DAG Parser SHALL return a non-nil validation error identifying the invalid step name and type.

3. WHEN the DAG Parser receives a linear `dag_definition` where each step's `depends_on` list references at most one prior step name, THE DAG Parser SHALL produce steps in topological order such that step `i` always appears after all steps it depends on.

4. THE DAG Parser SHALL return a non-nil error if any step's `depends_on` references a step name that does not appear elsewhere in the `dag_definition`.

### Requirement 5: Orchestrator Scheduler Loop

**User Story:** As a platform engineer, I want the orchestrator to continuously advance ready steps through the execution queue, so that workflows progress without manual intervention.

#### Acceptance Criteria

1. THE Scheduler Loop SHALL execute two polling passes on a tick interval not exceeding 1 second: one for PENDING-to-QUEUED advancement and one for RETRYING-to-QUEUED re-queuing.

2. WHEN a `PENDING` step execution's `depends_on` steps all have `status = 'SUCCEEDED'` in `step_executions` (or the step has no dependencies), THE Scheduler Loop SHALL call `Transition(ctx, db, stepID, "QUEUED")` via the Statemachine Package and then call `RPUSH conductor:tasks <step_execution_id>` on Redis.

3. WHEN a `RETRYING` step execution has `scheduled_after <= NOW()`, THE Scheduler Loop SHALL call `Transition(ctx, db, stepID, "QUEUED")` via the Statemachine Package and then call `RPUSH conductor:tasks <step_execution_id>` on Redis.

4. IF a Redis `RPUSH` call returns an error, THEN THE Scheduler Loop SHALL log the error with the step execution ID and continue without marking the step as failed; the step will be re-queued on the next polling tick.

5. THE Scheduler Loop SHALL accept a `context.Context` and terminate cleanly when the context is canceled.

### Requirement 6: Orchestrator gRPC Server

**User Story:** As a platform engineer, I want the orchestrator to expose a gRPC API so that workers can register, receive tasks, and report results without polling.

#### Acceptance Criteria

1. THE Orchestrator gRPC Server SHALL listen on the address specified by the `GRPC_ADDR` environment variable, defaulting to `:9000`.

2. WHEN a Worker calls `RegisterWorker`, THE Orchestrator gRPC Server SHALL upsert a row in the `workers` table with `status = 'ONLINE'`, `hostname` from the request, `grpc_address` set to the client's remote address, and `capacity` from the request; then begin streaming `TaskAssignment` messages to the caller by consuming entries from Redis via `BLPOP conductor:tasks <timeout>`.

3. WHEN the Orchestrator gRPC Server dequeues a `step_execution_id` from `conductor:tasks` for a connected worker, THE Orchestrator gRPC Server SHALL: (a) insert a row in `leases` with `expires_at = NOW() + 30 seconds`, (b) call `Transition(ctx, db, stepExecutionID, "RUNNING")` via the Statemachine Package, and (c) send a `TaskAssignment` message to the worker containing the step's `id`, `step_type`, `config`, `input`, and `idempotency_key`.

4. WHEN a Worker calls `AckTask` with `status = "SUCCEEDED"`, THE Orchestrator gRPC Server SHALL call `Transition(ctx, db, stepID, "SUCCEEDED")` via the Statemachine Package, store `output` in `step_executions.output`, and delete the corresponding `leases` row.

5. WHEN a Worker calls `AckTask` with `status = "FAILED"`, THE Orchestrator gRPC Server SHALL check `attempt_count` against `max_attempts`; if `attempt_count < max_attempts`, call `Transition(ctx, db, stepID, "RETRYING")` and set `scheduled_after` per the backoff formula; otherwise call `Transition(ctx, db, stepID, "FAILED")`. In both cases delete the `leases` row.

6. WHEN a Worker calls `Heartbeat`, THE Orchestrator gRPC Server SHALL update `workers.last_heartbeat_at = NOW()` and, for each `task_id` in `HeartbeatRequest.task_ids`, extend the corresponding lease by setting `leases.renewed_at = NOW()` and `leases.expires_at = NOW() + 30 seconds`.

7. WHEN a Worker calls `Heartbeat` and a step execution referenced in `task_ids` has `status = 'CANCELED'` in `step_executions`, THE Orchestrator gRPC Server SHALL include that step's `step_execution_id` in `HeartbeatResponse.canceled_task_ids`.

### Requirement 7: Worker gRPC Client

**User Story:** As a platform engineer, I want the worker to register with the orchestrator and receive tasks over a streaming connection, so that task delivery is push-based with no polling.

#### Acceptance Criteria

1. WHEN the Worker starts, THE Worker gRPC Client SHALL establish a gRPC connection to the address in the `ORCHESTRATOR_ADDR` environment variable (default `:9000`) and call `RegisterWorker` with the worker's hostname, a generated `worker_id` UUID, and `capacity = 1` for M1.

2. WHEN a `TaskAssignment` message arrives on the stream, THE Worker gRPC Client SHALL dispatch it to the executor registered for `task.step_type` by calling `executor.Execute(ctx, task.input, task.config)`.

3. THE Worker gRPC Client SHALL send a `HeartbeatRequest` to the Orchestrator every 10 seconds containing the `step_execution_id` values of all tasks currently executing.

4. WHEN a `HeartbeatResponse.canceled_task_ids` entry matches a currently executing task, THE Worker gRPC Client SHALL cancel that task's context, wait for the executor to return, and then call `AckTask` with `status = "CANCELED"`.

5. WHEN `executor.Execute` returns a non-nil error, THE Worker gRPC Client SHALL call `AckTask` with `status = "FAILED"` and `error_message` set to the error's string.

6. WHEN `executor.Execute` returns a nil error and a JSON output, THE Worker gRPC Client SHALL call `AckTask` with `status = "SUCCEEDED"` and `output` set to the executor's returned bytes.

### Requirement 8: Step Executors

**User Story:** As a platform engineer, I want built-in step executors for HTTP requests, key-remap transforms, and sleep delays, so that common workflow operations work out of the box.

#### Acceptance Criteria

1. THE Step Executor Interface SHALL be `Execute(ctx context.Context, input json.RawMessage, config json.RawMessage) (json.RawMessage, error)`, implemented by each executor type.

2. WHEN the `http` executor is invoked, THE HTTP Executor SHALL parse `config` to obtain `url` (string, required) and `method` (string, default `"POST"`), make an HTTP request to `config.url` using `config.method` with the `input` bytes as the JSON request body and `Content-Type: application/json`, and return the response body as output.

3. WHEN the `http` executor receives an HTTP response with a status code outside the 200–299 range, THE HTTP Executor SHALL return a non-nil error containing the numeric status code and the first 512 bytes of the response body.

4. WHEN the `transform` executor is invoked, THE Transform Executor SHALL parse `config.mapping` as a JSON object where each key is an output field name and each value is a dot-notation path string (e.g., `"user.name"`); it SHALL traverse `input` along each path and produce a new JSON object with exactly those keys and the extracted values as output.

5. WHEN the `delay` executor is invoked, THE Delay Executor SHALL parse `config.duration_seconds` as a positive integer and call `time.Sleep` for that many seconds, honoring context cancellation; it SHALL return an empty JSON object `{}` as output on success.

6. WHEN the Executor Registry is asked for an executor by a `step_type` string that has no registered executor, THE Executor Registry SHALL return a non-nil error identifying the unrecognized type.

### Requirement 9: Statemachine Unit Tests

**User Story:** As a platform engineer, I want unit tests covering every statemachine transition, so that regressions in the core state logic are caught by CI immediately.

#### Acceptance Criteria

1. THE Statemachine Unit Tests SHALL include one test case per valid `(from, to)` pair listed in Requirement 3.2, asserting that `Transition` returns nil and that the mock DB's `UpdateStepStatus` was called with the correct arguments.

2. THE Statemachine Unit Tests SHALL include test cases for invalid transitions — at minimum one attempt from each non-terminal state to a state not in its valid-next-state set — and assert that `Transition` returns a non-nil error and that `UpdateStepStatus` was NOT called.

3. THE Statemachine Unit Tests SHALL include test cases for all three terminal states (`SUCCEEDED`, `FAILED`, `CANCELED`), each attempting at least one transition and asserting a non-nil error with no DB write.

4. THE Statemachine Unit Tests SHALL use a mock or in-memory implementation of the `DB` interface defined in Requirement 3.6, so that no live Postgres instance is required.

### Requirement 10: Integration Test — 3-Step Linear Workflow

**User Story:** As a platform engineer, I want an automated integration test that exercises the full pipeline from workflow insertion to step completion, so that correctness of the assembled system can be verified continuously.

#### Acceptance Criteria

1. THE Integration Test SHALL be located at `orchestrator/internal/integration/linear_workflow_test.go` and SHALL call `t.Skip(...)` if either the `TEST_DATABASE_URL` or `TEST_REDIS_URL` environment variable is unset.

2. THE Integration Test SHALL insert a `workflows` row whose `dag_definition` contains three linear steps: step `"a"` of type `delay` (duration 0s), step `"b"` of type `transform` (identity mapping), and step `"c"` of type `delay` (duration 0s); step `"b"` depends on `"a"`, and step `"c"` depends on `"b"`.

3. WHEN the Integration Test triggers a run for the workflow and starts in-process Orchestrator (scheduler + gRPC server) and Worker goroutines, THE Integration Test SHALL poll `step_executions` and assert that all three rows have `status = 'SUCCEEDED'` within 30 seconds.

4. THE Integration Test SHALL verify that a `workers` row exists with `status = 'ONLINE'` corresponding to the in-process worker after registration.

5. THE Integration Test SHALL clean up all inserted rows (workflow, run, step executions, worker, leases) after the test completes, regardless of pass or fail.

### Requirement 11: Build Tooling

**User Story:** As a platform engineer, I want consistent `make` targets in each service, so that CI pipelines and contributors can build, test, lint, and run services with a uniform interface.

#### Acceptance Criteria

1. THE Orchestrator Makefile SHALL exist at `orchestrator/Makefile` and define targets: `build`, `test`, `lint`, and `run`.

2. THE Worker Makefile SHALL exist at `worker/Makefile` and define targets: `build`, `test`, `lint`, and `run`.

3. WHEN `make build` is executed in the `orchestrator/` directory, THE Orchestrator Makefile SHALL run `go build -o bin/orchestrator ./cmd/orchestrator` and exit non-zero if compilation fails.

4. WHEN `make build` is executed in the `worker/` directory, THE Worker Makefile SHALL run `go build -o bin/worker ./cmd/worker` and exit non-zero if compilation fails.

5. WHEN `make test` is executed in the `orchestrator/` directory, THE Orchestrator Makefile SHALL run `go test ./...` and propagate the exit code.

6. WHEN `make test` is executed in the `worker/` directory, THE Worker Makefile SHALL run `go test ./...` and propagate the exit code.

7. WHEN `make lint` is executed in either service directory, THE Makefile SHALL run `go vet ./...` and exit non-zero on any vet error.

### Requirement 12: Go Module Names

**User Story:** As a platform engineer, I want canonical, stable Go module paths, so that internal package imports are unambiguous and consistent across both services.

#### Acceptance Criteria

1. THE Orchestrator `go.mod` file SHALL be located at `orchestrator/go.mod`, declare `module github.com/conductor/orchestrator`, and specify `go 1.22`.

2. THE Worker `go.mod` file SHALL be located at `worker/go.mod`, declare `module github.com/conductor/worker`, and specify `go 1.22`.

### Requirement 13: Proto Definition

**User Story:** As a platform engineer, I want the gRPC service contract defined in a single proto file committed to the repository, so that both the orchestrator and worker compile against the same generated types without requiring `protoc` at build time.

#### Acceptance Criteria

1. THE Proto File SHALL be located at `shared/proto/conductor.proto`, declare `syntax = "proto3"`, `package conductor`, and `option go_package = "github.com/conductor/orchestrator/shared/proto/conductorpb"`.

2. THE Proto File SHALL define `OrchestratorService` with exactly three RPCs matching the architecture contract:
   - `rpc RegisterWorker(RegisterWorkerRequest) returns (stream TaskAssignment);`
   - `rpc AckTask(AckTaskRequest) returns (AckTaskResponse);`
   - `rpc Heartbeat(HeartbeatRequest) returns (HeartbeatResponse);`

3. THE Proto File SHALL define all six message types — `RegisterWorkerRequest`, `TaskAssignment`, `AckTaskRequest`, `AckTaskResponse`, `HeartbeatRequest`, `HeartbeatResponse` — with field names, types, and field numbers matching the architecture document exactly.

4. THE Repository SHALL contain pre-generated Go stubs at `shared/proto/conductorpb/conductor.pb.go` and `shared/proto/conductorpb/conductor_grpc.pb.go`, committed as source files, so that neither service requires `protoc` or `protoc-gen-go` to build.
