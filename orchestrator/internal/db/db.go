package db

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DB wraps a pgxpool.Pool and exposes all persistence operations for the orchestrator.
type DB struct {
	pool *pgxpool.Pool
}

// New creates a new DB with a pgx connection pool.
func New(ctx context.Context, databaseURL string) (*DB, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("db: parse config: %w", err)
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("db: connect: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("db: ping: %w", err)
	}
	return &DB{pool: pool}, nil
}

// Close closes the connection pool.
func (d *DB) Close() {
	d.pool.Close()
}

// Pool returns the underlying pgxpool.Pool for use in tests.
func (d *DB) Pool() *pgxpool.Pool {
	return d.pool
}

// RunMigrations reads all *.sql files from migrationsDir in lexicographic order
// and executes each in a transaction.
func (d *DB) RunMigrations(ctx context.Context, migrationsDir string) error {
	entries, err := os.ReadDir(migrationsDir)
	if err != nil {
		return fmt.Errorf("db: read migrations dir %s: %w", migrationsDir, err)
	}
	var files []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			files = append(files, filepath.Join(migrationsDir, e.Name()))
		}
	}
	sort.Strings(files)
	for _, f := range files {
		sql, err := os.ReadFile(f)
		if err != nil {
			return fmt.Errorf("db: read migration %s: %w", f, err)
		}
		tx, err := d.pool.Begin(ctx)
		if err != nil {
			return fmt.Errorf("db: begin migration tx for %s: %w", f, err)
		}
		if _, err := tx.Exec(ctx, string(sql)); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("db: execute migration %s: %w", f, err)
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("db: commit migration %s: %w", f, err)
		}
	}
	return nil
}

// --- Statemachine DB interface ---

// GetStepStatus returns the current status string for a step_execution.
func (d *DB) GetStepStatus(ctx context.Context, stepID string) (string, error) {
	var status string
	err := d.pool.QueryRow(ctx,
		`SELECT status FROM step_executions WHERE id = $1`, stepID,
	).Scan(&status)
	if err != nil {
		return "", fmt.Errorf("db: get step status %s: %w", stepID, err)
	}
	return status, nil
}

// UpdateStepStatus updates step_executions.status and returns an error if zero rows matched.
func (d *DB) UpdateStepStatus(ctx context.Context, stepID, newStatus string) error {
	tag, err := d.pool.Exec(ctx,
		`UPDATE step_executions SET status = $2 WHERE id = $1`, stepID, newStatus,
	)
	if err != nil {
		return fmt.Errorf("db: update step status %s: %w", stepID, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("db: update step status %s: no rows affected", stepID)
	}
	return nil
}

// --- Data structs ---

// StepDefinition mirrors a single entry in the dag_definition.steps array.
type StepDefinition struct {
	Name           string          `json:"name"`
	Type           string          `json:"type"`
	DependsOn      []string        `json:"depends_on"`
	Config         json.RawMessage `json:"config"`
	TimeoutSeconds int             `json:"timeout_seconds"`
	MaxAttempts    int             `json:"max_attempts"`
}

// DAGDefinition is the top-level dag_definition JSON object.
type DAGDefinition struct {
	Steps []StepDefinition `json:"steps"`
}

// StepExecution mirrors the step_executions table.
type StepExecution struct {
	ID             string
	RunID          string
	StepName       string
	StepType       string
	Status         string
	AttemptCount   int
	MaxAttempts    int
	IdempotencyKey string
	Input          json.RawMessage
	Output         json.RawMessage
	ErrorMsg       string
	ScheduledAfter *time.Time
	StartedAt      *time.Time
	CompletedAt    *time.Time
}

// Worker mirrors the workers table.
type Worker struct {
	ID              string
	Hostname        string
	GRPCAddress     string
	Status          string
	Capacity        int
	RegisteredAt    time.Time
	LastHeartbeatAt time.Time
}

// Lease mirrors the leases table.
type Lease struct {
	ID              string
	StepExecutionID string
	WorkerID        string
	AcquiredAt      time.Time
	ExpiresAt       time.Time
	RenewedAt       time.Time
}

// WorkflowRun mirrors the workflow_runs table.
type WorkflowRun struct {
	ID          string
	WorkflowID  string
	Status      string
	Input       json.RawMessage
	Output      json.RawMessage
	TriggeredBy string
	StartedAt   time.Time
	CompletedAt *time.Time
	ErrorMsg    string
}

// --- CRUD helpers ---

// GetPendingReadySteps returns PENDING step_executions whose all depends_on
// steps have status = 'SUCCEEDED', or have no dependencies.
func (d *DB) GetPendingReadySteps(ctx context.Context) ([]StepExecution, error) {
	// Fetch all PENDING steps with their run's dag_definition.
	rows, err := d.pool.Query(ctx, `
		SELECT se.id, se.run_id, se.step_name, se.step_type, se.status,
		       se.attempt_count, se.max_attempts, se.idempotency_key,
		       se.input, se.output, COALESCE(se.error_msg, ''),
		       se.scheduled_after, se.started_at, se.completed_at,
		       w.dag_definition
		FROM step_executions se
		JOIN workflow_runs wr ON wr.id = se.run_id
		JOIN workflows w ON w.id = wr.workflow_id
		WHERE se.status = 'PENDING'
	`)
	if err != nil {
		return nil, fmt.Errorf("db: get pending steps: %w", err)
	}
	defer rows.Close()

	type pendingRow struct {
		se            StepExecution
		dagDefinition []byte
	}
	var pending []pendingRow
	for rows.Next() {
		var r pendingRow
		var dagRaw []byte
		if err := rows.Scan(
			&r.se.ID, &r.se.RunID, &r.se.StepName, &r.se.StepType, &r.se.Status,
			&r.se.AttemptCount, &r.se.MaxAttempts, &r.se.IdempotencyKey,
			&r.se.Input, &r.se.Output, &r.se.ErrorMsg,
			&r.se.ScheduledAfter, &r.se.StartedAt, &r.se.CompletedAt,
			&dagRaw,
		); err != nil {
			return nil, fmt.Errorf("db: scan pending step: %w", err)
		}
		r.dagDefinition = dagRaw
		pending = append(pending, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("db: pending steps rows: %w", err)
	}

	var ready []StepExecution
	for _, r := range pending {
		var dag DAGDefinition
		if err := json.Unmarshal(r.dagDefinition, &dag); err != nil {
			continue // skip if dag unparseable
		}
		var deps []string
		for _, step := range dag.Steps {
			if step.Name == r.se.StepName {
				deps = step.DependsOn
				break
			}
		}
		if len(deps) == 0 {
			ready = append(ready, r.se)
			continue
		}
		// Check that all deps are SUCCEEDED.
		allSucceeded := true
		for _, dep := range deps {
			var depStatus string
			err := d.pool.QueryRow(ctx,
				`SELECT status FROM step_executions WHERE run_id = $1 AND step_name = $2`,
				r.se.RunID, dep,
			).Scan(&depStatus)
			if err != nil || depStatus != "SUCCEEDED" {
				allSucceeded = false
				break
			}
		}
		if allSucceeded {
			ready = append(ready, r.se)
		}
	}
	return ready, nil
}

// GetRetryingReadySteps returns RETRYING steps whose scheduled_after <= NOW().
func (d *DB) GetRetryingReadySteps(ctx context.Context) ([]StepExecution, error) {
	rows, err := d.pool.Query(ctx, `
		SELECT id, run_id, step_name, step_type, status,
		       attempt_count, max_attempts, idempotency_key,
		       input, output, COALESCE(error_msg, ''),
		       scheduled_after, started_at, completed_at
		FROM step_executions
		WHERE status = 'RETRYING' AND (scheduled_after IS NULL OR scheduled_after <= NOW())
	`)
	if err != nil {
		return nil, fmt.Errorf("db: get retrying steps: %w", err)
	}
	defer rows.Close()
	return scanStepRows(rows)
}

// GetStepByID returns a single StepExecution by ID.
func (d *DB) GetStepByID(ctx context.Context, stepID string) (*StepExecution, error) {
	var se StepExecution
	err := d.pool.QueryRow(ctx, `
		SELECT id, run_id, step_name, step_type, status,
		       attempt_count, max_attempts, idempotency_key,
		       input, output, COALESCE(error_msg, ''),
		       scheduled_after, started_at, completed_at
		FROM step_executions WHERE id = $1
	`, stepID).Scan(
		&se.ID, &se.RunID, &se.StepName, &se.StepType, &se.Status,
		&se.AttemptCount, &se.MaxAttempts, &se.IdempotencyKey,
		&se.Input, &se.Output, &se.ErrorMsg,
		&se.ScheduledAfter, &se.StartedAt, &se.CompletedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("db: get step %s: %w", stepID, err)
	}
	return &se, nil
}

// UpsertWorker inserts or updates a worker row.
func (d *DB) UpsertWorker(ctx context.Context, w Worker) error {
	_, err := d.pool.Exec(ctx, `
		INSERT INTO workers (id, hostname, grpc_address, status, capacity)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (id) DO UPDATE SET
			hostname = EXCLUDED.hostname,
			grpc_address = EXCLUDED.grpc_address,
			status = EXCLUDED.status,
			capacity = EXCLUDED.capacity,
			last_heartbeat_at = NOW()
	`, w.ID, w.Hostname, w.GRPCAddress, w.Status, w.Capacity)
	if err != nil {
		return fmt.Errorf("db: upsert worker %s: %w", w.ID, err)
	}
	return nil
}

// UpdateWorkerHeartbeat sets last_heartbeat_at to NOW() for the given worker.
func (d *DB) UpdateWorkerHeartbeat(ctx context.Context, workerID string) error {
	_, err := d.pool.Exec(ctx,
		`UPDATE workers SET last_heartbeat_at = NOW() WHERE id = $1`, workerID)
	if err != nil {
		return fmt.Errorf("db: heartbeat worker %s: %w", workerID, err)
	}
	return nil
}

// UpdateWorkerStatus updates a worker's status column.
func (d *DB) UpdateWorkerStatus(ctx context.Context, workerID, status string) error {
	_, err := d.pool.Exec(ctx,
		`UPDATE workers SET status = $2 WHERE id = $1`, workerID, status)
	if err != nil {
		return fmt.Errorf("db: update worker status %s: %w", workerID, err)
	}
	return nil
}

// InsertLease inserts a new lease row.
func (d *DB) InsertLease(ctx context.Context, l Lease) error {
	_, err := d.pool.Exec(ctx, `
		INSERT INTO leases (id, step_execution_id, worker_id, acquired_at, expires_at, renewed_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, l.ID, l.StepExecutionID, l.WorkerID, l.AcquiredAt, l.ExpiresAt, l.RenewedAt)
	if err != nil {
		return fmt.Errorf("db: insert lease for step %s: %w", l.StepExecutionID, err)
	}
	return nil
}

// DeleteLease removes the lease for a step execution.
func (d *DB) DeleteLease(ctx context.Context, stepExecutionID string) error {
	_, err := d.pool.Exec(ctx,
		`DELETE FROM leases WHERE step_execution_id = $1`, stepExecutionID)
	if err != nil {
		return fmt.Errorf("db: delete lease for step %s: %w", stepExecutionID, err)
	}
	return nil
}

// RenewLease extends the lease expiry by 30 seconds.
func (d *DB) RenewLease(ctx context.Context, stepExecutionID string) error {
	_, err := d.pool.Exec(ctx, `
		UPDATE leases
		SET renewed_at = NOW(), expires_at = NOW() + INTERVAL '30 seconds'
		WHERE step_execution_id = $1
	`, stepExecutionID)
	if err != nil {
		return fmt.Errorf("db: renew lease for step %s: %w", stepExecutionID, err)
	}
	return nil
}

// UpdateStepOutput stores the executor output for a completed step.
func (d *DB) UpdateStepOutput(ctx context.Context, stepID string, output json.RawMessage) error {
	_, err := d.pool.Exec(ctx,
		`UPDATE step_executions SET output = $2, completed_at = NOW() WHERE id = $1`,
		stepID, output)
	if err != nil {
		return fmt.Errorf("db: update step output %s: %w", stepID, err)
	}
	return nil
}

// UpdateStepError stores the error message for a failed step.
func (d *DB) UpdateStepError(ctx context.Context, stepID, errMsg string) error {
	_, err := d.pool.Exec(ctx,
		`UPDATE step_executions SET error_msg = $2 WHERE id = $1`, stepID, errMsg)
	if err != nil {
		return fmt.Errorf("db: update step error %s: %w", stepID, err)
	}
	return nil
}

// SetStepScheduledAfter sets the retry schedule time for a step.
func (d *DB) SetStepScheduledAfter(ctx context.Context, stepID string, after time.Time) error {
	_, err := d.pool.Exec(ctx,
		`UPDATE step_executions SET scheduled_after = $2 WHERE id = $1`, stepID, after)
	if err != nil {
		return fmt.Errorf("db: set scheduled_after %s: %w", stepID, err)
	}
	return nil
}

// IncrementStepAttempt increments attempt_count and sets started_at = NOW().
func (d *DB) IncrementStepAttempt(ctx context.Context, stepID string) error {
	_, err := d.pool.Exec(ctx, `
		UPDATE step_executions
		SET attempt_count = attempt_count + 1, started_at = NOW()
		WHERE id = $1
	`, stepID)
	if err != nil {
		return fmt.Errorf("db: increment attempt %s: %w", stepID, err)
	}
	return nil
}

// CreateRun inserts a workflow_run row and returns its ID.
func (d *DB) CreateRun(ctx context.Context, r WorkflowRun) (string, error) {
	var id string
	err := d.pool.QueryRow(ctx, `
		INSERT INTO workflow_runs (workflow_id, status, input, triggered_by)
		VALUES ($1, $2, $3, NULLIF($4, ''))
		RETURNING id
	`, r.WorkflowID, r.Status, r.Input, r.TriggeredBy).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("db: create run: %w", err)
	}
	return id, nil
}

// CreateStepExecution inserts a step_execution row, ignoring duplicates.
func (d *DB) CreateStepExecution(ctx context.Context, se StepExecution) error {
	_, err := d.pool.Exec(ctx, `
		INSERT INTO step_executions
			(run_id, step_name, step_type, status, attempt_count, max_attempts,
			 idempotency_key, input)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (run_id, step_name) DO NOTHING
	`, se.RunID, se.StepName, se.StepType, se.Status, se.AttemptCount,
		se.MaxAttempts, se.IdempotencyKey, se.Input)
	if err != nil {
		return fmt.Errorf("db: create step execution %s/%s: %w", se.RunID, se.StepName, err)
	}
	return nil
}

// GetRunStepExecutions returns all step_executions for a given run.
func (d *DB) GetRunStepExecutions(ctx context.Context, runID string) ([]StepExecution, error) {
	rows, err := d.pool.Query(ctx, `
		SELECT id, run_id, step_name, step_type, status,
		       attempt_count, max_attempts, idempotency_key,
		       input, output, COALESCE(error_msg, ''),
		       scheduled_after, started_at, completed_at
		FROM step_executions
		WHERE run_id = $1
		ORDER BY step_name
	`, runID)
	if err != nil {
		return nil, fmt.Errorf("db: get run steps %s: %w", runID, err)
	}
	defer rows.Close()
	return scanStepRows(rows)
}

// GetWorkflowDAG returns the dag_definition JSON for a workflow run.
func (d *DB) GetWorkflowDAG(ctx context.Context, runID string) ([]byte, error) {
	var dag []byte
	err := d.pool.QueryRow(ctx, `
		SELECT w.dag_definition
		FROM workflows w
		JOIN workflow_runs wr ON wr.workflow_id = w.id
		WHERE wr.id = $1
	`, runID).Scan(&dag)
	if err != nil {
		return nil, fmt.Errorf("db: get dag for run %s: %w", runID, err)
	}
	return dag, nil
}

// scanStepRows scans pgx.Rows into a slice of StepExecution.
func scanStepRows(rows pgx.Rows) ([]StepExecution, error) {
	var steps []StepExecution
	for rows.Next() {
		var se StepExecution
		if err := rows.Scan(
			&se.ID, &se.RunID, &se.StepName, &se.StepType, &se.Status,
			&se.AttemptCount, &se.MaxAttempts, &se.IdempotencyKey,
			&se.Input, &se.Output, &se.ErrorMsg,
			&se.ScheduledAfter, &se.StartedAt, &se.CompletedAt,
		); err != nil {
			return nil, fmt.Errorf("db: scan step row: %w", err)
		}
		steps = append(steps, se)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("db: step rows error: %w", err)
	}
	return steps, nil
}
