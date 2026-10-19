.PHONY: build test lint run

build:
pip install -r requirements.txt

test:
pytest tests/ -v

lint:
ruff check app/ tests/

run:
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload