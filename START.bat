@echo off
setlocal enabledelayedexpansion
title Polymarket Dashboard
color 0B
cd /d "%~dp0"

echo.
echo   ╔══════════════════════════════════════════════════════╗
echo   ║    POLYMARKET TRADING SUITE - QUICK START            ║
echo   ║    Dashboard + All 3 Bots                            ║
echo   ╚══════════════════════════════════════════════════════╝
echo.

:: ── Verify Node.js ──
where node >nul 2>&1
if errorlevel 1 (
    echo   [ERROR] Node.js not found. Run LAUNCH.bat for full setup.
    pause & exit /b 1
)

:: ── Verify dependencies ──
if not exist "node_modules\ethers" (
    echo   [npm] First run — installing dependencies...
    call npm install --silent 2>nul
    if exist "copybot\package.json" ( cd /d "%~dp0copybot" && call npm install --silent 2>nul && cd /d "%~dp0" )
    if exist "autobot\package.json" ( cd /d "%~dp0autobot" && call npm install --silent 2>nul && cd /d "%~dp0" )
    echo   [ok] Dependencies installed
)

:: ── Kill any running instances ──
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3847 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" 2>nul
taskkill /F /FI "WINDOWTITLE eq Polymarket*" 2>nul >nul
timeout /t 1 /nobreak >nul

:: ── Ensure logs directory ──
if not exist logs mkdir logs

:: ── Pull latest code if git is available ──
where git >nul 2>&1
if not errorlevel 1 (
    if exist ".git" (
        echo   [update] Checking for updates...
        git fetch origin claude/polymarket-copy-bot-xcdOo >nul 2>&1
        for /f %%A in ('git rev-parse HEAD 2^>nul') do set "LOCAL=%%A"
        for /f %%A in ('git rev-parse origin/claude/polymarket-copy-bot-xcdOo 2^>nul') do set "REMOTE=%%A"
        if not "!LOCAL!"=="!REMOTE!" (
            echo   [update] New code found — pulling...
            git pull origin claude/polymarket-copy-bot-xcdOo >nul 2>&1
            echo   [ok] Updated to latest
        ) else (
            echo   [ok] Already up to date
        )
    )
)

echo.
echo   ╔══════════════════════════════════════════════════════╗
echo   ║                                                      ║
echo   ║   DASHBOARD:  http://localhost:3847                  ║
echo   ║                                                      ║
echo   ║   If your browser didn't open, copy the URL above   ║
echo   ║   and paste it into Chrome / Edge / Firefox.         ║
echo   ║                                                      ║
echo   ║   Keep this window open. Press Ctrl+C to stop.       ║
echo   ║                                                      ║
echo   ╚══════════════════════════════════════════════════════╝
echo.

:: ── Launch dashboard (it spawns + manages all 3 bots) ──
:LOOP
node web-dashboard.js
echo.
echo   [restart] Restarting in 3s...
timeout /t 3 /nobreak >nul
goto :LOOP
