#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════
#  POLYMARKET 3-BOT LAUNCHER — paste this into any terminal
# ═══════════════════════════════════════════════════════
set -e

echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║  POLYMARKET 3-BOT BOOTSTRAP              ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""

# ── Prerequisites check ──
command -v node >/dev/null 2>&1 || { echo "Need Node.js 18+. Install: https://nodejs.org"; exit 1; }
command -v git >/dev/null 2>&1 || { echo "Need git. Install: https://git-scm.com"; exit 1; }

NODE_V=$(node -v | cut -d. -f1 | tr -d v)
if [ "$NODE_V" -lt 18 ]; then echo "Need Node 18+, got $(node -v)"; exit 1; fi
echo "[ok] Node $(node -v)"

# ── Clone / update ──
REPO="https://github.com/lance-fisher/polymarketbtc15massistant.git"

# Pick install dir: D:\ProjectsHome on Windows, ~/polymarket-bots elsewhere
if [ -d "/d/ProjectsHome" ]; then
  DIR="/d/ProjectsHome/polymarket-bots"
elif [ -d "/mnt/d/ProjectsHome" ]; then
  DIR="/mnt/d/ProjectsHome/polymarket-bots"
else
  DIR="$HOME/polymarket-bots"
fi

if [ -d "$DIR/.git" ]; then
  echo "[ok] Repo exists at $DIR — pulling latest..."
  cd "$DIR" && git pull origin claude/polymarket-copy-bot-xcdOo 2>/dev/null || true
else
  echo "[clone] Cloning to $DIR ..."
  git clone -b claude/polymarket-copy-bot-xcdOo "$REPO" "$DIR"
fi
cd "$DIR"

# ── Wallet keys (already generated) ──
KEY_SIGNAL="0x674f6d0fe405f168a33d360555044cb9ff73cad75262c3d6d74b8f1db4c328d1"
KEY_COPY="0x99a1838ce42b8e0a2aa46de1356d77270190e02dd9ebf625d4f8913ea448aea3"
KEY_AUTO="0x66dbe2e0f2649ca433ec1a5fd1ff776fee9900b3623e05415af16c5f4bb1b2c3"
RPC="https://polygon-bor-rpc.publicnode.com"

# ── Write .env files ──
cat > "$DIR/.env" << EOF
PRIVATE_KEY=$KEY_SIGNAL
POLYGON_RPC_URL=$RPC
AUTO_TRADE=true
MAX_USDC_PER_TRADE=10
EOF

cat > "$DIR/copybot/.env" << EOF
PRIVATE_KEY=$KEY_COPY
POLYGON_RPC_URL=$RPC
TARGET_ADDRESS=0xEd5f13e3373079F62E3c5fce82D1e6263B063a3c
POLL_INTERVAL_S=30
TRADE_USDC=10
MAX_PORTFOLIO_USDC=100
MAX_POSITIONS=10
EOF

cat > "$DIR/autobot/.env" << EOF
PRIVATE_KEY=$KEY_AUTO
POLYGON_RPC_URL=$RPC
MAX_TRADE_USDC=10
MAX_PORTFOLIO_USDC=100
MAX_POSITIONS=10
SCAN_INTERVAL_S=60
MIN_EDGE=0.08
MIN_LIQUIDITY=1000
EOF

echo "[ok] .env files written"

# ── Install deps ──
echo "[npm] Installing..."
(cd "$DIR" && npm install --silent)
(cd "$DIR/copybot" && npm install --silent)
(cd "$DIR/autobot" && npm install --silent)
echo "[ok] Dependencies installed"

# ── Run approvals (sequentially, with delay to avoid rate limits) ──
echo ""
echo "[approve] Setting USDC + CTF approvals on-chain..."
echo "  (this needs MATIC in each wallet for gas)"
echo ""

(cd "$DIR/copybot" && node --env-file=.env src/approve.js 2>&1) || echo "  Copy Bot approval failed (need MATIC?)"
sleep 3
(cd "$DIR/autobot" && node --env-file=.env src/approve.js 2>&1) || echo "  Auto Bot approval failed (need MATIC?)"
echo ""

# ── Launch all 3 ──
mkdir -p "$DIR/logs"

echo "═══════════════════════════════════════════"
echo "  LAUNCHING ALL 3 BOTS"
echo "═══════════════════════════════════════════"
echo ""

# Bot 1: Copy Bot
(cd "$DIR/copybot" && node --env-file=.env src/index.js >> "$DIR/logs/copybot.log" 2>&1) &
P1=$!
echo "  [1] Copy Bot (@anoin123)   PID=$P1"

# Bot 2: Signal Bot (BTC 15m)
(cd "$DIR" && node --env-file=.env src/index.js >> "$DIR/logs/signal.log" 2>&1) &
P2=$!
echo "  [2] Signal Bot (BTC 15m)   PID=$P2"

# Bot 3: Autonomous Bot
(cd "$DIR/autobot" && node --env-file=.env src/index.js >> "$DIR/logs/autobot.log" 2>&1) &
P3=$!
echo "  [3] Autonomous Bot         PID=$P3"

echo ""
echo "  Wallets:"
echo "  ────────"
echo "  Signal:  0x5eD48e29dcd952955d7E4fccC3616EFA38cD75a5"
echo "  Copy:    0xf35803f093BBceaBEb9A6abd3d4c99856BDdA40C"
echo "  Auto:    0xf17Cb352380Fd5503742c5A0573cDE4c656d8486"
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

# Stream all logs
tail -f "$DIR/logs/copybot.log" "$DIR/logs/signal.log" "$DIR/logs/autobot.log" 2>/dev/null &
TP=$!
trap "kill $P1 $P2 $P3 $TP 2>/dev/null; exit 0" INT TERM
wait
