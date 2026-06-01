# Excalidraw Tailscale Launcher (Windows)
# Starts the Docker-hosted control panel.

$ErrorActionPreference = 'Continue'
$LAUNCHER_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path

Clear-Host
Write-Host ''
Write-Host '  EXCALIDRAW TAILSCALE LAUNCHER' -ForegroundColor Cyan
Write-Host ''

Write-Host '  [1/2] Checking Docker...' -ForegroundColor Yellow
try {
    $dockerVersion = & docker --version 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Docker is not installed" }
    Write-Host "        $dockerVersion" -ForegroundColor DarkGray
} catch {
    Write-Host '  Docker was not found.' -ForegroundColor Red
    $choice = Read-Host '  Download and install Docker Desktop now? (Y/n)'
    if ($choice -notmatch '^[nN]') {
        Write-Host '  Downloading Docker Desktop installer...' -ForegroundColor Yellow
        $installer = "$env:TEMP\Docker Desktop Installer.exe"
        Invoke-WebRequest -Uri "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe" -OutFile $installer
        Write-Host '  Running installer. Follow the prompts, then start Docker Desktop.' -ForegroundColor Yellow
        Start-Process -FilePath $installer -Wait
        Read-Host '  Press Enter to exit'
        exit 1
    }

    Write-Host '  Install Docker Desktop from https://docker.com and run this launcher again.' -ForegroundColor Yellow
    Read-Host '  Press Enter to exit'
    exit 1
}

$dockerInfo = & docker info 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host '  Docker Desktop is installed, but the Docker engine is not running.' -ForegroundColor Red
    Write-Host '  Start Docker Desktop, wait until it is running, then open this launcher again.' -ForegroundColor Yellow
    Write-Host ''
    Write-Host '  Docker said:' -ForegroundColor DarkGray
    $dockerInfo | Select-Object -Last 6 | ForEach-Object {
        Write-Host "    $_" -ForegroundColor DarkGray
    }
    Read-Host '  Press Enter to exit'
    exit 1
}

Write-Host '  [2/2] Starting control panel...' -ForegroundColor Yellow
$composeProc = Start-Process `
    -FilePath 'docker' `
    -ArgumentList 'compose', '-f', "`"$LAUNCHER_DIR\docker-compose.yml`"", 'up', 'gui', '-d', '--build' `
    -WorkingDirectory $LAUNCHER_DIR `
    -WindowStyle Hidden `
    -PassThru

$composeProc.WaitForExit()
if ($composeProc.ExitCode -ne 0) {
    Write-Host '  Failed to start the GUI container.' -ForegroundColor Red
    & docker compose -f "$LAUNCHER_DIR\docker-compose.yml" logs gui 2>&1 | Select-Object -Last 20
    Read-Host '  Press Enter to exit'
    exit 1
}

Write-Host '  GUI is running at http://localhost:7842' -ForegroundColor Green
Start-Process "http://localhost:7842"

Write-Host ''
Write-Host '  Use the browser control panel to paste your Tailscale auth key and start the session.' -ForegroundColor White
Write-Host '  Press Enter here when finished to stop all launcher containers.' -ForegroundColor DarkGray
$null = Read-Host '  >'

Write-Host ''
Write-Host '  Shutting down launcher containers...' -ForegroundColor Yellow
& docker compose -f "$LAUNCHER_DIR\docker-compose.yml" down 2>&1 | Out-Null
Write-Host '  Done.' -ForegroundColor Green
Start-Sleep -Seconds 2
