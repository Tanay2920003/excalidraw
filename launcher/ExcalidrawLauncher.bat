@echo off
title Excalidraw Secure Session
set "SCRIPT_DIR=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%launch.ps1"
echo.
pause
