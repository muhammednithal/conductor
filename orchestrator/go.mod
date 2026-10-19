module github.com/conductor/orchestrator

go 1.25

require (
	github.com/conductor/orchestrator/shared/proto/conductorpb v0.0.0-00010101000000-000000000000
	github.com/conductor/worker v0.0.0
	github.com/jackc/pgx/v5 v5.5.5
	github.com/redis/go-redis/v9 v9.5.1
	github.com/stretchr/testify v1.9.0
	google.golang.org/grpc v1.63.2
)

require (
	github.com/cespare/xxhash/v2 v2.2.0 // indirect
	github.com/davecgh/go-spew v1.1.1 // indirect
	github.com/dgryski/go-rendezvous v0.0.0-20200823014737-9f7001d12a5f // indirect
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20221227161230-091c0ba34f0a // indirect
	github.com/jackc/puddle/v2 v2.2.1 // indirect
	github.com/kr/text v0.2.0 // indirect
	github.com/pmezard/go-difflib v1.0.0 // indirect
	github.com/rogpeppe/go-internal v1.16.0 // indirect
	golang.org/x/crypto v0.19.0 // indirect
	golang.org/x/net v0.21.0 // indirect
	golang.org/x/sync v0.6.0 // indirect
	golang.org/x/sys v0.26.0 // indirect
	golang.org/x/text v0.14.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20240227224415-6ceb2ff114de // indirect
	google.golang.org/protobuf v1.34.0 // indirect
	gopkg.in/yaml.v3 v3.0.1 // indirect
)

replace github.com/conductor/orchestrator/shared/proto/conductorpb => ../shared/proto/conductorpb

replace github.com/conductor/worker => ../worker
