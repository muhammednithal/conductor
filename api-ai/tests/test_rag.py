"""Unit tests for the RAG endpoint and vector store."""
import json
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.ai.providers.base import RagChunk
from app.ai.vector_store import InMemoryVectorStore
from app.auth.service import create_token

TOKEN = create_token("00000000-0000-0000-0000-000000000001")
HEADERS = {"Authorization": f"Bearer {TOKEN}"}


# ── Vector store unit tests ──────────────────────────────────────────────────

class TestInMemoryVectorStore:
    def test_upsert_and_search(self):
        vs = InMemoryVectorStore()
        vs.upsert("doc1", "Hello world", [1.0, 0.0])
        vs.upsert("doc2", "Goodbye world", [0.0, 1.0])
        results = vs.search([1.0, 0.0], top_k=1)
        assert len(results) == 1
        assert results[0].doc_id == "doc1"

    def test_empty_search_returns_empty(self):
        vs = InMemoryVectorStore()
        assert vs.search([1.0, 0.0]) == []

    def test_count(self):
        vs = InMemoryVectorStore()
        assert vs.count() == 0
        vs.upsert("d1", "text", [0.5])
        assert vs.count() == 1


# ── RAG endpoint tests ────────────────────────────────────────────────────────

async def _mock_rag_gen(query, context, model=""):
    """Async generator that yields two RAG chunks."""
    yield RagChunk(chunk="Hello ", done=False)
    yield RagChunk(chunk="world", done=True)


def test_rag_query_streams_chunks(mock_db_pool, mock_redis_init, monkeypatch):
    monkeypatch.setattr("app.ai.router.get_vector_store", lambda: InMemoryVectorStore())

    provider = MagicMock()
    embed_result = MagicMock()
    embed_result.embeddings = [[0.5, 0.5]]
    embed_result.tokens_used = 2
    provider.embed = AsyncMock(return_value=embed_result)
    provider.rag_query = MagicMock(side_effect=_mock_rag_gen)
    monkeypatch.setattr("app.ai.router.get_provider", lambda: provider)

    from app.main import app
    with TestClient(app) as c:
        resp = c.post(
            "/ai/rag/query",
            json={"query": "What is the answer?", "top_k": 5},
            headers=HEADERS,
        )
    assert resp.status_code == 200
    lines = [l for l in resp.text.split("\n") if l.startswith("data:")]
    assert len(lines) == 2
    first = json.loads(lines[0][5:])
    assert first["chunk"] == "Hello "
    assert first["done"] is False
    last = json.loads(lines[1][5:])
    assert last["done"] is True


def test_vector_upsert_endpoint(mock_db_pool, mock_redis_init, monkeypatch):
    vs = InMemoryVectorStore()
    monkeypatch.setattr("app.ai.router.get_vector_store", lambda: vs)

    from app.main import app
    with TestClient(app) as c:
        resp = c.post(
            "/ai/vectors/upsert",
            json={"doc_id": "test-doc", "text": "hello world", "embedding": [0.1, 0.2, 0.3]},
            headers=HEADERS,
        )
    assert resp.status_code == 201
    assert vs.count() == 1