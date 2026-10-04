# 002 — FastAPI for API-AI Service

**Status:** accepted

## Context

The api-ai service handles authentication, workflow CRUD, AI endpoints (summarize, embed, RAG), and SSE event streaming. The team needs a framework that integrates easily with Python LLM SDKs and supports async patterns.

## Decision

Python FastAPI is chosen for the api-ai service.

Rationale:
- The Python LLM SDK ecosystem (OpenAI, LangChain, sentence-transformers, tiktoken) is the most mature available
- FastAPI automatically generates OpenAPI documentation from type hints
- Native async support (asyncio/ASGI) handles concurrent SSE streams efficiently
- Pydantic models provide request/response validation with minimal boilerplate

## Consequences

**Positive:**
- Direct access to all major LLM provider SDKs without wrapping
- Auto-generated OpenAPI spec in `/api-ai/openapi/` from code
- Async endpoints handle many concurrent SSE connections without blocking threads
- Large ecosystem of Python data-processing libraries available for future step types

**Negative:**
- Running two languages (Go + Python) increases operational complexity
- Python's GIL can limit true parallelism for CPU-bound tasks (mitigated by async I/O for this service's workload)
- Docker image is larger than a Go binary
