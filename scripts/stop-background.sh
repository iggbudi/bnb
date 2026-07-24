#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

APP_DIR="/data/data/com.termux/files/home/bnb"
PID_FILE="$APP_DIR/run/server.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "BNB LP Analyzer background tidak sedang berjalan."
  exit 0
fi

pid="$(cat "$PID_FILE")"
if kill -0 "$pid" 2>/dev/null; then
  kill "$pid"
  # Server drains HTTP requests/schedulers and closes every SQLite handle (default timeout 15s).
  for _ in {1..40}; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.5
  done
  if kill -0 "$pid" 2>/dev/null; then
    echo "Graceful shutdown melewati 20 detik; mengirim SIGKILL." >&2
    kill -9 "$pid" 2>/dev/null || true
  fi
  echo "BNB LP Analyzer dihentikan (PID $pid)."
else
  echo "PID lama ditemukan; proses sudah tidak berjalan."
fi

rm -f "$PID_FILE"
termux-wake-unlock 2>/dev/null || true
