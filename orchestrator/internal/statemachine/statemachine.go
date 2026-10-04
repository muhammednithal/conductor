// Package statemachine is the sole authority for updating step_executions.status.
// No other package may write this column directly via SQL.
package statemachine

import (
	"context"
	"fmt"
)

// DB is the minimal database interface required by the statemachine package.
// Only this package calls UpdateStepStatus; all others read via their own queries.
type DB interface {
	// GetStepStatus returns the current status of the step execution identified by stepID.
	// Returns an error wrapping sql.ErrNoRows (or pgx equivalent) when the step does not exist.
	GetStepStatus(ctx context.Context, stepID string) (string, error)

	// UpdateStepStatus executes UPDATE step_executions SET status=$2 WHERE id=$1.
	// Returns an error if zero rows are matched (step not found or concurrent update).
	UpdateStepStatus(ctx context.Context, stepID, newStatus string) error
}

// validTransitions maps each non-terminal status to the set of valid target statuses.
// Terminal states (SUCCEEDED, FAILED, CANCELED) intentionally absent — lookups on them
// return a nil inner map, which Transition treats as "no valid transitions."
var validTransitions = map[string]map[string]bool{
	"PENDING":  {"QUEUED": true, "CANCELED": true},
	"QUEUED":   {"RUNNING": true, "CANCELED": true},
	"RUNNING":  {"SUCCEEDED": true, "FAILED": true, "RETRYING": true, "CANCELED": true},
	"RETRYING": {"QUEUED": true, "CANCELED": true},
}

// Transition atomically moves the step execution identified by stepID to newStatus.
// It returns a descriptive error if the transition is invalid or the row is not found.
// It is the only function permitted to call db.UpdateStepStatus.
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
