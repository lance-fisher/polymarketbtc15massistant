#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
echo "============================================"
echo "  Polymarket Trading Bots"
echo "============================================"
echo ""

# ── Check .env files ──
if [ ! -f "$DIR/.env" ]; then
  echo "ERROR: Missing .env in project root (BTC 15m bot)"
  echo "  cp .env.example .env  and fill in PRIVATE_KEY"
  exit 1
fi

if [ ! -f "$DIR/copybot/.env" ]; then
  echo "ERROR: Missing copybot/.env (Copy bot)"
  echo "  cp copybot/.env.example copybot/.env  and fill in PRIVATE_KEY"
  exit 1
fi

# ── Install deps ──
echo "[1/4] Installing dependencies..."
cd "$DIR" && npm install --silent 2>/dev/null
cd "$DIR/copybot" && npm install --silent 2>/dev/null

# ── Run approvals for copy bot ──
echo "[2/4] Running USDC approvals for Copy Bot..."
cd "$DIR/copybot"
npm run approve 2>&1 || echo "  (approvals skipped or already set)"

# ── Start BTC 15m Signal + Auto-Trade Bot ──
echo "[3/4] Starting BTC 15m Signal Bot (auto-trade enabled)..."
cd "$DIR"
npm start &
PID_SIGNAL=$!

# ── Start Copy Bot (@anoin123) ──
echo "[4/4] Starting Copy Bot (@anoin123)..."
cd "$DIR/copybot"
npm start &
PID_COPY=$!

echo ""
echo "============================================"
echo "  BOTH BOTS RUNNING"
echo "  Signal Bot PID: $PID_SIGNAL"
echo "  Copy Bot PID:   $PID_COPY"
echo "============================================"
echo "  Press Ctrl+C to stop all bots"
echo ""

# ── Wait for Ctrl+C ──
trap "echo 'Shutting down...'; kill $PID_SIGNAL $PID_COPY 2>/dev/null; exit 0" INT TERM
wait
