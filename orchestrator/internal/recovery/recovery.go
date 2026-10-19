// Package recovery implements the one-time startup procedure that reconciles
// Postgres state with the Redis task queue after an orchestrator restart.
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
// errors are logged and skipped.
func Recover(ctx context.Context, database *db.DB, redisClient *redis.Client) error {
// Step 1: Re-push all QUEUED steps to Redis (lost on crash).
queued, err := database.GetQueuedSteps(ctx)
if err != nil {
return fmt.Errorf("recovery: get queued steps: %w", err)
}
for _, step := range queued {
if err := redisClient.PushTask(ctx, step.ID); err != nil {
log.Printf("recovery: push queued step %s: %v", step.ID, err)
}
}
log.Printf("recovery: re-pushed %d QUEUED steps", len(queued))

// Step 2: Handle RUNNING steps whose lease has expired.
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
_ = database.DeleteLease(ctx, el.StepExecutionID)
continue
}
} else {
if err := statemachine.Transition(ctx, database, el.StepExecutionID, "FAILED"); err != nil {
log.Printf("recovery: transition step %s to FAILED: %v", el.StepExecutionID, err)
_ = database.DeleteLease(ctx, el.StepExecutionID)
continue
}
}
if err := database.DeleteLease(ctx, el.StepExecutionID); err != nil {
log.Printf("recovery: delete lease step %s: %v", el.StepExecutionID, err)
}
}
log.Printf("recovery: processed %d expired leases", len(expired))

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
log.Printf("recovery: push retrying step %s: %v", step.ID, err)
}
}
log.Printf("recovery: promoted %d elapsed RETRYING steps", len(retrying))

return nil
}
