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
redisc "github.com/conductor/orchestrator/internal/redis"
"github.com/conductor/orchestrator/internal/recovery"
"github.com/conductor/orchestrator/internal/scheduler"
"github.com/conductor/orchestrator/shared/proto/conductorpb"
workerexecutor "github.com/conductor/worker/internal/executor"
workerclient "github.com/conductor/worker/internal/grpcclient"
"github.com/stretchr/testify/require"
"google.golang.org/grpc"
)

// TestCrashRecovery verifies that Recovery re-queues QUEUED steps that were
// never pushed to Redis (simulating an orchestrator crash before the push).
func TestCrashRecovery(t *testing.T) {
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

// Insert workflow with A → B
var userID string
err = database.Pool().QueryRow(ctx,
`INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id`,
fmt.Sprintf("crash-%d@test", time.Now().UnixNano()), "x",
).Scan(&userID)
require.NoError(t, err)

dagDef := map[string]any{
"steps": []map[string]any{
{"name": "a", "type": "delay", "depends_on": []string{}, "config": map[string]any{"duration_seconds": 0}, "max_attempts": 1},
{"name": "b", "type": "delay", "depends_on": []string{"a"}, "config": map[string]any{"duration_seconds": 0}, "max_attempts": 1},
},
}
dagJSON, _ := json.Marshal(dagDef)

var workflowID string
err = database.Pool().QueryRow(ctx,
`INSERT INTO workflows (owner_id, name, dag_definition) VALUES ($1, $2, $3) RETURNING id`,
userID, "crash-test", dagJSON,
).Scan(&workflowID)
require.NoError(t, err)

runID, err := database.CreateRun(ctx, db.WorkflowRun{WorkflowID: workflowID, Status: "PENDING", Input: json.RawMessage(`{}`)})
require.NoError(t, err)

// Insert step A directly as QUEUED (bypassing the scheduler, as if the
// orchestrator pushed it to Redis but then crashed before workers popped it).
_, err = database.Pool().Exec(ctx, `
INSERT INTO step_executions
(run_id, step_name, step_type, status, attempt_count, max_attempts, idempotency_key, input)
VALUES ($1, 'a', 'delay', 'QUEUED', 0, 1, $2, $3)
`, runID, runID+":a:0", json.RawMessage(`{"duration_seconds":0}`))
require.NoError(t, err)

// Insert step B as PENDING (normal state)
require.NoError(t, database.CreateStepExecution(ctx, db.StepExecution{
RunID: runID, StepName: "b", StepType: "delay", Status: "PENDING",
MaxAttempts: 1, IdempotencyKey: runID + ":b:0",
Input: json.RawMessage(`{"duration_seconds":0}`),
}))

// Redis is empty — simulate the crash. Now call Recover to re-populate Redis.
require.NoError(t, recovery.Recover(ctx, database, redisClient))

// Start scheduler + grpcserver + worker
sched := scheduler.New(database, redisClient)
go sched.Run(ctx)

lis, err := net.Listen("tcp", "127.0.0.1:0")
require.NoError(t, err)
grpcServer := grpc.NewServer()
conductorpb.RegisterOrchestratorServiceServer(grpcServer, grpcserver.NewServer(database, redisClient))
go grpcServer.Serve(lis)
defer grpcServer.Stop()

reg := workerexecutor.NewRegistry()
reg.Register("delay", &workerexecutor.DelayExecutor{})
wc, err := workerclient.New(lis.Addr().String(), "crash-worker", "host", reg)
require.NoError(t, err)
defer wc.Close()
go wc.Run(ctx)

require.Eventually(t, func() bool {
steps, err := database.GetRunStepExecutions(ctx, runID)
if err != nil || len(steps) != 2 {
return false
}
for _, s := range steps {
if s.Status != "SUCCEEDED" {
return false
}
}
return true
}, 28*time.Second, 200*time.Millisecond, "both steps should SUCCEED after crash recovery")
}