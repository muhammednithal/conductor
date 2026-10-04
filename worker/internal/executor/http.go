package executor

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type httpConfig struct {
	URL    string `json:"url"`
	Method string `json:"method"`
}

// HTTPExecutor executes an HTTP request using the input as the JSON body.
type HTTPExecutor struct {
	client *http.Client
}

// NewHTTPExecutor creates an HTTPExecutor with a 30-second timeout.
func NewHTTPExecutor() *HTTPExecutor {
	return &HTTPExecutor{
		client: &http.Client{Timeout: 30 * time.Second},
	}
}

// Execute makes an HTTP request.
// config: { "url": "...", "method": "POST" }
// input: arbitrary JSON sent as the request body.
// Returns the response body as output.
func (e *HTTPExecutor) Execute(ctx context.Context, input, config json.RawMessage) (json.RawMessage, error) {
	var cfg httpConfig
	if err := json.Unmarshal(config, &cfg); err != nil {
		return nil, fmt.Errorf("http: parse config: %w", err)
	}
	if cfg.URL == "" {
		return nil, fmt.Errorf("http: config.url is required")
	}
	if cfg.Method == "" {
		cfg.Method = "POST"
	}

	req, err := http.NewRequestWithContext(ctx, cfg.Method, cfg.URL, bytes.NewReader(input))
	if err != nil {
		return nil, fmt.Errorf("http: create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := e.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http: do request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20)) // 1 MB cap
	if err != nil {
		return nil, fmt.Errorf("http: read response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		preview := body
		if len(preview) > 512 {
			preview = preview[:512]
		}
		return nil, fmt.Errorf("http: status %d: %s", resp.StatusCode, preview)
	}

	return json.RawMessage(body), nil
}
