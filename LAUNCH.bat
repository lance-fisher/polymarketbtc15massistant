@echo off
setlocal enabledelayedexpansion
title Polymarket Trading Suite - One-Click Launcher
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

    :: Detect architecture
    if "%PROCESSOR_ARCHITECTURE%"=="AMD64" (
        set "NODE_URL=https://nodejs.org/dist/v20.11.1/node-v20.11.1-x64.msi"
    ) else (
        set "NODE_URL=https://nodejs.org/dist/v20.11.1/node-v20.11.1-x86.msi"
    )

    set "NODE_MSI=%TEMP%\node-installer.msi"
    echo   [download] Downloading Node.js...
    powershell -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '!NODE_URL!' -OutFile '!NODE_MSI!' -UseBasicParsing } catch { Write-Host 'Download failed'; exit 1 }"
    if errorlevel 1 (
        echo.
        echo   [ERROR] Could not download Node.js.
        echo   Please install manually from https://nodejs.org
        echo   Then double-click this file again.
        pause & exit /b 1
    )

    echo   [install] Installing Node.js (may ask for admin)...
    msiexec /i "!NODE_MSI!" /qn /norestart
    if errorlevel 1 (
        echo   [retry] Trying with admin prompt...
        powershell -Command "Start-Process msiexec -ArgumentList '/i','!NODE_MSI!','/qb','/norestart' -Verb RunAs -Wait"
    )
    del "!NODE_MSI!" 2>nul

    :: Refresh PATH so we can find node
    set "PATH=%ProgramFiles%\nodejs;%PATH%"
    set "PATH=%ProgramFiles(x86)%\nodejs;%PATH%"
    set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"

    where node >nul 2>&1
    if errorlevel 1 (
        echo.
        echo   [ERROR] Node.js installed but not in PATH yet.
        echo   Please CLOSE this window, REOPEN it, and double-click LAUNCH.bat again.
        pause & exit /b 1
    )
)

for /f "tokens=1 delims=." %%v in ('node -v') do set NODE_V=%%v
set NODE_V=%NODE_V:v=%
echo   [ok] Node.js v%NODE_V% found

:: ═══════════════════════════════════════════════════════
::  STEP 2: Determine install directory
:: ═══════════════════════════════════════════════════════

:: If this bat is already inside the repo (has package.json next to it), use current dir
if exist "%~dp0package.json" (
    set "DIR=%~dp0"
    :: Remove trailing backslash
    if "!DIR:~-1!"=="\" set "DIR=!DIR:~0,-1!"
    echo   [ok] Running from repo at !DIR!
    goto :SKIP_DOWNLOAD
)

:: Otherwise, pick install location
if exist "D:\ProjectsHome" (
    set "DIR=D:\ProjectsHome\polymarket-bots"
) else (
    set "DIR=%USERPROFILE%\polymarket-bots"
)

:: ═══════════════════════════════════════════════════════
::  STEP 3: Download repo (no Git needed!)
:: ═══════════════════════════════════════════════════════
set "BRANCH=claude/polymarket-copy-bot-xcdOo"
set "ZIP_URL=https://github.com/lance-fisher/polymarketbtc15massistant/archive/refs/heads/%BRANCH%.zip"

:: Check if already downloaded
if exist "%DIR%\package.json" (
    echo   [ok] Already installed at %DIR%
    goto :SKIP_DOWNLOAD
)

echo   [download] Downloading bot code...
set "ZIP_FILE=%TEMP%\polymarket-bots.zip"
powershell -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '%ZIP_URL%' -OutFile '%ZIP_FILE%' -UseBasicParsing } catch { Write-Host 'Download failed'; exit 1 }"
if errorlevel 1 (
    echo.
    echo   [ERROR] Could not download from GitHub.
    echo   Check your internet connection and try again.
    pause & exit /b 1
)

echo   [extract] Extracting...
if exist "%DIR%" rmdir /s /q "%DIR%" 2>nul
powershell -Command "$ProgressPreference='SilentlyContinue'; Expand-Archive -Path '%ZIP_FILE%' -DestinationPath '%TEMP%\polymarket-extract' -Force"

:: GitHub ZIPs have a nested folder — move contents up
for /d %%F in ("%TEMP%\polymarket-extract\*") do (
    move "%%F" "%DIR%" >nul 2>nul
)
rmdir /s /q "%TEMP%\polymarket-extract" 2>nul
del "%ZIP_FILE%" 2>nul

if not exist "%DIR%\package.json" (
    echo   [ERROR] Extraction failed. Try again.
    pause & exit /b 1
)
echo   [ok] Installed to %DIR%

:SKIP_DOWNLOAD
cd /d "%DIR%"

:: ═══════════════════════════════════════════════════════
::  STEP 4: Kill any running bots
:: ═══════════════════════════════════════════════════════
echo   [cleanup] Stopping any running bots...
taskkill /F /FI "WINDOWTITLE eq CopyBot*"   2>nul >nul
taskkill /F /FI "WINDOWTITLE eq SignalBot*"  2>nul >nul
taskkill /F /FI "WINDOWTITLE eq AutoBot*"    2>nul >nul
taskkill /F /FI "WINDOWTITLE eq Dashboard*"  2>nul >nul
timeout /t 1 /nobreak >nul

:: ═══════════════════════════════════════════════════════
::  STEP 5: Write wallet keys and config
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
) > "%DIR%\.env"

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
) > "%DIR%\copybot\.env"

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
) > "%DIR%\autobot\.env"

echo   [ok] Config written

:: ═══════════════════════════════════════════════════════
::  STEP 6: Install npm dependencies
:: ═══════════════════════════════════════════════════════
echo   [npm] Installing dependencies (first run only)...
cd /d "%DIR%"         && call npm install --silent 2>nul
cd /d "%DIR%\copybot" && call npm install --silent 2>nul
cd /d "%DIR%\autobot" && call npm install --silent 2>nul
cd /d "%DIR%"
echo   [ok] Dependencies ready

:: ── Initialize state files ──
if not exist "%DIR%\state.json" echo {} > "%DIR%\state.json"
if not exist "%DIR%\autobot-state.json" echo {} > "%DIR%\autobot-state.json"

:: ── Create logs dir ──
if not exist "%DIR%\logs" mkdir "%DIR%\logs"
type nul > "%DIR%\logs\copybot.log" 2>nul
type nul > "%DIR%\logs\signal.log" 2>nul
type nul > "%DIR%\logs\autobot.log" 2>nul

:: ═══════════════════════════════════════════════════════
::  STEP 6b: Check wallet balances
:: ═══════════════════════════════════════════════════════
echo.
echo   ═══════════════════════════════════════════════════
echo     CHECKING WALLET BALANCES
echo   ═══════════════════════════════════════════════════
echo.
node "%DIR%\check-wallets.js" 2>nul
echo.

:: ═══════════════════════════════════════════════════════
::  STEP 7: LAUNCH ALL 3 BOTS
:: ═══════════════════════════════════════════════════════
echo.
echo   ═══════════════════════════════════════════════════
echo     LAUNCHING ALL 3 BOTS
echo   ═══════════════════════════════════════════════════
echo.

:: Bot 1: Copy Bot
start "CopyBot" /min cmd /c ""%DIR%\copybot\run.bat" >> "%DIR%\logs\copybot.log" 2>&1"
echo   [1/3] Copy Bot (@anoin123)     STARTED

:: Bot 2: Signal Bot
start "SignalBot" /min cmd /c ""%DIR%\run-signal.bat" >> "%DIR%\logs\signal.log" 2>&1"
echo   [2/3] Signal Bot (BTC 15m)     STARTED

:: Bot 3: Autonomous Bot
start "AutoBot" /min cmd /c ""%DIR%\autobot\run.bat" >> "%DIR%\logs\autobot.log" 2>&1"
echo   [3/3] Autonomous Bot           STARTED

echo.
echo   Wallets:
echo   ────────────────────────────────────────────
echo   Signal:  0x5eD48e29dcd952955d7E4fccC3616EFA38cD75a5
echo   Copy:    0xf35803f093BBceaBEb9A6abd3d4c99856BDdA40C
echo   Auto:    0xf17Cb352380Fd5503742c5A0573cDE4c656d8486
echo.
echo   Safeguards:
echo   ────────────────────────────────────────────
echo   Per trade:      $5 max
echo   Portfolio cap:  $15 max exposure
echo   Position cap:   3 max concurrent
echo   Daily cap:      $10/day
echo   Spread guard:   5c max
echo   Autobot edge:   12%% min
echo.

:: ═══════════════════════════════════════════════════════
::  STEP 8: Create Desktop shortcut for future launches
::  (Uses a simple .bat file — works everywhere, no COM needed)
:: ═══════════════════════════════════════════════════════

:: Find Desktop using PowerShell (most reliable across all Windows versions)
for /f "usebackq tokens=*" %%d in (`powershell -NoProfile -Command "[Environment]::GetFolderPath('Desktop')"`) do set "SC_DESKTOP=%%d"

:: Fallback: try common paths
if "!SC_DESKTOP!"=="" if exist "%USERPROFILE%\OneDrive\Desktop" set "SC_DESKTOP=%USERPROFILE%\OneDrive\Desktop"
if "!SC_DESKTOP!"=="" if exist "%USERPROFILE%\Desktop" set "SC_DESKTOP=%USERPROFILE%\Desktop"

if not "!SC_DESKTOP!"=="" (
    echo @echo off> "!SC_DESKTOP!\Polymarket Bots.bat"
    echo cd /d "!DIR!">> "!SC_DESKTOP!\Polymarket Bots.bat"
    echo call LAUNCH.bat>> "!SC_DESKTOP!\Polymarket Bots.bat"

    if exist "!SC_DESKTOP!\Polymarket Bots.bat" (
        echo   [ok] Desktop shortcut created: "Polymarket Bots.bat"
        echo       Double-click it anytime to restart bots
    ) else (
        echo   [skip] Could not create desktop shortcut
    )
) else (
    echo   [skip] Could not locate Desktop folder
)

:: ═══════════════════════════════════════════════════════
::  STEP 9: Open Dashboard in browser
:: ═══════════════════════════════════════════════════════
echo.
echo   ═══════════════════════════════════════════════════
echo     Opening Dashboard in your browser...
echo   ═══════════════════════════════════════════════════
echo.

timeout /t 3 /nobreak >nul

title Polymarket Dashboard
echo   Dashboard: http://localhost:3847
echo   Keep this window open. Ctrl+C to stop.
echo.
node web-dashboard.js
