from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database
    database_url: str = "postgresql://conductor:conductor@localhost:5432/conductor"

    # Redis
    redis_url: str = "redis://localhost:6379"

    # JWT
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24  # 24 hours

    # LLM
    llm_provider: str = "mock"  # "openai" | "mock"
    openai_api_key: str = ""

    # Orchestrator internal API
    orchestrator_internal_url: str = "http://localhost:9001/internal"


settings = Settings()