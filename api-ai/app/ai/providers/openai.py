from openai import AsyncOpenAI

from app.ai.providers.base import EmbedResult, LLMProvider, SummarizeResult
from app.config import settings


class OpenAIProvider(LLMProvider):
    def __init__(self) -> None:
        self._client = AsyncOpenAI(api_key=settings.openai_api_key)

    async def summarize(self, text: str, max_length: int = 200, model: str = "") -> SummarizeResult:
        model = model or "gpt-4o-mini"
        resp = await self._client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": f"Summarise the following text in at most {max_length} words."},
                {"role": "user", "content": text},
            ],
        )
        usage = resp.usage
        return SummarizeResult(
            summary=resp.choices[0].message.content or "",
            tokens_used=usage.total_tokens if usage else 0,
        )

    async def embed(self, texts: list[str]) -> EmbedResult:
        resp = await self._client.embeddings.create(
            model="text-embedding-3-small",
            input=texts,
        )
        embeddings = [item.embedding for item in resp.data]
        tokens_used = resp.usage.total_tokens if resp.usage else 0
        return EmbedResult(embeddings=embeddings, tokens_used=tokens_used)