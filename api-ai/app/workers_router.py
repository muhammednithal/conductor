"""Read-only workers endpoint."""
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.database import get_conn

router = APIRouter(prefix="/workers", tags=["workers"])


class WorkerResponse(BaseModel):
    id: UUID
    hostname: str
    status: str
    capacity: int
    last_heartbeat_at: datetime


@router.get("", response_model=list[WorkerResponse])
async def list_workers(user_id: str = Depends(get_current_user)) -> list[WorkerResponse]:
    async with get_conn() as conn:
        rows = await conn.fetch(
            "SELECT id, hostname, status, capacity, last_heartbeat_at "
            "FROM workers ORDER BY last_heartbeat_at DESC"
        )
    return [WorkerResponse(**dict(r)) for r in rows]