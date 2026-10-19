import json
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.database import get_conn

router = APIRouter(tags=["runs"])


class TriggerRunRequest(BaseModel):
    input: dict[str, Any] | None = None


class RunResponse(BaseModel):
    id: UUID
    workflow_id: UUID
    status: str
    started_at: datetime
    completed_at: datetime | None = None
    error_msg: str | None = None


class StepExecutionResponse(BaseModel):
    id: UUID
    step_name: str
    step_type: str
    status: str
    attempt_count: int
    output: dict[str, Any] | None = None
    error_msg: str | None = None


class RunDetailResponse(RunResponse):
    step_executions: list[StepExecutionResponse] = []


@router.post("/workflows/{workflow_id}/runs", response_model=RunResponse, status_code=status.HTTP_201_CREATED)
async def trigger_run(
    workflow_id: UUID,
    req: TriggerRunRequest,
    user_id: str = Depends(get_current_user),
) -> RunResponse:
    async with get_conn() as conn:
        wf = await conn.fetchrow(
            "SELECT * FROM workflows WHERE id = $1 AND owner_id = $2",
            workflow_id, UUID(user_id),
        )
        if not wf:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Workflow not found")

        # Create the run
        run_row = await conn.fetchrow(
            "INSERT INTO workflow_runs (workflow_id, status, input, triggered_by) "
            "VALUES ($1, 'PENDING', $2, $3) RETURNING *",
            workflow_id,
            json.dumps(req.input or {}),
            UUID(user_id),
        )
        run_id = run_row["id"]

        # Parse DAG and create step_executions (all PENDING)
        dag = json.loads(wf["dag_definition"]) if isinstance(wf["dag_definition"], str) else dict(wf["dag_definition"])
        for i, step in enumerate(dag.get("steps", [])):
            ikey = f"{run_id}:{step['name']}:0"
            await conn.execute(
                "INSERT INTO step_executions "
                "(run_id, step_name, step_type, status, attempt_count, max_attempts, idempotency_key, input) "
                "VALUES ($1, $2, $3, 'PENDING', 0, $4, $5, $6) "
                "ON CONFLICT (run_id, step_name) DO NOTHING",
                run_id,
                step["name"],
                step["type"],
                step.get("max_attempts", 3),
                ikey,
                json.dumps(step.get("config", {})),
            )

    return RunResponse(
        id=run_row["id"],
        workflow_id=run_row["workflow_id"],
        status=run_row["status"],
        started_at=run_row["started_at"],
    )


@router.get("/runs", response_model=list[RunResponse])
async def list_runs(user_id: str = Depends(get_current_user)) -> list[RunResponse]:
    async with get_conn() as conn:
        rows = await conn.fetch(
            "SELECT wr.* FROM workflow_runs wr "
            "JOIN workflows w ON w.id = wr.workflow_id "
            "WHERE w.owner_id = $1 ORDER BY wr.started_at DESC",
            UUID(user_id),
        )
    return [RunResponse(id=r["id"], workflow_id=r["workflow_id"], status=r["status"],
                        started_at=r["started_at"], completed_at=r["completed_at"],
                        error_msg=r["error_msg"]) for r in rows]


@router.get("/runs/{run_id}", response_model=RunDetailResponse)
async def get_run(run_id: UUID, user_id: str = Depends(get_current_user)) -> RunDetailResponse:
    async with get_conn() as conn:
        run = await conn.fetchrow(
            "SELECT wr.* FROM workflow_runs wr "
            "JOIN workflows w ON w.id = wr.workflow_id "
            "WHERE wr.id = $1 AND w.owner_id = $2",
            run_id, UUID(user_id),
        )
        if not run:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found")
        steps = await conn.fetch(
            "SELECT * FROM step_executions WHERE run_id = $1 ORDER BY step_name",
            run_id,
        )
    step_list = [
        StepExecutionResponse(
            id=s["id"], step_name=s["step_name"], step_type=s["step_type"],
            status=s["status"], attempt_count=s["attempt_count"],
            output=json.loads(s["output"]) if s["output"] else None,
            error_msg=s["error_msg"],
        )
        for s in steps
    ]
    return RunDetailResponse(
        id=run["id"], workflow_id=run["workflow_id"], status=run["status"],
        started_at=run["started_at"], completed_at=run["completed_at"],
        error_msg=run["error_msg"], step_executions=step_list,
    )


@router.delete("/runs/{run_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_run(run_id: UUID, user_id: str = Depends(get_current_user)) -> None:
    async with get_conn() as conn:
        run = await conn.fetchrow(
            "SELECT wr.id FROM workflow_runs wr "
            "JOIN workflows w ON w.id = wr.workflow_id "
            "WHERE wr.id = $1 AND w.owner_id = $2",
            run_id, UUID(user_id),
        )
        if not run:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found")
        await conn.execute(
            "UPDATE workflow_runs SET status = 'CANCELED' WHERE id = $1", run_id
        )