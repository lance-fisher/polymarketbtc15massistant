# ═══════════════════════════════════════════════════════
#  POLYMARKET TRADING SUITE (PowerShell)
#
#  Run from any terminal:
#    powershell -ExecutionPolicy Bypass -File setup.ps1
# ═══════════════════════════════════════════════════════

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║       POLYMARKET TRADING SUITE - LAUNCHER            ║" -ForegroundColor Cyan
Write-Host "  ║       Signal Bot + Copy Bot + Auto Bot               ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── Check prerequisites ──
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "  [ERROR] Node.js not found! Download: https://nodejs.org" -ForegroundColor Red; exit 1
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "  [ERROR] Git not found! Download: https://git-scm.com" -ForegroundColor Red; exit 1
}
Write-Host "  [ok] Node $(node -v)"

# ── Config ──
$REPO   = "https://github.com/lance-fisher/polymarketbtc15massistant.git"
$BRANCH = "claude/polymarket-copy-bot-xcdOo"

if (Test-Path "D:\ProjectsHome") {
    $DIR = "D:\ProjectsHome\polymarket-bots"
} else {
    $DIR = "$env:USERPROFILE\polymarket-bots"
}

# ── Clone or pull ──
if (Test-Path "$DIR\.git") {
    Write-Host "  [ok] Repo at $DIR - pulling latest..."
    Push-Location $DIR
    git pull origin $BRANCH 2>$null
    Pop-Location
} else {
    Write-Host "  [clone] Cloning to $DIR..."
    git clone -b $BRANCH $REPO $DIR
}

# ── Kill old bots ──
Write-Host "  [cleanup] Stopping old bots..."
Get-Process node -ErrorAction SilentlyContinue | Where-Object {
    $_.MainWindowTitle -match "CopyBot|SignalBot|AutoBot|Dashboard"
} | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 1

# ═══════════════════════════════════════════════════════
#  WALLET KEYS
# ═══════════════════════════════════════════════════════
$KEY_SIGNAL = "0x674f6d0fe405f168a33d360555044cb9ff73cad75262c3d6d74b8f1db4c328d1"
$KEY_COPY   = "0x99a1838ce42b8e0a2aa46de1356d77270190e02dd9ebf625d4f8913ea448aea3"
$KEY_AUTO   = "0x66dbe2e0f2649ca433ec1a5fd1ff776fee9900b3623e05415af16c5f4bb1b2c3"
$RPC        = "https://polygon-bor-rpc.publicnode.com"

# ═══════════════════════════════════════════════════════
#  WRITE .ENV FILES
# ═══════════════════════════════════════════════════════

@"
PRIVATE_KEY=$KEY_SIGNAL
POLYGON_RPC_URL=$RPC
MAX_TRADE_USDC=5
MAX_DAILY_USDC=10
MAX_SPREAD_CENTS=5
"@ | Set-Content "$DIR\.env" -Encoding ASCII

@"
PRIVATE_KEY=$KEY_COPY
POLYGON_RPC_URL=$RPC
TARGET_USERNAME=anoin123
TARGET_ADDRESS=0xEd5f13e3373079F62E3c5fce82D1e6263B063a3c
MAX_TRADE_USDC=5
MAX_PORTFOLIO_USDC=15
MAX_POSITIONS=3
MAX_DAILY_USDC=10
MAX_SPREAD_CENTS=5
MAX_NEW_PER_CYCLE=1
POLL_INTERVAL_S=30
"@ | Set-Content "$DIR\copybot\.env" -Encoding ASCII

@"
PRIVATE_KEY=$KEY_AUTO
POLYGON_RPC_URL=$RPC
MAX_TRADE_USDC=5
MAX_PORTFOLIO_USDC=15
MAX_POSITIONS=3
MAX_DAILY_USDC=10
MAX_SPREAD_CENTS=5
SCAN_INTERVAL_S=60
MIN_EDGE=0.12
MIN_LIQUIDITY=5000
"@ | Set-Content "$DIR\autobot\.env" -Encoding ASCII

Write-Host "  [ok] .env files written"

# ── Install deps ──
Write-Host "  [npm] Installing dependencies..."
Push-Location $DIR;           npm install --silent 2>$null; Pop-Location
Push-Location "$DIR\copybot"; npm install --silent 2>$null; Pop-Location
Push-Location "$DIR\autobot"; npm install --silent 2>$null; Pop-Location
Write-Host "  [ok] Dependencies ready"

# ── Approvals ──
Write-Host ""
Write-Host "  [approve] Setting on-chain approvals..."
Write-Host "  (needs MATIC/POL in each wallet for gas)"

Push-Location "$DIR\copybot"
try { node src\approve.js 2>&1 } catch { Write-Host "  Copy Bot approval skipped" }
Pop-Location
Start-Sleep 2

Push-Location "$DIR\autobot"
try { node src\approve.js 2>&1 } catch { Write-Host "  Auto Bot approval skipped" }
Pop-Location

# ── Logs dir ──
New-Item -ItemType Directory -Path "$DIR\logs" -Force | Out-Null

# ═══════════════════════════════════════════════════════
#  LAUNCH ALL 3 BOTS
# ═══════════════════════════════════════════════════════
Write-Host ""
Write-Host "  ═══════════════════════════════════════════" -ForegroundColor Green
Write-Host "    LAUNCHING ALL 3 BOTS + DASHBOARD" -ForegroundColor Green
Write-Host "  ═══════════════════════════════════════════" -ForegroundColor Green
Write-Host ""

# Launch bots as hidden background processes
Start-Process -WindowStyle Hidden -FilePath "node" -ArgumentList "src\index.js" -WorkingDirectory "$DIR\copybot" -RedirectStandardOutput "$DIR\logs\copybot.log" -RedirectStandardError "$DIR\logs\copybot-err.log"
Write-Host "  [1/3] Copy Bot (@anoin123)     STARTED" -ForegroundColor Green

Start-Process -WindowStyle Hidden -FilePath "node" -ArgumentList "src\index.js" -WorkingDirectory "$DIR" -RedirectStandardOutput "$DIR\logs\signal.log" -RedirectStandardError "$DIR\logs\signal-err.log"
Write-Host "  [2/3] Signal Bot (BTC 15m)     STARTED" -ForegroundColor Green

Start-Process -WindowStyle Hidden -FilePath "node" -ArgumentList "src\index.js" -WorkingDirectory "$DIR\autobot" -RedirectStandardOutput "$DIR\logs\autobot.log" -RedirectStandardError "$DIR\logs\autobot-err.log"
Write-Host "  [3/3] Autonomous Bot           STARTED" -ForegroundColor Green

Write-Host ""
Write-Host "  All bots launched in background."
Write-Host ""

# ── Create desktop shortcut ──
Write-Host "  [shortcut] Creating desktop shortcut..."
try {
    $ws = New-Object -ComObject WScript.Shell
    $s = $ws.CreateShortcut("$env:USERPROFILE\Desktop\Polymarket Bots.lnk")
    $s.TargetPath = "$DIR\launcher.bat"
    $s.WorkingDirectory = $DIR
    $s.IconLocation = "shell32.dll,21"
    $s.Description = "Launch Polymarket Trading Suite"
    $s.Save()
    Write-Host "  [ok] Desktop shortcut created" -ForegroundColor Green
} catch {
    Write-Host "  [skip] Could not create shortcut"
}

Write-Host ""
Write-Host "  ═══════════════════════════════════════════" -ForegroundColor Green
Write-Host "    Opening Dashboard..." -ForegroundColor Green
Write-Host "  ═══════════════════════════════════════════" -ForegroundColor Green
Write-Host ""

# Give bots 3 seconds to start
Start-Sleep 3

# Launch dashboard in this window
$Host.UI.RawUI.WindowTitle = "Polymarket Dashboard"
Set-Location $DIR
node dashboard.js
