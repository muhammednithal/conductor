# Implementation Plan: M2 — Reliable DAG Execution with Fault Tolerance

## Overview

Implement shared backoff extraction, DB query helpers, lease reclaim loop, crash recovery, main.go wiring, and three integration tests that verify diamond DAG execution, worker-kill reclaim, and crash recovery.

## Tasks

- [ ] 1. Add DB helpers: GetExpiredLeases and GetQueuedSteps to orchestrator/internal/db/db.go
  - Add `ExpiredLease` struct with fields `LeaseID`, `StepExecutionID`, `WorkerID`, `AttemptCount`, `MaxAttempts`
  - Add `GetExpiredLeases(ctx context.Context) ([]ExpiredLease, error)` — SELECT from `leases` JOIN `step_executions` WHERE `expires_at < NOW()`
  - Add `GetQueuedSteps(ctx context.Context) ([]StepExecution, error)` — SELECT all `step_executions` WHERE `status = 'QUEUED'`; reuse existing `scanStepRows` helper
  - _Requirements: 4.1, 4.2, 4.3, 5.1, 5.2_

- [ ] 2. Extract backoff to orchestrator/internal/backoff/backoff.go; update grpcserver to import it
  - Create new package `backoff` with exported `Compute(attempt int) time.Duration` using the formula `min(1s × 2^attempt, 300s) × uniform(0.8, 1.2)` — identical logic to the existing private `computeBackoff` in `grpcserver/server.go`
  - Delete `computeBackoff` from `grpcserver/server.go`; replace both call sites with `backoff.Compute(step.AttemptCount)`
  - _Requirements: 2.1, 2.4_

- [ ] 3. Implement lease reclaimer: orchestrator/internal/lease/reclaimer.go
  - Create `Reclaimer` struct with `db *db.DB` and `redis *redis.Client` fields
  - Implement `New(database *db.DB, redisClient *redis.Client) *Reclaimer` constructor
  - Implement `Run(ctx context.Context)` with a `time.NewTicker(15 * time.Second)` loop
  - Each tick: call `db.GetExpiredLeases(ctx)`; for each `ExpiredLease` — if `attempt_count < max_attempts` call `db.SetStepScheduledAfter` with `backoff.Compute(attempt_count)`, then `statemachine.Transition(RETRYING)`; otherwise call `statemachine.Transition(FAILED)`; always call `db.DeleteLease` last
  - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [ ] 4. Implement crash recovery: orchestrator/internal/recovery/recovery.go
  - Create `Recover(ctx context.Context, database *db.DB, redisClient *redis.Client) error`
  - Step 1: `database.GetQueuedSteps(ctx)` → `redisClient.PushTask(ctx, step.ID)` for each; log and continue on individual push errors
  - Step 2: `database.GetExpiredLeases(ctx)` → apply same RETRYING/FAILED logic as the Reclaimer (using `backoff.Compute`), always `DeleteLease` after; log and continue on individual step errors
  - Step 3: `database.GetRetryingReadySteps(ctx)` → `statemachine.Transition(ctx, database, step.ID, "QUEUED")` then `redisClient.PushTask(ctx, step.ID)` for each; log and continue on individual step errors
  - Return a wrapped error only if a batch query (GetQueuedSteps, GetExpiredLeases, GetRetryingReadySteps) fails entirely
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [ ] 5. Wire reclaimer and recovery into orchestrator/cmd/orchestrator/main.go
  - Import `github.com/conductor/orchestrator/internal/lease` and `github.com/conductor/orchestrator/internal/recovery`
  - After `database.RunMigrations` and before the scheduler goroutine: call `recovery.Recover(ctx, database, redisClient)`; fatal on error
  - After the scheduler goroutine: start `lease.New(database, redisClient).Run(ctx)` in a new goroutine with matching log lines
  - _Requirements: 4.1, 5.4_

- [ ] 6. Integration test: diamond DAG (orchestrator/internal/integration/diamond_dag_test.go)
  - Add `//go:build integration` tag and package declaration matching existing `linear_workflow_test.go`
  - DAG: A (delay 0s) → B (delay 0s), A → C (delay 0s), then B+C → D (delay 0s) — four steps total
  - Wire an in-process orchestrator (scheduler + grpcserver + reclaimer) and in-process worker following the existing test harness pattern
  - Assert all 4 steps reach `SUCCEEDED` within 30s using `require.Eventually`
  - _Requirements: 1.1, 1.2, 1.3_

- [ ] 7. Integration test: worker kill + reclaim (orchestrator/internal/integration/worker_kill_test.go)
  - Add `//go:build integration` tag
  - Workflow: single `delay` step with `duration_seconds: 5`; `max_attempts: 3`
  - Start orchestrator (with reclaimer) and Worker 1; wait for the step to reach `RUNNING`
  - Cancel Worker 1's context (simulating process kill); lease stops renewing
  - Start Worker 2 with a fresh context
  - Assert: within 45s the step reaches `SUCCEEDED` via Worker 2
  - _Requirements: 4.1, 4.2, 4.5_

- [ ] 8. Integration test: crash recovery (orchestrator/internal/integration/crash_recovery_test.go)
  - Add `//go:build integration` tag
  - Insert a workflow run with 2 steps (A → B, both delay 0s); manually INSERT step A with `status = 'QUEUED'` directly via `database.Pool().Exec` — do NOT call `redis.PushTask`
  - Call `recovery.Recover(ctx, database, redisClient)` directly
  - Start scheduler + worker (no reclaimer needed for this test)
  - Assert both steps reach `SUCCEEDED` within 30s
  - _Requirements: 5.1, 5.3_

- [ ] 9. Final checkpoint: go build, go vet, go test ./... pass in orchestrator/
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All state transitions MUST go through `statemachine.Transition` — never update `step_executions.status` directly via SQL
- Do not edit `orchestrator/migrations/001_initial.sql`; add a new numbered migration file if any schema change is needed
- Integration tests require `TEST_DATABASE_URL` and `TEST_REDIS_URL` env vars; run with `go test -tags integration -timeout 120s ./internal/integration/...`
- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2"] },
    { "id": 1, "tasks": ["3", "4"] },
    { "id": 2, "tasks": ["5"] },
    { "id": 3, "tasks": ["6", "7", "8"] },
    { "id": 4, "tasks": ["9"] }
  ]
}
```
