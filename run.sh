#!/usr/bin/env bash
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║     POLYMARKET TRADING BOTS LAUNCHER     ║"
echo "  ╠══════════════════════════════════════════╣"
echo "  ║  Bot 1: Copy Bot (@anoin123)             ║"
echo "  ║  Bot 2: BTC 15m Signal Bot (auto-trade)  ║"
echo "  ║  Bot 3: Autonomous Opportunity Bot       ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""

mkdir -p "$DIR/logs"

# ── Install all deps ──
echo "[setup] Installing dependencies..."
(cd "$DIR" && npm install --silent 2>/dev/null)
(cd "$DIR/copybot" && npm install --silent 2>/dev/null)
(cd "$DIR/autobot" && npm install --silent 2>/dev/null)
echo "[setup] Done"

# ── Initialize state files if missing ──
if [ ! -f "$DIR/state.json" ]; then
  echo '{}' > "$DIR/state.json"
  echo "[setup] Created state.json"
fi
if [ ! -f "$DIR/autobot-state.json" ]; then
  echo '{}' > "$DIR/autobot-state.json"
  echo "[setup] Created autobot-state.json"
fi

# ── Approvals are now handled automatically by each bot on startup ──
# No separate approval step needed — bots check and approve inline.
echo "[setup] Approvals will run automatically on first bot startup"
echo ""

# ── Launch all 3 bots ──
echo "[launch] Starting all bots..."

(cd "$DIR/copybot" && npm start >> "$DIR/logs/copybot.log" 2>&1) &
PID1=$!

(cd "$DIR" && npm start >> "$DIR/logs/signal.log" 2>&1) &
PID2=$!

(cd "$DIR/autobot" && npm start >> "$DIR/logs/autobot.log" 2>&1) &
PID3=$!

echo ""
echo "  ════════════════════════════════════════════"
echo "  ALL 3 BOTS RUNNING"
echo ""
echo "  Copy Bot PID:       $PID1"
echo "  Signal Bot PID:     $PID2"
echo "  Autonomous Bot PID: $PID3"
echo ""
echo "  Logs:"
echo "    tail -f $DIR/logs/copybot.log"
echo "    tail -f $DIR/logs/signal.log"
echo "    tail -f $DIR/logs/autobot.log"
echo ""
echo "  Ctrl+C to stop all"
echo "  ════════════════════════════════════════════"
echo ""

cleanup() {
  echo ""
  echo "Shutting down all bots..."
  kill $PID1 $PID2 $PID3 2>/dev/null
  exit 0
}
trap cleanup INT TERM

tail -f "$DIR/logs/copybot.log" "$DIR/logs/signal.log" "$DIR/logs/autobot.log" 2>/dev/null &
TAIL_PID=$!
trap "kill $PID1 $PID2 $PID3 $TAIL_PID 2>/dev/null; exit 0" INT TERM
wait
