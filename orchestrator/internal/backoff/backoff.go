// Package backoff provides the canonical exponential-backoff formula used by
// the grpcserver, lease reclaimer, and crash recovery procedure.
package backoff

import (
"math"
"math/rand"
"time"
)

// Compute returns the retry delay for 0-indexed attempt number n.
// Formula: min(1s * 2^n, 300s) * uniform(0.8, 1.2)
func Compute(attempt int) time.Duration {
base := float64(time.Second)
capped := math.Min(base*math.Pow(2, float64(attempt)), float64(300*time.Second))
jitter := 0.8 + rand.Float64()*0.4 // uniform [0.8, 1.2]
return time.Duration(capped * jitter)
}
