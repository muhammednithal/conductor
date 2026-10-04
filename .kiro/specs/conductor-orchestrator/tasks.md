# Implementation Plan: Conductor Documentation-First Deliverable

## Overview

Produce the complete foundational documentation corpus for the Conductor distributed AI workflow
orchestrator. This phase outputs Markdown files only — no application code, migrations, or container
configurations are created. All content is derived from the requirements and design documents. An
explicit architecture approval gate (recorded in `docs/PROGRESS.md`) must be passed before any code
phase begins.

## Tasks

- [x] 1. Create `AGENTS.md` — single source of truth for AI coding assistants
  - Create `AGENTS.md` at the repository root with exactly these six sections in order:
    1. **Project Summary** — 3–6 sentences, ≤ 150 words describing Conductor's purpose, target users, and core capabilities
    2. **Repository Map** — ASCII tree showing all top-level directories and their primary subdirectories to depth 2 (`/orchestrator`, `/worker`, `/api-ai`, `/web`, `/deploy`, `/docs`, `/shared`)
    3. **Build / Test / Lint / Run commands** — exact `make` commands for each of the four services (orchestrator, worker, api-ai, web)
    4. **Hard Rules** — numbered list of the six rules: state transitions via `statemachine` package only; never edit applied migrations; every change ships with tests; no new dependencies without approval; only touch files in task scope; no unrelated refactors
    5. **Definition of Done checklist** — four items: tests pass, lint passes, `docs/PROGRESS.md` updated, no out-of-scope changes
    6. **AI Assistant Workflow** — instruction to read `docs/01-architecture.md` and current milestone spec before coding; update `docs/PROGRESS.md` after finishing
  - Keep total line count ≤ 100
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 10.3, 11.3_

- [x] 2. Create tool-specific pointer files
  - [x] 2.1 Create `CLAUDE.md` at the repository root
    - Content: directive to read `AGENTS.md` as the source of truth; total content ≤ 5 lines
    - Use the exact two-line body shown in the design (`# Claude Instructions` / `Read AGENTS.md…`)
    - _Requirements: 2.1, 2.2_

  - [x] 2.2 Create `.cursor/rules/conductor.md`
    - Content: pointer to `AGENTS.md` and `docs/` directory; total content ≤ 10 lines
    - Instruct: read `AGENTS.md` and the current milestone spec in `docs/milestones/` before generating or modifying code
    - _Requirements: 2.3, 2.4_

  - [x] 2.3 Create `.kiro/steering/conductor.md`
    - Content: pointer to `AGENTS.md` and `docs/` directory; total content ≤ 10 lines
    - Instruct: read `AGENTS.md` and `docs/01-architecture.md` before starting any task
    - _Requirements: 2.5, 2.6_

- [x] 3. Create vision document (`docs/00-vision.md`)
  - Create `docs/00-vision.md` with these six sections:
    1. **What is Conductor?** — plain language, ≤ 3 paragraphs, no undefined acronyms
    2. **Why does it exist?** — problems solved (fragile ad-hoc LLM pipelines, no crash recovery, no visibility)
    3. **Who uses it?** — personas and use-case table (ML engineer, platform engineer, data analyst)
    4. **End-to-end example workflow** — Upload PDF → chunk → embed → summarize each chunk → merge → output
    5. **Success criteria** — four measurable outcomes from the design (10-step workflow in 30 s; crashed worker reclaimed in 60 s; 100 concurrent runs without loss; dashboard state lag ≤ 2 s)
    6. **Glossary** — define DAG, Orchestrator, Worker, Lease, Step, Run
  - Short paragraphs, clear `##` headings, readable by a non-developer stakeholder
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 4. Create architecture document (`docs/01-architecture.md`)
  - Create `docs/01-architecture.md`; each sub-task writes one section of this file

  - [x] 4.1 Write Repository Structure section
    - Table mapping each top-level directory to its purpose and primary file types (seven rows from the design)
    - Specify: migrations in `/orchestrator/migrations/`; OpenAPI specs in `/api-ai/openapi/`; proto definitions in `/shared/proto/`; test file locations per language convention
    - _Requirements: 4.1, 11.1, 11.2, 11.4, 11.5, 11.6_

  - [x] 4.2 Write Data Model section
    - Full Postgres schema for all six tables: `users`, `workflows`, `workflow_runs`, `step_executions`, `workers`, `leases`
    - Include column names, types, nullability, default values, primary keys, foreign keys, unique constraints, and check constraints exactly as specified in the design
    - Include the DAG definition JSON schema with the `steps` array shape
    - _Requirements: 4.2_

  - [x] 4.3 Write State Machine section
    - Mermaid `stateDiagram-v2` diagram with all seven states and every labeled transition from the design
    - List terminal states (`SUCCEEDED`, `FAILED`, `CANCELED`) and state the `statemachine` package constraint
    - _Requirements: 4.3_

  - [x] 4.4 Write API Contracts section
    - Orchestrator gRPC protobuf service definition (`RegisterWorker`, `AckTask`, `Heartbeat`) with all message types
    - Orchestrator internal REST API table (three endpoints: cancel, status, metrics)
    - FastAPI REST API tables for all five groups: auth, workflows, runs, AI endpoints, workers (read-only)
    - Each row specifies method, path, request, response, and error responses
    - _Requirements: 4.4_

  - [x] 4.5 Write Lease-Based Task Assignment section
    - Specify heartbeat interval (10 s), lease duration (30 s), reclaim scan interval (15 s)
    - Reclaim condition (`expires_at < NOW()`) and reclaim actions for both retry-eligible and exhausted steps
    - _Requirements: 4.7_

  - [x] 4.6 Write Retry Policy section
    - Table with all six retry parameters: base interval, multiplier, jitter range, max interval cap, default max attempts, terminal state after exhaustion
    - Backoff formula: `min(base * 2^attempt, max_interval) * uniform(0.8, 1.2)`
    - Explain how `scheduled_after` is used and how the scheduler re-queues `RETRYING` steps
    - _Requirements: 4.8_

  - [x] 4.7 Write Idempotency section
    - Key format: `{run_id}:{step_name}:{attempt_count}`
    - Storage in `step_executions.idempotency_key` with `UNIQUE` constraint; `INSERT … ON CONFLICT DO NOTHING` pattern
    - AI endpoint deduplication via `idempotency_key` header; Redis cache for 24 hours
    - _Requirements: 4.9_

  - [x] 4.8 Write Timeouts, Cancellation, and Rate Limiting section
    - Default step timeout (300 s), LLM call timeout (120 s), cancellation ack timeout (5 s)
    - Six-step cancellation sequence from DELETE request through worker ack to force-cancel
    - Rate limiting: 60 req/min per workflow, Redis token bucket key pattern, HTTP 429 behavior
    - _Requirements: 4.10_

  - [x] 4.9 Write Crash Recovery section
    - Two SQL queries (find non-terminal steps; find RUNNING with no valid lease) with annotations
    - Four recovery actions applied on orchestrator restart
    - _Requirements: 4.6_

  - [x] 4.10 Write Failure Scenarios section
    - Table with seven failure scenarios: worker crash, network partition, orchestrator restart, Redis failure, Postgres failure, duplicate task delivery, step timeout
    - Each row specifies detection mechanism and system response
    - _Requirements: 4.5_

  - [x] 4.11 Write Service Specifications and System Architecture sections
    - Orchestrator responsibilities table (11 rows from the design's §4.11)
    - Worker responsibilities table (9 rows from §4.12)
    - API-AI service responsibilities table (11 rows from §4.13)
    - Web Dashboard responsibilities table (5 rows from §4.14)
    - Inter-service communication matrix (8 rows) with protocol and direction for every service pair
    - Mermaid `graph LR` system architecture diagram showing all services, data stores, and message flows
    - _Requirements: 4.11, 12.1, 12.2, 12.3, 12.4, 12.5_

- [x] 5. Create conventions document (`docs/02-conventions.md`)
  - Create `docs/02-conventions.md`; each sub-task writes one section

  - [x] 5.1 Write naming conventions section
    - Go: `camelCase` unexported, `PascalCase` exported, single-word `snake_case` packages, `ALL_CAPS` constants
    - Python: `snake_case` functions/vars, `PascalCase` classes, `SCREAMING_SNAKE_CASE` constants, `kebab-case` module filenames
    - TypeScript: `camelCase` functions/vars, `PascalCase` components/classes/interfaces, `SCREAMING_SNAKE_CASE` env constants
    - Database: `snake_case` tables and columns, plural table names, `{table}_{column}_fk` FK names, `{table}_{column}_idx` index names
    - _Requirements: 5.1, 5.2_

  - [x] 5.2 Write error handling section
    - Go: wrap with `fmt.Errorf`/`%w`; define sentinel errors in `errors.go`; use `errors.Is`/`errors.As`; propagate gRPC status codes
    - Python: custom exception hierarchy; HTTP 4xx for client errors, 5xx for server errors; log context with structlog
    - TypeScript: typed error responses; error boundaries in React; no unhandled promise rejections
    - _Requirements: 5.3_

  - [x] 5.3 Write structured logging section
    - Format: JSON; required fields: `timestamp` (RFC3339), `level`, `service`, `trace_id`, `span_id`, `msg`
    - _Requirements: 5.4_

  - [x] 5.4 Write testing standards section
    - Coverage minimums: Go ≥ 80%, Python ≥ 80%, TypeScript ≥ 70%
    - Integration tests: required for every public API endpoint
    - File naming: `*_test.go` alongside source (Go), `tests/` subdirectory (Python), `__tests__/` or `*.test.ts` (TypeScript)
    - _Requirements: 5.5_

  - [x] 5.5 Write git workflow section
    - Branch format: `{type}/{issue-id}-short-description`
    - Commit messages: Conventional Commits (`feat:`, `fix:`, `chore:`, etc.)
    - PR requirements: 1 reviewer + CI green; squash merge strategy
    - _Requirements: 5.6_

  - [x] 5.6 Write observability section
    - Prometheus metric naming: `conductor_{service}_{metric}_{unit}`; mandatory categories: latency histogram, error rate counter, throughput counter per service
    - OpenTelemetry: span names `{service}.{operation}`; required headers `traceparent`/`tracestate`; mandatory spans at service entry points and all external/DB/Redis calls
    - _Requirements: 5.7, 5.8_

- [x] 6. Checkpoint — verify documentation foundation before ADRs and milestones
  - Confirm tasks 1–5 are complete
  - Verify `AGENTS.md` ≤ 100 lines, `CLAUDE.md` ≤ 5 lines, both cursor and kiro pointer files ≤ 10 lines
  - Ask the user if questions arise before continuing.

- [x] 7. Create ADR documents (`docs/adr/`)
  - Each ADR follows the template: filename `NNN-short-title.md`, ≤ 500 words, sections: title, Status, Context, Decision, Consequences (Positive / Negative)

  - [x] 7.1 Create `docs/adr/001-go-for-orchestrator-worker.md`
    - Status: accepted
    - Decision: Go for orchestrator and worker — rationale: goroutine concurrency model, gRPC first-class support, static compilation for small Docker images, strong performance characteristics
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 7.2 Create `docs/adr/002-fastapi-for-api-ai.md`
    - Status: accepted
    - Decision: Python FastAPI for the api-ai service — rationale: mature Python LLM SDK ecosystem (OpenAI, LangChain, sentence-transformers), automatic OpenAPI generation, async support
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 7.3 Create `docs/adr/003-lease-based-scheduling.md`
    - Status: accepted
    - Decision: lease + heartbeat scheduling over simple polling — rationale: prevents duplicate execution; polling requires distributed locks; leases proven in Temporal and SQS
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 7.4 Create `docs/adr/004-postgres-source-of-truth.md`
    - Status: accepted
    - Decision: Postgres as sole source of truth — rationale: DAG execution state requires ACID transactions; relational model maps naturally to workflows/runs/steps; strong consistency required for state machine
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 7.5 Create `docs/adr/005-redis-queues-pubsub.md`
    - Status: accepted
    - Decision: Redis for task queues (List RPUSH/BLPOP) and pub/sub for SSE fan-out — rationale: low latency, operationally simpler than Kafka for this scale
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [x] 8. Create milestone specifications (`docs/milestones/`)
  - Each milestone follows the template: Goal (1–3 sentences), Scope (bullets), Non-Goals (≥ 2 items), Acceptance Criteria (≥ 3 binary-verifiable items), Tasks (5–10 items)

  - [x] 8.1 Create `docs/milestones/M1.md`
    - Goal: single-worker linear job execution
    - Scope: Orchestrator service + one Worker service, linear DAGs only (no branches), Postgres state persistence, gRPC bidirectional streaming
    - _Requirements: 7.1, 7.2, 7.3, 7.9_

  - [x] 8.2 Create `docs/milestones/M2.md`
    - Goal: reliable DAG execution with fault tolerance
    - Scope: DAG branching and fan-out, retry with exponential backoff, heartbeats, lease reclaim, crash recovery on restart
    - _Requirements: 7.1, 7.4, 7.9_

  - [x] 8.3 Create `docs/milestones/M3.md`
    - Goal: AI step types via FastAPI integration
    - Scope: FastAPI service with JWT auth, `summarize` and `embed` step types, idempotency key header, token/cost tracking
    - _Requirements: 7.1, 7.5, 7.9_

  - [x] 8.4 Create `docs/milestones/M4.md`
    - Goal: live run viewer in the web dashboard
    - Scope: React run viewer with SSE/WebSocket connection, real-time step state updates, run history list and detail views
    - _Requirements: 7.1, 7.6, 7.9_

  - [x] 8.5 Create `docs/milestones/M5.md`
    - Goal: visual workflow builder and RAG support
    - Scope: drag-and-drop DAG builder in React, `rag` query step type, end-to-end RAG example workflow
    - _Requirements: 7.1, 7.7, 7.9_

  - [x] 8.6 Create `docs/milestones/M6.md`
    - Goal: hardening, observability, and documentation finalization
    - Scope: chaos testing (kill workers mid-run), Prometheus metrics per service, OpenTelemetry traces, final documentation review
    - _Requirements: 7.1, 7.8, 7.9_

- [x] 9. Create progress tracking document (`docs/PROGRESS.md`)
  - Create `docs/PROGRESS.md` with sections in this exact order: `## Done`, `## In Progress`, `## Next`, `## Known Issues`, `## Open Questions`
  - Initial **In Progress**: list all 12 documentation requirements (Req 1–12) as individual entries
  - Initial **Next**: M1 implementation pending architecture approval
  - Leave **Done**, **Known Issues**, and **Open Questions** empty with placeholder comments
  - _Requirements: 8.1, 8.2, 8.8_

- [x] 10. Create documentation validation script (`docs/validate.sh`)
  - Create `docs/validate.sh` as a single executable shell script that CI can run; exit code 0 on success, non-zero on any failure

  - [x] 10.1 Implement smoke checks (file existence)
    - Check for every required file listed in the design's Testing Strategy section: all docs, AGENTS.md, CLAUDE.md, `.cursor/rules/conductor.md`, `.kiro/steering/conductor.md`, five ADRs, six milestone specs
    - Print `MISSING: {file} not found` for each absent file and collect into a failure list
    - _Requirements: 7.10, 9.1_

  - [x] 10.2 Implement constraint checks
    - `AGENTS.md` line count ≤ 100; `CLAUDE.md` ≤ 5 lines; cursor and kiro pointer files ≤ 10 lines each
    - Each ADR word count ≤ 500 (count with `wc -w`)
    - `docs/PROGRESS.md` contains all five required section headings
    - _Requirements: 1.9, 2.2, 2.4, 2.6, 6.6_

  - [x] 10.3 Implement section presence checks
    - For `docs/01-architecture.md`: assert the ten required headings are present (Repository Structure, Data Model, State Machine, API Contracts, Lease-Based Task Assignment, Retry Policy, Idempotency, Timeouts and Cancellation, Crash Recovery, Failure Scenarios)
    - For each `M1.md–M6.md`: assert Goal, Scope, Non-Goals, Acceptance Criteria, Tasks headings
    - For each ADR: assert Status, Context, Decision, Consequences headings
    - _Requirements: 4.1, 7.2_

  - [x] 10.4 Implement policy enforcement check
    - `find` for `*.go`, `*.py`, `*.ts`, `*.js`, `*.sh` (outside `docs/`), `*.sql`, `Dockerfile*`, `docker-compose*.yml` outside `.git/`, `docs/`, `.kiro/`, `.cursor/`
    - Print `POLICY VIOLATION: application code found in {path}; architecture approval required` for each match
    - _Requirements: 9.2, 9.3, 9.4_

- [x] 11. Final checkpoint — run validation and confirm documentation corpus is complete
  - Execute `bash docs/validate.sh` and confirm zero errors and zero policy violations
  - Manually verify both Mermaid diagrams in `docs/01-architecture.md` render correctly
  - Confirm all five ADRs have `Status: accepted`
  - Confirm `docs/PROGRESS.md` "In Progress" reflects the documentation phase and "Next" shows M1
  - Ask the user if questions arise before marking complete.

## Notes

- Sub-tasks marked with `*` are optional and can be skipped for a faster first pass
- Each task references specific requirements for full traceability
- Checkpoints at tasks 6 and 11 ensure incremental validation before moving to the next phase
- This deliverable contains **only documentation**; no application code will be produced until a stakeholder records architecture approval in `docs/PROGRESS.md`
- `docs/validate.sh` is permitted under the no-code policy because the policy enforcement scan explicitly excludes `./docs/*`
- Once all tasks are complete and validation passes, open `docs/PROGRESS.md` and record the approval entry before executing M1 tasks

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3", "3"] },
    { "id": 2, "tasks": ["4.1", "4.2", "4.3", "4.4", "4.5", "4.6", "4.7", "4.8", "4.9", "4.10", "5.1", "5.2", "5.3", "5.4", "5.5", "5.6"] },
    { "id": 3, "tasks": ["4.11"] },
    { "id": 4, "tasks": ["7.1", "7.2", "7.3", "7.4", "7.5", "8.1", "8.2", "8.3", "8.4", "8.5", "8.6"] },
    { "id": 5, "tasks": ["9"] },
    { "id": 6, "tasks": ["10.1", "10.2", "10.3", "10.4"] }
  ]
}
```
