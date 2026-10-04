# Conductor — Vision

## What is Conductor?

Conductor is a workflow orchestrator built for AI-powered pipelines. It lets teams define a sequence of steps — such as fetching data, calling an AI model, transforming results, and storing output — as a structured plan called a workflow. Conductor then runs those steps reliably across a pool of workers, tracking progress and handling failures automatically.

At its core, Conductor is a coordination layer. Teams describe *what* should happen and in what order; Conductor decides *when* and *where* each piece of work runs, and makes sure nothing gets lost even when machines crash or networks hiccup.

The system ships with a visual drag-and-drop builder so workflows can be designed without writing configuration by hand, and a live dashboard that shows exactly what is happening inside any running workflow at any moment.

## Why Does It Exist?

Most teams building AI pipelines start with scripts: a Python file that calls one model, pipes the result into another, and writes the final output somewhere. These scripts work fine for demos. In production they become a liability — if the script crashes halfway through, there is no automatic recovery; the whole job must be restarted from scratch. If multiple jobs run at once, there is no visibility into which one is stuck or why.

Conductor exists to replace that fragile approach. It gives every step a durable state stored in a database, so a crash mid-pipeline means only the failed step restarts, not the whole workflow. Retry logic with automatic backoff is built in, so transient errors (a slow API response, a briefly unavailable service) resolve themselves without human intervention.

Visibility is a first-class feature. Every state change — a step starting, succeeding, or failing — is captured and streamed to the dashboard in real time. Teams move from blind-firing scripts to having an operational picture of every workflow execution.

## Who Uses It?

| Persona | Role | Primary use case |
|---|---|---|
| ML Engineer | Builds and iterates on AI pipelines | Chains together embedding, summarization, and retrieval steps; monitors token usage and cost per run |
| Platform Engineer | Owns reliability and infrastructure | Deploys the worker pool, configures retry budgets, sets up monitoring, responds to incidents |
| Data Analyst | Consumes workflow outputs | Triggers document-processing workflows, inspects run history, and reviews per-step outputs without touching code |

## End-to-End Example Workflow

The following example shows how a team might use Conductor to process a research paper and produce a structured summary.

```
Upload PDF
    │
    ▼
Chunk text        ← splits the document into overlapping passages
    │
    ▼
Embed chunks      ← turns each passage into a vector for search
    │
    ▼
Summarize each chunk  ← calls an AI model on every passage in parallel
    │
    ▼
Merge summaries   ← combines the per-chunk results into a single document
    │
    ▼
Write output      ← stores the final summary and metadata
```

Each box is a step in the workflow. Steps that do not depend on each other (such as summarizing different chunks) run in parallel across the worker pool. If the "Embed chunks" step fails due to a temporary network error, Conductor retries it automatically before any downstream steps are attempted.

## Success Criteria

Conductor is considered production-ready when all four of the following outcomes can be demonstrated:

1. **Throughput** — A single workflow containing 10 steps completes end-to-end within 30 seconds on a cluster of 2 workers.
2. **Crash recovery** — When a worker crashes mid-execution, its in-progress steps are automatically reclaimed and re-run within 60 seconds, with no manual intervention.
3. **Concurrency** — The system runs 100 simultaneous workflow executions without losing any job.
4. **Live visibility** — The web dashboard reflects each step's state change within 2 seconds of the change occurring.

## Glossary

**DAG (Directed Acyclic Graph)** — A way of describing a workflow as a set of steps (nodes) connected by dependency arrows (edges). "Directed" means arrows point one way; "acyclic" means there are no loops. Conductor uses a DAG to determine which steps can run in parallel and which must wait for others to finish.

**Orchestrator** — The central service that reads a workflow's DAG, decides when each step is ready to run, assigns work to available workers, and records every state change to the database.

**Worker** — A process that receives step assignments from the orchestrator, executes the actual work (calling an AI model, making an HTTP request, transforming data), and reports back when the step succeeds or fails.

**Lease** — A time-limited claim that a worker holds on a step it is currently executing. The worker must send a heartbeat every 10 seconds to keep the lease alive. If the lease expires — because the worker crashed or went silent — the orchestrator reclaims the step and reschedules it.

**Step** — A single unit of work inside a workflow. Examples include calling an AI model to summarize text, making an HTTP request, or applying a data transformation. Each step has a type, a configuration, and a status that moves through a defined lifecycle (pending → running → succeeded or failed).

**Run** — One execution of a workflow. A workflow is the reusable template; a run is the live instance created when someone triggers that template with a specific input. Each run has its own set of step executions and its own outcome.
