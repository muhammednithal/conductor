"""Mock LLM provider for testing — no external calls."""
from typing import AsyncGenerator

from app.ai.providers.base import EmbedResult, LLMProvider, RagChunk, SummarizeResult


class MockProvider(LLMProvider):
    async def summarize(self, text: str, max_length: int = 200, model: str = "") -> SummarizeResult:
        words = text.split()[:max_length]
        return SummarizeResult(summary=" ".join(words), tokens_used=len(words))

    async def embed(self, texts: list[str]) -> EmbedResult:
        # Return 8-dimensional mock embeddings
        embeddings = [[float(i % 10) / 10 for i in range(8)] for _ in texts]
        tokens_used = sum(len(t.split()) for t in texts)
        return EmbedResult(embeddings=embeddings, tokens_used=tokens_used)

    async def rag_query(
        self, query: str, context_docs: list[str], model: str = ""
    ) -> AsyncGenerator[RagChunk, None]:
        context = " ".join(context_docs[:3])
        words = f"Based on context: {context}. Answer: {query}".split()
        for i, word in enumerate(words):
            yield RagChunk(chunk=word + " ", done=(i == len(words) - 1))
        if not words:
            yield RagChunk(chunk="No context available.", done=True)