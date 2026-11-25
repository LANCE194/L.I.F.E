@echo off
title L.I.F.E. - Localized Intelligent First-aid Evaluator
REM Always run from the folder this file is in, even when double-clicked from elsewhere.
cd /d "%~dp0"

node --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo ERROR: Node.js is not installed or not in PATH.
    echo Install the LTS version ^(20 or newer^) from https://nodejs.org/ and try again.
    echo.
    pause
    exit /b 1
)

if not exist "server\package.json" (
    echo ERROR: server\package.json not found. Keep run_life.bat in the LIFE project folder.
    pause
    exit /b 1
)

node start_life.js %*

echo.
echo L.I.F.E. stopped.
pause
