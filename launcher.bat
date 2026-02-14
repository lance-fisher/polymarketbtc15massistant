@echo off
title Polymarket Trading Suite [Persistent]
color 0B

:: ── Figure out install dir ──
if exist "D:\ProjectsHome" (
    set "DIR=D:\ProjectsHome\polymarket-bots"
) else (
    set "DIR=%USERPROFILE%\polymarket-bots"
)

set "REPO=https://github.com/lance-fisher/polymarketbtc15massistant.git"
set "BRANCH=claude/polymarket-copy-bot-xcdOo"

:: ── First-time: clone if repo doesn't exist ──
if not exist "%DIR%\.git" (
    echo.
    echo   First run — setting up repository...
    echo.
    :: If folder exists but isn't a git repo, remove it first
    if exist "%DIR%" (
        echo   Removing incomplete install at %DIR%...
        rmdir /s /q "%DIR%" 2>nul
    )
    git clone -b %BRANCH% %REPO% "%DIR%"
    if errorlevel 1 (
        echo   [ERROR] Git clone failed. Check internet and try again.
        pause
        exit /b 1
    )
    cd /d "%DIR%"

    echo   Installing dependencies...
    call npm install --silent 2>nul
    cd /d "%DIR%\copybot" && call npm install --silent 2>nul
    cd /d "%DIR%\autobot" && call npm install --silent 2>nul
    cd /d "%DIR%"

    :: Run setup.bat for .env setup + approvals if it exists
    if exist "%DIR%\setup.bat" (
        echo   Running first-time setup...
        call "%DIR%\setup.bat"
        exit /b
    )
)

cd /d "%DIR%"

:: ── Create desktop shortcut (checks all common desktop locations) ──
call :create_shortcut

:: ── Kill any orphaned bot windows from old-style launches ──
taskkill /F /FI "WINDOWTITLE eq CopyBot*"  2>nul >nul
taskkill /F /FI "WINDOWTITLE eq SignalBot*" 2>nul >nul
taskkill /F /FI "WINDOWTITLE eq AutoBot*"   2>nul >nul
taskkill /F /FI "WINDOWTITLE eq Dashboard*" 2>nul >nul
ping -n 2 127.0.0.1 >nul

echo.
echo   ╔══════════════════════════════════════════════════════╗
echo   ║     POLYMARKET PERSISTENT LAUNCHER                    ║
echo   ║     Bots auto-restart · Code auto-updates from git    ║
echo   ║     Just leave this window open. That's it.           ║
echo   ╚══════════════════════════════════════════════════════╝
echo.

:loop
echo   [%time%] Pulling latest code...
git pull origin %BRANCH%
if errorlevel 1 (
    echo   [warn] Git pull failed — continuing with current code
)

echo   [%time%] Checking dependencies...
call npm install --silent 2>nul
cd /d "%DIR%\copybot" && call npm install --silent 2>nul
cd /d "%DIR%\autobot" && call npm install --silent 2>nul
cd /d "%DIR%"
if errorlevel 1 (
    echo   [warn] npm install had issues — continuing anyway
)

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
ping -n 6 127.0.0.1 >nul
goto loop

:: ═══════════════════════════════════════════════════════
::  Desktop launcher — drops a simple .bat onto the desktop
::  (more reliable than COM .lnk shortcuts)
:: ═══════════════════════════════════════════════════════
:create_shortcut
set "LAUNCHER_PATH=%DIR%\launcher.bat"

:: Find desktop folder
set "DESKTOP="
if exist "%USERPROFILE%\OneDrive\Desktop" (
    set "DESKTOP=%USERPROFILE%\OneDrive\Desktop"
) else if exist "%USERPROFILE%\Desktop" (
    set "DESKTOP=%USERPROFILE%\Desktop"
)
if "%DESKTOP%"=="" (
    for /f "usebackq tokens=*" %%d in (`powershell -Command "[Environment]::GetFolderPath('Desktop')"`) do set "DESKTOP=%%d"
)
if "%DESKTOP%"=="" (
    echo   [shortcut] Could not locate Desktop folder
    goto :eof
)

:: Write a simple .bat launcher on the desktop (always works, no COM needed)
set "BATFILE=%DESKTOP%\Polymarket Bots.bat"
if not exist "%BATFILE%" (
    echo   [shortcut] Creating desktop launcher at %DESKTOP%...
    (
        echo @echo off
        echo title Polymarket Trading Suite
        echo cd /d "%DIR%"
        echo call launcher.bat
    ) > "%BATFILE%"
    if exist "%BATFILE%" (
        echo   [ok] Desktop launcher created: "Polymarket Bots.bat"
    ) else (
        echo   [skip] Could not write to desktop
    )
)

:: Also try .lnk shortcut (nicer icon) — but don't fail if it doesn't work
set "LNKFILE=%DESKTOP%\Polymarket Bots.lnk"
if not exist "%LNKFILE%" (
    powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%LNKFILE%'); $s.TargetPath = '%LAUNCHER_PATH%'; $s.WorkingDirectory = '%DIR%'; $s.IconLocation = 'shell32.dll,21'; $s.Description = 'Launch Polymarket Trading Suite (persistent)'; $s.Save()" 2>nul
    if exist "%LNKFILE%" echo   [ok] Desktop shortcut created: "Polymarket Bots.lnk"
)
goto :eof
