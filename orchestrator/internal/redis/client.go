// Package redis provides a thin wrapper around go-redis for the conductor:tasks queue.
package redis

import (
	"context"
	"fmt"
	"time"

	goredis "github.com/redis/go-redis/v9"
)

const taskQueueKey = "conductor:tasks"

// Client wraps a go-redis client for task queue operations.
type Client struct {
	rdb *goredis.Client
}

// NewClient creates a new Redis client connected to the given address.
func NewClient(addr string) *Client {
	rdb := goredis.NewClient(&goredis.Options{
		Addr: addr,
	})
	return &Client{rdb: rdb}
}

// Close closes the underlying Redis connection.
func (c *Client) Close() error {
	return c.rdb.Close()
}

// Ping verifies the connection is live.
func (c *Client) Ping(ctx context.Context) error {
	if err := c.rdb.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("redis: ping: %w", err)
	}
	return nil
}

// PushTask appends a step execution ID to the right end of conductor:tasks.
func (c *Client) PushTask(ctx context.Context, stepExecutionID string) error {
	if err := c.rdb.RPush(ctx, taskQueueKey, stepExecutionID).Err(); err != nil {
		return fmt.Errorf("redis: push task %s: %w", stepExecutionID, err)
	}
	return nil
}

// PopTask blocks until a step execution ID is available or timeout elapses.
// Returns ("", nil) on timeout (no item available within timeout duration).
// Returns (id, nil) when an item is successfully dequeued.
func (c *Client) PopTask(ctx context.Context, timeout time.Duration) (string, error) {
	result, err := c.rdb.BLPop(ctx, timeout, taskQueueKey).Result()
	if err == goredis.Nil {
		return "", nil // timeout, no item available
	}
	if err != nil {
		return "", fmt.Errorf("redis: pop task: %w", err)
	}
	// result[0] is the key name, result[1] is the value
	return result[1], nil
}

// FlushDB flushes the current Redis database. For testing only.
func (c *Client) FlushDB(ctx context.Context) error {
	return c.rdb.FlushDB(ctx).Err()
}

// PublishStepEvent publishes a step state change to the run's pub/sub channel.
// Channel: conductor:events:{runID}
// Payload: {"step_execution_id":"...","step_name":"...","status":"..."}
func (c *Client) PublishStepEvent(ctx context.Context, runID, stepExecutionID, stepName, status string) error {
payload := fmt.Sprintf(
`{"step_execution_id":%q,"step_name":%q,"status":%q}`,
stepExecutionID, stepName, status,
)
channel := "conductor:events:" + runID
if err := c.rdb.Publish(ctx, channel, payload).Err(); err != nil {
return fmt.Errorf("redis: publish event run %s step %s: %w", runID, stepExecutionID, err)
}
return nil
}
