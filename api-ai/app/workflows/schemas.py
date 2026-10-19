from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel


class WorkflowCreate(BaseModel):
    name: str
    description: str | None = None
    dag_definition: dict[str, Any]


class WorkflowUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    dag_definition: dict[str, Any] | None = None


class WorkflowResponse(BaseModel):
    id: UUID
    owner_id: UUID
    name: str
    description: str | None
    dag_definition: dict[str, Any]
    version: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}