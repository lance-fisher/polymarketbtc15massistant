@echo off
title Polymarket Trading Suite [Persistent]
color 0B

:: ── Figure out install dir ──
if exist "D:\ProjectsHome" (
    set "DIR=D:\ProjectsHome\polymarket-bots"
) else (
    set "DIR=%USERPROFILE%\polymarket-bots"
)

:: ── First-time check: if no repo, run start.bat for initial setup ──
if not exist "%DIR%\.git" (
    echo.
    echo   First run detected — running initial setup...
    echo.
    call "%~dp0start.bat"
    exit /b
)

cd /d "%DIR%"

:: ── Kill any orphaned bot windows from old-style launches ──
taskkill /F /FI "WINDOWTITLE eq CopyBot*"  2>nul >nul
taskkill /F /FI "WINDOWTITLE eq SignalBot*" 2>nul >nul
taskkill /F /FI "WINDOWTITLE eq AutoBot*"   2>nul >nul
taskkill /F /FI "WINDOWTITLE eq Dashboard*" 2>nul >nul
timeout /t 1 /nobreak >nul

echo.
echo   ╔══════════════════════════════════════════════════════╗
echo   ║     POLYMARKET PERSISTENT LAUNCHER                    ║
echo   ║     Bots auto-restart · Code auto-updates from git    ║
echo   ║     Just leave this window open. That's it.           ║
echo   ╚══════════════════════════════════════════════════════╝
echo.

:loop
echo   [%time%] Pulling latest code...
git pull origin claude/polymarket-copy-bot-xcdOo 2>nul

echo   [%time%] Checking dependencies...
call npm install --silent 2>nul
cd /d "%DIR%\copybot" && call npm install --silent 2>nul
cd /d "%DIR%\autobot" && call npm install --silent 2>nul
cd /d "%DIR%"

if not exist "%DIR%\logs" mkdir "%DIR%\logs"

echo.
echo   [%time%] ══ Starting Dashboard + All Bots ══
echo   Dashboard manages all 3 bots as child processes.
echo   Auto-update checks git every 60 seconds.
echo   If I push code, everything restarts automatically.
echo.

node web-dashboard.js

echo.
echo   [%time%] Dashboard exited (update or crash). Restarting in 5s...
echo.
timeout /t 5 /nobreak >nul
goto loop
