#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

APP_DIR="/data/data/com.termux/files/home/bnb"
PID_FILE="$APP_DIR/run/server.pid"
cd "$APP_DIR"

if [[ ! -f "$PID_FILE" ]]; then
  echo "Status: stopped (PID file tidak ada)"
  exit 1
fi

pid="$(cat "$PID_FILE")"
if ! kill -0 "$pid" 2>/dev/null; then
  echo "Status: stopped (PID $pid sudah tidak aktif)"
  exit 1
fi

port="${PORT:-$(grep -E '^PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2-)}"
port="${port:-3000}"
if curl -fsS --max-time 5 "http://127.0.0.1:${port}/api/health/live" >/dev/null; then
  echo "Status: running (PID $pid, port $port, health OK)"
else
  echo "Status: running (PID $pid), health check gagal"
  exit 1
fi
