# ═══════════════════════════════════════════════════════
#  POLYMARKET 3-BOT LAUNCHER (PowerShell)
#
#  Run from any terminal:
#    powershell -ExecutionPolicy Bypass -File start.ps1
# ═══════════════════════════════════════════════════════

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "  ╔══════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║  POLYMARKET 3-BOT LAUNCHER               ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── Check prerequisites ──
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Node.js not found. Install: https://nodejs.org" -ForegroundColor Red; exit 1
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Git not found. Install: https://git-scm.com" -ForegroundColor Red; exit 1
}
Write-Host "[ok] Node $(node -v)"

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
    Write-Host "[ok] Repo exists at $DIR - pulling latest..."
    Push-Location $DIR
    git pull origin $BRANCH 2>$null
    Pop-Location
} else {
    Write-Host "[clone] Cloning to $DIR..."
    git clone -b $BRANCH $REPO $DIR
}

# ── Kill old bots ──
Write-Host "[cleanup] Stopping old bots..."
Get-Process node -ErrorAction SilentlyContinue | Where-Object {
    $_.MainWindowTitle -match "CopyBot|SignalBot|AutoBot"
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

Write-Host "[ok] .env files written"

# ── Install deps ──
Write-Host "[npm] Installing dependencies..."
Push-Location $DIR;         npm install --silent 2>$null; Pop-Location
Push-Location "$DIR\copybot"; npm install --silent 2>$null; Pop-Location
Push-Location "$DIR\autobot"; npm install --silent 2>$null; Pop-Location
Write-Host "[ok] Dependencies installed"

# ── Approvals ──
Write-Host ""
Write-Host "[approve] Setting on-chain approvals (needs MATIC for gas)..."

function Load-EnvAndRun($envFile, $script) {
    $envVars = @{}
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^([^#]\S+)=(.+)$') {
            $envVars[$Matches[1]] = $Matches[2]
        }
    }
    $envBlock = $envVars.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }
    foreach ($kv in $envVars.GetEnumerator()) {
        [Environment]::SetEnvironmentVariable($kv.Key, $kv.Value, "Process")
    }
    node $script 2>&1
}

Push-Location "$DIR\copybot"
try { Load-EnvAndRun ".env" "src\approve.js" } catch { Write-Host "  Copy Bot approval skipped" }
Pop-Location
Start-Sleep 3

Push-Location "$DIR\autobot"
try { Load-EnvAndRun ".env" "src\approve.js" } catch { Write-Host "  Auto Bot approval skipped" }
Pop-Location

# ── Logs dir ──
New-Item -ItemType Directory -Path "$DIR\logs" -Force | Out-Null

# ═══════════════════════════════════════════════════════
#  LAUNCH ALL 3 BOTS
# ═══════════════════════════════════════════════════════
Write-Host ""
Write-Host "═══════════════════════════════════════════" -ForegroundColor Green
Write-Host "  LAUNCHING ALL 3 BOTS" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════" -ForegroundColor Green
Write-Host ""

# Helper: launch a bot in a background job with env vars
function Start-Bot($name, $workDir, $envFile, $script, $logFile) {
    $envText = Get-Content "$workDir\$envFile" -Raw
    $cmd = "cd '$workDir'; `$lines = @'`n$envText`n'@ -split '`n'; foreach (`$l in `$lines) { if (`$l -match '^([^#]\S+)=(.+)$') { [Environment]::SetEnvironmentVariable(`$Matches[1], `$Matches[2], 'Process') } }; node $script *>> '$logFile'"
    Start-Process powershell -ArgumentList "-WindowStyle Hidden -Command $cmd" -WindowStyle Hidden
    Write-Host "  [$name] STARTED" -ForegroundColor Green
}

Start-Bot "1-CopyBot"   "$DIR\copybot" ".env" "src\index.js" "$DIR\logs\copybot.log"
Start-Bot "2-SignalBot"  "$DIR"         ".env" "src\index.js" "$DIR\logs\signal.log"
Start-Bot "3-AutoBot"    "$DIR\autobot" ".env" "src\index.js" "$DIR\logs\autobot.log"

Write-Host ""
Write-Host "  Wallets:" -ForegroundColor White
Write-Host "  Signal:  0x5eD48e29dcd952955d7E4fccC3616EFA38cD75a5"
Write-Host "  Copy:    0xf35803f093BBceaBEb9A6abd3d4c99856BDdA40C"
Write-Host "  Auto:    0xf17Cb352380Fd5503742c5A0573cDE4c656d8486"
Write-Host ""
Write-Host "  Safeguards (tuned for `$20 wallets):" -ForegroundColor Yellow
Write-Host "  Per trade:      `$5 max"
Write-Host "  Portfolio cap:  `$15 max exposure"
Write-Host "  Position cap:   3 max concurrent"
Write-Host "  Daily cap:      `$10/day (resets midnight ET)"
Write-Host "  Spread guard:   5c max"
Write-Host "  Autobot edge:   12% min (high-conviction only)"
Write-Host ""
Write-Host "  Watch logs:" -ForegroundColor White
Write-Host "    Get-Content $DIR\logs\copybot.log -Wait -Tail 20"
Write-Host "    Get-Content $DIR\logs\signal.log -Wait -Tail 20"
Write-Host "    Get-Content $DIR\logs\autobot.log -Wait -Tail 20"
Write-Host ""
Write-Host "  Stop all bots:" -ForegroundColor White
Write-Host "    Get-Process node | Stop-Process -Force"
Write-Host ""
Write-Host "═══════════════════════════════════════════" -ForegroundColor Green
Write-Host "  ALL BOTS RUNNING" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════" -ForegroundColor Green
Write-Host ""

# Tail all logs
Write-Host "  Streaming logs (Ctrl+C to stop viewing, bots keep running)..." -ForegroundColor DarkGray
Write-Host ""
Start-Sleep 3
Get-Content "$DIR\logs\copybot.log","$DIR\logs\signal.log","$DIR\logs\autobot.log" -Wait -Tail 5 -ErrorAction SilentlyContinue
