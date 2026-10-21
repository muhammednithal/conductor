# Build stage
FROM golang:1.22-alpine AS builder
WORKDIR /workspace

# Copy shared proto first (needed by go.mod replace directive)
COPY shared/proto/conductorpb/ shared/proto/conductorpb/

# Copy and download orchestrator dependencies
WORKDIR /workspace/orchestrator
COPY orchestrator/go.mod orchestrator/go.sum ./
RUN go mod download

# Build
COPY orchestrator/ .
RUN go build -o /orchestrator ./cmd/orchestrator

# Runtime stage
FROM alpine:3.20
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=builder /orchestrator .
COPY orchestrator/migrations/ migrations/
EXPOSE 9000
CMD ["./orchestrator"]