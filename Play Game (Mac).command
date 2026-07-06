#!/bin/bash
# ============================================================
# Play Game (Mac).command
# Double-click this file to launch the game — no terminal typing.
# It finds its own folder, starts a local web server (needed for
# the webcam pose control), opens the game in your browser, and
# shuts the server down when you close this window.
# ============================================================

# cd into the folder this script lives in (works no matter where the
# game folder is moved/copied to).
cd "$(dirname "$0")" || exit 1

PORT=8000
# If 8000 is busy, walk up to find a free port.
while lsof -i :"$PORT" >/dev/null 2>&1; do
  PORT=$((PORT+1))
done

URL="http://localhost:$PORT"
echo "=================================================="
echo "  Untitled Quest — starting local server"
echo "  Folder: $(pwd)"
echo "  URL:    $URL"
echo "=================================================="
echo ""
echo "Opening your browser… (keep this window open while playing)"
echo "Close this window to stop the game server."
echo ""

# Pick python3 (macOS ships it after the one-time Xcode tools prompt).
if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo "Python is not installed. A one-time install prompt will appear."
  echo "Click 'Install', wait for it to finish, then double-click this file again."
  xcode-select --install
  read -r -p "Press Enter to close…"
  exit 1
fi

# Start the server in the background, open the browser, then wait.
"$PY" -m http.server "$PORT" >/dev/null 2>&1 &
SERVER_PID=$!

# Give the server a moment, then open the default browser.
sleep 1
open "$URL"

# When this Terminal window/script is closed, stop the server.
trap 'kill $SERVER_PID 2>/dev/null' EXIT

# Keep the script alive so the server keeps running.
wait $SERVER_PID
