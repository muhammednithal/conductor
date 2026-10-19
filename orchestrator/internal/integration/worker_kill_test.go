//go:build integration

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
"github.com/conductor/orchestrator/internal/lease"
redisc "github.com/conductor/orchestrator/internal/redis"
"github.com/conductor/orchestrator/internal/scheduler"
"github.com/conductor/orchestrator/shared/proto/conductorpb"
workerexecutor "github.com/conductor/worker/internal/executor"
workerclient "github.com/conductor/worker/internal/grpcclient"
"github.com/stretchr/testify/require"
"google.golang.org/grpc"
)

// TestWorkerKillReclaim verifies that a step held by a killed worker is
// reclaimed and re-executed by a second worker within 45 seconds.
func TestWorkerKillReclaim(t *testing.T) {
dbURL := os.Getenv("TEST_DATABASE_URL")
redisURL := os.Getenv("TEST_REDIS_URL")
if dbURL == "" || redisURL == "" {
t.Skip("TEST_DATABASE_URL and TEST_REDIS_URL must be set")
}

// 45s budget: lease TTL (30s) + one reclaim scan interval (15s)
ctx, cancel := context.WithTimeout(context.Background(), 55*time.Second)
defer cancel()

database, err := db.New(ctx, dbURL)
require.NoError(t, err)
defer database.Close()
require.NoError(t, database.RunMigrations(ctx, "../../migrations"))

redisClient := redisc.NewClient(redisURL)
defer redisClient.Close()
require.NoError(t, redisClient.FlushDB(ctx))

// Insert workflow with a single delay step (0s so it completes quickly once reclaimed)
var userID string
err = database.Pool().QueryRow(ctx,
`INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id`,
fmt.Sprintf("kill-%d@test", time.Now().UnixNano()), "x",
).Scan(&userID)
require.NoError(t, err)

dagDef := map[string]any{
"steps": []map[string]any{
{"name": "a", "type": "delay", "depends_on": []string{}, "config": map[string]any{"duration_seconds": 0}, "max_attempts": 3},
},
}
dagJSON, _ := json.Marshal(dagDef)

var workflowID string
err = database.Pool().QueryRow(ctx,
`INSERT INTO workflows (owner_id, name, dag_definition) VALUES ($1, $2, $3) RETURNING id`,
userID, "kill-test", dagJSON,
).Scan(&workflowID)
require.NoError(t, err)

runID, err := database.CreateRun(ctx, db.WorkflowRun{WorkflowID: workflowID, Status: "PENDING", Input: json.RawMessage(`{}`)})
require.NoError(t, err)

require.NoError(t, database.CreateStepExecution(ctx, db.StepExecution{
RunID: runID, StepName: "a", StepType: "delay", Status: "PENDING",
MaxAttempts: 3, IdempotencyKey: runID + ":a:0",
Input: json.RawMessage(`{"duration_seconds":0}`),
}))

// Start orchestrator (scheduler + grpcserver + reclaimer)
sched := scheduler.New(database, redisClient)
go sched.Run(ctx)
reclaimer := lease.New(database, redisClient)
go reclaimer.Run(ctx)

lis, err := net.Listen("tcp", "127.0.0.1:0")
require.NoError(t, err)
grpcServer := grpc.NewServer()
conductorpb.RegisterOrchestratorServiceServer(grpcServer, grpcserver.NewServer(database, redisClient))
go grpcServer.Serve(lis)
defer grpcServer.Stop()

addr := lis.Addr().String()

// Worker 1 — will be "killed" by cancelling its context
worker1Ctx, killWorker1 := context.WithCancel(ctx)
reg1 := workerexecutor.NewRegistry()
reg1.Register("delay", &workerexecutor.DelayExecutor{})
wc1, err := workerclient.New(addr, "worker-1", "host-1", reg1)
require.NoError(t, err)
go wc1.Run(worker1Ctx)

// Wait for step to reach RUNNING (Worker 1 has it)
require.Eventually(t, func() bool {
steps, _ := database.GetRunStepExecutions(ctx, runID)
return len(steps) > 0 && steps[0].Status == "RUNNING"
}, 10*time.Second, 200*time.Millisecond, "step should reach RUNNING")

// Kill Worker 1 — stops heartbeating; lease will expire within 30s
killWorker1()
wc1.Close()

// Worker 2 — will pick up the reclaimed step
reg2 := workerexecutor.NewRegistry()
reg2.Register("delay", &workerexecutor.DelayExecutor{})
wc2, err := workerclient.New(addr, "worker-2", "host-2", reg2)
require.NoError(t, err)
defer wc2.Close()
go wc2.Run(ctx)

// Assert step reaches SUCCEEDED within 45s of the kill
require.Eventually(t, func() bool {
steps, _ := database.GetRunStepExecutions(ctx, runID)
return len(steps) > 0 && steps[0].Status == "SUCCEEDED"
}, 45*time.Second, 500*time.Millisecond, "step should be reclaimed and SUCCEEDED within 45s")
}