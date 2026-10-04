# Requirements Document

## Introduction

Conductor is a distributed AI workflow orchestrator (mini Temporal/Airflow for LLM tasks) that enables users to define workflows as DAGs of steps and execute them reliably across many workers, surviving crashes. This requirements document focuses on the **documentation-first phase** of the project, establishing the foundational documentation structure before any application code is written.

The documentation must be tool-neutral, working seamlessly with Cursor, Claude Code, Kiro, Codex, and other AI-assisted development tools. After the architecture documentation is complete, the team will stop and wait for approval before writing any application code.

## Glossary

- **Conductor**: The distributed AI workflow orchestrator system being documented
- **DAG**: Directed Acyclic Graph - the structure used to define workflow step dependencies
- **Orchestrator**: The Go service that parses DAGs, schedules steps, and manages state
- **Worker**: The Go service that executes individual workflow steps
- **API_AI_Service**: The FastAPI service handling authentication, workflow CRUD, and AI endpoints
- **Web_Dashboard**: The React application providing the user interface
- **AGENTS_MD**: The single source of truth document for AI coding assistant rules
- **Architecture_Doc**: The comprehensive technical architecture documentation
- **Milestone_Spec**: A specification document defining scope, goals, and tasks for each development phase
- **ADR**: Architecture Decision Record - documents capturing non-obvious technical decisions
- **State_Machine**: The defined transitions for step execution states (PENDING, QUEUED, RUNNING, SUCCEEDED, FAILED, RETRYING, CANCELED)
- **Lease**: Time-bounded task assignment to workers with heartbeat renewal

## Requirements

### Requirement 1: AGENTS.md Single Source of Truth

**User Story:** As an AI coding assistant user, I want a single AGENTS.md file that serves as the authoritative source of project rules, so that all AI tools follow consistent guidelines regardless of which tool I use.

#### Acceptance Criteria

1. THE Documentation_System SHALL contain an AGENTS.md file at the repository root
2. THE AGENTS_MD SHALL provide a project summary of 3-6 sentences not exceeding 150 words describing Conductor's purpose, target users, and core capabilities
3. THE AGENTS_MD SHALL include a repository map showing the monorepo structure (/orchestrator, /worker, /api-ai, /web, /deploy, /docs)
4. THE AGENTS_MD SHALL specify exact build, test, lint, and run commands for each service
5. THE AGENTS_MD SHALL define hard rules including: state transitions only through state-machine package, never edit applied migrations, every change ships with tests, no new dependencies without asking, don't touch files outside task scope, don't refactor unrelated code
6. THE AGENTS_MD SHALL include a definition of done checklist specifying: tests pass, lint passes, PROGRESS.md updated, and no unrelated changes
7. THE AGENTS_MD SHALL instruct AI assistants to read docs/01-architecture.md and the current milestone spec in docs/milestones/ before coding
8. THE AGENTS_MD SHALL instruct AI assistants to update docs/PROGRESS.md after finishing work
9. THE AGENTS_MD SHALL remain under 100 lines to ensure readability and quick parsing

### Requirement 2: Tool-Specific Pointer Files

**User Story:** As a developer using different AI tools, I want tool-specific configuration files that point to AGENTS.md, so that each tool discovers the shared rules without duplication.

#### Acceptance Criteria

1. THE Documentation_System SHALL contain a CLAUDE.md file at the repository root
2. THE CLAUDE_MD SHALL contain a directive instructing the AI tool to read AGENTS.md as the source of truth, with total content not exceeding 5 lines
3. THE Documentation_System SHALL contain a .cursor/rules/ directory with pointer files
4. THE Cursor_Rules SHALL contain pointers to AGENTS.md and the docs/ directory only, not exceeding 10 lines of content
5. THE Documentation_System SHALL contain a .kiro/steering/ directory with pointer files
6. THE Kiro_Steering SHALL contain pointers to AGENTS.md and the docs/ directory only, not exceeding 10 lines of content
7. WHEN new AI tools are adopted, THE Documentation_System SHALL support adding new pointer files that contain only references to AGENTS.md and the docs/ directory rather than duplicating rule content from those sources

### Requirement 3: Vision Document

**User Story:** As a new team member or stakeholder, I want a plain-language vision document, so that I understand what Conductor is and why it exists without reading technical specifications.

#### Acceptance Criteria

1. THE Documentation_System SHALL contain a docs/00-vision.md file
2. THE Vision_Doc SHALL explain what Conductor is in language that avoids technical jargon and defines any necessary technical terms in a glossary section or on first use
3. THE Vision_Doc SHALL articulate why Conductor is being built and the problems it solves
4. THE Vision_Doc SHALL describe the target users and their use cases with at least one end-to-end workflow example (e.g., Upload PDF -> chunk -> embed -> summarize each chunk -> merge -> output)
5. THE Vision_Doc SHALL state the project's success criteria as measurable outcomes without specifying implementation details
6. THE Vision_Doc SHALL use short paragraphs, clear headings, and avoid acronyms unless defined, so that readers without software development experience can understand the content

### Requirement 4: Architecture Document

**User Story:** As a developer or architect, I want a comprehensive architecture document, so that I understand the system's data model, state machine, API contracts, and failure handling before writing code.

#### Acceptance Criteria

1. THE Documentation_System SHALL contain a docs/01-architecture.md file
2. THE Architecture_Doc SHALL define the data model for workflows, steps, runs, and workers in Postgres including entity relationships, primary keys, foreign keys, and required fields for each table
3. THE Architecture_Doc SHALL include a state machine diagram showing all step states (PENDING, QUEUED, RUNNING, SUCCEEDED, FAILED, RETRYING, CANCELED) with transitions labeled by trigger events
4. THE Architecture_Doc SHALL document API contracts for the orchestrator gRPC/REST API, worker registration, and FastAPI endpoints, specifying HTTP method or RPC name, request parameters, response structure, and error responses for each endpoint
5. THE Architecture_Doc SHALL describe failure scenarios including worker crashes, network partitions, and orchestrator restarts, specifying detection mechanism and system response for each failure type
6. THE Architecture_Doc SHALL explain crash recovery by specifying which Postgres tables are queried on orchestrator restart and how incomplete tasks resume execution
7. THE Architecture_Doc SHALL document the lease-based task assignment including heartbeat interval, lease duration, and conditions under which tasks are reclaimed from unresponsive workers
8. THE Architecture_Doc SHALL specify retry behavior including base interval, multiplier, max duration, jitter range, max attempts, and dead-letter state transition criteria
9. THE Architecture_Doc SHALL explain idempotency key generation, storage location, and duplicate detection mechanism to prevent duplicate side effects
10. THE Architecture_Doc SHALL document per-step default timeout duration, cancellation event sequence, and rate limiting values for LLM calls as requests per time window
11. THE Architecture_Doc SHALL include a Mermaid architecture diagram showing all services, data stores, and message flows between components

### Requirement 5: Conventions Document

**User Story:** As a developer, I want a conventions document, so that I follow consistent naming, error handling, logging, testing, and git practices across the codebase.

#### Acceptance Criteria

1. THE Documentation_System SHALL contain a docs/02-conventions.md file
2. THE Conventions_Doc SHALL define naming conventions for Go, Python, TypeScript, and database objects, covering functions, variables, constants, types, packages, files, database tables, and database columns
3. THE Conventions_Doc SHALL specify error handling patterns for each language and service, including error wrapping, error propagation across service boundaries, error categorization for retry logic, and user-facing error message guidelines
4. THE Conventions_Doc SHALL establish structured logging format using JSON and required context fields including timestamp, log level, service name, trace ID, and span ID
5. THE Conventions_Doc SHALL define testing standards including minimum unit test coverage percentage, integration test scope, test file naming conventions, and specification of which code categories require tests versus are exempt
6. THE Conventions_Doc SHALL specify git workflow rules including branch naming format, commit message format following Conventional Commits, and PR requirements including required reviewer count, required CI checks, and merge strategy
7. THE Conventions_Doc SHALL document Prometheus metrics naming conventions and required observability instrumentation including mandatory metric categories for latency, error rates, and throughput per service
8. THE Conventions_Doc SHALL specify OpenTelemetry tracing requirements across Go and Python services, including span naming conventions, required context propagation headers, and mandatory spans for service entry points and external calls

### Requirement 6: Architecture Decision Records

**User Story:** As a current or future team member, I want architecture decision records, so that I understand why non-obvious technical decisions were made.

#### Acceptance Criteria

1. THE Documentation_System SHALL contain a docs/adr/ directory
2. THE ADR_Directory SHALL contain one file per architectural decision, where architectural decisions are choices affecting system structure, technology selection, external dependencies, or cross-component interactions
3. WHEN an architectural choice is made, THE ADR SHALL document context explaining the problem being addressed with background information, decision stating the chosen approach with rationale, and consequences describing both positive and negative impacts
4. THE ADR_Format SHALL include: title, status (proposed, accepted, deprecated, or superseded), context, decision, and consequences sections
5. THE ADR_Collection SHALL cover initial decisions including: choice of Go for orchestrator/worker, choice of FastAPI for API, lease-based scheduling vs polling, Postgres as source of truth, Redis for queues/pubsub
6. EACH ADR file SHALL follow the naming convention NNN-short-title.md where NNN is a sequential number and SHALL NOT exceed 500 words

### Requirement 7: Milestone Specifications

**User Story:** As a project manager or developer, I want milestone specifications, so that I understand the incremental delivery plan with clear scope, goals, and acceptance criteria for each phase.

#### Acceptance Criteria

1. THE Documentation_System SHALL contain docs/milestones/M1.md through docs/milestones/M6.md
2. EACH Milestone_Spec SHALL include: goal (1-3 sentences), scope (bulleted list), non-goals (minimum 2 items), acceptance criteria (minimum 3 items), and task list (5-10 tasks per milestone)
3. THE M1_Spec SHALL specify implementation requirements for: orchestrator + one worker, linear jobs in Postgres
4. THE M2_Spec SHALL specify implementation requirements for: DAG execution, retries, heartbeats, lease reclaim
5. THE M3_Spec SHALL specify implementation requirements for: FastAPI integration with summarize and embed as step types
6. THE M4_Spec SHALL specify implementation requirements for: React live run viewer with SSE/WebSocket
7. THE M5_Spec SHALL specify implementation requirements for: drag-and-drop workflow builder and RAG workflow
8. THE M6_Spec SHALL specify implementation requirements for: chaos testing, observability polish, and documentation finalization
9. EACH Milestone_Spec acceptance criterion SHALL be binary verifiable, meaning a tester can determine pass or fail without subjective judgment
10. IF a milestone file M1.md through M6.md is missing, THEN THE Documentation_System SHALL report the missing file as a validation error

### Requirement 8: Progress Tracking Document

**User Story:** As a team member or AI assistant, I want a progress tracking document, so that I can see what's done, in progress, next, and any known issues or open questions.

#### Acceptance Criteria

1. THE Documentation_System SHALL contain a docs/PROGRESS.md file
2. THE Progress_Doc SHALL include sections in order: Done, In Progress, Next, Known Issues, Open Questions
3. WHEN a task or requirement is verified as complete, THE AI_Assistant SHALL move the entry from In Progress to Done with a completion date
4. WHEN work begins on a task, THE AI_Assistant SHALL add an entry to In Progress identifying the item being worked on
5. WHEN a blocking problem is discovered, THE AI_Assistant SHALL add an entry to Known Issues with a description of the impact
6. WHEN a decision or clarification is needed, THE AI_Assistant SHALL add an entry to Open Questions
7. THE Progress_Doc SHALL be updated when any of the following occurs: a task status changes, an issue is discovered, or a question arises
8. WHEN first created, THE Progress_Doc SHALL populate the current status reflecting the documentation-first phase

### Requirement 9: Documentation-Only Deliverable

**User Story:** As a project stakeholder, I want the initial deliverable to contain only documentation, so that the architecture can be reviewed and approved before any application code is written.

#### Acceptance Criteria

1. THE Initial_Deliverable SHALL contain all documentation files specified in requirements 1-8
2. THE Initial_Deliverable SHALL NOT contain any application code including Go source files, Python source files, TypeScript files, JavaScript files, shell scripts, or compiled binaries
3. THE Initial_Deliverable SHALL NOT contain database migrations
4. THE Initial_Deliverable SHALL NOT contain Docker Compose files, Dockerfiles, or container orchestration configurations
5. IF application code is requested before architecture approval, THEN THE Documentation_System SHALL provide a message indicating approval is required and retain the request pending approval
6. THE Documentation SHALL contain named components, defined interfaces, explicit data flows, and concrete technology choices rather than generic descriptions or TODO markers
7. WHEN architecture approval is granted, THE Documentation_System SHALL record the approval from a stakeholder before permitting code generation

### Requirement 10: Tool-Neutral Documentation

**User Story:** As a team using multiple AI development tools, I want documentation that works with any AI coding assistant, so that we're not locked into a specific tool.

#### Acceptance Criteria

1. THE Documentation SHALL use CommonMark-compliant Markdown syntax with GitHub Flavored Markdown tables and fenced code blocks
2. THE Documentation SHALL avoid custom directives, proprietary frontmatter schemas, and non-standard code block annotations
3. THE AGENTS_MD SHALL use plain-language instructions that reference standard programming concepts without tool-specific commands or trigger phrases
4. THE Documentation SHALL use Mermaid for diagrams
5. WHEN referencing file paths, THE Documentation SHALL use forward slashes for cross-platform compatibility
6. THE Documentation Structure SHALL follow heading hierarchies, code blocks with language identifiers, and bullet lists as primary formatting elements
7. WHEN configuration examples are provided, THE Documentation SHALL use standard file formats (JSON, YAML, TOML) without tool-specific extensions

### Requirement 11: Monorepo Structure Documentation

**User Story:** As a developer, I want the documentation to establish the monorepo structure, so that when code is written it follows a consistent organization.

#### Acceptance Criteria

1. THE Documentation SHALL define the following top-level directories: /orchestrator, /worker, /api-ai, /web, /deploy, /docs, /shared
2. THE Architecture_Doc SHALL describe the purpose of each top-level directory in a dedicated "Repository Structure" section, including what file types belong in each
3. THE AGENTS_MD SHALL include the repository map as an ASCII tree showing all top-level directories and their primary subdirectories to a depth of 2 levels
4. THE Documentation SHALL specify that database migrations belong in /orchestrator/migrations/ as the single source of schema changes
5. THE Documentation SHALL specify that OpenAPI specs belong in /api-ai/openapi/ and proto/schema definitions belong in /shared/proto/
6. THE Documentation SHALL specify test file locations following language conventions: Go services use *_test.go files alongside source files, Python services use a tests/ subdirectory, and TypeScript services use a __tests__/ subdirectory or *.test.ts files alongside source files

### Requirement 12: Service Specification in Documentation

**User Story:** As a developer, I want each service clearly specified in the architecture documentation, so that I understand what each service does before implementation begins.

#### Acceptance Criteria

1. THE Architecture_Doc SHALL specify the Orchestrator service responsibilities including: DAG parsing, validation, scheduling, state persistence, lease management, retry logic, crash recovery, timeouts, cancellation, rate limiting, and event emission, with each responsibility described as a subsection containing its purpose and observable behavior
2. THE Architecture_Doc SHALL specify the Worker service responsibilities including: registration, task polling/streaming, heartbeats, step execution (http, transform, delay), FastAPI calls for AI steps, graceful shutdown, and concurrency configuration, with each responsibility described as a subsection containing its purpose and observable behavior
3. THE Architecture_Doc SHALL specify the API_AI_Service responsibilities including: authentication (JWT), workflow CRUD, run triggering, run history, AI endpoints (summarize, embed, RAG query), streaming responses, pluggable LLM provider interface, and token/cost tracking, with each responsibility described as a subsection containing its purpose and observable behavior
4. THE Architecture_Doc SHALL specify the Web_Dashboard responsibilities including: drag-and-drop workflow builder, run viewer with real-time state updates, run history, cost/latency dashboard, and worker status page, with each responsibility described as a subsection containing its purpose and observable behavior
5. THE Architecture_Doc SHALL document inter-service communication by specifying: the protocol used for each service pair (gRPC, REST, WebSocket, or SSE), the direction of calls between services, and a service dependency diagram showing which services call which other services
