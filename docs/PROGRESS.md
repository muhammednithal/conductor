# Progress

## Done

- **2025-07-15** --- Documentation corpus complete: AGENTS.md, CLAUDE.md, .cursor/rules, .kiro/steering, docs/00-vision.md, docs/01-architecture.md, docs/02-conventions.md, docs/PROGRESS.md, docs/adr/001-005, docs/milestones/M1-M6, docs/validate.sh (Req 1-12)

- **2025-07-15** --- M1 implementation complete --- all source files written:
  - shared/proto/conductor.proto + shared/proto/conductorpb/ (pre-generated Go stubs)
  - orchestrator/go.mod, orchestrator/Makefile, orchestrator/migrations/001_initial.sql
  - orchestrator/internal/statemachine/statemachine.go + statemachine_test.go
  - orchestrator/internal/db/db.go
  - orchestrator/internal/redis/client.go
  - orchestrator/internal/grpcserver/server.go
  - orchestrator/internal/scheduler/scheduler.go
  - orchestrator/internal/integration/linear_workflow_test.go
  - orchestrator/cmd/orchestrator/main.go
  - worker/go.mod, worker/Makefile
  - worker/internal/executor/registry.go, http.go, transform.go, delay.go
  - worker/internal/grpcclient/client.go
  - worker/cmd/worker/main.go

## In Progress

<!-- None -->

## Next

M1 manual verification (requires Go 1.22 installed on the developer machine):
1. Install Go 1.22: https://go.dev/dl/
2. cd orchestrator && go mod tidy && make build && make lint && make test
3. cd worker && go mod tidy && make build && make lint && make test
4. Integration test: set TEST_DATABASE_URL and TEST_REDIS_URL, then run:
   go test -tags integration -timeout 60s ./internal/integration/...

M2 implementation (fault tolerance, branching DAGs, lease reclaim, crash recovery)

## Known Issues

- Go is not installed in the Kiro terminal --- go.sum files are absent until go mod tidy is run locally.

## Open Questions

None.
