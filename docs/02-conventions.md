# Conventions

## Naming Conventions

<!-- Requirements: 5.1, 5.2 -->

### Go

| Identifier type        | Style       | Example                  |
|------------------------|-------------|--------------------------|
| Unexported identifiers | `camelCase` | `leaseTimeout`, `runID`  |
| Exported identifiers   | `PascalCase`| `StepExecutor`, `RunID`  |
| Package names          | single-word `snake_case` | `statemachine`, `lease` |
| Constants              | `ALL_CAPS`  | `MAX_RETRY_COUNT`        |

### Python

| Identifier type    | Style                 | Example                        |
|--------------------|-----------------------|--------------------------------|
| Functions          | `snake_case`          | `get_workflow`, `run_step`     |
| Variables          | `snake_case`          | `step_id`, `retry_count`       |
| Classes            | `PascalCase`          | `WorkflowService`, `StepModel` |
| Constants          | `SCREAMING_SNAKE_CASE`| `MAX_RETRIES`, `DEFAULT_TTL`   |
| Module filenames   | `kebab-case`          | `workflow-service.py`, `step-handlers.py` |

### TypeScript

| Identifier type                      | Style                 | Example                         |
|--------------------------------------|-----------------------|---------------------------------|
| Functions                            | `camelCase`           | `fetchWorkflow`, `handleSubmit` |
| Variables                            | `camelCase`           | `stepCount`, `isLoading`        |
| Components, classes, and interfaces  | `PascalCase`          | `WorkflowBuilder`, `StepNode`, `IRunStatus` |
| Environment constants                | `SCREAMING_SNAKE_CASE`| `VITE_API_BASE_URL`, `NODE_ENV` |

### Database

| Element       | Convention                         | Example                               |
|---------------|------------------------------------|---------------------------------------|
| Table names   | `snake_case`, plural               | `workflow_runs`, `step_executions`    |
| Column names  | `snake_case`                       | `created_at`, `retry_count`           |
| Foreign keys  | `{table}_{column}_fk`              | `step_executions_run_id_fk`           |
| Indexes       | `{table}_{column}_idx`             | `step_executions_status_idx`          |

## Error Handling

<!-- Requirements: 5.3 -->

### Go

- Wrap errors with `fmt.Errorf("context: %w", err)` to preserve the error chain.
- Define sentinel errors in `errors.go` files at the package level, e.g. `var ErrNotFound = errors.New("not found")`.
- Match errors with `errors.Is` and `errors.As`; never compare error strings directly.
- Propagate gRPC status codes using `status.Errorf(codes.NotFound, "...")` so callers receive structured status errors.

### Python

- Define a custom exception hierarchy rooted at a base type, e.g. `ConductorError` → `ValidationError`, `NotFoundError`, `ProviderError`.
- Return HTTP 4xx for client errors and HTTP 5xx for server/infrastructure errors.
- Log full context with structlog: `log.error("msg", exc_info=True, step_id=step_id)`.

### TypeScript

- Use typed error responses, e.g. `{ error: string; code: string }`, so callers can discriminate on `code` without parsing strings.
- Wrap React component trees in error boundaries to prevent unhandled render errors from crashing the entire UI.
- No unhandled promise rejections — always attach `.catch()` or use `try/await/catch` blocks around every async call.

## Structured Logging

<!-- Requirements: 5.4 -->

All services emit logs in **JSON** format. Every log entry MUST include the following fields:

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | RFC3339 string | Time the log entry was produced |
| `level` | string | Log level: `debug`, `info`, `warn`, `error` |
| `service` | string | Name of the service emitting the log |
| `trace_id` | string | OpenTelemetry trace ID for distributed tracing |
| `span_id` | string | OpenTelemetry span ID |
| `msg` | string | Human-readable log message |

## Testing Standards

<!-- Requirements: 5.5 -->

### Coverage Minimums

| Language   | Minimum coverage |
|------------|-----------------|
| Go         | ≥ 80%           |
| Python     | ≥ 80%           |
| TypeScript | ≥ 70%           |

### Integration Tests

Integration tests are required for every public API endpoint — this covers both gRPC RPCs and FastAPI REST endpoints. Each endpoint must have at least one integration test that exercises the full request/response cycle against a real (or test-double) backing store.

### Test File Naming

| Service              | Convention                                                                  |
|----------------------|-----------------------------------------------------------------------------|
| Go services          | `*_test.go` files alongside the source file under test                      |
| Python services      | `tests/` subdirectory at the service root                                   |
| TypeScript services  | `__tests__/` directory or `*.test.ts` files alongside the source file       |

## Git Workflow

<!-- Requirements: 5.6 -->

### Branch Naming

Format: `{type}/{issue-id}-short-description`

| Type | When to use |
|------|-------------|
| `feat` | New feature work |
| `fix` | Bug fixes |
| `chore` | Maintenance, dependency updates, tooling |
| `docs` | Documentation-only changes |
| `refactor` | Code restructuring with no behavior change |
| `ci` | CI/CD pipeline changes |

Examples:
- `feat/42-dag-scheduler`
- `fix/17-lease-expiry-bug`
- `chore/8-update-deps`

### Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification.

Format: `{type}: {short imperative summary}`

Allowed types: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`, `ci:`

Example:
```
feat: add exponential backoff to lease reclaim
```

- Use the imperative mood in the summary ("add", not "added" or "adds").
- Keep the summary under 72 characters.
- Add a body when the change needs more context, separated from the summary by a blank line.

### Pull Request Requirements

- **Reviewer approval:** At least 1 reviewer must approve before merging.
- **CI must be green:** All checks (build, test, lint) must pass.
- **Merge strategy:** Squash merge only — keeps the default branch history linear.

## Observability

<!-- Requirements: 5.7, 5.8 -->

### Prometheus Metrics

Metric naming pattern: `conductor_{service}_{metric}_{unit}`

Examples: `conductor_orchestrator_step_duration_seconds`, `conductor_worker_task_errors_total`

Mandatory metric categories **per service**:

| Category | Metric type | Purpose |
|----------|-------------|---------|
| Latency | Histogram | Request/operation duration (e.g., `conductor_orchestrator_step_duration_seconds`) |
| Error rate | Counter | Total errors by type (e.g., `conductor_worker_task_errors_total`) |
| Throughput | Counter | Total operations completed (e.g., `conductor_api_requests_total`) |

### OpenTelemetry Tracing

Span naming convention: `{service}.{operation}`

Examples: `orchestrator.schedule_step`, `worker.execute_step`, `api.create_workflow`

Required context propagation headers: `traceparent`, `tracestate` (W3C Trace Context spec)

Mandatory spans:

- **Service entry points**: every inbound HTTP request, gRPC RPC call
- **External calls**: every outbound HTTP call, gRPC call
- **Database calls**: every Postgres query or transaction
- **Redis calls**: every Redis command
