@echo off
setlocal enabledelayedexpansion
title Polymarket Trading Suite
color 0B
cd /d "%~dp0"

echo.
echo   ╔══════════════════════════════════════════════════════╗
echo   ║    POLYMARKET TRADING SUITE                          ║
echo   ║    Signal Bot + Copy Bot + Auto Bot + Dashboard      ║
echo   ╚══════════════════════════════════════════════════════╝
echo.

:: ═══════════════════════════════════════════════════════
::  STEP 1: Node.js
:: ═══════════════════════════════════════════════════════
where node >nul 2>&1
if errorlevel 1 (
    echo   [setup] Node.js not found — installing automatically...
    if "%PROCESSOR_ARCHITECTURE%"=="AMD64" (
        set "NODE_URL=https://nodejs.org/dist/v20.11.1/node-v20.11.1-x64.msi"
    ) else (
        set "NODE_URL=https://nodejs.org/dist/v20.11.1/node-v20.11.1-x86.msi"
    )
    set "NODE_MSI=%TEMP%\node-installer.msi"
    powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '!NODE_URL!' -OutFile '!NODE_MSI!' -UseBasicParsing" 2>nul
    if errorlevel 1 (
        echo   [ERROR] Could not download Node.js. Install from https://nodejs.org then re-run.
        pause & exit /b 1
    )
    echo   [setup] Installing Node.js...
    msiexec /i "!NODE_MSI!" /qn /norestart
    if errorlevel 1 powershell -NoProfile -Command "Start-Process msiexec -ArgumentList '/i','!NODE_MSI!','/qb','/norestart' -Verb RunAs -Wait"
    del "!NODE_MSI!" 2>nul
    set "PATH=%ProgramFiles%\nodejs;%ProgramFiles(x86)%\nodejs;%LOCALAPPDATA%\Programs\nodejs;%PATH%"
    where node >nul 2>&1
    if errorlevel 1 (
        echo   [ERROR] Node installed but not found. Close this window, reopen, and run again.
        pause & exit /b 1
    )
)
for /f "tokens=1 delims=." %%v in ('node -v') do set NODE_V=%%v
set NODE_V=%NODE_V:v=%
echo   [ok] Node.js v%NODE_V%

:: ═══════════════════════════════════════════════════════
::  STEP 2: Kill old processes + free port
:: ═══════════════════════════════════════════════════════
echo   [cleanup] Stopping old instances...
taskkill /F /FI "WINDOWTITLE eq CopyBot*"   2>nul >nul
taskkill /F /FI "WINDOWTITLE eq SignalBot*"  2>nul >nul
taskkill /F /FI "WINDOWTITLE eq AutoBot*"    2>nul >nul
taskkill /F /FI "WINDOWTITLE eq Polymarket*" 2>nul >nul
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3847 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" 2>nul
timeout /t 1 /nobreak >nul

:: ═══════════════════════════════════════════════════════
::  STEP 3: Pull latest code
:: ═══════════════════════════════════════════════════════
set "BRANCH=claude/polymarket-copy-bot-xcdOo"

where git >nul 2>&1
if not errorlevel 1 (
    if exist ".git" (
        echo   [update] Checking for updates...
        git fetch origin %BRANCH% >nul 2>&1
        for /f %%A in ('git rev-parse HEAD 2^>nul') do set "LOCAL=%%A"
        for /f %%A in ('git rev-parse origin/%BRANCH% 2^>nul') do set "REMOTE=%%A"
        if not "!LOCAL!"=="!REMOTE!" (
            echo   [update] New code found — pulling...
            git pull origin %BRANCH% >nul 2>&1
            echo   [ok] Updated to latest
        ) else (
            echo   [ok] Code up to date
        )
    ) else (
        echo   [setup] Setting up auto-update...
        git init -q 2>nul
        git remote add origin https://github.com/lance-fisher/polymarketbtc15massistant.git 2>nul
        git fetch -q origin %BRANCH% 2>nul
        git reset -q origin/%BRANCH% 2>nul
        echo   [ok] Auto-update enabled
    )
) else (
    echo   [info] No git — using current code (install git for auto-updates^)
)

:: ═══════════════════════════════════════════════════════
::  STEP 4: Write .env files (only if missing)
:: ═══════════════════════════════════════════════════════
set "RPC=https://polygon-bor-rpc.publicnode.com"

if not exist ".env" (
    echo   [config] Writing signal bot config...
    (
    echo PRIVATE_KEY=0x674f6d0fe405f168a33d360555044cb9ff73cad75262c3d6d74b8f1db4c328d1
    echo POLYGON_RPC_URL=%RPC%
    echo MAX_TRADE_USDC=5
    echo MAX_DAILY_USDC=30
    echo MAX_SPREAD_CENTS=8
    ) > ".env"
)

if not exist "copybot\.env" (
    echo   [config] Writing copy bot config...
    (
    echo PRIVATE_KEY=0x99a1838ce42b8e0a2aa46de1356d77270190e02dd9ebf625d4f8913ea448aea3
    echo POLYGON_RPC_URL=%RPC%
    echo TARGET_USERNAME=anoin123
    echo TARGET_ADDRESS=0xEd5f13e3373079F62E3c5fce82D1e6263B063a3c
    echo MAX_TRADE_USDC=5
    echo MAX_PORTFOLIO_USDC=15
    echo MAX_POSITIONS=3
    echo MAX_DAILY_USDC=20
    echo MAX_SPREAD_CENTS=8
    echo MAX_NEW_PER_CYCLE=3
    echo POLL_INTERVAL_S=20
    ) > "copybot\.env"
)

if not exist "autobot\.env" (
    echo   [config] Writing auto bot config...
    (
    echo PRIVATE_KEY=0x66dbe2e0f2649ca433ec1a5fd1ff776fee9900b3623e05415af16c5f4bb1b2c3
    echo POLYGON_RPC_URL=%RPC%
    echo MAX_TRADE_USDC=5
    echo MAX_PORTFOLIO_USDC=15
    echo MAX_POSITIONS=3
    echo MAX_DAILY_USDC=20
    echo MAX_SPREAD_CENTS=8
    echo SCAN_INTERVAL_S=30
    echo MIN_EDGE=0.03
    echo MIN_LIQUIDITY=1500
    ) > "autobot\.env"
)
echo   [ok] Config ready

:: ═══════════════════════════════════════════════════════
::  STEP 5: Install npm dependencies (all 3 projects)
:: ═══════════════════════════════════════════════════════
set "NEED_INSTALL=0"
if not exist "node_modules\ethers" set "NEED_INSTALL=1"
if not exist "copybot\node_modules\ethers" set "NEED_INSTALL=1"
if not exist "autobot\node_modules\ethers" set "NEED_INSTALL=1"

if "!NEED_INSTALL!"=="1" (
    echo   [npm] Installing dependencies (this takes ~30s first time^)...
    call npm install --silent 2>nul
    if errorlevel 1 call npm install 2>nul
    cd /d "%~dp0copybot" && call npm install --silent 2>nul
    cd /d "%~dp0autobot" && call npm install --silent 2>nul
    cd /d "%~dp0"
    echo   [ok] Dependencies installed
) else (
    echo   [ok] Dependencies ready
)

:: ── Ensure logs + state files ──
if not exist "logs" mkdir "logs"
if not exist "state.json" echo {}> "state.json"
if not exist "autobot-state.json" echo {}> "autobot-state.json"

:: ═══════════════════════════════════════════════════════
::  STEP 6: Check wallet balances
:: ═══════════════════════════════════════════════════════
echo.
echo   ═══════════════════════════════════════════════════
echo     WALLET STATUS
echo   ═══════════════════════════════════════════════════
echo.
node check-wallets.js 2>nul
echo.

:: ═══════════════════════════════════════════════════════
::  STEP 7: Desktop shortcut (create once)
:: ═══════════════════════════════════════════════════════
for /f "usebackq tokens=*" %%d in (`powershell -NoProfile -Command "[Environment]::GetFolderPath('Desktop')"`) do set "SC_DESKTOP=%%d"
if "!SC_DESKTOP!"=="" if exist "D:\Lance\Desktop" set "SC_DESKTOP=D:\Lance\Desktop"
if "!SC_DESKTOP!"=="" if exist "%USERPROFILE%\OneDrive\Desktop" set "SC_DESKTOP=%USERPROFILE%\OneDrive\Desktop"
if "!SC_DESKTOP!"=="" if exist "%USERPROFILE%\Desktop" set "SC_DESKTOP=%USERPROFILE%\Desktop"
if exist "D:\Lance\Desktop" set "SC_DESKTOP=D:\Lance\Desktop"

if not "!SC_DESKTOP!"=="" (
    if not exist "!SC_DESKTOP!\Polymarket Bots.bat" (
        echo @echo off> "!SC_DESKTOP!\Polymarket Bots.bat"
        echo cd /d "%~dp0">> "!SC_DESKTOP!\Polymarket Bots.bat"
        echo call START.bat>> "!SC_DESKTOP!\Polymarket Bots.bat"
        echo   [ok] Desktop shortcut created: "Polymarket Bots.bat"
    )
)

:: ═══════════════════════════════════════════════════════
::  LAUNCH
:: ═══════════════════════════════════════════════════════
echo.
echo   ╔══════════════════════════════════════════════════════╗
echo   ║                                                      ║
echo   ║   DASHBOARD:  http://localhost:3847                  ║
echo   ║                                                      ║
echo   ║   Browser should open automatically.                 ║
echo   ║   If not, copy the URL above into your browser.      ║
echo   ║                                                      ║
echo   ║   Keep this window open. Press Ctrl+C to stop.       ║
echo   ║                                                      ║
echo   ╚══════════════════════════════════════════════════════╝
echo.
echo   Wallets:
echo   Signal: 0x5eD48e29dcd952955d7E4fccC3616EFA38cD75a5
echo   Copy:   0xf35803f093BBceaBEb9A6abd3d4c99856BDdA40C
echo   Auto:   0xf17Cb352380Fd5503742c5A0573cDE4c656d8486
echo.

title Polymarket Dashboard - http://localhost:3847

:: ── Dashboard restart loop (auto-restarts after updates) ──
:LOOP
node web-dashboard.js
echo.
echo   [restart] Dashboard restarting in 3s...
timeout /t 3 /nobreak >nul
goto :LOOP
