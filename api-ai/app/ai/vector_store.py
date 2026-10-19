"""
In-memory vector store for M5 RAG support.
Stores embeddings as lists of floats and performs cosine similarity search.
No external dependencies — resets on process restart.
"""
import math
from dataclasses import dataclass, field
from typing import Any


@dataclass
class VectorDocument:
    doc_id: str
    text: str
    embedding: list[float]
    metadata: dict[str, Any] = field(default_factory=dict)


class InMemoryVectorStore:
    """Thread-unsafe in-process vector store — sufficient for M5 demo."""

    def __init__(self) -> None:
        self._docs: dict[str, VectorDocument] = {}

    def upsert(self, doc_id: str, text: str, embedding: list[float], metadata: dict[str, Any] | None = None) -> None:
        self._docs[doc_id] = VectorDocument(doc_id=doc_id, text=text, embedding=embedding, metadata=metadata or {})

    def search(self, query_embedding: list[float], top_k: int = 5) -> list[VectorDocument]:
        """Return the top_k most similar documents by cosine similarity."""
        if not self._docs:
            return []
        scored = []
        for doc in self._docs.values():
            score = _cosine_similarity(query_embedding, doc.embedding)
            scored.append((score, doc))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [doc for _, doc in scored[:top_k]]

    def count(self) -> int:
        return len(self._docs)


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(x * x for x in b))
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)


# Module-level singleton shared across all requests within one process
_store = InMemoryVectorStore()


def get_vector_store() -> InMemoryVectorStore:
    return _store