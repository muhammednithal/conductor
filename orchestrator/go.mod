module github.com/conductor/orchestrator

go 1.22

require (
	github.com/conductor/worker v0.0.0
	github.com/jackc/pgx/v5 v5.5.5
	github.com/redis/go-redis/v9 v9.5.1
	github.com/stretchr/testify v1.9.0
	google.golang.org/grpc v1.63.2
	google.golang.org/protobuf v1.34.0
)

replace github.com/conductor/orchestrator/shared/proto/conductorpb => ../shared/proto/conductorpb

replace github.com/conductor/worker => ../worker
