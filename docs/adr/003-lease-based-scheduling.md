# 003 — Lease-Based Task Scheduling

**Status:** accepted

## Context

The orchestrator must assign steps to workers in a way that prevents duplicate execution when workers crash. Simple polling with distributed locks (e.g., Redis SETNX) requires careful lock expiry tuning and creates split-brain risks. An alternative is a lease model where each task assignment is time-bounded and self-healing.

## Decision

Lease + heartbeat scheduling is chosen over simple polling with distributed locks.

Rationale:
- A lease stored in Postgres (the source of truth) is durable across orchestrator restarts
- Workers send heartbeats every 10s; a 30s lease provides a comfortable 3× margin before reclaim
- If a worker crashes, its lease expires automatically — no explicit cleanup is required
- This model is proven in production systems including Temporal, AWS SQS visibility timeout, and Google Cloud Tasks
- Prevents duplicate execution: the UNIQUE constraint on `leases.step_execution_id` ensures only one worker holds a lease per step

## Consequences

**Positive:**
- Self-healing: crashed workers' steps are reclaimed within `lease_duration + reclaim_scan_interval` (≤ 45s)
- No separate lock service required; the `leases` table piggybacks on the Postgres source of truth
- Observable: lease state is queryable via SQL for debugging

**Negative:**
- Workers must implement heartbeat logic; failure to heartbeat causes unnecessary reclaim
- Reclaim latency (up to 45s) may be noticeable for short workflows; tunable via config
