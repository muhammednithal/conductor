package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/conductor/worker/internal/executor"
	"github.com/conductor/worker/internal/grpcclient"
)

func main() {
	// --- Configuration from environment ---
	orchestratorAddr := getEnv("ORCHESTRATOR_ADDR", ":9000")

	hostname, err := os.Hostname()
	if err != nil {
		hostname = "unknown"
	}
	hostname = getEnv("WORKER_HOSTNAME", hostname)

	workerID := generateID()

	// --- Root context with signal cancellation ---
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// --- Executor registry ---
	reg := executor.NewRegistry()
	reg.Register("http", executor.NewHTTPExecutor())
	reg.Register("transform", &executor.TransformExecutor{})
	reg.Register("delay", &executor.DelayExecutor{})
reg.Register("summarize", executor.NewAIExecutor("/ai/summarize"))
reg.Register("embed", executor.NewAIExecutor("/ai/embed"))

	// --- gRPC client ---
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

// generateID generates a 16-byte random hex string as a worker UUID substitute.
func generateID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("worker-%d", os.Getpid())
	}
	// Format as UUID-like string: 8-4-4-4-12
	return fmt.Sprintf("%s-%s-%s-%s-%s",
		hex.EncodeToString(b[0:4]),
		hex.EncodeToString(b[4:6]),
		hex.EncodeToString(b[6:8]),
		hex.EncodeToString(b[8:10]),
		hex.EncodeToString(b[10:16]),
	)
}
