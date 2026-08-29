#!/bin/bash
cd "$(dirname "$0")"
PORT=8743
echo "Starting Reel Factory..."
( sleep 1.5 && open "http://localhost:$PORT/" ) &
if command -v python3 &> /dev/null; then
  python3 -m http.server "$PORT"
elif command -v python &> /dev/null; then
  python -m SimpleHTTPServer "$PORT"
else
  echo "Python isn't installed. Install it from python.org, then double-click this file again."
  read -p "Press enter to close..."
fi
