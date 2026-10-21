$ROOT = Split-Path $MyInvocation.MyCommand.Path
Write-Host "Stopping Conductor services..." -ForegroundColor Yellow
Get-Process orchestrator,worker -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process python -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*uvicorn*" } | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*vite*" } | Stop-Process -Force -ErrorAction SilentlyContinue
docker compose -f "$ROOT\deploy\docker-compose-infra.yml" stop 2>&1 | Out-Null
Write-Host "All stopped." -ForegroundColor Green