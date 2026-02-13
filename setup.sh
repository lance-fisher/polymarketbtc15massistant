#!/usr/bin/env bash
#
# ONE-TIME SETUP — Run this once. It installs everything, creates .env files,
# and drops a desktop shortcut you can double-click to launch all 3 bots.
#
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║   POLYMARKET BOTS — ONE-TIME SETUP           ║"
echo "  ╚══════════════════════════════════════════════╝"
echo ""

# ── 1. Install Node dependencies ──
echo "[1/3] Installing dependencies..."
(cd "$DIR" && npm install 2>/dev/null)
(cd "$DIR/copybot" && npm install 2>/dev/null)
(cd "$DIR/autobot" && npm install 2>/dev/null)
echo "  Done."

# ── 2. Create .env files if missing ──
if [ ! -f "$DIR/.env" ]; then
  cp "$DIR/.env.example" "$DIR/.env"
  echo "[2/3] Created .env — edit it to add your PRIVATE_KEY"
else
  echo "[2/3] .env already exists"
fi

if [ ! -f "$DIR/copybot/.env" ]; then
  cp "$DIR/copybot/.env.example" "$DIR/copybot/.env"
  echo "  Created copybot/.env"
fi

if [ ! -f "$DIR/autobot/.env" ]; then
  cp "$DIR/autobot/.env.example" "$DIR/autobot/.env"
  echo "  Created autobot/.env"
fi

# ── 3. Create desktop shortcut ──
DESKTOP=""
if [ -d "$HOME/Desktop" ]; then
  DESKTOP="$HOME/Desktop"
elif [ -d "$HOME/desktop" ]; then
  DESKTOP="$HOME/desktop"
fi

OS="$(uname -s)"

if [ "$OS" = "Darwin" ]; then
  # macOS — create a .command file (double-clickable)
  SHORTCUT="$DESKTOP/Polymarket Bots.command"
  cat > "$SHORTCUT" << SCRIPT
#!/usr/bin/env bash
cd "$DIR"
./run.sh
SCRIPT
  chmod +x "$SHORTCUT"
  echo "[3/3] Created desktop shortcut: $SHORTCUT"

elif [ -n "$DESKTOP" ]; then
  # Linux — create a .desktop file
  SHORTCUT="$DESKTOP/polymarket-bots.desktop"
  cat > "$SHORTCUT" << SCRIPT
[Desktop Entry]
Type=Application
Name=Polymarket Bots
Exec=bash -c 'cd "$DIR" && ./run.sh; exec bash'
Terminal=true
Icon=utilities-terminal
Comment=Launch all 3 Polymarket trading bots
SCRIPT
  chmod +x "$SHORTCUT"
  echo "[3/3] Created desktop shortcut: $SHORTCUT"

else
  echo "[3/3] No Desktop folder found — run ./run.sh manually"
fi

# ── Windows WSL / Git Bash ──
if [ -d "/mnt/c/Users" ]; then
  WIN_USER=$(ls /mnt/c/Users/ | grep -v -E "^(Public|Default|All Users|Default User)$" | head -1)
  if [ -n "$WIN_USER" ] && [ -d "/mnt/c/Users/$WIN_USER/Desktop" ]; then
    BAT="/mnt/c/Users/$WIN_USER/Desktop/Polymarket Bots.bat"
    # Convert WSL path to Windows path
    WIN_DIR=$(wslpath -w "$DIR" 2>/dev/null || echo "")
    if [ -n "$WIN_DIR" ]; then
      cat > "$BAT" << SCRIPT
@echo off
wsl -e bash -c "cd '$DIR' && ./run.sh"
pause
SCRIPT
      echo "  Also created Windows shortcut: $BAT"
    fi
  fi
fi

echo ""
echo "  ════════════════════════════════════════════"
echo "  SETUP COMPLETE"
echo ""
echo "  Next steps:"
echo "    1. Fund the wallets on Polygon with USDC + MATIC"
echo "    2. Double-click 'Polymarket Bots' on your Desktop"
echo "    3. Done — bots will trade automatically"
echo "  ════════════════════════════════════════════"
echo ""
