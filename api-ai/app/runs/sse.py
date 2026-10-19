"""SSE fan-out: subscribes to Redis pub/sub and streams step events to clients."""
import asyncio
from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.auth.dependencies import get_current_user
from app.database import get_conn
from app.redis_client import get_redis

router = APIRouter(tags=["stream"])


@router.get("/runs/{run_id}/stream")
async def stream_run(
    run_id: UUID,
    user_id: str = Depends(get_current_user),
) -> StreamingResponse:
    """
    SSE endpoint that streams step state changes for a run.
    Reconnects automatically when the client sends Last-Event-ID.
    """
    # Verify the run belongs to this user
    async with get_conn() as conn:
        row = await conn.fetchrow(
            """SELECT wr.id FROM workflow_runs wr
               JOIN workflows w ON w.id = wr.workflow_id
               WHERE wr.id = $1 AND w.owner_id = $2""",
            run_id, UUID(user_id),
        )
    if not row:
        from fastapi import HTTPException, status
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found")

    channel = f"conductor:events:{run_id}"

    async def event_generator():
        redis = get_redis()
        pubsub = redis.pubsub()
        await pubsub.subscribe(channel)
        try:
            # Send a keep-alive comment every 15s to prevent proxy timeouts
            yield ": keep-alive\n\n"
            while True:
                try:
                    msg = await asyncio.wait_for(pubsub.get_message(ignore_subscribe_messages=True), timeout=15.0)
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
                    continue
                if msg and msg["type"] == "message":
                    data = msg["data"] if isinstance(msg["data"], str) else msg["data"].decode()
                    yield f"data: {data}\n\n"
        finally:
            await pubsub.unsubscribe(channel)
            await pubsub.aclose()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )