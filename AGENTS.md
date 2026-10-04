# AGENTS.md

## Project Summary

Conductor is a distributed AI workflow orchestrator that schedules and executes
multi-step DAG pipelines across a pool of workers. It targets platform engineers
and AI application developers who need reliable, fault-tolerant execution of
LLM-powered pipelines. Core capabilities include lease-based task scheduling,
automatic retry with exponential backoff, crash recovery, real-time SSE
streaming of step states, and a visual drag-and-drop workflow builder.

## Repository Map

```
/
├── orchestrator/        ← Go: DAG scheduling, state machine, lease management
│   ├── cmd/
│   ├── internal/
│   └── migrations/
├── worker/              ← Go: task execution, heartbeat, step handlers
│   ├── cmd/
│   └── internal/
├── api-ai/              ← Python FastAPI: auth, workflow CRUD, AI endpoints
│   ├── app/
│   ├── openapi/
│   └── tests/
├── web/                 ← React+TypeScript dashboard
│   ├── src/
│   └── package.json
├── shared/              ← Protobuf definitions (gRPC)
│   └── proto/
├── deploy/              ← Docker Compose, env templates
└── docs/                ← All documentation and ADRs
    ├── adr/
    └── milestones/
```

## Build / Test / Lint / Run Commands

| Service        | Build              | Test              | Lint              | Run              |
|----------------|--------------------|-------------------|-------------------|------------------|
| orchestrator   | `make build`       | `make test`       | `make lint`       | `make run`       |
| worker         | `make build`       | `make test`       | `make lint`       | `make run`       |
| api-ai         | `make build`       | `make test`       | `make lint`       | `make run`       |
| web            | `make build`       | `make test`       | `make lint`       | `make run`       |

Run each command from inside the service directory (e.g. `cd orchestrator && make test`).

## Hard Rules

1. All step state transitions MUST go through the `statemachine` package only; never update `step_executions.status` directly via SQL outside that package.
2. Never edit an already-applied database migration; add a new migration file instead.
3. Every change ships with tests — at minimum one unit test and one integration test.
4. Do not add external dependencies without explicit approval.
5. Only touch files relevant to the current task; do not modify out-of-scope files.
6. Do not refactor unrelated code in the same commit.

## Definition of Done

- [ ] All tests pass (`make test` in every affected service)
- [ ] Lint passes (`make lint` in every affected service)
- [ ] `docs/PROGRESS.md` updated with the completed item and today's date
- [ ] No changes to files outside the task's stated scope

## AI Assistant Workflow

Before writing or modifying any code:
1. Read `docs/01-architecture.md` to understand the system design, data model, and service contracts.
2. Read the current milestone spec in `docs/milestones/` to understand in-scope work.

After finishing a task, update `docs/PROGRESS.md` — move the completed item to the **Done** section with the date and note any open questions or follow-ups.
