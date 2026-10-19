from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import AsyncGenerator


@dataclass
class SummarizeResult:
    summary: str
    tokens_used: int


@dataclass
class EmbedResult:
    embeddings: list[list[float]]
    tokens_used: int


@dataclass
class RagChunk:
    chunk: str
    done: bool


class LLMProvider(ABC):
    @abstractmethod
    async def summarize(self, text: str, max_length: int = 200, model: str = "") -> SummarizeResult: ...

    @abstractmethod
    async def embed(self, texts: list[str]) -> EmbedResult: ...

    @abstractmethod
    async def rag_query(
        self, query: str, context_docs: list[str], model: str = ""
    ) -> AsyncGenerator[RagChunk, None]: ...