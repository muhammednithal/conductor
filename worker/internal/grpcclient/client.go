// Package grpcclient implements the gRPC connection to the orchestrator,
// task stream consumption, heartbeat loop, and executor dispatch.
package grpcclient

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/conductor/orchestrator/shared/proto/conductorpb"
	"github.com/conductor/worker/internal/executor"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// Client manages the gRPC connection to the orchestrator and all active task executions.
type Client struct {
	conn        *grpc.ClientConn
	stub        conductorpb.OrchestratorServiceClient
	workerID    string
	hostname    string
	executors   *executor.Registry
	activeTasks sync.Map // map[stepExecutionID string] -> context.CancelFunc
}

// New dials the orchestrator and returns a Client.
func New(orchestratorAddr, workerID, hostname string, executors *executor.Registry) (*Client, error) {
	conn, err := grpc.Dial(orchestratorAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("grpcclient: dial %s: %w", orchestratorAddr, err)
	}
	return &Client{
		conn:      conn,
		stub:      conductorpb.NewOrchestratorServiceClient(conn),
		workerID:  workerID,
		hostname:  hostname,
		executors: executors,
	}, nil
}

// Close closes the underlying gRPC connection.
func (c *Client) Close() error {
	return c.conn.Close()
}

// Run registers with the orchestrator, starts the heartbeat loop, and
// processes incoming TaskAssignment messages until ctx is cancelled.
func (c *Client) Run(ctx context.Context) error {
	req := &conductorpb.RegisterWorkerRequest{
		WorkerId: c.workerID,
		Hostname: c.hostname,
		Capacity: 1, // M1: single goroutine
	}
	stream, err := c.stub.RegisterWorker(ctx, req)
	if err != nil {
		return fmt.Errorf("grpcclient: register worker: %w", err)
	}

	go c.heartbeatLoop(ctx)

	for {
		assignment, err := stream.Recv()
		if err != nil {
			if ctx.Err() != nil {
				return nil // normal shutdown
			}
			return fmt.Errorf("grpcclient: recv: %w", err)
		}
		go c.executeTask(ctx, assignment)
	}
}

// executeTask runs a single task in its own goroutine, calls AckTask when done.
func (c *Client) executeTask(ctx context.Context, a *conductorpb.TaskAssignment) {
	taskCtx, cancel := context.WithCancel(ctx)
	c.activeTasks.Store(a.StepExecutionId, cancel)
	defer func() {
		c.activeTasks.Delete(a.StepExecutionId)
		cancel()
	}()

	exec, err := c.executors.Lookup(a.StepType)
	if err != nil {
		c.ackFailed(ctx, a, err.Error())
		return
	}

	output, err := exec.Execute(taskCtx, a.Input, a.Config)
	if err != nil {
		if taskCtx.Err() != nil {
			c.ackCanceled(ctx, a)
		} else {
			c.ackFailed(ctx, a, err.Error())
		}
		return
	}
	c.ackSucceeded(ctx, a, output)
}

// heartbeatLoop sends a Heartbeat RPC every 10 seconds.
func (c *Client) heartbeatLoop(ctx context.Context) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			var ids []string
			c.activeTasks.Range(func(k, _ any) bool {
				ids = append(ids, k.(string))
				return true
			})
			resp, err := c.stub.Heartbeat(ctx, &conductorpb.HeartbeatRequest{
				WorkerId: c.workerID,
				TaskIds:  ids,
			})
			if err != nil {
				log.Printf("grpcclient: heartbeat error: %v", err)
				continue
			}
			// Cancel tasks the orchestrator wants stopped.
			for _, canceledID := range resp.CanceledTaskIds {
				if cancelFn, ok := c.activeTasks.Load(canceledID); ok {
					cancelFn.(context.CancelFunc)()
				}
			}
		}
	}
}

func (c *Client) ackSucceeded(ctx context.Context, a *conductorpb.TaskAssignment, output []byte) {
	_, err := c.stub.AckTask(ctx, &conductorpb.AckTaskRequest{
		TaskId:   a.StepExecutionId,
		WorkerId: c.workerID,
		Status:   "SUCCEEDED",
		Output:   output,
	})
	if err != nil {
		log.Printf("grpcclient: ack succeeded %s: %v", a.StepExecutionId, err)
	}
}

func (c *Client) ackFailed(ctx context.Context, a *conductorpb.TaskAssignment, errMsg string) {
	_, err := c.stub.AckTask(ctx, &conductorpb.AckTaskRequest{
		TaskId:       a.StepExecutionId,
		WorkerId:     c.workerID,
		Status:       "FAILED",
		ErrorMessage: errMsg,
	})
	if err != nil {
		log.Printf("grpcclient: ack failed %s: %v", a.StepExecutionId, err)
	}
}

func (c *Client) ackCanceled(ctx context.Context, a *conductorpb.TaskAssignment) {
	_, err := c.stub.AckTask(ctx, &conductorpb.AckTaskRequest{
		TaskId:   a.StepExecutionId,
		WorkerId: c.workerID,
		Status:   "CANCELED",
	})
	if err != nil {
		log.Printf("grpcclient: ack canceled %s: %v", a.StepExecutionId, err)
	}
}
