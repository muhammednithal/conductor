package main

import (
"context"
"crypto/sha256"
"fmt"
"log"
"os"
"os/signal"
"syscall"

"github.com/conductor/worker/internal/executor"
"github.com/conductor/worker/internal/grpcclient"
)

func main() {
orchestratorAddr := getEnv("ORCHESTRATOR_ADDR", ":9000")

hostname, err := os.Hostname()
if err != nil {
hostname = "unknown"
}
hostname = getEnv("WORKER_HOSTNAME", hostname)

// Deterministic ID based on hostname so restarts UPDATE the same row
// instead of creating a new one each time.
workerID := hostnameToID(hostname)

ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
defer stop()

reg := executor.NewRegistry()
reg.Register("http", executor.NewHTTPExecutor())
reg.Register("transform", &executor.TransformExecutor{})
reg.Register("delay", &executor.DelayExecutor{})
reg.Register("summarize", executor.NewAIExecutor("/ai/summarize"))
reg.Register("embed", executor.NewAIExecutor("/ai/embed"))

client, err := grpcclient.New(orchestratorAddr, workerID, hostname, reg)
if err != nil {
log.Fatalf("worker: create grpc client: %v", err)
}
defer client.Close()

log.Printf("worker: %s (%s) connecting to orchestrator at %s", workerID, hostname, orchestratorAddr)

if err := client.Run(ctx); err != nil {
log.Printf("worker: run: %v", err)
}
log.Printf("worker: stopped")
}

func getEnv(key, defaultVal string) string {
if v := os.Getenv(key); v != "" {
return v
}
return defaultVal
}

// hostnameToID converts a hostname to a stable UUID-shaped ID using SHA-256.
// The same hostname always produces the same ID, so UpsertWorker updates the
// existing row rather than inserting a new one on every restart.
func hostnameToID(hostname string) string {
h := sha256.Sum256([]byte(hostname))
return fmt.Sprintf("%x-%x-%x-%x-%x",
h[0:4], h[4:6], h[6:8], h[8:10], h[10:16])
}