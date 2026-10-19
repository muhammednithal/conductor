# Requirements Document

## Introduction

Milestone 2 extends the Conductor orchestrator to support reliable DAG execution with fault tolerance. The system must handle multi-dependency fan-out/fan-in DAG patterns, retry failed steps with exponential backoff, reclaim leases from crashed workers automatically, and recover in-flight state when the orchestrator process restarts. No changes are required to the worker, API-AI service, web dashboard, or database schema.

## Glossary

- **Scheduler**: The background goroutine in `orchestrator/internal/scheduler` that advances `PENDING` steps to `QUEUED` when their dependencies are satisfied, and re-queues `RETRYING` steps whose backoff delay has elapsed.
- **Reclaimer**: The new background goroutine in `orchestrator/internal/lease` that scans for expired leases and transitions affected steps to `RETRYING` or `FAILED`.
- **Recovery**: The one-time startup function in `orchestrator/internal/recovery` that reconciles Postgres state with the Redis task queue after an orchestrator restart.
- **Lease**: A time-bounded ownership token in the `leases` table, keyed to a step execution and a worker. Expires at `acquired_at + 30s`; renewed by worker heartbeats.
- **Step Execution**: A row in `step_executions` representing one attempt to run a workflow step, tracked by the State Machine.
- **State Machine**: The `statemachine` package — the sole authority for writing `step_executions.status`. No other package may update this column directly via SQL.
- **Backoff Package**: The new `orchestrator/internal/backoff` package exposing the canonical `Compute(attempt int) time.Duration` function.
- **OrchestratorService**: The gRPC server implemented in `orchestrator/internal/grpcserver`.
- **DB**: The `orchestrator/internal/db` package wrapping all Postgres operations.

## Requirements

### Requirement 1: Multi-dependency Fan-out/Fan-in Execution

**User Story:** As a workflow author, I want steps with multiple upstream dependencies to start only after all those dependencies complete, so that complex branching and merging DAG patterns execute correctly.

#### Acceptance Criteria

1. WHEN all steps listed in a step's `depends_on` field reach `SUCCEEDED`, THE Scheduler SHALL transition the dependent step from `PENDING` to `QUEUED` and push its step execution ID to the Redis task queue `conductor:tasks`.
2. WHILE any step listed in a step's `depends_on` field has not yet reached `SUCCEEDED`, THE Scheduler SHALL keep the dependent step in `PENDING`.
3. WHEN a step has an empty `depends_on` list, THE Scheduler SHALL transition the step from `PENDING` to `QUEUED` without waiting for any other step.

### Requirement 2: Shared Exponential Backoff

**User Story:** As a platform engineer, I want failed steps to retry with increasing delays derived from a single canonical formula, so that retry behavior is consistent regardless of which code path triggered the retry.

#### Acceptance Criteria

1. THE Backoff Package SHALL compute the retry delay for 0-indexed attempt `n` as `min(1s × 2^n, 300s) × uniform(0.8, 1.2)`, where `uniform(0.8, 1.2)` is a value drawn from a uniform distribution over [0.8, 1.2].
2. WHEN a step's `attempt_count` is less than `max_attempts` and the step fails, THE Orchestrator SHALL set `scheduled_after = NOW() + Backoff.Compute(attempt_count)` and transition the step to `RETRYING`.
3. WHEN a step's `attempt_count` is greater than or equal to `max_attempts`, THE Orchestrator SHALL transition the step to `FAILED`.
4. THE OrchestratorService `AckTask` handler and the Reclaimer SHALL both call `Backoff.Compute` from the Backoff Package to compute retry delays.

### Requirement 3: Heartbeat-based Lease Renewal

**User Story:** As a platform engineer, I want worker heartbeats to extend lease expiry, so that healthy workers are not falsely reclaimed while their steps are still running.

#### Acceptance Criteria

1. WHEN the OrchestratorService issues a lease to a worker, THE OrchestratorService SHALL set `leases.expires_at = acquired_at + 30s`.
2. WHEN a worker sends a `HeartbeatRequest` containing one or more step execution IDs, THE OrchestratorService SHALL set `leases.expires_at = NOW() + 30s` and `leases.renewed_at = NOW()` for each corresponding lease row.

### Requirement 4: Lease Expiry Detection and Reclaim

**User Story:** As a platform engineer, I want the orchestrator to automatically detect and reclaim expired leases, so that tasks from crashed or unresponsive workers are reassigned to healthy workers.

#### Acceptance Criteria

1. THE Reclaimer SHALL scan the `leases` table for rows where `expires_at < NOW()` on a 15-second interval.
2. WHEN an expired lease is detected AND the corresponding `step_executions.attempt_count < step_executions.max_attempts`, THE Reclaimer SHALL set `scheduled_after = NOW() + Backoff.Compute(attempt_count)`, transition the step to `RETRYING`, and delete the lease row.
3. WHEN an expired lease is detected AND the corresponding `step_executions.attempt_count >= step_executions.max_attempts`, THE Reclaimer SHALL transition the step to `FAILED` and delete the lease row.
4. THE Reclaimer SHALL delete the lease row after each expired lease is processed, regardless of which transition (`RETRYING` or `FAILED`) was applied.
5. WHEN a reclaimed step transitions to `RETRYING` and its `scheduled_after` timestamp elapses, THE Scheduler SHALL transition the step to `QUEUED` and push its ID to the Redis task queue.

### Requirement 5: Crash Recovery on Startup

**User Story:** As a platform engineer, I want the orchestrator to recover in-flight workflow state on restart, so that no step executions are permanently lost after an orchestrator process crash.

#### Acceptance Criteria

1. WHEN the Orchestrator starts, THE Recovery procedure SHALL query all step executions with `status = 'QUEUED'` and push each step execution ID to the Redis task queue.
2. WHEN the Orchestrator starts, THE Recovery procedure SHALL query all step executions in `RUNNING` state whose lease has expired or is absent, and apply the same `RETRYING`/`FAILED` routing as the Reclaimer, using `Backoff.Compute` for `scheduled_after`.
3. WHEN the Orchestrator starts, THE Recovery procedure SHALL query all step executions in `RETRYING` state where `scheduled_after <= NOW()`, transition each to `QUEUED`, and push each ID to the Redis task queue.
4. THE Recovery procedure SHALL complete before the Scheduler and Reclaimer goroutines are started.
5. IF an individual step execution fails to process during Recovery, THEN THE Recovery procedure SHALL log the error and continue processing the remaining step executions without aborting.
