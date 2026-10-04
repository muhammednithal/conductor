# 001 — Go for Orchestrator and Worker

**Status:** accepted

## Context

The orchestrator and worker services are the core execution engine of Conductor. They must handle high concurrency (many simultaneous lease holders, scheduler loops, and streaming worker connections), communicate over gRPC, and deploy reliably in containerized environments. A language choice that aligns with these constraints reduces operational complexity and performance risk.

## Decision

Go is chosen for both the orchestrator and worker services.

Rationale:
- Goroutines and channels provide native concurrency primitives ideal for managing many concurrent lease holders, scheduler loops, and worker streams
- gRPC has first-class Go support via the official `google.golang.org/grpc` package
- Go compiles to a single static binary, producing small Docker images with no runtime dependency
- Strong performance characteristics for network I/O and concurrent workloads

## Consequences

**Positive:**
- Predictable latency due to Go's efficient goroutine scheduler
- Simple deployment: single binary per service
- Strong type system catches errors at compile time
- Native gRPC code generation via protoc-gen-go

**Negative:**
- Team members less familiar with Go require ramp-up time
- Less mature LLM/AI SDK ecosystem compared to Python (mitigated by delegating AI work to the api-ai service)
