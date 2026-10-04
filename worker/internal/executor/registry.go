// Package executor defines the Executor interface and Registry for step type dispatch.
package executor

import (
	"context"
	"encoding/json"
	"fmt"
)

// Executor executes a single workflow step.
type Executor interface {
	Execute(ctx context.Context, input json.RawMessage, config json.RawMessage) (json.RawMessage, error)
}

// Registry maps step type strings to their Executor implementations.
type Registry struct {
	m map[string]Executor
}

// NewRegistry creates an empty Registry.
func NewRegistry() *Registry {
	return &Registry{m: make(map[string]Executor)}
}

// Register adds an executor for the given step type string.
func (r *Registry) Register(stepType string, e Executor) {
	r.m[stepType] = e
}

// Lookup returns the Executor for the given step type.
// Returns a descriptive error for unrecognised types.
func (r *Registry) Lookup(stepType string) (Executor, error) {
	e, ok := r.m[stepType]
	if !ok {
		return nil, fmt.Errorf("executor: unknown step type %q", stepType)
	}
	return e, nil
}
