// Package scheduler implements the step scheduling loop.
// It advances PENDING steps to QUEUED when their dependencies are satisfied,
// and re-queues RETRYING steps whose backoff delay has elapsed.
package scheduler

import (
	"context"
	"log"
	"time"

	"github.com/conductor/orchestrator/internal/db"
	"github.com/conductor/orchestrator/internal/redis"
	"github.com/conductor/orchestrator/internal/statemachine"
)

// Scheduler polls the database on a 1-second tick and advances ready steps.
type Scheduler struct {
	db    *db.DB
	redis *redis.Client
}

// New creates a new Scheduler.
func New(database *db.DB, redisClient *redis.Client) *Scheduler {
	return &Scheduler{db: database, redis: redisClient}
}

// Run starts the scheduler loop. It blocks until ctx is cancelled.
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

// advancePendingSteps queries for PENDING steps whose dependencies are all SUCCEEDED
// and transitions them to QUEUED, then pushes their IDs to Redis.
func (s *Scheduler) advancePendingSteps(ctx context.Context) {
	steps, err := s.db.GetPendingReadySteps(ctx)
	if err != nil {
		log.Printf("scheduler: get pending ready steps: %v", err)
		return
	}
	for _, step := range steps {
		if err := statemachine.Transition(ctx, s.db, step.ID, "QUEUED"); err != nil {
			log.Printf("scheduler: transition step %s to QUEUED: %v", step.ID, err)
			continue
		}
		if err := s.redis.PushTask(ctx, step.ID); err != nil {
			// Step is now QUEUED in DB; next iteration will not re-push unless
			// we detect it — for M1 simplicity, log and move on.
			// A more robust implementation would use a QUEUED scan loop.
			log.Printf("scheduler: push task %s to Redis: %v", step.ID, err)
		}
	}
}

// requeueRetryingSteps transitions RETRYING steps whose backoff delay has elapsed
// back to QUEUED and re-pushes them to Redis.
func (s *Scheduler) requeueRetryingSteps(ctx context.Context) {
	steps, err := s.db.GetRetryingReadySteps(ctx)
	if err != nil {
		log.Printf("scheduler: get retrying ready steps: %v", err)
		return
	}
	for _, step := range steps {
		if err := statemachine.Transition(ctx, s.db, step.ID, "QUEUED"); err != nil {
			log.Printf("scheduler: transition retrying step %s to QUEUED: %v", step.ID, err)
			continue
		}
		if err := s.redis.PushTask(ctx, step.ID); err != nil {
			log.Printf("scheduler: push retrying task %s to Redis: %v", step.ID, err)
		}
	}
}
