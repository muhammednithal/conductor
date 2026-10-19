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

// TestDiamondDAG verifies fan-out (A→B, A→C) and fan-in (B+C→D) execution.
// The diamond shape tests that D waits for both B and C before starting.
func TestDiamondDAG(t *testing.T) {
dbURL := os.Getenv("TEST_DATABASE_URL")
redisURL := os.Getenv("TEST_REDIS_URL")
if dbURL == "" || redisURL == "" {
t.Skip("TEST_DATABASE_URL and TEST_REDIS_URL must be set")
}

ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()

database, err := db.New(ctx, dbURL)
require.NoError(t, err)
defer database.Close()
require.NoError(t, database.RunMigrations(ctx, "../../migrations"))

redisClient := redisc.NewClient(redisURL)
defer redisClient.Close()
require.NoError(t, redisClient.FlushDB(ctx))

// Insert user + workflow
var userID string
err = database.Pool().QueryRow(ctx,
`INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id`,
fmt.Sprintf("diamond-%d@test", time.Now().UnixNano()), "x",
).Scan(&userID)
require.NoError(t, err)

dagDef := map[string]any{
"steps": []map[string]any{
{"name": "a", "type": "delay", "depends_on": []string{}, "config": map[string]any{"duration_seconds": 0}, "max_attempts": 1},
{"name": "b", "type": "delay", "depends_on": []string{"a"}, "config": map[string]any{"duration_seconds": 0}, "max_attempts": 1},
{"name": "c", "type": "delay", "depends_on": []string{"a"}, "config": map[string]any{"duration_seconds": 0}, "max_attempts": 1},
{"name": "d", "type": "delay", "depends_on": []string{"b", "c"}, "config": map[string]any{"duration_seconds": 0}, "max_attempts": 1},
},
}
dagJSON, _ := json.Marshal(dagDef)

var workflowID string
err = database.Pool().QueryRow(ctx,
`INSERT INTO workflows (owner_id, name, dag_definition) VALUES ($1, $2, $3) RETURNING id`,
userID, "diamond-test", dagJSON,
).Scan(&workflowID)
require.NoError(t, err)

runID, err := database.CreateRun(ctx, db.WorkflowRun{WorkflowID: workflowID, Status: "PENDING", Input: json.RawMessage(`{}`)})
require.NoError(t, err)

stepDefs := []struct{ name, typ, cfg string }{
{"a", "delay", `{"duration_seconds":0}`},
{"b", "delay", `{"duration_seconds":0}`},
{"c", "delay", `{"duration_seconds":0}`},
{"d", "delay", `{"duration_seconds":0}`},
}
for i, s := range stepDefs {
require.NoError(t, database.CreateStepExecution(ctx, db.StepExecution{
RunID: runID, StepName: s.name, StepType: s.typ, Status: "PENDING",
MaxAttempts: 1, IdempotencyKey: fmt.Sprintf("%s:%s:%d", runID, s.name, i),
Input: json.RawMessage(s.cfg),
}))
}

// Start in-process orchestrator
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

// Start in-process worker
reg := workerexecutor.NewRegistry()
reg.Register("delay", &workerexecutor.DelayExecutor{})
wc, err := workerclient.New(lis.Addr().String(), "diamond-worker", "test-host", reg)
require.NoError(t, err)
defer wc.Close()
go wc.Run(ctx)

require.Eventually(t, func() bool {
steps, err := database.GetRunStepExecutions(ctx, runID)
if err != nil || len(steps) != 4 {
return false
}
for _, s := range steps {
if s.Status != "SUCCEEDED" {
return false
}
}
return true
}, 28*time.Second, 200*time.Millisecond, "all 4 diamond steps should SUCCEED within 30s")
}