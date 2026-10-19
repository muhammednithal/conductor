-- 002_ai_token_usage.sql: token usage tracking for cost reporting

CREATE TABLE IF NOT EXISTS ai_token_usage (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID        NOT NULL REFERENCES users(id),
    run_id       UUID        REFERENCES workflow_runs(id),
    operation    TEXT        NOT NULL CHECK (operation IN ('summarize', 'embed', 'rag')),
    tokens_used  INT         NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);