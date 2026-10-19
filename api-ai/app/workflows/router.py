import json
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth.dependencies import get_current_user
from app.database import get_conn
from app.workflows.schemas import WorkflowCreate, WorkflowResponse, WorkflowUpdate

router = APIRouter(prefix="/workflows", tags=["workflows"])


@router.get("", response_model=list[WorkflowResponse])
async def list_workflows(user_id: str = Depends(get_current_user)) -> list[WorkflowResponse]:
    async with get_conn() as conn:
        rows = await conn.fetch(
            "SELECT * FROM workflows WHERE owner_id = $1 ORDER BY created_at DESC",
            UUID(user_id),
        )
    return [_row_to_workflow(r) for r in rows]


@router.post("", response_model=WorkflowResponse, status_code=status.HTTP_201_CREATED)
async def create_workflow(
    req: WorkflowCreate, user_id: str = Depends(get_current_user)
) -> WorkflowResponse:
    async with get_conn() as conn:
        row = await conn.fetchrow(
            """INSERT INTO workflows (owner_id, name, description, dag_definition)
               VALUES ($1, $2, $3, $4) RETURNING *""",
            UUID(user_id),
            req.name,
            req.description,
            json.dumps(req.dag_definition),
        )
    return _row_to_workflow(row)


@router.get("/{workflow_id}", response_model=WorkflowResponse)
async def get_workflow(
    workflow_id: UUID, user_id: str = Depends(get_current_user)
) -> WorkflowResponse:
    row = await _get_owned(workflow_id, user_id)
    return _row_to_workflow(row)


@router.put("/{workflow_id}", response_model=WorkflowResponse)
async def update_workflow(
    workflow_id: UUID,
    req: WorkflowUpdate,
    user_id: str = Depends(get_current_user),
) -> WorkflowResponse:
    await _get_owned(workflow_id, user_id)
    fields = []
    vals: list = []

    if req.name is not None:
        fields.append(f"name = ${len(vals) + 2}")
        vals.append(req.name)
    if req.description is not None:
        fields.append(f"description = ${len(vals) + 2}")
        vals.append(req.description)
    if req.dag_definition is not None:
        fields.append(f"dag_definition = ${len(vals) + 2}")
        vals.append(json.dumps(req.dag_definition))

    if not fields:
        return _row_to_workflow(await _get_owned(workflow_id, user_id))

    fields.append("updated_at = NOW()")
    fields.append("version = version + 1")
    sql = f"UPDATE workflows SET {', '.join(fields)} WHERE id = $1 RETURNING *"
    async with get_conn() as conn:
        row = await conn.fetchrow(sql, workflow_id, *vals)
    return _row_to_workflow(row)


@router.delete("/{workflow_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workflow(
    workflow_id: UUID, user_id: str = Depends(get_current_user)
) -> None:
    await _get_owned(workflow_id, user_id)
    async with get_conn() as conn:
        await conn.execute("DELETE FROM workflows WHERE id = $1", workflow_id)


async def _get_owned(workflow_id: UUID, user_id: str):
    async with get_conn() as conn:
        row = await conn.fetchrow("SELECT * FROM workflows WHERE id = $1", workflow_id)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workflow not found")
    if str(row["owner_id"]) != user_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your workflow")
    return row


def _row_to_workflow(row) -> WorkflowResponse:
    d = dict(row)
    d["dag_definition"] = (
        json.loads(d["dag_definition"])
        if isinstance(d["dag_definition"], str)
        else d["dag_definition"]
    )
    return WorkflowResponse(**d)