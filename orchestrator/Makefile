.PHONY: build test lint run

build:
	go build -o bin/orchestrator ./cmd/orchestrator

test:
	go test ./...

lint:
	go vet ./...

run:
	go run ./cmd/orchestrator
