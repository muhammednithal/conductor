FROM golang:1.22-alpine AS builder
WORKDIR /workspace

COPY shared/proto/conductorpb/ shared/proto/conductorpb/

WORKDIR /workspace/worker
COPY worker/go.mod worker/go.sum ./
RUN go mod download

COPY worker/ .
RUN go build -o /worker ./cmd/worker

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=builder /worker .
EXPOSE 8080
CMD ["./worker"]