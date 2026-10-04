module github.com/conductor/worker

go 1.22

require (
	github.com/stretchr/testify v1.9.0
	google.golang.org/grpc v1.63.2
	google.golang.org/protobuf v1.34.0
)

replace github.com/conductor/orchestrator/shared/proto/conductorpb => ../shared/proto/conductorpb
