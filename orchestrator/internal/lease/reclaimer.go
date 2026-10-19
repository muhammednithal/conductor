// Package lease implements the background lease reclaim loop.
// It scans for expired leases every 15 seconds and transitions affected
// step executions to RETRYING (with backoff) or FAILED.
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

// New creates a Reclaimer.
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
