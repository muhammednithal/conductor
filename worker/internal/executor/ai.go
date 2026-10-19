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

type aiStepConfig struct {
APIAIURL string `json:"api_ai_url"` // e.g. http://localhost:8000
Token    string `json:"token"`      // Bearer token
}

// AIExecutor delegates summarize and embed steps to the api-ai service.
// Config must include api_ai_url and token.
type AIExecutor struct {
client   *http.Client
endpoint string // /ai/summarize or /ai/embed
}

func NewAIExecutor(endpoint string) *AIExecutor {
return &AIExecutor{
client:   &http.Client{Timeout: 120 * time.Second},
endpoint: endpoint,
}
}

func (e *AIExecutor) Execute(ctx context.Context, input, config json.RawMessage) (json.RawMessage, error) {
var cfg aiStepConfig
if err := json.Unmarshal(config, &cfg); err != nil {
return nil, fmt.Errorf("ai executor: parse config: %w", err)
}
if cfg.APIAIURL == "" {
cfg.APIAIURL = "http://localhost:8000"
}

url := cfg.APIAIURL + e.endpoint
req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(input))
if err != nil {
return nil, fmt.Errorf("ai executor: create request: %w", err)
}
req.Header.Set("Content-Type", "application/json")
if cfg.Token != "" {
req.Header.Set("Authorization", "Bearer "+cfg.Token)
}

resp, err := e.client.Do(req)
if err != nil {
return nil, fmt.Errorf("ai executor: http call: %w", err)
}
defer resp.Body.Close()

body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
if resp.StatusCode < 200 || resp.StatusCode >= 300 {
preview := body
if len(preview) > 512 {
preview = preview[:512]
}
return nil, fmt.Errorf("ai executor: status %d: %s", resp.StatusCode, preview)
}
return json.RawMessage(body), nil
}