#Requires -Version 5.1
<#
.SYNOPSIS  Start all Conductor services for local development. Press Ctrl+C to stop.
#>
param()

$ROOT = Split-Path $MyInvocation.MyCommand.Path
$GO   = "C:\Program Files\Go\bin\go.exe"
$LOGS = "$ROOT\.logs"
New-Item -ItemType Directory -Force -Path $LOGS | Out-Null

function Info($m) { Write-Host "[Conductor] $m" -ForegroundColor Cyan }
function OK($m)   { Write-Host "[  OK  ] $m" -ForegroundColor Green }
function Fail($m) { Write-Host "[ FAIL ] $m" -ForegroundColor Red; exit 1 }

# Build orchestrator
Info "Building orchestrator..."
& $GO build -o "$ROOT\orchestrator\bin\orchestrator.exe" "./cmd/orchestrator" 2>&1
if ($LASTEXITCODE -ne 0) { Fail "Orchestrator build failed" }
OK "Orchestrator built"

# Build worker
Info "Building worker..."
& $GO build -o "$ROOT\worker\bin\worker.exe" "./cmd/worker" 2>&1
if ($LASTEXITCODE -ne 0) { Fail "Worker build failed" }
OK "Worker built"

# Start infrastructure
Info "Starting Docker infrastructure..."
docker compose -f "$ROOT\deploy\docker-compose-infra.yml" up -d 2>&1
if ($LASTEXITCODE -ne 0) { Fail "Docker failed" }

Info "Waiting for Postgres..."
for ($i = 0; $i -lt 30; $i++) {
    $r = docker exec conductor-postgres pg_isready -U conductor -q 2>&1
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep 1
}
OK "Infrastructure ready"

# Start orchestrator
$env:DATABASE_URL   = "postgres://conductor:conductor@localhost:5432/conductor"
$env:REDIS_ADDR     = "localhost:6379"
$env:MIGRATIONS_DIR = "migrations"
Info "Starting Orchestrator on :9000..."
$orch = Start-Process "$ROOT\orchestrator\bin\orchestrator.exe" `
    -PassThru -NoNewWindow -RedirectStandardError "$LOGS\orchestrator.log" `
    -WorkingDirectory "$ROOT\orchestrator"
Start-Sleep 5
OK "Orchestrator PID $($orch.Id)"

# Start worker
$env:ORCHESTRATOR_ADDR = ":9000"
Info "Starting Worker..."
$wkr = Start-Process "$ROOT\worker\bin\worker.exe" `
    -PassThru -NoNewWindow -RedirectStandardError "$LOGS\worker.log" `
    -WorkingDirectory "$ROOT\worker"
OK "Worker PID $($wkr.Id)"

# Start api-ai
$env:DATABASE_URL = "postgresql://conductor:conductor@localhost:5432/conductor"
$env:REDIS_URL    = "redis://localhost:6379"
$env:LLM_PROVIDER = "mock"
Info "Starting api-ai on :8000..."
$api = Start-Process python `
    -ArgumentList "-m","uvicorn","app.main:app","--port","8000","--log-level","warning" `
    -PassThru -NoNewWindow -RedirectStandardError "$LOGS\api-ai.log" `
    -WorkingDirectory "$ROOT\api-ai"
Start-Sleep 4
OK "api-ai PID $($api.Id)"

# Start web
Info "Starting Web on :3000..."
$web = Start-Process node `
    -ArgumentList "$ROOT\web\node_modules\vite\bin\vite.js","--port","3000" `
    -PassThru -NoNewWindow -RedirectStandardOutput "$LOGS\web.log" `
    -WorkingDirectory "$ROOT\web"
Start-Sleep 3
OK "Web PID $($web.Id)"

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "  Dashboard  http://localhost:3000" -ForegroundColor Cyan
Write-Host "  API docs   http://localhost:8000/docs" -ForegroundColor Cyan
Write-Host "  Logs       $LOGS" -ForegroundColor Gray
Write-Host "  Ctrl+C to stop all" -ForegroundColor Yellow
Write-Host "==========================================" -ForegroundColor Green

try { while ($true) { Start-Sleep 2 } }
finally {
    Write-Host "`nStopping..." -ForegroundColor Yellow
    foreach ($p in @($orch, $wkr, $api, $web)) {
        if ($p -and -not $p.HasExited) { $p.Kill() }
    }
    docker compose -f "$ROOT\deploy\docker-compose-infra.yml" stop 2>&1 | Out-Null
    OK "Stopped."
}
