package main

import (
	"context"
	"log"
	"net"
	"os"
	"os/signal"
	"syscall"

	"github.com/conductor/orchestrator/internal/db"
	"github.com/conductor/orchestrator/internal/grpcserver"
	"github.com/conductor/orchestrator/internal/redis"
	"github.com/conductor/orchestrator/internal/scheduler"
	"github.com/conductor/orchestrator/shared/proto/conductorpb"
	"google.golang.org/grpc"
)

func main() {
	// --- Configuration from environment ---
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL environment variable is required")
	}
	redisAddr := getEnv("REDIS_ADDR", "localhost:6379")
	grpcAddr := getEnv("GRPC_ADDR", ":9000")
	migrationsDir := getEnv("MIGRATIONS_DIR", "migrations")

	// --- Root context with signal cancellation ---
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// --- Database ---
	database, err := db.New(ctx, databaseURL)
	if err != nil {
		log.Fatalf("orchestrator: connect to database: %v", err)
	}
	defer database.Close()
	log.Printf("orchestrator: connected to database")

	if err := database.RunMigrations(ctx, migrationsDir); err != nil {
		log.Fatalf("orchestrator: run migrations: %v", err)
	}
	log.Printf("orchestrator: migrations applied")

	// --- Redis ---
	redisClient := redis.NewClient(redisAddr)
	defer redisClient.Close()
	if err := redisClient.Ping(ctx); err != nil {
		log.Fatalf("orchestrator: connect to redis: %v", err)
	}
	log.Printf("orchestrator: connected to redis at %s", redisAddr)

	// --- Scheduler ---
	sched := scheduler.New(database, redisClient)
	go func() {
		log.Printf("orchestrator: scheduler starting")
		sched.Run(ctx)
		log.Printf("orchestrator: scheduler stopped")
	}()

	// --- gRPC server ---
	lis, err := net.Listen("tcp", grpcAddr)
	if err != nil {
		log.Fatalf("orchestrator: listen on %s: %v", grpcAddr, err)
	}
	grpcServer := grpc.NewServer()
	conductorpb.RegisterOrchestratorServiceServer(grpcServer, grpcserver.NewServer(database, redisClient))

	go func() {
		<-ctx.Done()
		log.Printf("orchestrator: shutting down gRPC server")
		grpcServer.GracefulStop()
	}()

	log.Printf("orchestrator: gRPC server listening on %s", grpcAddr)
	if err := grpcServer.Serve(lis); err != nil {
		log.Printf("orchestrator: grpc serve: %v", err)
	}
	log.Printf("orchestrator: stopped")
}

func getEnv(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}
