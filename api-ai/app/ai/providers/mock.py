"""Mock LLM provider for testing — no external calls."""
from app.ai.providers.base import EmbedResult, LLMProvider, SummarizeResult


class MockProvider(LLMProvider):
    async def summarize(self, text: str, max_length: int = 200, model: str = "") -> SummarizeResult:
        words = text.split()[:max_length]
        return SummarizeResult(summary=" ".join(words), tokens_used=len(words))

    async def embed(self, texts: list[str]) -> EmbedResult:
        embeddings = [[float(i % 10) / 10 for i in range(8)] for _ in texts]
        tokens_used = sum(len(t.split()) for t in texts)
        return EmbedResult(embeddings=embeddings, tokens_used=tokens_used)