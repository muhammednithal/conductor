"""
Test fixtures for api-ai unit tests.
DB pool and Redis are mocked so no live Postgres/Redis is needed.
"""
import os
from unittest.mock import AsyncMock, MagicMock

import pytest

os.environ.setdefault("LLM_PROVIDER", "mock")
os.environ.setdefault("JWT_SECRET", "test-secret")


@pytest.fixture(autouse=True)
def mock_db_pool(monkeypatch):
    """
    Patch asyncpg pool so the lifespan does not connect to a real database.
    pool.acquire() must be a plain MagicMock (not AsyncMock) because asyncpg
    uses it as an async context manager without an explicit await.
    """
    conn = AsyncMock()
    # Make conn.fetchrow / conn.execute return sensible defaults
    conn.fetchrow = AsyncMock(return_value=None)
    conn.fetch = AsyncMock(return_value=[])
    conn.execute = AsyncMock(return_value=None)

    acquire_cm = MagicMock()
    acquire_cm.__aenter__ = AsyncMock(return_value=conn)
    acquire_cm.__aexit__ = AsyncMock(return_value=False)

    pool = MagicMock()                    # plain MagicMock so acquire() is sync
    pool.acquire = MagicMock(return_value=acquire_cm)
    pool.close = AsyncMock()

    monkeypatch.setattr("app.database.create_pool", AsyncMock(return_value=pool))
    monkeypatch.setattr("app.database.close_pool", AsyncMock())
    monkeypatch.setattr("app.database._pool", pool)
    return conn


@pytest.fixture(autouse=True)
def mock_redis_init(monkeypatch):
    """
    Patch get_redis at every import site so endpoint handlers get the mock.
    """
    redis = AsyncMock()
    redis.get = AsyncMock(return_value=None)
    redis.set = AsyncMock()
    redis.aclose = AsyncMock()

    mock_fn = lambda: redis
    monkeypatch.setattr("app.redis_client.get_redis", mock_fn)
    monkeypatch.setattr("app.ai.router.get_redis", mock_fn)
    monkeypatch.setattr("app.redis_client.close_redis", AsyncMock())
    return redis