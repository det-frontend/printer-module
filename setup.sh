#!/usr/bin/env bash
set -euo pipefail

# One-command setup for printer-bridge on Linux using pm2 (no auth)
# - Installs pm2 if missing
# - Ensures dialout group permissions
# - Optionally relaxes current /dev device perms once
# - Starts printer-bridge under pm2 and enables on-boot

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

NAME=${NAME:-printer-bridge}
SERIAL_PATH=${SERIAL_PATH:-/dev/ttyUSB0}
BAUD=${BAUD:-9600}
PORT=${PORT:-8081}
PM2_ECOSYSTEM=${PM2_ECOSYSTEM:-}
FIX_DEV_PERMS=${FIX_DEV_PERMS:-true}

print_usage() {
  cat <<EOF
Usage: NAME=printer-bridge SERIAL_PATH=/dev/ttyUSB0 BAUD=9600 PORT=8081 \
       bash setup.sh

Environment variables (optional):
  NAME            pm2 process name (default: printer-bridge)
  SERIAL_PATH     serial device path (default: /dev/ttyUSB0)
  BAUD            baud rate (default: 9600)
  PORT            HTTP port (default: 8081)
  FIX_DEV_PERMS   if 'true', chmod current device once if present (default: true)

Examples:
  SERIAL_PATH=/dev/ttyUSB0 BAUD=9600 PORT=8081 bash setup.sh
  NAME=pb SERIAL_PATH=/dev/ttyS5 PORT=8082 bash setup.sh
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  print_usage
  exit 0
fi

echo "[setup] Working directory: $SCRIPT_DIR"
cd "$SCRIPT_DIR"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "[setup] Missing required command: $1"; exit 1; }
}

need_cmd node
need_cmd npm

if ! command -v pm2 >/dev/null 2>&1; then
  echo "[setup] Installing pm2 globally..."
  npm i -g pm2
else
  echo "[setup] pm2 found"
fi

# Ensure user has dialout permissions (Linux)
if [[ "$(uname -s)" == "Linux" ]]; then
  if id -nG "$USER" | grep -qw dialout; then
    echo "[setup] User '$USER' already in 'dialout' group"
  else
    echo "[setup] Adding user '$USER' to 'dialout' group (logout/login required)"
    if sudo -n true 2>/dev/null; then
      sudo usermod -aG dialout "$USER" || true
      echo "[setup] Added. Please log out and back in for group change to take effect."
    else
      echo "[setup] Could not run sudo non-interactively. Run manually: sudo usermod -aG dialout $USER"
    fi
  fi

  # Optionally relax perms for current device for this session
  if [[ "$FIX_DEV_PERMS" == "true" && -e "$SERIAL_PATH" ]]; then
    echo "[setup] Temporarily relaxing permissions for $SERIAL_PATH (until reboot)"
    if sudo -n true 2>/dev/null; then
      sudo chmod a+rw "$SERIAL_PATH" || true
    else
      echo "[setup] Could not run sudo non-interactively for chmod. Skipping."
    fi
  fi
fi

echo "[setup] Starting pm2 process '$NAME' -> $SERIAL_PATH@$BAUD, port $PORT (no auth)"

# Stop existing process with same name (if any)
if pm2 describe "$NAME" >/dev/null 2>&1; then
  pm2 delete "$NAME" >/dev/null 2>&1 || true
fi

# Start the bridge without BRIDGE_SECRET (open API)
pm2 start "$SCRIPT_DIR/printer.js" --name "$NAME" --env production -- \
  SERIAL_PATH="$SERIAL_PATH" BAUD="$BAUD" PORT="$PORT"

pm2 save

# Configure pm2 to launch on boot
if command -v systemctl >/dev/null 2>&1; then
  if sudo -n true 2>/dev/null; then
    echo "[setup] Enabling pm2 startup via systemd"
    sudo env PATH=$PATH pm2 startup -u "$USER" --hp "$HOME" >/dev/null 2>&1 || true
  else
    echo "[setup] To enable pm2 on boot, run: sudo env PATH=$PATH pm2 startup -u $USER --hp $HOME"
  fi
else
  echo "[setup] systemctl not found; skipping pm2 startup integration"
fi

echo "[setup] Done. Verify with: curl -s http://localhost:$PORT/health"
echo "[setup] If serial open is false, replug the adapter or run: pm2 logs $NAME"


