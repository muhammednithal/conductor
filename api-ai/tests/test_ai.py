"""Unit tests for AI endpoints using mock LLM provider and mocked infrastructure."""
import json
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.auth.service import create_token

TOKEN = create_token("00000000-0000-0000-0000-000000000001")
HEADERS = {"Authorization": f"Bearer {TOKEN}"}


def test_summarize_returns_summary(mock_db_pool, mock_redis_init):
    """Mock provider should return a summary without LLM API calls."""
    mock_redis_init.get.return_value = None  # cache miss

    from app.main import app
    with TestClient(app) as c:
        resp = c.post(
            "/ai/summarize",
            json={"text": "Hello world this is a test", "max_length": 10},
            headers=HEADERS,
        )
    assert resp.status_code == 200
    data = resp.json()
    assert "summary" in data
    assert "tokens_used" in data
    assert isinstance(data["tokens_used"], int)


def test_summarize_returns_cached_result(mock_db_pool, mock_redis_init):
    """When Redis has a cached result, the provider should not be called."""
    cached = json.dumps({"summary": "cached summary", "tokens_used": 5})
    mock_redis_init.get.return_value = cached

    from app.main import app
    with TestClient(app) as c:
        resp = c.post(
            "/ai/summarize",
            json={"text": "anything"},
            headers={**HEADERS, "Idempotency-Key": "test-key-123"},
        )
    assert resp.status_code == 200
    assert resp.json()["summary"] == "cached summary"


def test_embed_returns_embeddings(mock_db_pool, mock_redis_init):
    """Mock provider should return vectors for each input text."""
    mock_redis_init.get.return_value = None

    from app.main import app
    with TestClient(app) as c:
        resp = c.post(
            "/ai/embed",
            json={"texts": ["hello", "world"]},
            headers=HEADERS,
        )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["embeddings"]) == 2
    assert all(isinstance(v, float) for v in data["embeddings"][0])