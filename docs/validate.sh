#!/usr/bin/env bash
set -euo pipefail

# Resolve the repository root from the script's location (docs/../)
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

FAILURES=0

# =============================================================================
# Smoke checks — required file existence
# =============================================================================
echo "=== Smoke checks: required files ==="

REQUIRED_FILES=(
  "AGENTS.md"
  "CLAUDE.md"
  ".cursor/rules/conductor.md"
  ".kiro/steering/conductor.md"
  "docs/00-vision.md"
  "docs/01-architecture.md"
  "docs/02-conventions.md"
  "docs/PROGRESS.md"
  "docs/adr/001-go-for-orchestrator-worker.md"
  "docs/adr/002-fastapi-for-api-ai.md"
  "docs/adr/003-lease-based-scheduling.md"
  "docs/adr/004-postgres-source-of-truth.md"
  "docs/adr/005-redis-queues-pubsub.md"
  "docs/milestones/M1.md"
  "docs/milestones/M2.md"
  "docs/milestones/M3.md"
  "docs/milestones/M4.md"
  "docs/milestones/M5.md"
  "docs/milestones/M6.md"
)

for file in "${REQUIRED_FILES[@]}"; do
  if [ ! -f "${REPO_ROOT}/${file}" ]; then
    echo "MISSING: ${file} not found"
    FAILURES=$(( FAILURES + 1 ))
  fi
done

echo ""
echo "=== Smoke checks complete: $FAILURES failure(s) ==="

# =============================================================================
# Constraint checks — line counts and section headings
# =============================================================================
echo ""
echo "=== Constraint checks ==="

# AGENTS.md: must be ≤ 100 lines
AGENTS_LINES=$(wc -l < "${REPO_ROOT}/AGENTS.md" 2>/dev/null || echo 9999)
if [ "$AGENTS_LINES" -gt 100 ]; then
  echo "CONSTRAINT FAIL: AGENTS.md has $AGENTS_LINES lines (max 100)"
  FAILURES=$(( FAILURES + 1 ))
fi

# CLAUDE.md: must be ≤ 5 lines
CLAUDE_LINES=$(wc -l < "${REPO_ROOT}/CLAUDE.md" 2>/dev/null || echo 9999)
if [ "$CLAUDE_LINES" -gt 5 ]; then
  echo "CONSTRAINT FAIL: CLAUDE.md has $CLAUDE_LINES lines (max 5)"
  FAILURES=$(( FAILURES + 1 ))
fi

# .cursor/rules/conductor.md: must be ≤ 10 lines
CURSOR_LINES=$(wc -l < "${REPO_ROOT}/.cursor/rules/conductor.md" 2>/dev/null || echo 9999)
if [ "$CURSOR_LINES" -gt 10 ]; then
  echo "CONSTRAINT FAIL: .cursor/rules/conductor.md has $CURSOR_LINES lines (max 10)"
  FAILURES=$(( FAILURES + 1 ))
fi

# .kiro/steering/conductor.md: must be ≤ 10 lines
KIRO_LINES=$(wc -l < "${REPO_ROOT}/.kiro/steering/conductor.md" 2>/dev/null || echo 9999)
if [ "$KIRO_LINES" -gt 10 ]; then
  echo "CONSTRAINT FAIL: .kiro/steering/conductor.md has $KIRO_LINES lines (max 10)"
  FAILURES=$(( FAILURES + 1 ))
fi

# Each ADR: must be ≤ 500 words
for adr in "${REPO_ROOT}"/docs/adr/*.md; do
  [ -f "$adr" ] || continue
  ADR_WORDS=$(wc -w < "$adr" 2>/dev/null || echo 9999)
  if [ "$ADR_WORDS" -gt 500 ]; then
    echo "CONSTRAINT FAIL: $(basename "$adr") has $ADR_WORDS words (max 500)"
    FAILURES=$(( FAILURES + 1 ))
  fi
done

# docs/PROGRESS.md: must contain all five required headings
PROGRESS_FILE="${REPO_ROOT}/docs/PROGRESS.md"
for heading in "## Done" "## In Progress" "## Next" "## Known Issues" "## Open Questions"; do
  if ! grep -qF "$heading" "$PROGRESS_FILE" 2>/dev/null; then
    echo "CONSTRAINT FAIL: docs/PROGRESS.md missing heading: $heading"
    FAILURES=$(( FAILURES + 1 ))
  fi
done

echo ""
echo "=== Constraint checks complete: $FAILURES total failure(s) so far ==="

# =============================================================================
# Section presence checks — required headings inside key documents
# =============================================================================
echo ""
echo "=== Section presence checks ==="

# docs/01-architecture.md — ten required headings
ARCH_FILE="${REPO_ROOT}/docs/01-architecture.md"
ARCH_HEADINGS=(
  "## Repository Structure"
  "## Data Model"
  "## State Machine"
  "## API Contracts"
  "## Lease-Based Task Assignment"
  "## Retry Policy"
  "## Idempotency"
  "## Timeouts, Cancellation, and Rate Limiting"
  "## Crash Recovery"
  "## Failure Scenarios"
)
for heading in "${ARCH_HEADINGS[@]}"; do
  if ! grep -qF "$heading" "$ARCH_FILE" 2>/dev/null; then
    echo "SECTION FAIL: docs/01-architecture.md missing: $heading"
    FAILURES=$(( FAILURES + 1 ))
  fi
done

# Each milestone (M1–M6) — five required headings
for milestone in M1 M2 M3 M4 M5 M6; do
  MS_FILE="${REPO_ROOT}/docs/milestones/${milestone}.md"
  [ -f "$MS_FILE" ] || continue
  for heading in "## Goal" "## Scope" "## Non-Goals" "## Acceptance Criteria" "## Tasks"; do
    if ! grep -qF "$heading" "$MS_FILE" 2>/dev/null; then
      echo "SECTION FAIL: docs/milestones/${milestone}.md missing: $heading"
      FAILURES=$(( FAILURES + 1 ))
    fi
  done
done

# Each ADR — four required headings
for adr in "${REPO_ROOT}"/docs/adr/*.md; do
  [ -f "$adr" ] || continue
  for heading in "## Context" "## Decision" "## Consequences" "**Status:**"; do
    if ! grep -qF "$heading" "$adr" 2>/dev/null; then
      echo "SECTION FAIL: $(basename "$adr") missing: $heading"
      FAILURES=$(( FAILURES + 1 ))
    fi
  done
done

echo ""
echo "=== Section presence checks complete: $FAILURES total failure(s) so far ==="

# =============================================================================
# Policy enforcement — no application code outside docs/
# =============================================================================
echo ""
echo "=== Policy enforcement check ==="

# Find application code files outside excluded directories
# Excluded: .git/, docs/, .kiro/, .cursor/
POLICY_VIOLATIONS=0
while IFS= read -r -d '' found_file; do
  rel_path="${found_file#${REPO_ROOT}/}"
  echo "POLICY VIOLATION: application code found in ${rel_path}; architecture approval required"
  FAILURES=$(( FAILURES + 1 ))
  POLICY_VIOLATIONS=$(( POLICY_VIOLATIONS + 1 ))
done < <(find "${REPO_ROOT}" \
  -not \( -path "${REPO_ROOT}/.git/*" -prune \) \
  -not \( -path "${REPO_ROOT}/docs/*" -prune \) \
  -not \( -path "${REPO_ROOT}/.kiro/*" -prune \) \
  -not \( -path "${REPO_ROOT}/.cursor/*" -prune \) \
  \( -name "*.go" \
     -o -name "*.py" \
     -o -name "*.ts" \
     -o -name "*.js" \
     -o -name "*.sql" \
     -o -name "Dockerfile*" \
     -o -name "docker-compose*.yml" \) \
  -print0 2>/dev/null)

echo ""
echo "=== Policy enforcement complete: $POLICY_VIOLATIONS violation(s) ==="

# =============================================================================
# Final result
# =============================================================================
echo ""
echo "============================================"
if [ "$FAILURES" -eq 0 ]; then
  echo "VALIDATION PASSED — 0 errors, 0 policy violations"
  exit 0
else
  echo "VALIDATION FAILED — $FAILURES total failure(s)"
  exit 1
fi
