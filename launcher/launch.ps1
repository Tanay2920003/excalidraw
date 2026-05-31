# =============================================================================
#  Excalidraw Secure Session Launcher  (Windows)
#  Starts the GUI control panel in Docker.
# =============================================================================

$ErrorActionPreference = 'Continue'
$LAUNCHER_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path

# ── Banner ──
Clear-Host
Write-Host ''
Write-Host '  ╔══════════════════════════════════════════════════════════╗' -ForegroundColor Cyan
Write-Host '  ║           EXCALIDRAW  ·  LAUNCHER GUI                    ║' -ForegroundColor Cyan
Write-Host '  ╚══════════════════════════════════════════════════════════╝' -ForegroundColor Cyan
Write-Host ''

# ── Check Docker ──
Write-Host '  [1/2] Checking Docker...' -ForegroundColor Yellow
try {
    $dv = & docker --version 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Not installed" }
    Write-Host "          $dv" -ForegroundColor DarkGray
} catch {
    Write-Host '  ✗ Docker not found.' -ForegroundColor Red
    $choice = Read-Host '  Would you like to auto-download and install Docker Desktop now? (Y/n)'
    if ($choice -notmatch '^[nN]') {
        Write-Host '  Downloading Docker Desktop Installer...' -ForegroundColor Yellow
        $installer = "$env:TEMP\Docker Desktop Installer.exe"
        Invoke-WebRequest -Uri "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe" -OutFile $installer
        Write-Host '  Running installer. Please follow the prompts (may require a reboot)...' -ForegroundColor Yellow
        Start-Process -FilePath $installer -Wait
        Write-Host '  Installation finished. Please launch Docker Desktop and ensure it is running.' -ForegroundColor Cyan
        Read-Host '  Press Enter to exit'; exit 1
    } else {
        Write-Host '  Please install Docker Desktop manually from https://docker.com' -ForegroundColor Yellow
        Read-Host '  Press Enter to exit'; exit 1
    }
}

# ── Start GUI ──
Write-Host '  [2/2] Starting Control Panel...' -ForegroundColor Yellow
$composeProc = Start-Process `
    -FilePath 'docker' `
    -ArgumentList 'compose', '-f', "`"$LAUNCHER_DIR\docker-compose.yml`"", 'up', 'gui', '-d' `
    -WorkingDirectory $LAUNCHER_DIR `
    -WindowStyle Hidden `
    -PassThru

$composeProc.WaitForExit()
if ($composeProc.ExitCode -ne 0) {
    Write-Host '  ✗ Failed to start the GUI container.' -ForegroundColor Red
    & docker compose -f "$LAUNCHER_DIR\docker-compose.yml" logs gui 2>&1 | Select-Object -Last 20
    Read-Host '  Press Enter to exit'; exit 1
}

Write-Host '  ✓ GUI is running.' -ForegroundColor Green
Write-Host ''

# Open browser to the GUI
Start-Process "http://localhost:7842"

Write-Host '  The Excalidraw Launcher is open in your web browser.' -ForegroundColor White
Write-Host '  Manage your session from there.' -ForegroundColor White
Write-Host ''
Write-Host '  Press [ENTER] when you are completely finished to shut EVERYTHING down.' -ForegroundColor DarkGray

$null = Read-Host '  >'

Write-Host ''
Write-Host '  Shutting down all Excalidraw containers...' -ForegroundColor Yellow
& docker compose -f "$LAUNCHER_DIR\docker-compose.yml" down 2>&1 | Out-Null
Write-Host '  ✓ Done.' -ForegroundColor Green
Start-Sleep -Seconds 2
