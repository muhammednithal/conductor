# Design Document: M2 — Reliable DAG Execution with Fault Tolerance

## Overview

M2 adds three net-new packages to the orchestrator, two new DB helper functions, and three integration tests. The core data model and gRPC API are unchanged. All state transitions continue to go exclusively through the `statemachine` package.

| New package | Path | Purpose |
|---|---|---|
| `backoff` | `orchestrator/internal/backoff/backoff.go` | Canonical exponential-backoff formula; replaces the private `computeBackoff` in `grpcserver` |
| `lease` | `orchestrator/internal/lease/reclaimer.go` | 15-second ticker that reclaims expired leases |
| `recovery` | `orchestrator/internal/recovery/recovery.go` | One-shot startup function that reconciles Postgres state with Redis |

Updated files:

| File | Change |
|---|---|
| `orchestrator/internal/db/db.go` | + `GetExpiredLeases`, `GetQueuedSteps`, `ExpiredLease` struct |
| `orchestrator/internal/grpcserver/server.go` | Remove inline `computeBackoff`; import `backoff.Compute` |
| `orchestrator/cmd/orchestrator/main.go` | Call `recovery.Recover` before goroutines; start `lease.Reclaimer` goroutine |

New test files (all `//go:build integration`):

| File | Test |
|---|---|
| `orchestrator/internal/integration/diamond_dag_test.go` | `TestDiamondDAG` |
| `orchestrator/internal/integration/worker_kill_test.go` | `TestWorkerKillReclaim` |
| `orchestrator/internal/integration/crash_recovery_test.go` | `TestCrashRecovery` |

## Package Structure

```
orchestrator/
├── cmd/orchestrator/main.go          (UPDATED)
└── internal/
    ├── backoff/backoff.go            (NEW)
    ├── db/db.go                      (UPDATED)
    ├── grpcserver/server.go          (UPDATED)
    ├── lease/reclaimer.go            (NEW)
    ├── recovery/recovery.go          (NEW)
    ├── scheduler/scheduler.go        (unchanged)
    ├── statemachine/statemachine.go  (unchanged)
    └── integration/
        ├── linear_workflow_test.go   (existing)
        ├── diamond_dag_test.go       (NEW)
        ├── worker_kill_test.go       (NEW)
        └── crash_recovery_test.go   (NEW)
```

## Component Design

### Backoff Package

Extracted from the private `computeBackoff` function that currently lives in `grpcserver/server.go`. Moving it to its own package removes the duplication risk and makes the formula testable in isolation.

```go
// orchestrator/internal/backoff/backoff.go
package backoff

import (
    "math"
    "math/rand"
    "time"
)

// Compute returns the retry delay for the given 0-indexed attempt number.
// Formula: min(1s * 2^attempt, 300s) * uniform(0.8, 1.2)
func Compute(attempt int) time.Duration {
    base := float64(time.Second)
    capped := math.Min(base*math.Pow(2, float64(attempt)), float64(300*time.Second))
    jitter := 0.8 + rand.Float64()*0.4 // uniform [0.8, 1.2]
    return time.Duration(capped * jitter)
}
```

After extraction, `grpcserver/server.go` replaces:
```go
// remove: computeBackoff(attempt) function definition
// replace call sites with:
delay := backoff.Compute(step.AttemptCount)
```

### DB Helpers

Two new methods on `*DB` in `orchestrator/internal/db/db.go`:

```go
// ExpiredLease carries the fields needed by the reclaimer and recovery procedures.
type ExpiredLease struct {
    LeaseID         string
    StepExecutionID string
    WorkerID        string
    AttemptCount    int
    MaxAttempts     int
}

// GetExpiredLeases returns all lease rows with expires_at < NOW(),
// joined with the step_execution for attempt_count and max_attempts.
func (d *DB) GetExpiredLeases(ctx context.Context) ([]ExpiredLease, error) {
    rows, err := d.pool.Query(ctx, `
        SELECT l.id, l.step_execution_id, l.worker_id,
               se.attempt_count, se.max_attempts
        FROM leases l
        JOIN step_executions se ON se.id = l.step_execution_id
        WHERE l.expires_at < NOW()
    `)
    if err != nil {
        return nil, fmt.Errorf("db: get expired leases: %w", err)
    }
    defer rows.Close()
    var leases []ExpiredLease
    for rows.Next() {
        var el ExpiredLease
        if err := rows.Scan(
            &el.LeaseID, &el.StepExecutionID, &el.WorkerID,
            &el.AttemptCount, &el.MaxAttempts,
        ); err != nil {
            return nil, fmt.Errorf("db: scan expired lease: %w", err)
        }
        leases = append(leases, el)
    }
    return leases, rows.Err()
}

// GetQueuedSteps returns all step_executions with status = 'QUEUED'.
func (d *DB) GetQueuedSteps(ctx context.Context) ([]StepExecution, error) {
    rows, err := d.pool.Query(ctx, `
        SELECT id, run_id, step_name, step_type, status,
               attempt_count, max_attempts, idempotency_key,
               input, output, COALESCE(error_msg, ''),
               scheduled_after, started_at, completed_at
        FROM step_executions
        WHERE status = 'QUEUED'
    `)
    if err != nil {
        return nil, fmt.Errorf("db: get queued steps: %w", err)
    }
    defer rows.Close()
    return scanStepRows(rows)
}
```

### Lease Reclaimer

Runs a 15-second ticker loop. Each tick fetches expired leases and applies the RETRYING/FAILED routing, always deleting the lease row last.

```go
// orchestrator/internal/lease/reclaimer.go
package lease

import (
    "context"
    "log"
    "time"

    "github.com/conductor/orchestrator/internal/backoff"
    "github.com/conductor/orchestrator/internal/db"
    "github.com/conductor/orchestrator/internal/redis"
    "github.com/conductor/orchestrator/internal/statemachine"
)

// Reclaimer periodically detects and reclaims expired leases.
type Reclaimer struct {
    db    *db.DB
    redis *redis.Client
}

// New creates a Reclaimer with the given DB and Redis client.
func New(database *db.DB, redisClient *redis.Client) *Reclaimer {
    return &Reclaimer{db: database, redis: redisClient}
}

// Run starts the reclaim loop; blocks until ctx is cancelled.
func (r *Reclaimer) Run(ctx context.Context) {
    ticker := time.NewTicker(15 * time.Second)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            r.reclaim(ctx)
        }
    }
}

func (r *Reclaimer) reclaim(ctx context.Context) {
    expired, err := r.db.GetExpiredLeases(ctx)
    if err != nil {
        log.Printf("reclaimer: get expired leases: %v", err)
        return
    }
    for _, el := range expired {
        if el.AttemptCount < el.MaxAttempts {
            delay := backoff.Compute(el.AttemptCount)
            if err := r.db.SetStepScheduledAfter(ctx, el.StepExecutionID, time.Now().Add(delay)); err != nil {
                log.Printf("reclaimer: set scheduled_after step %s: %v", el.StepExecutionID, err)
            }
            if err := statemachine.Transition(ctx, r.db, el.StepExecutionID, "RETRYING"); err != nil {
                log.Printf("reclaimer: transition step %s to RETRYING: %v", el.StepExecutionID, err)
            }
        } else {
            if err := statemachine.Transition(ctx, r.db, el.StepExecutionID, "FAILED"); err != nil {
                log.Printf("reclaimer: transition step %s to FAILED: %v", el.StepExecutionID, err)
            }
        }
        // Always delete the lease, regardless of which branch was taken.
        if err := r.db.DeleteLease(ctx, el.StepExecutionID); err != nil {
            log.Printf("reclaimer: delete lease step %s: %v", el.StepExecutionID, err)
        }
    }
}
```

### Crash Recovery

Called once at startup, before the scheduler and reclaimer goroutines are launched. Three steps match the three recovery cases in the architecture document.

```go
// orchestrator/internal/recovery/recovery.go
package recovery

import (
    "context"
    "fmt"
    "log"
    "time"

    "github.com/conductor/orchestrator/internal/backoff"
    "github.com/conductor/orchestrator/internal/db"
    "github.com/conductor/orchestrator/internal/redis"
    "github.com/conductor/orchestrator/internal/statemachine"
)

// Recover reconciles Postgres state with the Redis task queue.
// Must be called after migrations and before starting the Scheduler or Reclaimer.
// Returns a non-nil error only if a batch query fails entirely; individual step
// errors are logged and skipped so the procedure always processes all steps.
func Recover(ctx context.Context, database *db.DB, redisClient *redis.Client) error {
    // Step 1: Re-push all QUEUED steps to Redis (they may have been lost on crash).
    queued, err := database.GetQueuedSteps(ctx)
    if err != nil {
        return fmt.Errorf("recovery: get queued steps: %w", err)
    }
    for _, step := range queued {
        if err := redisClient.PushTask(ctx, step.ID); err != nil {
            log.Printf("recovery: push queued step %s to redis: %v", step.ID, err)
        }
    }

    // Step 2: Handle RUNNING steps whose lease has expired — same logic as Reclaimer.
    expired, err := database.GetExpiredLeases(ctx)
    if err != nil {
        return fmt.Errorf("recovery: get expired leases: %w", err)
    }
    for _, el := range expired {
        if el.AttemptCount < el.MaxAttempts {
            delay := backoff.Compute(el.AttemptCount)
            if err := database.SetStepScheduledAfter(ctx, el.StepExecutionID, time.Now().Add(delay)); err != nil {
                log.Printf("recovery: set scheduled_after step %s: %v", el.StepExecutionID, err)
            }
            if err := statemachine.Transition(ctx, database, el.StepExecutionID, "RETRYING"); err != nil {
                log.Printf("recovery: transition step %s to RETRYING: %v", el.StepExecutionID, err)
                continue
            }
        } else {
            if err := statemachine.Transition(ctx, database, el.StepExecutionID, "FAILED"); err != nil {
                log.Printf("recovery: transition step %s to FAILED: %v", el.StepExecutionID, err)
                continue
            }
        }
        if err := database.DeleteLease(ctx, el.StepExecutionID); err != nil {
            log.Printf("recovery: delete lease step %s: %v", el.StepExecutionID, err)
        }
    }

    // Step 3: Re-push RETRYING steps whose backoff delay has elapsed.
    retrying, err := database.GetRetryingReadySteps(ctx)
    if err != nil {
        return fmt.Errorf("recovery: get retrying ready steps: %w", err)
    }
    for _, step := range retrying {
        if err := statemachine.Transition(ctx, database, step.ID, "QUEUED"); err != nil {
            log.Printf("recovery: transition retrying step %s to QUEUED: %v", step.ID, err)
            continue
        }
        if err := redisClient.PushTask(ctx, step.ID); err != nil {
            log.Printf("recovery: push retrying step %s to redis: %v", step.ID, err)
        }
    }

    return nil
}
```

### main.go Changes

The two additions to `orchestrator/cmd/orchestrator/main.go`, inserted between the migrations block and the scheduler goroutine, and after the scheduler goroutine respectively:

```go
// --- Crash Recovery (before scheduler and reclaimer goroutines) ---
if err := recovery.Recover(ctx, database, redisClient); err != nil {
    log.Fatalf("orchestrator: crash recovery: %v", err)
}
log.Printf("orchestrator: crash recovery complete")

// --- Scheduler (existing) ---
sched := scheduler.New(database, redisClient)
go func() {
    log.Printf("orchestrator: scheduler starting")
    sched.Run(ctx)
    log.Printf("orchestrator: scheduler stopped")
}()

// --- Lease Reclaimer (new) ---
reclaimer := lease.New(database, redisClient)
go func() {
    log.Printf("orchestrator: lease reclaimer starting")
    reclaimer.Run(ctx)
    log.Printf("orchestrator: lease reclaimer stopped")
}()
```

### Integration Tests

All three tests live in `orchestrator/internal/integration/`, carry `//go:build integration`, and follow the same harness pattern as the existing `TestLinearWorkflow`: in-process orchestrator (scheduler + gRPC server + reclaimer) and in-process worker.

#### TestDiamondDAG (`diamond_dag_test.go`)

DAG shape: A → B, A → C, B+C → D (all `delay` steps with `duration_seconds: 0`).

Key assertions:
- After setup, only step A is eligible (no deps); B, C, D remain PENDING.
- After A succeeds, B and C both become eligible simultaneously (fan-out).
- D only becomes eligible after both B and C succeed (fan-in).
- All 4 steps reach SUCCEEDED within 30s.

#### TestWorkerKillReclaim (`worker_kill_test.go`)

Setup:
- Single workflow with one `delay` step (`duration_seconds: 5`).
- Start orchestrator (scheduler + grpcserver + reclaimer).
- Start Worker 1 — it picks up the step and acquires a lease.
- Cancel Worker 1's context (simulating process kill); the lease is no longer renewed.

Assertions:
- Within 45s (lease TTL 30s + reclaim scan 15s), the step must be reclaimed.
- Start Worker 2 after Worker 1 is killed; the step must reach SUCCEEDED via Worker 2.

#### TestCrashRecovery (`crash_recovery_test.go`)

Setup:
- Insert a workflow run with 2 steps (A → B, both `delay` with 0s).
- Manually set step A to QUEUED directly in the DB — do **not** push to Redis.
- Call `recovery.Recover(ctx, db, redis)` directly.
- Start scheduler + worker.

Assertions:
- Both steps reach SUCCEEDED within 30s.
- Confirms Recovery re-populated Redis from Postgres without manual intervention.

## Error Handling

| Scenario | Handler | Behaviour |
|---|---|---|
| `GetExpiredLeases` query fails | Reclaimer tick | Log; skip this tick; retry next tick |
| `GetExpiredLeases` query fails | Recovery | Return wrapped error; `main` fatals |
| `statemachine.Transition` fails | Reclaimer / Recovery | Log; continue to next lease |
| `SetStepScheduledAfter` fails | Reclaimer / Recovery | Log; continue (transition still attempted) |
| `DeleteLease` fails | Reclaimer / Recovery | Log; continue (lease will be re-processed on next scan) |
| `PushTask` fails during Recovery | Recovery | Log; continue (Scheduler will re-queue on next tick via `GetRetryingReadySteps`) |
| `GetQueuedSteps` fails | Recovery | Return wrapped error; `main` fatals |

## Timing Parameters

| Parameter | Value | Owner |
|---|---|---|
| Lease duration | 30 seconds | `grpcserver.RegisterWorker` |
| Heartbeat interval | 10 seconds | Worker |
| Reclaim scan interval | 15 seconds | `lease.Reclaimer` |
| Worst-case reclaim latency | ≤ 45 seconds | lease TTL + one scan interval |
| Backoff base | 1 second | `backoff.Compute` |
| Backoff cap | 300 seconds | `backoff.Compute` |
| Backoff jitter | ±20% uniform | `backoff.Compute` |

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Dependency Gate

*For any* step with N entries in `depends_on` and any assignment of statuses to those N dependencies, the Scheduler's readiness predicate returns true if and only if every dependency has status `SUCCEEDED`; for any other mix of statuses, the predicate returns false and the step remains in `PENDING`.

**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: Backoff Range

*For any* 0-indexed attempt count `n ≥ 0`, `backoff.Compute(n)` returns a duration `d` satisfying `0.8 × min(1s × 2^n, 300s) ≤ d ≤ 1.2 × min(1s × 2^n, 300s)`.

**Validates: Requirements 2.1**

### Property 3: Retry/Fail Routing

*For any* step with attempt count `a` and max-attempts limit `m`, when an expired lease or a FAILED ack is processed, the step is transitioned to `RETRYING` when `a < m` and to `FAILED` when `a >= m`.

**Validates: Requirements 2.2, 2.3, 4.2, 4.3**

### Property 4: Lease Cleanup Invariant

*For any* expired lease processed by the Reclaimer, the `leases` row for that step execution is absent from the database after processing completes, regardless of whether the step was routed to `RETRYING` or `FAILED`.

**Validates: Requirements 4.4**

### Property 5: Recovery Queue Restoration

*For any* set of step executions with `status = 'QUEUED'` present in Postgres before `Recover` is called, every step execution ID in that set is present in the Redis task queue after `Recover` returns.

**Validates: Requirements 5.1**

### Property 6: Recovery Retry Promotion

*For any* step execution with `status = 'RETRYING'` and `scheduled_after ≤ NOW()` present in Postgres before `Recover` is called, the step execution has `status = 'QUEUED'` and its ID is present in the Redis task queue after `Recover` returns.

**Validates: Requirements 5.3**
