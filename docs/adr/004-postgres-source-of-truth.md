# 004 — Postgres as Source of Truth

**Status:** accepted

## Context

Conductor's state machine requires strict consistency: a step must not be simultaneously RUNNING on two workers, and state transitions must survive orchestrator crashes. Options considered: Postgres (relational, ACID), Redis (in-memory, fast), or a dedicated workflow state store.

## Decision

Postgres is chosen as the sole source of truth for all workflow, run, and step state.

Rationale:
- DAG execution state requires ACID transactions to safely transition steps and leases atomically
- The relational model maps naturally: workflows → runs → step_executions → leases
- Strong consistency is required for the state machine; eventual consistency is not acceptable
- Postgres survives process crashes; Redis without AOF/RDB persistence does not
- Foreign keys enforce referential integrity between tables

## Consequences

**Positive:**
- All state is durable by default; orchestrator restart is safe
- SQL queries make debugging and observability straightforward
- ACID transactions allow atomic state transitions (e.g., insert lease + update step status in one transaction)
- Mature tooling: migrations, schema introspection, monitoring

**Negative:**
- Postgres is a single point of failure without replication (mitigated by standard HA setup)
- Higher latency than Redis for read-heavy workloads; mitigated by using Redis as a task queue cache
- Schema migrations require care; applied migrations must never be edited
