package executor

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

type delayConfig struct {
	DurationSeconds int `json:"duration_seconds"`
}

// DelayExecutor sleeps for the configured duration, honouring context cancellation.
type DelayExecutor struct{}

// Execute sleeps for cfg.duration_seconds seconds.
// Returns an empty JSON object {} as output on success.
// Returns ctx.Err() if the context is cancelled during sleep.
func (e *DelayExecutor) Execute(ctx context.Context, input, config json.RawMessage) (json.RawMessage, error) {
	var cfg delayConfig
	if err := json.Unmarshal(config, &cfg); err != nil {
		return nil, fmt.Errorf("delay: parse config: %w", err)
	}

	select {
	case <-time.After(time.Duration(cfg.DurationSeconds) * time.Second):
		return json.RawMessage(`{}`), nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}
