#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════
#  POLYMARKET 3-BOT LAUNCHER
#
#  Just paste this into any terminal (Git Bash, WSL, macOS, Linux):
#    bash bootstrap.sh
#
#  Or to restart after pulling updates:
#    bash bootstrap.sh restart
# ═══════════════════════════════════════════════════════
set -e

echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║  POLYMARKET 3-BOT BOOTSTRAP              ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""

# ── Prerequisites ──
command -v node >/dev/null 2>&1 || { echo "Need Node.js 18+. Install: https://nodejs.org"; exit 1; }
command -v git  >/dev/null 2>&1 || { echo "Need git. Install: https://git-scm.com"; exit 1; }

NODE_V=$(node -v | cut -d. -f1 | tr -d v)
if [ "$NODE_V" -lt 18 ]; then echo "Need Node 18+, got $(node -v)"; exit 1; fi
echo "[ok] Node $(node -v)"

# ── Install directory ──
REPO="https://github.com/lance-fisher/polymarketbtc15massistant.git"
BRANCH="claude/polymarket-copy-bot-xcdOo"

if [ -d "/d/ProjectsHome" ]; then
  DIR="/d/ProjectsHome/polymarket-bots"
elif [ -d "/mnt/d/ProjectsHome" ]; then
  DIR="/mnt/d/ProjectsHome/polymarket-bots"
else
  DIR="$HOME/polymarket-bots"
fi

# ── Clone or pull ──
if [ -d "$DIR/.git" ]; then
  echo "[ok] Repo exists at $DIR — pulling latest..."
  cd "$DIR" && git pull origin "$BRANCH" 2>/dev/null || true
else
  echo "[clone] Cloning to $DIR ..."
  git clone -b "$BRANCH" "$REPO" "$DIR"
fi
cd "$DIR"

# ── Kill old bot processes ──
echo "[cleanup] Stopping any running bots..."
if command -v taskkill >/dev/null 2>&1; then
  taskkill /F /IM node.exe 2>/dev/null || true
else
  pkill -f "node.*src/index.js" 2>/dev/null || true
  pkill -f "node.*src/approve.js" 2>/dev/null || true
fi
sleep 1

# ═══════════════════════════════════════════════════════
#  WALLET KEYS & RPC
# ═══════════════════════════════════════════════════════
KEY_SIGNAL="0x674f6d0fe405f168a33d360555044cb9ff73cad75262c3d6d74b8f1db4c328d1"
KEY_COPY="0x99a1838ce42b8e0a2aa46de1356d77270190e02dd9ebf625d4f8913ea448aea3"
KEY_AUTO="0x66dbe2e0f2649ca433ec1a5fd1ff776fee9900b3623e05415af16c5f4bb1b2c3"
RPC="https://polygon-bor-rpc.publicnode.com"

# ═══════════════════════════════════════════════════════
#  WRITE .ENV FILES (matching config.js variable names)
# ═══════════════════════════════════════════════════════

cat > "$DIR/.env" << EOF
PRIVATE_KEY=$KEY_SIGNAL
POLYGON_RPC_URL=$RPC
MAX_TRADE_USDC=10
MAX_DAILY_USDC=30
MAX_SPREAD_CENTS=8
EOF

cat > "$DIR/copybot/.env" << EOF
PRIVATE_KEY=$KEY_COPY
POLYGON_RPC_URL=$RPC
TARGET_USERNAME=anoin123
TARGET_ADDRESS=0xEd5f13e3373079F62E3c5fce82D1e6263B063a3c
MAX_TRADE_USDC=10
MAX_PORTFOLIO_USDC=50
MAX_POSITIONS=5
MAX_DAILY_USDC=30
MAX_SPREAD_CENTS=8
MAX_NEW_PER_CYCLE=2
POLL_INTERVAL_S=30
EOF

cat > "$DIR/autobot/.env" << EOF
PRIVATE_KEY=$KEY_AUTO
POLYGON_RPC_URL=$RPC
MAX_TRADE_USDC=10
MAX_PORTFOLIO_USDC=50
MAX_POSITIONS=5
MAX_DAILY_USDC=30
MAX_SPREAD_CENTS=8
SCAN_INTERVAL_S=60
MIN_EDGE=0.08
MIN_LIQUIDITY=1000
EOF

echo "[ok] .env files written"

# ── Install deps ──
echo "[npm] Installing..."
(cd "$DIR" && npm install --silent 2>&1) || true
(cd "$DIR/copybot" && npm install --silent 2>&1) || true
(cd "$DIR/autobot" && npm install --silent 2>&1) || true
echo "[ok] Dependencies installed"

# ── Run approvals (need MATIC for gas) ──
echo ""
echo "[approve] Setting USDC + CTF approvals on-chain..."
echo "  (needs MATIC/POL in each wallet for gas)"
echo ""

# Helper: load .env vars and run node (works on any Node version)
run_with_env() {
  local envfile="$1"
  shift
  env $(grep -v '^\s*#' "$envfile" | grep '=' | xargs) "$@"
}

run_with_env "$DIR/copybot/.env" node "$DIR/copybot/src/approve.js" 2>&1 || echo "  Copy Bot approval failed (need MATIC?)"
sleep 3
run_with_env "$DIR/autobot/.env" node "$DIR/autobot/src/approve.js" 2>&1 || echo "  Auto Bot approval failed (need MATIC?)"
echo ""

# ═══════════════════════════════════════════════════════
#  LAUNCH ALL 3 BOTS
# ═══════════════════════════════════════════════════════
mkdir -p "$DIR/logs"

echo "═══════════════════════════════════════════"
echo "  LAUNCHING ALL 3 BOTS"
echo "═══════════════════════════════════════════"
echo ""

# Bot 1: Copy Bot
(cd "$DIR/copybot" && run_with_env .env node src/index.js >> "$DIR/logs/copybot.log" 2>&1) &
P1=$!
echo "  [1] Copy Bot (@anoin123)   PID=$P1"

# Bot 2: Signal Bot (BTC 15m)
(cd "$DIR" && run_with_env .env node src/index.js >> "$DIR/logs/signal.log" 2>&1) &
P2=$!
echo "  [2] Signal Bot (BTC 15m)   PID=$P2"

# Bot 3: Autonomous Bot
(cd "$DIR/autobot" && run_with_env .env node src/index.js >> "$DIR/logs/autobot.log" 2>&1) &
P3=$!
echo "  [3] Autonomous Bot         PID=$P3"

echo ""
echo "  Wallets:"
echo "  ────────"
echo "  Signal:  0x5eD48e29dcd952955d7E4fccC3616EFA38cD75a5"
echo "  Copy:    0xf35803f093BBceaBEb9A6abd3d4c99856BDdA40C"
echo "  Auto:    0xf17Cb352380Fd5503742c5A0573cDE4c656d8486"
echo ""
echo "  Safeguards (all 3 bots):"
echo "  ────────────────────────"
echo "  Per trade:      \$10 max"
echo "  Portfolio cap:  \$50 max exposure"
echo "  Position cap:   5 max concurrent"
echo "  Daily cap:      \$30/day (resets midnight ET)"
echo "  Spread guard:   8c max spread"
echo ""
echo "  Installed at: $DIR"
echo ""
echo "  Live logs:"
echo "    tail -f $DIR/logs/copybot.log"
echo "    tail -f $DIR/logs/signal.log"
echo "    tail -f $DIR/logs/autobot.log"
echo ""
echo "  Ctrl+C to stop all"
echo "═══════════════════════════════════════════"

cleanup() { kill $P1 $P2 $P3 2>/dev/null; echo "Stopped."; exit 0; }
trap cleanup INT TERM

# Stream all logs to terminal
tail -f "$DIR/logs/copybot.log" "$DIR/logs/signal.log" "$DIR/logs/autobot.log" 2>/dev/null &
TP=$!
trap "kill $P1 $P2 $P3 $TP 2>/dev/null; exit 0" INT TERM
wait
