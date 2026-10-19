from app.ai.providers.base import LLMProvider
from app.config import settings


def get_provider() -> LLMProvider:
    if settings.llm_provider == "openai":
        from app.ai.providers.openai import OpenAIProvider
        return OpenAIProvider()
    from app.ai.providers.mock import MockProvider
    return MockProvider()