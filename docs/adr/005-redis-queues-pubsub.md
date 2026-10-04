# 005 — Redis for Task Queues and Pub/Sub

**Status:** accepted

## Context

Conductor needs two message transport capabilities: (1) a task queue for dispatching step IDs to workers, and (2) a pub/sub channel for broadcasting step state changes to SSE subscribers. Options considered: Redis (Lists + Pub/Sub), Apache Kafka, RabbitMQ, or Postgres LISTEN/NOTIFY.

## Decision

Redis is chosen for both task queues (List RPUSH/BLPOP) and event pub/sub (PUBLISH/SUBSCRIBE).

Rationale:
- Sub-millisecond latency for queue push/pop is sufficient for this scale
- Redis Lists (RPUSH/BLPOP) provide a simple, reliable FIFO queue with blocking pop
- Redis Pub/Sub enables SSE fan-out from the orchestrator to many concurrent web clients
- Operationally simpler than Kafka: no ZooKeeper/KRaft, no partition management, no consumer group complexity
- Redis already needed for rate limiting (token bucket) and idempotency cache; adding queues/pub-sub adds no new infrastructure dependency

## Consequences

**Positive:**
- Low operational overhead: single Redis instance serves queuing, pub/sub, rate limiting, and idempotency caching
- BLPOP blocks efficiently, eliminating polling loops in workers
- Pub/Sub delivers state changes within milliseconds to SSE subscribers

**Negative:**
- Redis Pub/Sub is fire-and-forget: messages are lost if a subscriber is disconnected (acceptable because Postgres holds durable state)
- Redis is in-memory; data is lost on restart without persistence (acceptable for queues, since crash recovery re-queues from Postgres)
- Not suitable for very high throughput (millions of tasks/sec); Kafka would be required at that scale
