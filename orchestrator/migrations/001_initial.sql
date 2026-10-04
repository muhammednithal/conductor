-- 001_initial.sql: Initial Conductor schema
-- Created tables in dependency order: users, workflows, workflow_runs,
-- step_executions, workers, leases

CREATE TABLE IF NOT EXISTS users (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT        NOT NULL UNIQUE,
    password_hash TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workflows (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id       UUID        NOT NULL REFERENCES users(id),
    name           TEXT        NOT NULL,
    description    TEXT,
    dag_definition JSONB       NOT NULL,
    version        INT         NOT NULL DEFAULT 1,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workflow_runs (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id  UUID        NOT NULL REFERENCES workflows(id),
    status       TEXT        NOT NULL CHECK (status IN ('PENDING','RUNNING','SUCCEEDED','FAILED','CANCELED')),
    input        JSONB,
    output       JSONB,
    triggered_by UUID        REFERENCES users(id),
    started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    error_msg    TEXT
);

CREATE TABLE IF NOT EXISTS step_executions (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id           UUID        NOT NULL REFERENCES workflow_runs(id),
    step_name        TEXT        NOT NULL,
    step_type        TEXT        NOT NULL CHECK (step_type IN ('http','transform','delay','summarize','embed','rag')),
    status           TEXT        NOT NULL CHECK (status IN ('PENDING','QUEUED','RUNNING','SUCCEEDED','FAILED','RETRYING','CANCELED')),
    attempt_count    INT         NOT NULL DEFAULT 0,
    max_attempts     INT         NOT NULL DEFAULT 3,
    idempotency_key  TEXT        NOT NULL UNIQUE,
    input            JSONB,
    output           JSONB,
    error_msg        TEXT,
    scheduled_after  TIMESTAMPTZ,
    started_at       TIMESTAMPTZ,
    completed_at     TIMESTAMPTZ,
    UNIQUE (run_id, step_name)
);

CREATE TABLE IF NOT EXISTS workers (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    hostname          TEXT        NOT NULL,
    grpc_address      TEXT        NOT NULL,
    status            TEXT        NOT NULL CHECK (status IN ('ONLINE','OFFLINE','DRAINING')),
    capacity          INT         NOT NULL DEFAULT 10,
    registered_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leases (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    step_execution_id  UUID        NOT NULL REFERENCES step_executions(id) UNIQUE,
    worker_id          UUID        NOT NULL REFERENCES workers(id),
    acquired_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at         TIMESTAMPTZ NOT NULL,
    renewed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
