@echo off
setlocal enabledelayedexpansion
title Polymarket Trading Suite
color 0B
cd /d "%~dp0"

echo.
echo   ╔══════════════════════════════════════════════════════╗
echo   ║    POLYMARKET TRADING SUITE - ONE-CLICK LAUNCHER     ║
echo   ║    Signal Bot + Copy Bot + Auto Bot                  ║
echo   ╚══════════════════════════════════════════════════════╝
echo.

:: ═══════════════════════════════════════════════════════
::  STEP 1: Check/Install Node.js automatically
:: ═══════════════════════════════════════════════════════
where node >nul 2>&1
if errorlevel 1 (
    echo   [!] Node.js not found. Installing automatically...
    echo.
    if "%PROCESSOR_ARCHITECTURE%"=="AMD64" (
        set "NODE_URL=https://nodejs.org/dist/v20.11.1/node-v20.11.1-x64.msi"
    ) else (
        set "NODE_URL=https://nodejs.org/dist/v20.11.1/node-v20.11.1-x86.msi"
    )
    set "NODE_MSI=%TEMP%\node-installer.msi"
    echo   [download] Downloading Node.js...
    powershell -NoProfile -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '!NODE_URL!' -OutFile '!NODE_MSI!' -UseBasicParsing } catch { Write-Host 'Download failed'; exit 1 }"
    if errorlevel 1 (
        echo   [ERROR] Could not download Node.js. Install from https://nodejs.org then retry.
        pause & exit /b 1
    )
    echo   [install] Installing Node.js (may ask for admin)...
    msiexec /i "!NODE_MSI!" /qn /norestart
    if errorlevel 1 powershell -NoProfile -Command "Start-Process msiexec -ArgumentList '/i','!NODE_MSI!','/qb','/norestart' -Verb RunAs -Wait"
    del "!NODE_MSI!" 2>nul
    set "PATH=%ProgramFiles%\nodejs;%ProgramFiles(x86)%\nodejs;%LOCALAPPDATA%\Programs\nodejs;%PATH%"
    where node >nul 2>&1
    if errorlevel 1 (
        echo   [ERROR] Close this window, reopen, and run again.
        pause & exit /b 1
    )
)
for /f "tokens=1 delims=." %%v in ('node -v') do set NODE_V=%%v
set NODE_V=%NODE_V:v=%
echo   [ok] Node.js v%NODE_V%

:: ═══════════════════════════════════════════════════════
::  STEP 2: Install / Update code
:: ═══════════════════════════════════════════════════════

:: If running from inside the repo, use this dir
if exist "%~dp0package.json" (
    set "DIR=%~dp0"
    if "!DIR:~-1!"=="\" set "DIR=!DIR:~0,-1!"
    goto :HAVE_DIR
)

:: Pick install location
if exist "D:\ProjectsHome" (
    set "DIR=D:\ProjectsHome\polymarket-bots"
) else (
    set "DIR=%USERPROFILE%\polymarket-bots"
)

:HAVE_DIR
set "BRANCH=claude/polymarket-copy-bot-xcdOo"
set "ZIP_URL=https://github.com/lance-fisher/polymarketbtc15massistant/archive/refs/heads/%BRANCH%.zip"

:: Always grab latest code (preserves state files)
if exist "!DIR!\package.json" (
    echo   [update] Pulling latest code...
) else (
    echo   [download] Downloading bot code...
)

:: Back up state files before update
if exist "!DIR!\state.json" copy /y "!DIR!\state.json" "%TEMP%\pm-state-bak.json" >nul 2>nul
if exist "!DIR!\autobot-state.json" copy /y "!DIR!\autobot-state.json" "%TEMP%\pm-astate-bak.json" >nul 2>nul

set "ZIP_FILE=%TEMP%\polymarket-bots.zip"
powershell -NoProfile -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '%ZIP_URL%' -OutFile '%ZIP_FILE%' -UseBasicParsing } catch { exit 1 }" 2>nul

if errorlevel 1 (
    if exist "!DIR!\package.json" (
        echo   [skip] Could not reach GitHub — using existing code
        goto :SKIP_EXTRACT
    )
    echo   [ERROR] Could not download from GitHub. Check internet.
    pause & exit /b 1
)

:: Extract (replace code but keep node_modules)
if exist "!DIR!\node_modules" (
    :: Move node_modules aside so rmdir doesn't delete them
    move "!DIR!\node_modules" "%TEMP%\pm-nm-root" >nul 2>nul
    if exist "!DIR!\copybot\node_modules" move "!DIR!\copybot\node_modules" "%TEMP%\pm-nm-copy" >nul 2>nul
    if exist "!DIR!\autobot\node_modules" move "!DIR!\autobot\node_modules" "%TEMP%\pm-nm-auto" >nul 2>nul
)

if exist "!DIR!" rmdir /s /q "!DIR!" 2>nul
powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; Expand-Archive -Path '%ZIP_FILE%' -DestinationPath '%TEMP%\polymarket-extract' -Force"
for /d %%F in ("%TEMP%\polymarket-extract\*") do move "%%F" "!DIR!" >nul 2>nul
rmdir /s /q "%TEMP%\polymarket-extract" 2>nul
del "%ZIP_FILE%" 2>nul

:: Restore node_modules
if exist "%TEMP%\pm-nm-root" move "%TEMP%\pm-nm-root" "!DIR!\node_modules" >nul 2>nul
if exist "%TEMP%\pm-nm-copy" move "%TEMP%\pm-nm-copy" "!DIR!\copybot\node_modules" >nul 2>nul
if exist "%TEMP%\pm-nm-auto" move "%TEMP%\pm-nm-auto" "!DIR!\autobot\node_modules" >nul 2>nul

:: Restore state files
if exist "%TEMP%\pm-state-bak.json" move /y "%TEMP%\pm-state-bak.json" "!DIR!\state.json" >nul 2>nul
if exist "%TEMP%\pm-astate-bak.json" move /y "%TEMP%\pm-astate-bak.json" "!DIR!\autobot-state.json" >nul 2>nul

if not exist "!DIR!\package.json" (
    echo   [ERROR] Extraction failed. Try again.
    pause & exit /b 1
)
echo   [ok] Code ready at !DIR!

:SKIP_EXTRACT
cd /d "!DIR!"

:: ═══════════════════════════════════════════════════════
::  STEP 3: Kill any running bots
:: ═══════════════════════════════════════════════════════
taskkill /F /FI "WINDOWTITLE eq CopyBot*"   2>nul >nul
taskkill /F /FI "WINDOWTITLE eq SignalBot*"  2>nul >nul
taskkill /F /FI "WINDOWTITLE eq AutoBot*"    2>nul >nul
taskkill /F /FI "WINDOWTITLE eq Polymarket*" 2>nul >nul
timeout /t 1 /nobreak >nul

:: ═══════════════════════════════════════════════════════
::  STEP 4: Write wallet keys and config
:: ═══════════════════════════════════════════════════════
set "KEY_SIGNAL=0x674f6d0fe405f168a33d360555044cb9ff73cad75262c3d6d74b8f1db4c328d1"
set "KEY_COPY=0x99a1838ce42b8e0a2aa46de1356d77270190e02dd9ebf625d4f8913ea448aea3"
set "KEY_AUTO=0x66dbe2e0f2649ca433ec1a5fd1ff776fee9900b3623e05415af16c5f4bb1b2c3"
set "RPC=https://polygon-bor-rpc.publicnode.com"

(
echo PRIVATE_KEY=%KEY_SIGNAL%
echo POLYGON_RPC_URL=%RPC%
echo MAX_TRADE_USDC=5
echo MAX_DAILY_USDC=10
echo MAX_SPREAD_CENTS=5
) > "!DIR!\.env"

(
echo PRIVATE_KEY=%KEY_COPY%
echo POLYGON_RPC_URL=%RPC%
echo TARGET_USERNAME=anoin123
echo TARGET_ADDRESS=0xEd5f13e3373079F62E3c5fce82D1e6263B063a3c
echo MAX_TRADE_USDC=5
echo MAX_PORTFOLIO_USDC=15
echo MAX_POSITIONS=3
echo MAX_DAILY_USDC=10
echo MAX_SPREAD_CENTS=5
echo MAX_NEW_PER_CYCLE=1
echo POLL_INTERVAL_S=30
) > "!DIR!\copybot\.env"

(
echo PRIVATE_KEY=%KEY_AUTO%
echo POLYGON_RPC_URL=%RPC%
echo MAX_TRADE_USDC=5
echo MAX_PORTFOLIO_USDC=15
echo MAX_POSITIONS=3
echo MAX_DAILY_USDC=10
echo MAX_SPREAD_CENTS=5
echo SCAN_INTERVAL_S=60
echo MIN_EDGE=0.12
echo MIN_LIQUIDITY=5000
) > "!DIR!\autobot\.env"

echo   [ok] Config written

:: ═══════════════════════════════════════════════════════
::  STEP 5: Install npm dependencies (skip if present)
:: ═══════════════════════════════════════════════════════
if not exist "!DIR!\node_modules\ethers" (
    echo   [npm] Installing dependencies...
    cd /d "!DIR!"         && call npm install --silent 2>nul
    cd /d "!DIR!\copybot" && call npm install --silent 2>nul
    cd /d "!DIR!\autobot" && call npm install --silent 2>nul
    cd /d "!DIR!"
    echo   [ok] Dependencies installed
) else (
    echo   [ok] Dependencies already installed
)

:: ── Initialize state files ──
if not exist "!DIR!\state.json" echo {} > "!DIR!\state.json"
if not exist "!DIR!\autobot-state.json" echo {} > "!DIR!\autobot-state.json"
if not exist "!DIR!\logs" mkdir "!DIR!\logs"

:: ═══════════════════════════════════════════════════════
::  STEP 6: Check wallet balances
:: ═══════════════════════════════════════════════════════
echo.
echo   ═══════════════════════════════════════════════════
echo     CHECKING WALLET BALANCES
echo   ═══════════════════════════════════════════════════
echo.
node "!DIR!\check-wallets.js" 2>nul
echo.

:: ═══════════════════════════════════════════════════════
::  STEP 7: LAUNCH ALL 3 BOTS + DASHBOARD
:: ═══════════════════════════════════════════════════════
echo   ═══════════════════════════════════════════════════
echo     LAUNCHING ALL 3 BOTS
echo   ═══════════════════════════════════════════════════
echo.

start "CopyBot" /min cmd /c ""!DIR!\copybot\run.bat" >> "!DIR!\logs\copybot.log" 2>&1"
echo   [1/3] Copy Bot (@anoin123)     STARTED

start "SignalBot" /min cmd /c ""!DIR!\run-signal.bat" >> "!DIR!\logs\signal.log" 2>&1"
echo   [2/3] Signal Bot (BTC 15m)     STARTED

start "AutoBot" /min cmd /c ""!DIR!\autobot\run.bat" >> "!DIR!\logs\autobot.log" 2>&1"
echo   [3/3] Autonomous Bot           STARTED

echo.
echo   Wallets:
echo   ────────────────────────────────────────────
echo   Signal:  0x5eD48e29dcd952955d7E4fccC3616EFA38cD75a5
echo   Copy:    0xf35803f093BBceaBEb9A6abd3d4c99856BDdA40C
echo   Auto:    0xf17Cb352380Fd5503742c5A0573cDE4c656d8486
echo.
echo   Safeguards: $5/trade ^| $15 cap ^| 3 positions ^| $10/day ^| 5c spread
echo.

:: ═══════════════════════════════════════════════════════
::  STEP 8: Desktop shortcut (for next time, just double-click)
:: ═══════════════════════════════════════════════════════
for /f "usebackq tokens=*" %%d in (`powershell -NoProfile -Command "[Environment]::GetFolderPath('Desktop')"`) do set "SC_DESKTOP=%%d"
if "!SC_DESKTOP!"=="" if exist "%USERPROFILE%\OneDrive\Desktop" set "SC_DESKTOP=%USERPROFILE%\OneDrive\Desktop"
if "!SC_DESKTOP!"=="" if exist "%USERPROFILE%\Desktop" set "SC_DESKTOP=%USERPROFILE%\Desktop"

if not "!SC_DESKTOP!"=="" (
    echo @echo off> "!SC_DESKTOP!\Polymarket Bots.bat"
    echo cd /d "!DIR!">> "!SC_DESKTOP!\Polymarket Bots.bat"
    echo call LAUNCH.bat>> "!SC_DESKTOP!\Polymarket Bots.bat"
    if exist "!SC_DESKTOP!\Polymarket Bots.bat" (
        echo   [ok] Desktop shortcut: "Polymarket Bots.bat"
    )
)

:: ═══════════════════════════════════════════════════════
::  STEP 9: Open Dashboard
:: ═══════════════════════════════════════════════════════
echo.
echo   ═══════════════════════════════════════════════════
echo     Dashboard: http://localhost:3847
echo     Keep this window open. Ctrl+C to stop.
echo   ═══════════════════════════════════════════════════
echo.

timeout /t 2 /nobreak >nul
title Polymarket Dashboard
node web-dashboard.js
