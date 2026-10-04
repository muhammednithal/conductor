package executor

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

type transformConfig struct {
	Mapping map[string]string `json:"mapping"`
}

// TransformExecutor performs dot-notation key remapping on JSON input.
type TransformExecutor struct{}

// Execute applies cfg.Mapping to input: each output key is extracted from input
// using the corresponding dot-notation path.
// config: { "mapping": { "outputKey": "input.path.to.value" } }
func (e *TransformExecutor) Execute(ctx context.Context, input, config json.RawMessage) (json.RawMessage, error) {
	var cfg transformConfig
	if err := json.Unmarshal(config, &cfg); err != nil {
		return nil, fmt.Errorf("transform: parse config: %w", err)
	}

	var src map[string]any
	if err := json.Unmarshal(input, &src); err != nil {
		// If input is null or empty, treat as empty object.
		src = make(map[string]any)
	}

	out := make(map[string]any, len(cfg.Mapping))
	for outKey, path := range cfg.Mapping {
		val, err := extractPath(src, path)
		if err != nil {
			return nil, fmt.Errorf("transform: extract %q -> %q: %w", path, outKey, err)
		}
		out[outKey] = val
	}

	result, err := json.Marshal(out)
	if err != nil {
		return nil, fmt.Errorf("transform: marshal output: %w", err)
	}
	return json.RawMessage(result), nil
}

// extractPath traverses a nested map following dot-separated segments.
// e.g. extractPath({"a":{"b":1}}, "a.b") == 1
func extractPath(obj map[string]any, path string) (any, error) {
	parts := strings.SplitN(path, ".", 2)
	val, ok := obj[parts[0]]
	if !ok {
		return nil, fmt.Errorf("key %q not found", parts[0])
	}
	if len(parts) == 1 {
		return val, nil
	}
	nested, ok := val.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("cannot traverse into non-object at %q", parts[0])
	}
	return extractPath(nested, parts[1])
}
