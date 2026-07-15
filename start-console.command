#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

PORT="${PORT:-4317}"
URL="http://localhost:${PORT}"

if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  open "$URL" >/dev/null 2>&1 || true
  echo "Pixel Toys is already running:"
  echo "  $URL"
  exit 0
fi

(sleep 1.2 && open "$URL" >/dev/null 2>&1 || true) &
npm start
