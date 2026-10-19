import json
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel

from app.ai.providers import get_provider
from app.auth.dependencies import get_current_user
from app.database import get_conn
from app.redis_client import get_redis

router = APIRouter(prefix="/ai", tags=["ai"])

IDEMPOTENCY_TTL = 86400  # 24 hours


class SummarizeRequest(BaseModel):
    text: str
    max_length: int = 200
    model: str = ""


class SummarizeResponse(BaseModel):
    summary: str
    tokens_used: int


class EmbedRequest(BaseModel):
    texts: list[str]


class EmbedResponse(BaseModel):
    embeddings: list[list[float]]
    tokens_used: int


class CostResponse(BaseModel):
    total_tokens: int
    total_cost: float
    by_run: list[dict[str, Any]]


@router.post("/summarize", response_model=SummarizeResponse)
async def summarize(
    req: SummarizeRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    user_id: str = Depends(get_current_user),
) -> SummarizeResponse:
    cache_key = f"idempotency:{idempotency_key}" if idempotency_key else None
    redis = get_redis()

    if cache_key:
        cached = await redis.get(cache_key)
        if cached:
            return SummarizeResponse(**json.loads(cached))

    provider = get_provider()
    result = await provider.summarize(req.text, req.max_length, req.model)

    # Store token usage
    await _record_tokens(user_id, "summarize", result.tokens_used)

    resp = SummarizeResponse(summary=result.summary, tokens_used=result.tokens_used)
    if cache_key:
        await redis.set(cache_key, resp.model_dump_json(), ex=IDEMPOTENCY_TTL)
    return resp


@router.post("/embed", response_model=EmbedResponse)
async def embed(
    req: EmbedRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    user_id: str = Depends(get_current_user),
) -> EmbedResponse:
    cache_key = f"idempotency:{idempotency_key}" if idempotency_key else None
    redis = get_redis()

    if cache_key:
        cached = await redis.get(cache_key)
        if cached:
            return EmbedResponse(**json.loads(cached))

    provider = get_provider()
    result = await provider.embed(req.texts)

    await _record_tokens(user_id, "embed", result.tokens_used)

    resp = EmbedResponse(embeddings=result.embeddings, tokens_used=result.tokens_used)
    if cache_key:
        await redis.set(cache_key, resp.model_dump_json(), ex=IDEMPOTENCY_TTL)
    return resp


@router.get("/cost", response_model=CostResponse)
async def get_cost(user_id: str = Depends(get_current_user)) -> CostResponse:
    async with get_conn() as conn:
        rows = await conn.fetch(
            """SELECT run_id, SUM(tokens_used) as total_tokens
               FROM ai_token_usage
               WHERE user_id = $1
               GROUP BY run_id
               ORDER BY run_id""",
            UUID(user_id),
        )
    total_tokens = sum(r["total_tokens"] or 0 for r in rows)
    # Rough cost estimate: $0.0001 per 1k tokens
    total_cost = round(total_tokens / 1000 * 0.0001, 6)
    by_run = [{"run_id": str(r["run_id"]), "tokens": r["total_tokens"]} for r in rows]
    return CostResponse(total_tokens=total_tokens, total_cost=total_cost, by_run=by_run)


async def _record_tokens(user_id: str, operation: str, tokens: int) -> None:
    """Store token usage for cost tracking. Table created in migration 002."""
    try:
        async with get_conn() as conn:
            await conn.execute(
                """INSERT INTO ai_token_usage (user_id, operation, tokens_used)
                   VALUES ($1, $2, $3)
                   ON CONFLICT DO NOTHING""",
                UUID(user_id), operation, tokens,
            )
    except Exception:
        pass  # cost tracking is best-effort; never fail the main request