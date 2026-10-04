package statemachine_test

import (
	"context"
	"errors"
	"testing"

	"github.com/conductor/orchestrator/internal/statemachine"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockDB implements statemachine.DB using an in-memory map.
type mockDB struct {
	statuses map[string]string
	updated  bool // tracks if UpdateStepStatus was called
}

func newMockDB(stepID, status string) *mockDB {
	return &mockDB{statuses: map[string]string{stepID: status}}
}

func (m *mockDB) GetStepStatus(_ context.Context, stepID string) (string, error) {
	s, ok := m.statuses[stepID]
	if !ok {
		return "", errors.New("step not found")
	}
	return s, nil
}

func (m *mockDB) UpdateStepStatus(_ context.Context, stepID, newStatus string) error {
	if _, ok := m.statuses[stepID]; !ok {
		return errors.New("step not found")
	}
	m.statuses[stepID] = newStatus
	m.updated = true
	return nil
}

const testID = "test-step-id"

// TestValidTransitions tests all 9 valid (from, to) pairs.
func TestValidTransitions(t *testing.T) {
	cases := []struct {
		from string
		to   string
	}{
		{"PENDING", "QUEUED"},
		{"PENDING", "CANCELED"},
		{"QUEUED", "RUNNING"},
		{"QUEUED", "CANCELED"},
		{"RUNNING", "SUCCEEDED"},
		{"RUNNING", "FAILED"},
		{"RUNNING", "RETRYING"},
		{"RUNNING", "CANCELED"},
		{"RETRYING", "QUEUED"},
		{"RETRYING", "CANCELED"},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.from+"->"+tc.to, func(t *testing.T) {
			db := newMockDB(testID, tc.from)
			err := statemachine.Transition(context.Background(), db, testID, tc.to)
			require.NoError(t, err, "valid transition should not return error")
			assert.Equal(t, tc.to, db.statuses[testID], "status should be updated in DB")
			assert.True(t, db.updated, "UpdateStepStatus should have been called")
		})
	}
}

// TestInvalidTransitions tests that invalid (from, to) pairs return an error without DB mutation.
func TestInvalidTransitions(t *testing.T) {
	cases := []struct {
		from string
		to   string
	}{
		{"PENDING", "RUNNING"},   // PENDING can't jump directly to RUNNING
		{"PENDING", "SUCCEEDED"}, // PENDING can't jump to terminal states
		{"PENDING", "FAILED"},
		{"PENDING", "RETRYING"},
		{"QUEUED", "PENDING"},   // no backward transitions
		{"QUEUED", "SUCCEEDED"},
		{"QUEUED", "FAILED"},
		{"QUEUED", "RETRYING"},
		{"RUNNING", "PENDING"},
		{"RUNNING", "QUEUED"},
		{"RETRYING", "RUNNING"},
		{"RETRYING", "SUCCEEDED"},
		{"RETRYING", "FAILED"},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.from+"->"+tc.to, func(t *testing.T) {
			db := newMockDB(testID, tc.from)
			err := statemachine.Transition(context.Background(), db, testID, tc.to)
			require.Error(t, err, "invalid transition should return error")
			assert.Equal(t, tc.from, db.statuses[testID], "status should NOT be changed for invalid transition")
			assert.False(t, db.updated, "UpdateStepStatus should NOT have been called")
		})
	}
}

// TestTerminalStateTransitions tests that terminal states reject all transitions.
func TestTerminalStateTransitions(t *testing.T) {
	terminals := []string{"SUCCEEDED", "FAILED", "CANCELED"}
	targets := []string{"PENDING", "QUEUED", "RUNNING", "RETRYING", "SUCCEEDED"}

	for _, from := range terminals {
		for _, to := range targets {
			from, to := from, to
			t.Run(from+"->"+to, func(t *testing.T) {
				db := newMockDB(testID, from)
				err := statemachine.Transition(context.Background(), db, testID, to)
				require.Error(t, err, "transition from terminal state should return error")
				assert.Equal(t, from, db.statuses[testID], "terminal state should not be changed")
				assert.False(t, db.updated, "UpdateStepStatus should NOT have been called")
			})
		}
	}
}

// TestTransition_StepNotFound verifies that a missing step ID returns an error.
func TestTransition_StepNotFound(t *testing.T) {
	db := newMockDB("other-id", "PENDING")
	err := statemachine.Transition(context.Background(), db, "missing-id", "QUEUED")
	require.Error(t, err)
	assert.False(t, db.updated)
}
