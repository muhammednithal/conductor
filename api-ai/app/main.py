from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.auth.router import router as auth_router
from app.workflows.router import router as workflows_router
from app.runs.router import router as runs_router
from app.runs.sse import router as sse_router
from app.ai.router import router as ai_router
from app.workers_router import router as workers_router
from app.database import close_pool, create_pool
from app.redis_client import close_redis


@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_pool()
    yield
    await close_pool()
    await close_redis()


app = FastAPI(
    title="Conductor API-AI",
    description="Workflow management and AI step execution service",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(auth_router)
app.include_router(workflows_router)
app.include_router(runs_router)
app.include_router(sse_router)
app.include_router(ai_router)
app.include_router(workers_router)


@app.get("/health")
async def health():
    return {"status": "ok"}