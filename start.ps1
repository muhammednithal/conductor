#Requires -Version 5.1
<#
.SYNOPSIS  Start all Conductor services for local development. Press Ctrl+C to stop.
.EXAMPLE   .\start.ps1
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
Push-Location "$ROOT\orchestrator"
& $GO build -o "bin\orchestrator.exe" "./cmd/orchestrator"
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "Orchestrator build failed" }
Pop-Location
OK "Orchestrator built"

# Build worker
Info "Building worker..."
Push-Location "$ROOT\worker"
& $GO build -o "bin\worker.exe" "./cmd/worker"
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "Worker build failed" }
Pop-Location
OK "Worker built"

# Start infrastructure
Info "Starting Docker infrastructure (Postgres + Redis)..."
docker compose -f "$ROOT\deploy\docker-compose-infra.yml" up -d 2>&1
if ($LASTEXITCODE -ne 0) { Fail "Docker failed — is Docker Desktop running?" }

Info "Waiting for database to be ready..."
for ($i = 0; $i -lt 30; $i++) {
    docker exec conductor-postgres pg_isready -U conductor -q 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep 1
}
OK "Infrastructure ready"

# Set env vars for all services
$env:DATABASE_URL   = "postgres://conductor:conductor@localhost:5432/conductor"
$env:REDIS_ADDR     = "localhost:6379"
$env:MIGRATIONS_DIR = "migrations"
$env:ORCHESTRATOR_ADDR = ":9000"

# Start orchestrator
Info "Starting Orchestrator :9000..."
$orch = Start-Process "$ROOT\orchestrator\bin\orchestrator.exe" `
    -PassThru -NoNewWindow `
    -RedirectStandardError "$LOGS\orchestrator.log" `
    -WorkingDirectory "$ROOT\orchestrator"
Start-Sleep 5
if ($orch.HasExited) { Fail "Orchestrator crashed — check $LOGS\orchestrator.log" }
OK "Orchestrator running (PID $($orch.Id))"

# Start worker
Info "Starting Worker..."
$wkr = Start-Process "$ROOT\worker\bin\worker.exe" `
    -PassThru -NoNewWindow `
    -RedirectStandardError "$LOGS\worker.log" `
    -WorkingDirectory "$ROOT\worker"
Start-Sleep 2
OK "Worker running (PID $($wkr.Id))"

# Start api-ai
$env:DATABASE_URL = "postgresql://conductor:conductor@localhost:5432/conductor"
$env:REDIS_URL    = "redis://localhost:6379"
$env:LLM_PROVIDER = "mock"
Info "Starting api-ai :8000..."
$api = Start-Process python `
    -ArgumentList "-m","uvicorn","app.main:app","--port","8000","--log-level","warning" `
    -PassThru -NoNewWindow `
    -RedirectStandardError "$LOGS\api-ai.log" `
    -WorkingDirectory "$ROOT\api-ai"
Start-Sleep 4
if ($api.HasExited) { Fail "api-ai crashed — check $LOGS\api-ai.log" }
OK "api-ai running (PID $($api.Id))"

# Start web dashboard (Vite)
Info "Starting Web dashboard :3000..."
$web = Start-Process node `
    -ArgumentList "$ROOT\web\node_modules\vite\bin\vite.js","--port","3000" `
    -PassThru -NoNewWindow `
    -RedirectStandardOutput "$LOGS\web.log" `
    -WorkingDirectory "$ROOT\web"
Start-Sleep 3
OK "Web running (PID $($web.Id))"

# Print summary
Write-Host ""
Write-Host ("=" * 50) -ForegroundColor Green
Write-Host "  Conductor is running!" -ForegroundColor Green
Write-Host ""
Write-Host "  Dashboard : http://localhost:3000" -ForegroundColor Cyan
Write-Host "  API docs  : http://localhost:8000/docs" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Logs      : $LOGS\" -ForegroundColor Gray
Write-Host "  Stop      : Ctrl+C  or  .\stop.ps1" -ForegroundColor Gray
Write-Host ("=" * 50) -ForegroundColor Green
Write-Host ""

# Block until Ctrl+C, then clean up
try {
    while ($true) { Start-Sleep 2 }
} finally {
    Write-Host "`nShutting down..." -ForegroundColor Yellow
    foreach ($p in @($orch, $wkr, $api, $web)) {
        if ($p -and -not $p.HasExited) { $p.Kill() }
    }
    docker compose -f "$ROOT\deploy\docker-compose-infra.yml" stop 2>&1 | Out-Null
    Write-Host "All services stopped." -ForegroundColor Green
}
