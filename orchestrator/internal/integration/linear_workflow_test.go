//go:build integration

// Package integration contains end-to-end tests for the Conductor orchestrator.
// Run with: go test -tags integration -timeout 60s ./internal/integration/...
// Requires environment variables: TEST_DATABASE_URL, TEST_REDIS_URL
package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"testing"
	"time"

	"github.com/conductor/orchestrator/internal/db"
	"github.com/conductor/orchestrator/internal/grpcserver"
	redisc "github.com/conductor/orchestrator/internal/redis"
	"github.com/conductor/orchestrator/internal/scheduler"
	"github.com/conductor/orchestrator/shared/proto/conductorpb"
	workerexecutor "github.com/conductor/worker/internal/executor"
	workerclient "github.com/conductor/worker/internal/grpcclient"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
)

// TestLinearWorkflow verifies that a 3-step linear DAG (delay→transform→delay)
// completes with all steps SUCCEEDED within 30 seconds.
func TestLinearWorkflow(t *testing.T) {
	dbURL := os.Getenv("TEST_DATABASE_URL")
	redisURL := os.Getenv("TEST_REDIS_URL")
	if dbURL == "" || redisURL == "" {
		t.Skip("TEST_DATABASE_URL and TEST_REDIS_URL must be set to run integration tests")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// --- Setup DB ---
	database, err := db.New(ctx, dbURL)
	require.NoError(t, err, "connect to test database")
	defer database.Close()

	err = database.RunMigrations(ctx, "../../migrations")
	require.NoError(t, err, "run migrations")

	// --- Setup Redis ---
	redisClient := redisc.NewClient(redisURL)
	defer redisClient.Close()
	err = redisClient.FlushDB(ctx)
	require.NoError(t, err, "flush test redis db")

	// --- Insert test data ---
	// Users row required for FK
	var userID string
	err = database.Pool().QueryRow(ctx,
		`INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id`,
		fmt.Sprintf("test-%d@conductor.test", time.Now().UnixNano()),
		"not-a-real-hash",
	).Scan(&userID)
	require.NoError(t, err, "insert test user")

	// Workflow with 3-step linear DAG
	dagDef := map[string]any{
		"steps": []map[string]any{
			{
				"name":            "a",
				"type":            "delay",
				"depends_on":      []string{},
				"config":          map[string]any{"duration_seconds": 0},
				"timeout_seconds": 10,
				"max_attempts":    1,
			},
			{
				"name":            "b",
				"type":            "transform",
				"depends_on":      []string{"a"},
				"config":          map[string]any{"mapping": map[string]string{}},
				"timeout_seconds": 10,
				"max_attempts":    1,
			},
			{
				"name":            "c",
				"type":            "delay",
				"depends_on":      []string{"b"},
				"config":          map[string]any{"duration_seconds": 0},
				"timeout_seconds": 10,
				"max_attempts":    1,
			},
		},
	}
	dagJSON, err := json.Marshal(dagDef)
	require.NoError(t, err)

	var workflowID string
	err = database.Pool().QueryRow(ctx,
		`INSERT INTO workflows (owner_id, name, dag_definition) VALUES ($1, $2, $3) RETURNING id`,
		userID, "test-linear-workflow", dagJSON,
	).Scan(&workflowID)
	require.NoError(t, err, "insert test workflow")

	// Workflow run
	runID, err := database.CreateRun(ctx, db.WorkflowRun{
		WorkflowID: workflowID,
		Status:     "PENDING",
		Input:      json.RawMessage(`{}`),
	})
	require.NoError(t, err, "create workflow run")

	// Step executions — all PENDING
	steps := []struct {
		name     string
		stepType string
		configJSON string
	}{
		{"a", "delay", `{"duration_seconds":0}`},
		{"b", "transform", `{"mapping":{}}`},
		{"c", "delay", `{"duration_seconds":0}`},
	}
	for i, s := range steps {
		err = database.CreateStepExecution(ctx, db.StepExecution{
			RunID:          runID,
			StepName:       s.name,
			StepType:       s.stepType,
			Status:         "PENDING",
			AttemptCount:   0,
			MaxAttempts:    1,
			IdempotencyKey: fmt.Sprintf("%s:%s:%d", runID, s.name, i),
			Input:          json.RawMessage(s.configJSON),
		})
		require.NoError(t, err, "create step %s", s.name)
	}

	// --- Start in-process Orchestrator ---
	sched := scheduler.New(database, redisClient)
	go sched.Run(ctx)

	lis, err := net.Listen("tcp", "127.0.0.1:0") // random port
	require.NoError(t, err)
	grpcServer := grpc.NewServer()
	conductorpb.RegisterOrchestratorServiceServer(grpcServer, grpcserver.NewServer(database, redisClient))
	go grpcServer.Serve(lis)
	defer grpcServer.Stop()

	serverAddr := lis.Addr().String()

	// --- Start in-process Worker ---
	reg := workerexecutor.NewRegistry()
	reg.Register("http", workerexecutor.NewHTTPExecutor())
	reg.Register("transform", &workerexecutor.TransformExecutor{})
	reg.Register("delay", &workerexecutor.DelayExecutor{})

	workerClient, err := workerclient.New(serverAddr, "test-worker-id", "test-host", reg)
	require.NoError(t, err, "create worker client")
	defer workerClient.Close()
	go workerClient.Run(ctx) //nolint:errcheck

	// --- Assert all steps SUCCEEDED within 30s ---
	require.Eventually(t, func() bool {
		stepList, err := database.GetRunStepExecutions(ctx, runID)
		if err != nil || len(stepList) != 3 {
			return false
		}
		for _, s := range stepList {
			if s.Status != "SUCCEEDED" {
				return false
			}
		}
		return true
	}, 28*time.Second, 200*time.Millisecond,
		"all 3 steps should reach SUCCEEDED within 30s")

	// --- Assert worker row exists with ONLINE status ---
	var workerStatus string
	err = database.Pool().QueryRow(ctx,
		`SELECT status FROM workers WHERE id = $1`, "test-worker-id",
	).Scan(&workerStatus)
	// Worker may have disconnected and become OFFLINE by now; just check it was registered
	// by checking the row exists (status might be ONLINE or OFFLINE at teardown).
	require.NoError(t, err, "worker row should exist")

	// --- Cleanup ---
	t.Cleanup(func() {
		cleanCtx := context.Background()
		_ = database.Pool().QueryRow(cleanCtx, `DELETE FROM leases WHERE step_execution_id IN (SELECT id FROM step_executions WHERE run_id = $1)`, runID)
		database.Pool().QueryRow(cleanCtx, `DELETE FROM step_executions WHERE run_id = $1`, runID)
		database.Pool().QueryRow(cleanCtx, `DELETE FROM workflow_runs WHERE id = $1`, runID)
		database.Pool().QueryRow(cleanCtx, `DELETE FROM workers WHERE id = 'test-worker-id'`)
		database.Pool().QueryRow(cleanCtx, `DELETE FROM workflows WHERE id = $1`, workflowID)
		database.Pool().QueryRow(cleanCtx, `DELETE FROM users WHERE id = $1`, userID)
	})
}
