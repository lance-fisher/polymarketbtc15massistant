@echo off
setlocal enabledelayedexpansion
title Polymarket 3-Bot Launcher

echo.
echo   ╔══════════════════════════════════════════╗
echo   ║  POLYMARKET 3-BOT LAUNCHER               ║
echo   ╚══════════════════════════════════════════╝
echo.

:: ── Check prerequisites ──
where node >nul 2>&1 || (echo [ERROR] Node.js not found. Install from https://nodejs.org & pause & exit /b 1)
where git >nul 2>&1  || (echo [ERROR] Git not found. Install from https://git-scm.com & pause & exit /b 1)

for /f "tokens=1 delims=." %%v in ('node -v') do set NODE_V=%%v
set NODE_V=%NODE_V:v=%
echo [ok] Node v%NODE_V%

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
    echo [ok] Repo exists at %DIR% - pulling latest...
    cd /d "%DIR%"
    git pull origin %BRANCH% 2>nul
) else (
    echo [clone] Cloning to %DIR% ...
    git clone -b %BRANCH% %REPO% "%DIR%"
)
cd /d "%DIR%"

:: ── Kill old bot processes ──
echo [cleanup] Stopping any running bots...
taskkill /F /FI "WINDOWTITLE eq CopyBot*"  2>nul
taskkill /F /FI "WINDOWTITLE eq SignalBot*" 2>nul
taskkill /F /FI "WINDOWTITLE eq AutoBot*"   2>nul
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

echo [ok] .env files written

:: ── Install deps ──
echo [npm] Installing dependencies...
cd /d "%DIR%"         && call npm install --silent 2>nul
cd /d "%DIR%\copybot" && call npm install --silent 2>nul
cd /d "%DIR%\autobot" && call npm install --silent 2>nul
cd /d "%DIR%"
echo [ok] Dependencies installed

:: ── Approvals ──
echo.
echo [approve] Setting on-chain approvals (needs MATIC for gas)...
cd /d "%DIR%\copybot" && (
    for /f "usebackq tokens=1,2 delims==" %%a in (".env") do set "%%a=%%b"
    node src\approve.js 2>&1
) || echo   Copy Bot approval skipped
timeout /t 3 /nobreak >nul
cd /d "%DIR%\autobot" && (
    for /f "usebackq tokens=1,2 delims==" %%a in (".env") do set "%%a=%%b"
    node src\approve.js 2>&1
) || echo   Auto Bot approval skipped
cd /d "%DIR%"

:: ── Create logs dir ──
if not exist "%DIR%\logs" mkdir "%DIR%\logs"

:: ═══════════════════════════════════════════════════════
::  LAUNCH ALL 3 BOTS (each in its own window)
:: ═══════════════════════════════════════════════════════
echo.
echo ═══════════════════════════════════════════
echo   LAUNCHING ALL 3 BOTS
echo ═══════════════════════════════════════════
echo.

:: Bot 1: Copy Bot
start "CopyBot" /min cmd /c "cd /d "%DIR%\copybot" && for /f "usebackq tokens=1,2 delims==" %%a in (".env") do @set "%%a=%%b" && node src\index.js >> "%DIR%\logs\copybot.log" 2>&1"
echo   [1] Copy Bot (@anoin123)   STARTED

:: Bot 2: Signal Bot
start "SignalBot" /min cmd /c "cd /d "%DIR%" && for /f "usebackq tokens=1,2 delims==" %%a in (".env") do @set "%%a=%%b" && node src\index.js >> "%DIR%\logs\signal.log" 2>&1"
echo   [2] Signal Bot (BTC 15m)   STARTED

:: Bot 3: Autonomous Bot
start "AutoBot" /min cmd /c "cd /d "%DIR%\autobot" && for /f "usebackq tokens=1,2 delims==" %%a in (".env") do @set "%%a=%%b" && node src\index.js >> "%DIR%\logs\autobot.log" 2>&1"
echo   [3] Autonomous Bot         STARTED

echo.
echo   Wallets:
echo   ────────
echo   Signal:  0x5eD48e29dcd952955d7E4fccC3616EFA38cD75a5
echo   Copy:    0xf35803f093BBceaBEb9A6abd3d4c99856BDdA40C
echo   Auto:    0xf17Cb352380Fd5503742c5A0573cDE4c656d8486
echo.
echo   Safeguards (tuned for $20 wallets):
echo   ─────────────────────────────────────
echo   Per trade:      $5 max
echo   Portfolio cap:  $15 max exposure
echo   Position cap:   3 max concurrent
echo   Daily cap:      $10/day (resets midnight ET)
echo   Spread guard:   5c max (tighter = less slippage loss)
echo   Autobot edge:   12%% min (only high-conviction plays)
echo.
echo   Logs: %DIR%\logs\
echo.
echo   To watch live:
echo     type %DIR%\logs\copybot.log
echo     type %DIR%\logs\signal.log
echo     type %DIR%\logs\autobot.log
echo.
echo   To stop all bots:
echo     taskkill /F /FI "WINDOWTITLE eq CopyBot*"
echo     taskkill /F /FI "WINDOWTITLE eq SignalBot*"
echo     taskkill /F /FI "WINDOWTITLE eq AutoBot*"
echo.
echo ═══════════════════════════════════════════
echo   ALL BOTS RUNNING — this window can close
echo ═══════════════════════════════════════════
echo.
pause
