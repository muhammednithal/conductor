.PHONY: build test lint run

build:
	go build -o bin/worker ./cmd/worker

test:
	go test ./...

lint:
	go vet ./...

run:
	go run ./cmd/worker
