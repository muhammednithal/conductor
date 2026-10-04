// Package grpcserver implements the OrchestratorService gRPC server.
package grpcserver

import (
	"context"
	"fmt"
	"log"
	"math"
	"math/rand"
	"time"

	"github.com/conductor/orchestrator/internal/db"
	"github.com/conductor/orchestrator/internal/redis"
	"github.com/conductor/orchestrator/internal/statemachine"
	"github.com/conductor/orchestrator/shared/proto/conductorpb"
	"google.golang.org/grpc/peer"
)

// Server implements the OrchestratorServiceServer gRPC interface.
type Server struct {
	conductorpb.UnimplementedOrchestratorServiceServer
	db    *db.DB
	redis *redis.Client
}

// NewServer creates a Server with the given DB and Redis client.
func NewServer(database *db.DB, redisClient *redis.Client) *Server {
	return &Server{db: database, redis: redisClient}
}

// RegisterWorker handles the server-streaming RPC.
// It upserts the worker, then loops popping tasks from Redis and streaming them.
func (s *Server) RegisterWorker(
	req *conductorpb.RegisterWorkerRequest,
	stream conductorpb.OrchestratorService_RegisterWorkerServer,
) error {
	ctx := stream.Context()

	// Determine grpc_address from stream peer info.
	grpcAddr := ""
	if p, ok := peer.FromContext(ctx); ok {
		grpcAddr = p.Addr.String()
	}

	worker := db.Worker{
		ID:          req.WorkerId,
		Hostname:    req.Hostname,
		GRPCAddress: grpcAddr,
		Status:      "ONLINE",
		Capacity:    int(req.Capacity),
	}
	if err := s.db.UpsertWorker(ctx, worker); err != nil {
		return fmt.Errorf("grpcserver: upsert worker: %w", err)
	}
	log.Printf("grpcserver: worker %s (%s) registered", req.WorkerId, req.Hostname)

	defer func() {
		offCtx := context.Background() // use background ctx since stream ctx may be cancelled
		if err := s.db.UpdateWorkerStatus(offCtx, req.WorkerId, "OFFLINE"); err != nil {
			log.Printf("grpcserver: set worker %s offline: %v", req.WorkerId, err)
		}
	}()

	for {
		select {
		case <-ctx.Done():
			return nil
		default:
		}

		stepID, err := s.redis.PopTask(ctx, 5*time.Second)
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			log.Printf("grpcserver: pop task: %v", err)
			continue
		}
		if stepID == "" {
			continue // timeout, no task available
		}

		step, err := s.db.GetStepByID(ctx, stepID)
		if err != nil {
			log.Printf("grpcserver: get step %s: %v", stepID, err)
			continue
		}

		// Create lease: expires 30 seconds from now.
		now := time.Now()
		lease := db.Lease{
			ID:              fmt.Sprintf("%s-%s", req.WorkerId, stepID),
			StepExecutionID: stepID,
			WorkerID:        req.WorkerId,
			AcquiredAt:      now,
			ExpiresAt:       now.Add(30 * time.Second),
			RenewedAt:       now,
		}
		if err := s.db.InsertLease(ctx, lease); err != nil {
			log.Printf("grpcserver: insert lease for step %s: %v", stepID, err)
			// Re-push step so it can be picked up again.
			_ = s.redis.PushTask(ctx, stepID)
			continue
		}

		if err := statemachine.Transition(ctx, s.db, stepID, "RUNNING"); err != nil {
			log.Printf("grpcserver: transition step %s to RUNNING: %v", stepID, err)
			_ = s.db.DeleteLease(ctx, stepID)
			continue
		}

		if err := s.db.IncrementStepAttempt(ctx, stepID); err != nil {
			log.Printf("grpcserver: increment attempt for step %s: %v", stepID, err)
		}

		assignment := &conductorpb.TaskAssignment{
			TaskId:          stepID,
			StepExecutionId: stepID,
			StepType:        step.StepType,
			Config:          step.Input, // config stored in input column for M1
			Input:           step.Input,
			IdempotencyKey:  step.IdempotencyKey,
		}

		if err := stream.Send(assignment); err != nil {
			log.Printf("grpcserver: send assignment for step %s: %v", stepID, err)
			// Attempt to clean up: delete lease and transition back to QUEUED.
			_ = s.db.DeleteLease(ctx, stepID)
			_ = statemachine.Transition(context.Background(), s.db, stepID, "QUEUED")
			return err
		}
	}
}

// AckTask handles the result of a step execution.
func (s *Server) AckTask(ctx context.Context, req *conductorpb.AckTaskRequest) (*conductorpb.AckTaskResponse, error) {
	switch req.Status {
	case "SUCCEEDED":
		if err := s.db.UpdateStepOutput(ctx, req.TaskId, req.Output); err != nil {
			log.Printf("grpcserver: update output step %s: %v", req.TaskId, err)
		}
		if err := statemachine.Transition(ctx, s.db, req.TaskId, "SUCCEEDED"); err != nil {
			return nil, fmt.Errorf("grpcserver: transition step %s to SUCCEEDED: %w", req.TaskId, err)
		}
		if err := s.db.DeleteLease(ctx, req.TaskId); err != nil {
			log.Printf("grpcserver: delete lease step %s: %v", req.TaskId, err)
		}

	case "FAILED":
		step, err := s.db.GetStepByID(ctx, req.TaskId)
		if err != nil {
			return nil, fmt.Errorf("grpcserver: get step %s: %w", req.TaskId, err)
		}
		if req.ErrorMessage != "" {
			_ = s.db.UpdateStepError(ctx, req.TaskId, req.ErrorMessage)
		}
		if step.AttemptCount < step.MaxAttempts {
			backoff := computeBackoff(step.AttemptCount)
			_ = s.db.SetStepScheduledAfter(ctx, req.TaskId, time.Now().Add(backoff))
			if err := statemachine.Transition(ctx, s.db, req.TaskId, "RETRYING"); err != nil {
				return nil, fmt.Errorf("grpcserver: transition step %s to RETRYING: %w", req.TaskId, err)
			}
		} else {
			if err := statemachine.Transition(ctx, s.db, req.TaskId, "FAILED"); err != nil {
				return nil, fmt.Errorf("grpcserver: transition step %s to FAILED: %w", req.TaskId, err)
			}
		}
		if err := s.db.DeleteLease(ctx, req.TaskId); err != nil {
			log.Printf("grpcserver: delete lease step %s: %v", req.TaskId, err)
		}

	case "CANCELED":
		if err := statemachine.Transition(ctx, s.db, req.TaskId, "CANCELED"); err != nil {
			return nil, fmt.Errorf("grpcserver: transition step %s to CANCELED: %w", req.TaskId, err)
		}
		if err := s.db.DeleteLease(ctx, req.TaskId); err != nil {
			log.Printf("grpcserver: delete lease step %s: %v", req.TaskId, err)
		}

	default:
		return nil, fmt.Errorf("grpcserver: unknown ack status %q", req.Status)
	}

	return &conductorpb.AckTaskResponse{Success: true}, nil
}

// Heartbeat updates the worker's heartbeat timestamp and renews step leases.
func (s *Server) Heartbeat(ctx context.Context, req *conductorpb.HeartbeatRequest) (*conductorpb.HeartbeatResponse, error) {
	if err := s.db.UpdateWorkerHeartbeat(ctx, req.WorkerId); err != nil {
		log.Printf("grpcserver: update heartbeat worker %s: %v", req.WorkerId, err)
	}

	var canceledIDs []string
	for _, taskID := range req.TaskIds {
		if err := s.db.RenewLease(ctx, taskID); err != nil {
			log.Printf("grpcserver: renew lease step %s: %v", taskID, err)
			continue
		}
		step, err := s.db.GetStepByID(ctx, taskID)
		if err != nil {
			log.Printf("grpcserver: get step %s for heartbeat: %v", taskID, err)
			continue
		}
		if step.Status == "CANCELED" {
			canceledIDs = append(canceledIDs, taskID)
		}
	}

	return &conductorpb.HeartbeatResponse{CanceledTaskIds: canceledIDs}, nil
}

// computeBackoff returns the retry delay for attempt n (0-indexed).
// Formula: min(1s * 2^n, 300s) * uniform(0.8, 1.2)
func computeBackoff(attempt int) time.Duration {
	base := float64(time.Second)
	exp := math.Min(base*math.Pow(2, float64(attempt)), float64(300*time.Second))
	jitter := 0.8 + rand.Float64()*0.4 // uniform [0.8, 1.2]
	return time.Duration(exp * jitter)
}
