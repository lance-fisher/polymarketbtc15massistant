@echo off
setlocal enabledelayedexpansion
title Polymarket Trading Suite
color 0B

echo.
echo   ╔══════════════════════════════════════════════════════╗
echo   ║       POLYMARKET TRADING SUITE - LAUNCHER            ║
echo   ║       Signal Bot + Copy Bot + Auto Bot               ║
echo   ╚══════════════════════════════════════════════════════╝
echo.

:: ── Check prerequisites ──
where node >nul 2>&1 || (
    echo   [ERROR] Node.js not found!
    echo   Download: https://nodejs.org
    pause & exit /b 1
)
where git >nul 2>&1 || (
    echo   [ERROR] Git not found!
    echo   Download: https://git-scm.com
    pause & exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -v') do set NODE_V=%%v
set NODE_V=%NODE_V:v=%
echo   [ok] Node v%NODE_V%

:: ── Install directory ──
set "REPO=https://github.com/lance-fisher/polymarketbtc15massistant.git"
set "BRANCH=claude/polymarket-copy-bot-xcdOo"

if exist "D:\ProjectsHome" (
    set "DIR=D:\ProjectsHome\polymarket-bots"
) else (
    set "DIR=%USERPROFILE%\polymarket-bots"
)

:: ── Clone or pull ──
if exist "%DIR%\.git" (
    echo   [ok] Repo at %DIR% - pulling latest...
    cd /d "%DIR%"
    git checkout %BRANCH% 2>nul
    git pull origin %BRANCH% 2>nul
) else (
    echo   [clone] Cloning to %DIR% ...
    git clone -b %BRANCH% %REPO% "%DIR%"
)
cd /d "%DIR%"

:: ── Kill old bot processes ──
echo   [cleanup] Stopping any running bots...
taskkill /F /FI "WINDOWTITLE eq CopyBot*"   2>nul >nul
taskkill /F /FI "WINDOWTITLE eq SignalBot*"  2>nul >nul
taskkill /F /FI "WINDOWTITLE eq AutoBot*"    2>nul >nul
taskkill /F /FI "WINDOWTITLE eq Dashboard*"  2>nul >nul
timeout /t 1 /nobreak >nul

:: ═══════════════════════════════════════════════════════
::  WALLET KEYS ^& RPC
:: ═══════════════════════════════════════════════════════
set "KEY_SIGNAL=0x674f6d0fe405f168a33d360555044cb9ff73cad75262c3d6d74b8f1db4c328d1"
set "KEY_COPY=0x99a1838ce42b8e0a2aa46de1356d77270190e02dd9ebf625d4f8913ea448aea3"
set "KEY_AUTO=0x66dbe2e0f2649ca433ec1a5fd1ff776fee9900b3623e05415af16c5f4bb1b2c3"
set "RPC=https://polygon-bor-rpc.publicnode.com"

:: ═══════════════════════════════════════════════════════
::  WRITE .ENV FILES
:: ═══════════════════════════════════════════════════════

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

echo   [ok] .env files written

:: ── Install deps ──
echo   [npm] Installing dependencies...
cd /d "%DIR%"         && call npm install --silent 2>nul
cd /d "%DIR%\copybot" && call npm install --silent 2>nul
cd /d "%DIR%\autobot" && call npm install --silent 2>nul
cd /d "%DIR%"
echo   [ok] Dependencies ready

:: ── Run approvals (need MATIC for gas) ──
echo.
echo   [approve] Setting on-chain approvals...
echo   (needs MATIC/POL in each wallet for gas)
echo.

cd /d "%DIR%\copybot"
for /f "usebackq tokens=1,2 delims==" %%a in (".env") do set "%%a=%%b"
node src\approve.js 2>&1 || echo   Copy Bot approval skipped (need MATIC?)
timeout /t 2 /nobreak >nul

cd /d "%DIR%\autobot"
for /f "usebackq tokens=1,2 delims==" %%a in (".env") do set "%%a=%%b"
node src\approve.js 2>&1 || echo   Auto Bot approval skipped (need MATIC?)
cd /d "%DIR%"

:: ── Create logs dir ──
if not exist "%DIR%\logs" mkdir "%DIR%\logs"

:: Clear old logs for fresh start
type nul > "%DIR%\logs\copybot.log" 2>nul
type nul > "%DIR%\logs\signal.log" 2>nul
type nul > "%DIR%\logs\autobot.log" 2>nul

:: ═══════════════════════════════════════════════════════
::  LAUNCH ALL 3 BOTS (each via its own run.bat)
:: ═══════════════════════════════════════════════════════
echo.
echo   ═══════════════════════════════════════════
echo     LAUNCHING ALL 3 BOTS + DASHBOARD
echo   ═══════════════════════════════════════════
echo.

:: Bot 1: Copy Bot (minimized, uses copybot\run.bat which loads .env)
start "CopyBot" /min cmd /c ""%DIR%\copybot\run.bat" >> "%DIR%\logs\copybot.log" 2>&1"
echo   [1/3] Copy Bot (@anoin123)     STARTED

:: Bot 2: Signal Bot (minimized, uses run-signal.bat which loads .env)
start "SignalBot" /min cmd /c ""%DIR%\run-signal.bat" >> "%DIR%\logs\signal.log" 2>&1"
echo   [2/3] Signal Bot (BTC 15m)     STARTED

:: Bot 3: Autonomous Bot (minimized, uses autobot\run.bat which loads .env)
start "AutoBot" /min cmd /c ""%DIR%\autobot\run.bat" >> "%DIR%\logs\autobot.log" 2>&1"
echo   [3/3] Autonomous Bot           STARTED

echo.
echo   All bots launched in background windows.
echo.

:: ── Create desktop shortcut ──
echo   [shortcut] Creating desktop shortcut...
set "SHORTCUT=%USERPROFILE%\Desktop\Polymarket Bots.lnk"
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT%'); $s.TargetPath = '%DIR%\start.bat'; $s.WorkingDirectory = '%DIR%'; $s.IconLocation = 'shell32.dll,21'; $s.Description = 'Launch Polymarket Trading Suite'; $s.Save()" 2>nul
if exist "%SHORTCUT%" (
    echo   [ok] Desktop shortcut created: "Polymarket Bots"
) else (
    echo   [skip] Could not create shortcut
)

echo.
echo   ═══════════════════════════════════════════
echo     Opening Dashboard...
echo   ═══════════════════════════════════════════
echo.

:: Give bots 3 seconds to start writing logs
timeout /t 3 /nobreak >nul

:: Launch dashboard in THIS window (user sees it)
title Polymarket Dashboard
cd /d "%DIR%"
node dashboard.js
